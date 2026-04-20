import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { ensureUrn } from "../linkedin/urn.js";
import { AnalyticsQuerySchema } from "../schemas/analytics.js";
import { AccountIdSchema } from "../schemas/common.js";
import { callLinkedIn, jsonResult } from "./_helpers.js";
import { logger } from "../utils/logger.js";

interface AnalyticsRow {
  pivotValues?: string[];
  pivotLabels?: string[];
  dateRange?: { start: { year: number; month: number; day: number }; end: { year: number; month: number; day: number } };
  [metric: string]: unknown;
}

// ---------------------------------------------------------------------------
// URN → human-readable label resolution
// ---------------------------------------------------------------------------

/** URN prefixes resolvable via /adTargetingEntities?q=urns */
const RESOLVABLE_PREFIXES = [
  "urn:li:title:",
  "urn:li:industry:",
  "urn:li:seniority:",
  "urn:li:function:",
  "urn:li:geo:",
  "urn:li:skill:",
  "urn:li:degree:",
  "urn:li:fieldOfStudy:",
  "urn:li:organization:",
  "urn:li:locale:",
];

/** Static labels for staffCountRange (no API call needed). */
const STAFF_COUNT_LABELS: Record<string, string> = {
  "urn:li:staffCountRange:(1,1)": "Self-employed (1)",
  "urn:li:staffCountRange:(2,10)": "2-10 employees",
  "urn:li:staffCountRange:(11,50)": "11-50 employees",
  "urn:li:staffCountRange:(51,200)": "51-200 employees",
  "urn:li:staffCountRange:(201,500)": "201-500 employees",
  "urn:li:staffCountRange:(501,1000)": "501-1,000 employees",
  "urn:li:staffCountRange:(1001,5000)": "1,001-5,000 employees",
  "urn:li:staffCountRange:(5001,10000)": "5,001-10,000 employees",
  "urn:li:staffCountRange:(10001,2147483647)": "10,001+ employees",
};

interface TargetingEntity {
  urn: string;
  name?: string;
  facetUrn?: string;
}

/**
 * Resolve a list of URNs to human-readable labels.
 * Uses /adTargetingEntities?q=urns for demographic entities (titles,
 * industries, geos, etc.) and static mapping for staffCountRange.
 * Non-blocking: returns whatever it can resolve, leaves the rest as URN strings.
 */
async function resolveUrnsToLabels(
  client: AxiosInstance,
  urns: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (urns.length === 0) return labels;

  // Static resolutions (staff count ranges)
  for (const urn of urns) {
    if (STAFF_COUNT_LABELS[urn]) {
      labels.set(urn, STAFF_COUNT_LABELS[urn]);
    }
  }

  // Dynamic resolutions via adTargetingEntities
  const resolvable = urns.filter(
    (u) => RESOLVABLE_PREFIXES.some((p) => u.startsWith(p)) && !labels.has(u),
  );

  if (resolvable.length === 0) return labels;

  // Batch in groups of 50 (LinkedIn limit per call)
  for (let i = 0; i < resolvable.length; i += 50) {
    const batch = resolvable.slice(i, i + 50);
    const encodedUrns = batch.map((u) => encodeURIComponent(u)).join(",");
    try {
      const data = await callLinkedIn<{ elements: TargetingEntity[] }>(
        client,
        `/adTargetingEntities?q=urns&urns=List(${encodedUrns})`,
      );
      for (const entity of data.elements) {
        if (entity.name) {
          labels.set(entity.urn, entity.name);
        }
      }
      logger.debug({ resolved: data.elements.length, batch: batch.length }, "Resolved URNs to labels");
    } catch {
      // Non-blocking — if resolution fails, rows still have pivotValues (raw URNs)
      logger.warn({ batchSize: batch.length }, "Failed to resolve targeting entity URNs to labels");
    }
  }

  return labels;
}

/**
 * Enrich analytics rows with pivotLabels by resolving pivotValues URNs.
 */
async function enrichWithLabels(
  client: AxiosInstance,
  rows: AnalyticsRow[],
): Promise<AnalyticsRow[]> {
  const allUrns = [...new Set(rows.flatMap((r) => r.pivotValues ?? []))];
  if (allUrns.length === 0) return rows;

  const labelMap = await resolveUrnsToLabels(client, allUrns);
  if (labelMap.size === 0) return rows;

  return rows.map((r) => ({
    ...r,
    pivotLabels: (r.pivotValues ?? []).map((urn) => labelMap.get(urn) ?? urn),
  }));
}

interface AnalyticsResponse {
  elements: AnalyticsRow[];
  paging?: { total?: number };
}

/**
 * Build the LinkedIn /adAnalytics query string from a typed AnalyticsQuery.
 * The endpoint is famously fiddly: dateRange is a Restli object literal, the
 * pivot is `q=analytics`, and metric arrays go in `fields`.
 */
export function buildAnalyticsQuery(
  query: z.infer<typeof AnalyticsQuerySchema>,
  accountUrn: string,
): string {
  const start = query.dateRange.start;
  const end = query.dateRange.end;
  // Restli object literal — commas, parentheses and colons must stay raw
  const dateRange =
    `(start:(year:${start.year},month:${start.month},day:${start.day}),` +
    `end:(year:${end.year},month:${end.month},day:${end.day}))`;

  // Build the query string manually so that Restli-special characters
  // (commas, parentheses, colons) are NOT percent-encoded.
  // Only URNs inside List(...) are individually URL-encoded.
  // Always include pivotValues (identifies what each row represents, e.g.
  // "urn:li:title:26") and dateRange (time period per row when granularity
  // is not ALL). Without pivotValues, demographic pivots like
  // MEMBER_JOB_TITLE return metrics without any way to know which title
  // each row belongs to.
  const allFields = [...new Set([...query.fields, "pivotValues", "dateRange"])];

  const parts: string[] = [
    `q=analytics`,
    `pivot=${query.pivot}`,
    `timeGranularity=${query.timeGranularity}`,
    `dateRange=${dateRange}`,
    `fields=${allFields.join(",")}`,
  ];

  // Scope filters: prefer the most specific one passed by the caller
  if (query.campaigns?.length) {
    const urns = query.campaigns.map((c) => ensureUrn("sponsoredCampaign", c));
    parts.push(`campaigns=List(${urns.map((u) => encodeURIComponent(u)).join(",")})`);
  } else if (query.creatives?.length) {
    const urns = query.creatives.map((c) => ensureUrn("sponsoredCreative", c));
    parts.push(`creatives=List(${urns.map((u) => encodeURIComponent(u)).join(",")})`);
  } else if (query.accounts?.length) {
    const urns = query.accounts.map((a) => ensureUrn("sponsoredAccount", a));
    parts.push(`accounts=List(${urns.map((u) => encodeURIComponent(u)).join(",")})`);
  } else {
    // Default to the account passed at the tool level
    parts.push(`accounts=List(${encodeURIComponent(accountUrn)})`);
  }

  return parts.join("&");
}

export function registerAnalyticsTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "get_campaign_analytics",
    {
      title: "Get Campaign Analytics",
      description:
        "Fetch performance analytics for one or more campaigns. Pivot/granularity/dateRange/fields " +
        "control the shape of the report. Returns up to 50 rows inline; if the response is bigger " +
        "it is written to ${DATA_DIR}/exports/{timestamp}.json and the path is returned. " +
        "LinkedIn caps a single response at 15 000 rows — narrow the dateRange if you hit that.",
      inputSchema: {
        account_id: AccountIdSchema.describe(
          "Ad Account scope. Used as a default filter if `query.campaigns` is not set.",
        ),
        query: AnalyticsQuerySchema,
      },
    },
    async ({ account_id, query }) => {
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const qs = buildAnalyticsQuery(query, accountUrn);
      const data = await callLinkedIn<AnalyticsResponse>(client, `/adAnalytics?${qs}`);

      // Resolve pivotValues URNs to human-readable labels (e.g. urn:li:title:26 → "Responsable marketing")
      const enrichedRows = await enrichWithLabels(client, data.elements);

      const inlineLimit = 50;
      if (enrichedRows.length <= inlineLimit) {
        return jsonResult({
          rowCount: enrichedRows.length,
          rows: enrichedRows,
        });
      }

      // Big payload: write to disk and return the path
      const dataDir = process.env.DATA_DIR ?? "./data";
      const exportsDir = join(dataDir, "exports");
      await mkdir(exportsDir, { recursive: true });
      const filename = join(exportsDir, `analytics-${Date.now()}.json`);
      await writeFile(filename, JSON.stringify(enrichedRows, null, 2));
      return jsonResult({
        rowCount: enrichedRows.length,
        truncated: true,
        preview: enrichedRows.slice(0, 10),
        exportPath: filename,
        note: `Full result written to ${filename} (${enrichedRows.length} rows). Read the file with the filesystem tool if you need the rest.`,
      });
    },
  );

  server.registerTool(
    "get_account_analytics",
    {
      title: "Get Account Analytics",
      description:
        "Fetch aggregated performance analytics at the Ad Account level (across all campaigns). " +
        "Same shape as get_campaign_analytics but the pivot defaults to ACCOUNT.",
      inputSchema: {
        account_id: AccountIdSchema,
        query: AnalyticsQuerySchema,
      },
    },
    async ({ account_id, query }) => {
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const enrichedQuery = { ...query, accounts: [account_id], campaigns: undefined };
      const qs = buildAnalyticsQuery(enrichedQuery, accountUrn);
      const data = await callLinkedIn<AnalyticsResponse>(client, `/adAnalytics?${qs}`);
      const enrichedRows = await enrichWithLabels(client, data.elements);
      return jsonResult({
        rowCount: enrichedRows.length,
        rows: enrichedRows,
      });
    },
  );
}
