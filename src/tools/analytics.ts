import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { ensureUrn } from "../linkedin/urn.js";
import { AnalyticsQuerySchema } from "../schemas/analytics.js";
import { AccountIdSchema } from "../schemas/common.js";
import { callLinkedIn, jsonResult } from "./_helpers.js";

interface AnalyticsRow {
  pivotValues?: string[];
  dateRange?: { start: { year: number; month: number; day: number }; end: { year: number; month: number; day: number } };
  [metric: string]: unknown;
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

      const inlineLimit = 50;
      if (data.elements.length <= inlineLimit) {
        return jsonResult({
          rowCount: data.elements.length,
          rows: data.elements,
        });
      }

      // Big payload: write to disk and return the path
      const dataDir = process.env.DATA_DIR ?? "./data";
      const exportsDir = join(dataDir, "exports");
      await mkdir(exportsDir, { recursive: true });
      const filename = join(exportsDir, `analytics-${Date.now()}.json`);
      await writeFile(filename, JSON.stringify(data.elements, null, 2));
      return jsonResult({
        rowCount: data.elements.length,
        truncated: true,
        preview: data.elements.slice(0, 10),
        exportPath: filename,
        note: `Full result written to ${filename} (${data.elements.length} rows). Read the file with the filesystem tool if you need the rest.`,
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
      // Reuse the same handler logic by enforcing the accounts filter
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const enrichedQuery = { ...query, accounts: [account_id], campaigns: undefined };
      const qs = buildAnalyticsQuery(enrichedQuery, accountUrn);
      const data = await callLinkedIn<AnalyticsResponse>(client, `/adAnalytics?${qs}`);
      return jsonResult({
        rowCount: data.elements.length,
        rows: data.elements,
      });
    },
  );
}
