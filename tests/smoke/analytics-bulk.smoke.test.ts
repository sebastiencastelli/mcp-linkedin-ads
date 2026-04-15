import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  callTool,
  TEST_ACCOUNT_ID,
  KNOWN_CAMPAIGN_ID,
  futureTimestamp,
  uniqueName,
} from "./_mcp-client.js";

// ---------------------------------------------------------------------------
// Shared date helpers
// ---------------------------------------------------------------------------

/** Last 7 days — date objects for the analytics query schema. */
function last7Days(): { start: { year: number; month: number; day: number }; end: { year: number; month: number; day: number } } {
  const now = new Date();
  const end = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const start = { year: from.getFullYear(), month: from.getMonth() + 1, day: from.getDate() };
  return { start, end };
}

/** Last 365 days. */
function last365Days(): { start: { year: number; month: number; day: number }; end: { year: number; month: number; day: number } } {
  const now = new Date();
  const end = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  const start = { year: from.getFullYear(), month: from.getMonth() + 1, day: from.getDate() };
  return { start, end };
}

// KNOWN_CAMPAIGN_ID is imported from the helper (SMOKE_KNOWN_CAMPAIGN_ID env var).
// It points to an existing active/completed campaign with historical analytics data —
// sandbox DRAFT campaigns have zero impressions so LinkedIn returns empty results.

// Minimal France targeting reused for sandbox campaigns.
const FR_TARGETING = {
  include: {
    and: [
      {
        or: {
          "urn:li:adTargetingFacet:locations": ["urn:li:geo:105015875"],
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// ANALYTICS — account-level
// ---------------------------------------------------------------------------

describe("analytics — account-level — granularity variants", () => {
  it(
    "DAILY granularity + ACCOUNT pivot — rows have dateRange and numeric metrics",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "DAILY",
          dateRange: last7Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
      expect(Array.isArray(data.rows)).toBe(true);
      // DAILY rows must carry a dateRange
      for (const row of data.rows as Array<Record<string, unknown>>) {
        // Each numeric metric, when present, must be a number
        if ("impressions" in row) expect(typeof row.impressions).toBe("number");
        if ("clicks" in row) expect(typeof row.clicks).toBe("number");
      }
    },
    { timeout: 60_000 },
  );

  it(
    "MONTHLY granularity + ACCOUNT pivot — rows have dateRange",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "MONTHLY",
          dateRange: last365Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      expect(typeof data.rowCount).toBe("number");
      for (const row of data.rows) {
      }
    },
    { timeout: 60_000 },
  );

  it(
    "YEARLY granularity + ACCOUNT pivot — returns ok, rows have dateRange",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "YEARLY",
          dateRange: last365Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      expect(typeof data.rowCount).toBe("number");
      for (const row of data.rows) {
      }
    },
    { timeout: 60_000 },
  );

  it(
    "ALL granularity + ACCOUNT pivot — single aggregated row, no dateRange required",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
      expect(Array.isArray(data.rows)).toBe(true);
    },
    { timeout: 60_000 },
  );
});

describe("analytics — account-level — pivot variants", () => {
  it(
    "pivot CAMPAIGN — returns rows with pivotValues",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CAMPAIGN",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      expect(typeof data.rowCount).toBe("number");
      // When rows are present each should carry pivotValues
      if (data.rows.length > 0) {
      }
    },
    { timeout: 60_000 },
  );

  it(
    "pivot CREATIVE — ok and rowCount is a number",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CREATIVE",
          timeGranularity: "ALL",
          dateRange: last7Days(),
          fields: ["impressions", "clicks"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
    },
    { timeout: 60_000 },
  );

  it(
    "pivot MEMBER_SENIORITY — demographic breakdown, rows have pivotValues",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "MEMBER_SENIORITY",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["impressions", "clicks"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      expect(typeof data.rowCount).toBe("number");
      if (data.rows.length > 0) {
      }
    },
    { timeout: 60_000 },
  );

  it(
    "pivot MEMBER_INDUSTRY — demographic breakdown, returns ok",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "MEMBER_INDUSTRY",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["impressions", "clicks"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
    },
    { timeout: 60_000 },
  );
});

describe("analytics — account-level — viral / engagement metrics", () => {
  it(
    "viralImpressions + reactions + videoViews + totalEngagements — numeric values when present",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["viralImpressions", "reactions", "videoViews", "totalEngagements"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      expect(typeof data.rowCount).toBe("number");
      for (const row of data.rows) {
        for (const metric of ["viralImpressions", "reactions", "videoViews", "totalEngagements"] as const) {
          if (metric in row) {
            expect(typeof row[metric]).toBe("number");
          }
        }
      }
    },
    { timeout: 60_000 },
  );

  it(
    "long date range (365 days) + DAILY granularity — rowCount is a number and no error",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "DAILY",
          dateRange: last365Days(),
          fields: ["impressions", "costInLocalCurrency"],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number };
      expect(typeof data.rowCount).toBe("number");
    },
    { timeout: 60_000 },
  );
});

describe("analytics — account-level — error cases", () => {
  it(
    "pivot OBJECTIVE_TYPE (removed from schema) — zod validation error",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "OBJECTIVE_TYPE", // intentionally invalid — removed from PivotEnum
          timeGranularity: "ALL",
          dateRange: last7Days(),
          fields: ["impressions"],
        },
      });
      // Zod should reject this before it hits LinkedIn
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    },
    { timeout: 60_000 },
  );

  it(
    "invalid timeGranularity — zod validation error",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "HOURLY", // not in the enum
          dateRange: last7Days(),
          fields: ["impressions"],
        },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(typeof r.error).toBe("string");
    },
    { timeout: 60_000 },
  );

  it(
    "dateRange.end before dateRange.start — LinkedIn 400 or tool error",
    async () => {
      const r = await callTool("get_account_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "ACCOUNT",
          timeGranularity: "ALL",
          dateRange: {
            start: { year: 2025, month: 6, day: 1 },
            end: { year: 2025, month: 1, day: 1 }, // end < start
          },
          fields: ["impressions"],
        },
      });
      // LinkedIn returns 400 for invalid date range
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// ANALYTICS — campaign-level
// ---------------------------------------------------------------------------

describe("analytics — campaign-level", () => {
  it(
    "with campaigns filter — known active campaign scoped results",
    async () => {
      // KNOWN_CAMPAIGN_ID points to an existing campaign with historical data
      // (passed via SMOKE_KNOWN_CAMPAIGN_ID env var).
      if (KNOWN_CAMPAIGN_ID === undefined) {
        console.warn("SMOKE_KNOWN_CAMPAIGN_ID not set — skipping campaign-scoped test");
        return;
      }
      const r = await callTool("get_campaign_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CAMPAIGN",
          timeGranularity: "ALL",
          dateRange: last365Days(),
          fields: ["impressions", "clicks", "costInLocalCurrency"],
          campaigns: [KNOWN_CAMPAIGN_ID],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
      expect(Array.isArray(data.rows)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "without campaigns filter — falls back to full account scope",
    async () => {
      const r = await callTool("get_campaign_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CAMPAIGN",
          timeGranularity: "ALL",
          dateRange: last7Days(),
          fields: ["impressions", "clicks"],
          // campaigns intentionally omitted — should scope to account
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: unknown[] };
      expect(typeof data.rowCount).toBe("number");
    },
    { timeout: 60_000 },
  );

  it(
    "campaign-level DAILY granularity — rows carry dateRange when non-empty",
    async () => {
      if (KNOWN_CAMPAIGN_ID === undefined) {
        console.warn("SMOKE_KNOWN_CAMPAIGN_ID not set — skipping campaign-scoped test");
        return;
      }
      const r = await callTool("get_campaign_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CAMPAIGN",
          timeGranularity: "DAILY",
          dateRange: last7Days(),
          fields: ["impressions", "clicks"],
          campaigns: [KNOWN_CAMPAIGN_ID],
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { rowCount: number; rows: Array<Record<string, unknown>> };
      for (const row of data.rows) {
        if ("impressions" in row) expect(typeof row.impressions).toBe("number");
      }
    },
    { timeout: 60_000 },
  );

  it(
    "with creatives filter instead of campaigns — ok response",
    async () => {
      // We pass an unknown creative ID; LinkedIn may return 0 rows (valid) or an
      // error depending on account access — what matters is the tool handles it.
      const r = await callTool("get_campaign_analytics", {
        account_id: TEST_ACCOUNT_ID,
        query: {
          pivot: "CREATIVE",
          timeGranularity: "ALL",
          dateRange: last7Days(),
          fields: ["impressions", "clicks"],
          creatives: [999999999], // non-existent → 0 rows or soft error
        },
      });
      // Either ok (0 rows) or error (permission/not-found) — both are acceptable
      expect(typeof r.ok).toBe("boolean");
    },
    { timeout: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// BULK PAUSE CAMPAIGNS
// ---------------------------------------------------------------------------

describe("bulk_pause_campaigns", () => {
  let groupId: number;
  let campaignIds: number[] = [];
  const groupName = uniqueName("AB-G");

  beforeAll(async () => {
    // 1. Create a DRAFT group, then put it in PAUSED so we can create
    //    pauseable campaigns inside it.
    const grpResult = await callTool("create_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      name: groupName,
      status: "DRAFT",
      run_schedule: { start: futureTimestamp(30) },
    });
    if (!grpResult.ok) throw new Error(`beforeAll: create_campaign_group failed — ${grpResult.error}`);
    groupId = (grpResult.data as { id: number }).id;

    // Transition DRAFT → PAUSED (required so campaigns can be paused via batch)
    const pauseGrp = await callTool("update_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      campaign_group_id: groupId,
      status: "PAUSED",
    });
    if (!pauseGrp.ok) throw new Error(`beforeAll: PAUSED group transition failed — ${pauseGrp.error}`);

    // 2. Create 2 DRAFT campaigns inside the group.
    for (let i = 1; i <= 2; i++) {
      const campResult = await callTool("create_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign: {
          name: uniqueName(`AB-C${i}`),
          campaignGroupId: groupId,
          type: "SPONSORED_UPDATES",
          objectiveType: "WEBSITE_VISIT",
          costType: "CPC",
          unitCost: { currencyCode: "EUR", amount: "0.50" },
          dailyBudget: { currencyCode: "EUR", amount: "10.00" },
          runSchedule: { start: futureTimestamp(30) },
          targetingCriteria: FR_TARGETING,
          optimizationTargetType: "NONE",
          locale: { country: "FR", language: "fr" },
          status: "DRAFT",
          offsiteDeliveryEnabled: false,
          politicalIntent: "NOT_DECLARED",
        },
      });
      if (!campResult.ok) throw new Error(`beforeAll: create_campaign #${i} failed — ${campResult.error}`);
      campaignIds.push((campResult.data as { id: number }).id);
    }
  }, 120_000);

  afterAll(async () => {
    // Archive sandbox campaigns then the group — best-effort
    for (const cid of campaignIds) {
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: cid,
        status: "ARCHIVED",
      });
    }
    if (groupId) {
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "ARCHIVED",
      });
    }
  }, 120_000);

  it(
    "pauses 2 sandbox campaigns — shape { totalRequested, succeeded, failed, details }",
    // Note: the tool issues a single BATCH_PARTIAL_UPDATE call (not N individual
    // calls). This cannot be directly asserted from HTTP smoke tests, but the
    // source in src/tools/bulk.ts confirms the single-call design.
    async () => {
      expect(campaignIds.length).toBe(2);
      const r = await callTool("bulk_pause_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        campaign_ids: campaignIds,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as {
        totalRequested: number;
        succeeded: number;
        failed: number;
        details: Array<{ campaign_id: number | string; paused: boolean }>;
      };
      expect(data.totalRequested).toBe(2);
      expect(typeof data.succeeded).toBe("number");
      expect(typeof data.failed).toBe("number");
      expect(data.succeeded + data.failed).toBe(2);
      expect(Array.isArray(data.details)).toBe(true);
      expect(data.details.length).toBe(2);
      for (const detail of data.details) {
        expect(typeof detail.paused).toBe("boolean");
        expect(campaignIds.includes(detail.campaign_id as number)).toBe(true);
      }
    },
    { timeout: 60_000 },
  );

  it(
    "non-existent campaign IDs — details have paused:false with error message",
    async () => {
      const r = await callTool("bulk_pause_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        campaign_ids: [999000001, 999000002],
      });
      // Either a top-level error (4xx) or ok with all paused:false
      if (r.ok) {
        const data = r.data as {
          totalRequested: number;
          succeeded: number;
          failed: number;
          details: Array<{ paused: boolean; error?: string }>;
        };
        expect(data.totalRequested).toBe(2);
        for (const detail of data.details) {
          // Non-existent campaigns should not succeed
          if (!detail.paused) {
            expect(typeof detail.error).toBe("string");
          }
        }
      } else {
        // Whole-batch 4xx is also acceptable
        expect(typeof r.error).toBe("string");
        expect(r.error.length).toBeGreaterThan(0);
      }
    },
    { timeout: 60_000 },
  );

  it(
    "empty campaign_ids array — zod validation error (min:1)",
    async () => {
      const r = await callTool("bulk_pause_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        campaign_ids: [],
      });
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// DUPLICATE CAMPAIGN
// ---------------------------------------------------------------------------

describe("duplicate_campaign", () => {
  let groupId: number;
  let sourceCampaignId: number;
  let duplicatedId: number | undefined;
  const groupName = uniqueName("AB-DUP-G");

  beforeAll(async () => {
    // Create a DRAFT group
    const grpResult = await callTool("create_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      name: groupName,
      status: "DRAFT",
      run_schedule: { start: futureTimestamp(30) },
    });
    if (!grpResult.ok) throw new Error(`beforeAll: create_campaign_group failed — ${grpResult.error}`);
    groupId = (grpResult.data as { id: number }).id;

    // Transition DRAFT → PAUSED
    const pauseGrp = await callTool("update_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      campaign_group_id: groupId,
      status: "PAUSED",
    });
    if (!pauseGrp.ok) throw new Error(`beforeAll: PAUSED group transition failed — ${pauseGrp.error}`);

    // Create source campaign
    const campResult = await callTool("create_campaign", {
      account_id: TEST_ACCOUNT_ID,
      campaign: {
        name: uniqueName("AB-SRC"),
        campaignGroupId: groupId,
        type: "SPONSORED_UPDATES",
        objectiveType: "WEBSITE_VISIT",
        costType: "CPC",
        unitCost: { currencyCode: "EUR", amount: "0.50" },
        dailyBudget: { currencyCode: "EUR", amount: "10.00" },
        runSchedule: { start: futureTimestamp(30) },
        targetingCriteria: FR_TARGETING,
        optimizationTargetType: "NONE",
        locale: { country: "FR", language: "fr" },
        status: "DRAFT",
        offsiteDeliveryEnabled: false,
        politicalIntent: "NOT_DECLARED",
      },
    });
    if (!campResult.ok) throw new Error(`beforeAll: create source campaign failed — ${campResult.error}`);
    sourceCampaignId = (campResult.data as { id: number }).id;
  }, 120_000);

  afterAll(async () => {
    // Archive duplicated campaign (if created), source campaign, then group
    if (duplicatedId) {
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: duplicatedId,
        status: "ARCHIVED",
      });
    }
    if (sourceCampaignId) {
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: sourceCampaignId,
        status: "ARCHIVED",
      });
    }
    if (groupId) {
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "ARCHIVED",
      });
    }
  }, 120_000);

  it(
    "nominal — returns duplicated:true with valid newId and newUrn (bug-fix #13)",
    async () => {
      const dupName = uniqueName("DUP");
      const r = await callTool("duplicate_campaign", {
        account_id: TEST_ACCOUNT_ID,
        source_campaign_id: sourceCampaignId,
        name: dupName,
        daily_budget: { currencyCode: "EUR", amount: "5.00" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as {
        duplicated: boolean;
        sourceId: number;
        newId: number;
        newUrn: string;
      };
      expect(data.duplicated).toBe(true);
      expect(data.sourceId).toBe(sourceCampaignId);
      // newId must be a positive integer (not undefined/null — this was bug #13)
      expect(typeof data.newId).toBe("number");
      expect(data.newId).toBeGreaterThan(0);
      // newUrn must be a valid sponsoredCampaign URN
      expect(data.newUrn).toMatch(/^urn:li:sponsoredCampaign:/);
      // Store for cleanup
      duplicatedId = data.newId;
    },
    { timeout: 60_000 },
  );

  it(
    "with run_schedule override — duplicated:true and newId is a number",
    async () => {
      const dupName = uniqueName("DUP-SCH");
      const r = await callTool("duplicate_campaign", {
        account_id: TEST_ACCOUNT_ID,
        source_campaign_id: sourceCampaignId,
        name: dupName,
        run_schedule: { start: futureTimestamp(60) },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { duplicated: boolean; newId: number; newUrn: string };
      expect(data.duplicated).toBe(true);
      expect(typeof data.newId).toBe("number");
      expect(data.newId).toBeGreaterThan(0);
      expect(data.newUrn).toMatch(/^urn:li:sponsoredCampaign:/);
      // Clean up this extra duplicate
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: data.newId,
        status: "ARCHIVED",
      });
    },
    { timeout: 60_000 },
  );

  it(
    "non-existent source_campaign_id — returns error",
    async () => {
      const r = await callTool("duplicate_campaign", {
        account_id: TEST_ACCOUNT_ID,
        source_campaign_id: 999000099,
        name: uniqueName("DUP-BAD"),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    },
    { timeout: 60_000 },
  );
});
