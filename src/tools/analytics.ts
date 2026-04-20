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

// ---------------------------------------------------------------------------
// In-memory analytics results cache for pagination.
// When a query returns > PAGE_SIZE rows, the full result is cached here
// and a pageToken is returned so Claude can request subsequent pages without
// re-calling LinkedIn.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  rows: AnalyticsRow[];
  createdAt: number;
}

const analyticsCache = new Map<string, CacheEntry>();

/** Evict stale entries on each access. */
function evictStaleCache(): void {
  const now = Date.now();
  for (const [key, entry] of analyticsCache) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      analyticsCache.delete(key);
    }
  }
}

/** Compute summary stats across all numeric fields of a row set. */
function computeSummary(rows: AnalyticsRow[]): Record<string, { total: number; avg: number; min: number; max: number }> {
  const firstRow = rows[0] ?? {};
  const numericFields = Object.keys(firstRow).filter(
    (k) => typeof firstRow[k] === "number",
  );
  const summary: Record<string, { total: number; avg: number; min: number; max: number }> = {};
  for (const field of numericFields) {
    const values = rows.map((r) => (r[field] as number) ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    summary[field] = {
      total,
      avg: Math.round((total / values.length) * 100) / 100,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
  return summary;
}

/** Sort rows by the first numeric metric field, descending (top performers first). */
function sortByTopMetric(rows: AnalyticsRow[]): AnalyticsRow[] {
  const firstRow = rows[0] ?? {};
  const sortField = Object.keys(firstRow).find((k) => typeof firstRow[k] === "number");
  if (!sortField) return rows;
  return [...rows].sort((a, b) => ((b[sortField] as number) ?? 0) - ((a[sortField] as number) ?? 0));
}

/**
 * Paginated analytics response builder. Handles:
 * - pageToken continuation (read from cache)
 * - Fresh queries (call LinkedIn, enrich, sort, cache, return page 1)
 */
async function handleAnalyticsRequest(
  client: AxiosInstance,
  qs: string,
  pageToken?: string,
): Promise<ReturnType<typeof jsonResult>> {
  evictStaleCache();

  // --- Continuation: serve page from cache ---
  if (pageToken) {
    const [cacheId, offsetStr] = pageToken.split(":");
    const offset = Number(offsetStr);
    const entry = analyticsCache.get(cacheId ?? "");
    if (!entry) {
      return jsonResult({
        error: "page_token_expired",
        message: "The analytics cache entry has expired (TTL 5 min). Please re-run the original query.",
      });
    }
    const page = entry.rows.slice(offset, offset + PAGE_SIZE);
    const hasMore = offset + PAGE_SIZE < entry.rows.length;
    return jsonResult({
      rowCount: entry.rows.length,
      page: Math.floor(offset / PAGE_SIZE) + 1,
      pageSize: PAGE_SIZE,
      rows: page,
      nextPageToken: hasMore ? `${cacheId}:${offset + PAGE_SIZE}` : null,
    });
  }

  // --- Fresh query: call LinkedIn ---
  const data = await callLinkedIn<AnalyticsResponse>(client, `/adAnalytics?${qs}`);
  const enrichedRows = await enrichWithLabels(client, data.elements);
  const sortedRows = sortByTopMetric(enrichedRows);

  // Small result: return everything inline
  if (sortedRows.length <= PAGE_SIZE) {
    return jsonResult({
      rowCount: sortedRows.length,
      rows: sortedRows,
    });
  }

  // Large result: cache + return page 1 + summary
  const cacheId = `analytics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  analyticsCache.set(cacheId, { rows: sortedRows, createdAt: Date.now() });
  logger.info({ cacheId, totalRows: sortedRows.length }, "Analytics result cached for pagination");

  const page1 = sortedRows.slice(0, PAGE_SIZE);
  const summary = computeSummary(sortedRows);

  return jsonResult({
    rowCount: sortedRows.length,
    page: 1,
    pageSize: PAGE_SIZE,
    rows: page1,
    summary,
    nextPageToken: `${cacheId}:${PAGE_SIZE}`,
    note: `Showing top ${PAGE_SIZE} of ${sortedRows.length} rows (sorted by top metric desc). ` +
      `Call again with page_token to get the next page. Summary covers all ${sortedRows.length} rows.`,
  });
}

export function registerAnalyticsTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "get_campaign_analytics",
    {
      title: "Get Campaign Analytics",
      description:
        "Fetch performance analytics for one or more campaigns. Pivot/granularity/dateRange/fields " +
        "control the shape of the report. Returns up to 100 rows inline (sorted by top metric). " +
        "If the result has more rows, a nextPageToken is returned — call this tool again with " +
        "page_token to get the next 100. LinkedIn caps at 15,000 rows per query. " +
        "Guidance: Use ALL for aggregates, MONTHLY for trends > 30 days, DAILY for 7-14 day windows.",
      inputSchema: {
        account_id: AccountIdSchema.describe(
          "Ad Account scope. Used as a default filter if `query.campaigns` is not set.",
        ),
        query: AnalyticsQuerySchema,
        page_token: z.string().optional().describe(
          "Pagination token from a previous response's nextPageToken. " +
          "Pass this to get the next page of results without re-querying LinkedIn.",
        ),
      },
    },
    async ({ account_id, query, page_token }) => {
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const qs = buildAnalyticsQuery(query, accountUrn);
      return handleAnalyticsRequest(client, qs, page_token);
    },
  );

  server.registerTool(
    "get_account_analytics",
    {
      title: "Get Account Analytics",
      description:
        "Fetch aggregated performance analytics at the Ad Account level (across all campaigns). " +
        "Same as get_campaign_analytics but scoped to the full account. " +
        "Returns up to 100 rows inline. Pass page_token for subsequent pages. " +
        "Guidance: Use ALL for aggregates, MONTHLY for trends > 30 days, DAILY for 7-14 day windows.",
      inputSchema: {
        account_id: AccountIdSchema,
        query: AnalyticsQuerySchema,
        page_token: z.string().optional().describe(
          "Pagination token from a previous response's nextPageToken.",
        ),
      },
    },
    async ({ account_id, query, page_token }) => {
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const enrichedQuery = { ...query, accounts: [account_id], campaigns: undefined };
      const qs = buildAnalyticsQuery(enrichedQuery, accountUrn);
      return handleAnalyticsRequest(client, qs, page_token);
    },
  );
}
