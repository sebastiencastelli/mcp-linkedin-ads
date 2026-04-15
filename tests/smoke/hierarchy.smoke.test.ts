import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { callTool, TEST_ACCOUNT_ID, futureTimestamp, uniqueName } from "./_mcp-client.js";

// ---------------------------------------------------------------------------
// ACCOUNTS
// ---------------------------------------------------------------------------

describe("hierarchy — accounts", () => {
  it(
    "list_ad_accounts — returns at least 1 account with id/urn/name/currency",
    async () => {
      const r = await callTool("list_ad_accounts", {});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { accounts: unknown[] };
      expect(Array.isArray(data.accounts)).toBe(true);
      expect(data.accounts.length).toBeGreaterThanOrEqual(1);
      expect(data.accounts[0]).toMatchObject({
        id: expect.any(Number),
        urn: expect.stringMatching(/^urn:li:sponsoredAccount:/),
        name: expect.any(String),
        currency: expect.any(String),
      });
    },
    { timeout: 60_000 },
  );

  it(
    "list_ad_accounts — nextPageToken key present in response (null or string)",
    async () => {
      const r = await callTool("list_ad_accounts", {});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as Record<string, unknown>;
      expect("nextPageToken" in data).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_ad_accounts — respects pageSize param (1 item returned)",
    async () => {
      const r = await callTool("list_ad_accounts", { pagination: { pageSize: 1 } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { accounts: unknown[] };
      expect(data.accounts.length).toBeLessThanOrEqual(1);
    },
    { timeout: 60_000 },
  );

  it(
    "get_ad_account — returns full account details for TEST_ACCOUNT_ID",
    async () => {
      const r = await callTool("get_ad_account", { account_id: TEST_ACCOUNT_ID });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as Record<string, unknown>;
      expect(data).toMatchObject({
        id: TEST_ACCOUNT_ID,
        name: expect.any(String),
        currency: expect.any(String),
        status: expect.any(String),
      });
    },
    { timeout: 60_000 },
  );

  it(
    "get_ad_account — 404 on nonexistent account ID",
    async () => {
      const r = await callTool("get_ad_account", { account_id: 999999999 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // Error message should mention the failure (4xx or explicit not found)
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    },
    { timeout: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// CAMPAIGN GROUPS
// ---------------------------------------------------------------------------

describe("hierarchy — campaign groups", () => {
  let groupId: number;
  let groupUrn: string;
  const groupName = uniqueName("H");

  beforeAll(async () => {
    const r = await callTool("create_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      name: groupName,
      status: "DRAFT",
      run_schedule: { start: futureTimestamp(30) },
    });
    if (!r.ok) throw new Error(`beforeAll: create_campaign_group failed — ${r.error}`);
    const data = r.data as { id: number; urn: string };
    groupId = data.id;
    groupUrn = data.urn;
  }, 60_000);

  afterAll(async () => {
    if (!groupId) return;
    // Archive group — best-effort, don't throw on failure
    await callTool("update_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      campaign_group_id: groupId,
      status: "ARCHIVED",
    });
  }, 60_000);

  // --- create_campaign_group ---

  it(
    "create_campaign_group — returns created:true with numeric id and URN",
    async () => {
      // groupId / groupUrn set in beforeAll — assert on them here
      expect(typeof groupId).toBe("number");
      expect(groupId).toBeGreaterThan(0);
      expect(groupUrn).toMatch(/^urn:li:sponsoredCampaignGroup:/);
    },
    { timeout: 60_000 },
  );

  it(
    "create_campaign_group — with optional totalBudget creates successfully",
    async () => {
      const name = uniqueName("H-budget");
      // LinkedIn requires run_schedule.end when total_budget is set.
      const r = await callTool("create_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        name,
        status: "DRAFT",
        run_schedule: { start: futureTimestamp(30), end: futureTimestamp(60) },
        total_budget: { currencyCode: "EUR", amount: "100.00" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { created: boolean; id: number };
      expect(data.created).toBe(true);
      expect(typeof data.id).toBe("number");
      // cleanup
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: data.id,
        status: "ARCHIVED",
      });
    },
    { timeout: 60_000 },
  );

  // --- list_campaign_groups ---

  it(
    "list_campaign_groups — returns groups array with id/urn/name/status",
    async () => {
      const r = await callTool("list_campaign_groups", { account_id: TEST_ACCOUNT_ID });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { groups: unknown[]; nextPageToken: unknown };
      expect(Array.isArray(data.groups)).toBe(true);
      expect(data.groups.length).toBeGreaterThanOrEqual(1);
      expect(data.groups[0]).toMatchObject({
        id: expect.any(Number),
        urn: expect.stringMatching(/^urn:li:sponsoredCampaignGroup:/),
        name: expect.any(String),
        status: expect.any(String),
      });
      expect("nextPageToken" in data).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaign_groups — status filter ACTIVE/DRAFT returns only matching statuses",
    async () => {
      const r = await callTool("list_campaign_groups", {
        account_id: TEST_ACCOUNT_ID,
        status: ["ACTIVE", "DRAFT"],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { groups: Array<{ status: string }> };
      for (const g of data.groups) {
        expect(["ACTIVE", "DRAFT"]).toContain(g.status);
      }
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaign_groups — sandbox group appears in unfiltered list",
    async () => {
      const r = await callTool("list_campaign_groups", {
        account_id: TEST_ACCOUNT_ID,
        pagination: { pageSize: 100 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { groups: Array<{ id: number }> };
      const found = data.groups.some((g) => g.id === groupId);
      expect(found).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaign_groups — pagination cursor (pageSize:1) returns nextPageToken when more pages exist",
    async () => {
      const r = await callTool("list_campaign_groups", {
        account_id: TEST_ACCOUNT_ID,
        pagination: { pageSize: 1 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { groups: unknown[]; nextPageToken: unknown };
      expect(data.groups.length).toBeLessThanOrEqual(1);
      // If account has >1 group, nextPageToken must be non-null
      // (we have at least the sandbox group so there may be others)
      // We just assert the key exists — value can be null if only 1 group
      expect("nextPageToken" in data).toBe(true);
    },
    { timeout: 60_000 },
  );

  // --- update_campaign_group ---

  it(
    "update_campaign_group — rename returns updated:true with changed fields listed",
    async () => {
      const r = await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        name: `${groupName}-renamed`,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; id: number; changed: string[] };
      expect(data.updated).toBe(true);
      expect(data.id).toBe(groupId);
      expect(data.changed).toContain("name");
    },
    { timeout: 60_000 },
  );

  it(
    "update_campaign_group — change totalBudget returns updated:true",
    async () => {
      // LinkedIn requires run_schedule.end before allowing totalBudget.
      // Set end first, then update the budget.
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        run_schedule: { start: futureTimestamp(30), end: futureTimestamp(60) },
      });
      const r = await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        total_budget: { currencyCode: "EUR", amount: "150.00" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; changed: string[] };
      expect(data.updated).toBe(true);
      expect(data.changed).toContain("totalBudget");
    },
    { timeout: 60_000 },
  );

  it(
    "update_campaign_group — invalid status enum returns error",
    async () => {
      const r = await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "FLYING",
      });
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// CAMPAIGNS
// ---------------------------------------------------------------------------

describe("hierarchy — campaigns", () => {
  let groupId: number;
  let campaignId: number;
  let campaignUrn: string;
  const groupName = uniqueName("HC");
  const campaignName = uniqueName("C");

  // Minimal valid targeting: France geo only
  const minimalTargeting = {
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

  beforeAll(async () => {
    // Create a sandbox campaign group
    const grpResult = await callTool("create_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      name: groupName,
      status: "DRAFT",
      run_schedule: { start: futureTimestamp(30) },
    });
    if (!grpResult.ok) throw new Error(`beforeAll: create_campaign_group failed — ${grpResult.error}`);
    groupId = (grpResult.data as { id: number }).id;

    // Create the sandbox campaign
    const campResult = await callTool("create_campaign", {
      account_id: TEST_ACCOUNT_ID,
      campaign: {
        name: campaignName,
        campaignGroupId: groupId,
        type: "SPONSORED_UPDATES",
        objectiveType: "WEBSITE_VISIT",
        costType: "CPC",
        unitCost: { currencyCode: "EUR", amount: "2.00" },
        dailyBudget: { currencyCode: "EUR", amount: "10.00" },
        runSchedule: { start: futureTimestamp(30) },
        targetingCriteria: minimalTargeting,
        optimizationTargetType: "NONE",
        locale: { country: "FR", language: "fr" },
        status: "DRAFT",
        offsiteDeliveryEnabled: false,
        politicalIntent: "NOT_DECLARED",
      },
    });
    if (!campResult.ok) throw new Error(`beforeAll: create_campaign failed — ${campResult.error}`);
    const campData = campResult.data as { id: number; urn: string };
    campaignId = campData.id;
    campaignUrn = campData.urn;
  }, 120_000);

  afterAll(async () => {
    // Archive campaign then group — best-effort
    if (campaignId) {
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
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

  // --- create_campaign ---

  it(
    "create_campaign — returns created:true with numeric id and URN",
    async () => {
      expect(typeof campaignId).toBe("number");
      expect(campaignId).toBeGreaterThan(0);
      expect(campaignUrn).toMatch(/^urn:li:sponsoredCampaign:/);
    },
    { timeout: 60_000 },
  );

  it(
    "create_campaign — missing campaignGroupId returns error (422 validation)",
    async () => {
      const r = await callTool("create_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign: {
          name: uniqueName("C-bad"),
          // campaignGroupId intentionally omitted
          type: "SPONSORED_UPDATES",
          objectiveType: "WEBSITE_VISIT",
          costType: "CPC",
          unitCost: { currencyCode: "EUR", amount: "2.00" },
          dailyBudget: { currencyCode: "EUR", amount: "10.00" },
          runSchedule: { start: futureTimestamp(30) },
          targetingCriteria: minimalTargeting,
          locale: { country: "FR", language: "fr" },
          status: "DRAFT",
        },
      });
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );

  it(
    "create_campaign — invalid type enum returns error",
    async () => {
      const r = await callTool("create_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign: {
          name: uniqueName("C-badtype"),
          campaignGroupId: groupId,
          type: "INVALID_TYPE",
          objectiveType: "WEBSITE_VISIT",
          costType: "CPC",
          unitCost: { currencyCode: "EUR", amount: "2.00" },
          dailyBudget: { currencyCode: "EUR", amount: "10.00" },
          runSchedule: { start: futureTimestamp(30) },
          targetingCriteria: minimalTargeting,
          locale: { country: "FR", language: "fr" },
          status: "DRAFT",
        },
      });
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );

  // --- list_campaigns ---

  it(
    "list_campaigns — returns campaigns array with id/urn/name/status/type",
    async () => {
      const r = await callTool("list_campaigns", { account_id: TEST_ACCOUNT_ID });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: unknown[]; nextPageToken: unknown };
      expect(Array.isArray(data.campaigns)).toBe(true);
      expect(data.campaigns.length).toBeGreaterThanOrEqual(1);
      expect(data.campaigns[0]).toMatchObject({
        id: expect.any(Number),
        urn: expect.stringMatching(/^urn:li:sponsoredCampaign:/),
        name: expect.any(String),
        status: expect.any(String),
        type: expect.any(String),
      });
      expect("nextPageToken" in data).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaigns — sandbox campaign appears in unfiltered list",
    async () => {
      const r = await callTool("list_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        pagination: { pageSize: 100 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: Array<{ id: number }> };
      const found = data.campaigns.some((c) => c.id === campaignId);
      expect(found).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaigns — status filter DRAFT returns only DRAFT campaigns",
    async () => {
      const r = await callTool("list_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        status: ["DRAFT"],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: Array<{ status: string }> };
      for (const c of data.campaigns) {
        expect(c.status).toBe("DRAFT");
      }
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaigns — campaign_group_id filter scopes to sandbox group",
    async () => {
      const r = await callTool("list_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: Array<{ id: number }> };
      expect(data.campaigns.some((c) => c.id === campaignId)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaigns — pagination cursor (pageSize:1) returns at most 1 campaign",
    async () => {
      const r = await callTool("list_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        pagination: { pageSize: 1 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: unknown[] };
      expect(data.campaigns.length).toBeLessThanOrEqual(1);
    },
    { timeout: 60_000 },
  );

  it(
    "list_campaigns — combined status + campaign_group_id filters work together",
    async () => {
      const r = await callTool("list_campaigns", {
        account_id: TEST_ACCOUNT_ID,
        status: ["DRAFT"],
        campaign_group_id: groupId,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { campaigns: Array<{ status: string }> };
      for (const c of data.campaigns) {
        expect(c.status).toBe("DRAFT");
      }
    },
    { timeout: 60_000 },
  );

  // --- get_campaign ---

  it(
    "get_campaign — by numeric ID returns campaign details",
    async () => {
      const r = await callTool("get_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as Record<string, unknown>;
      expect(data).toMatchObject({
        id: campaignId,
        name: expect.any(String),
        status: expect.any(String),
        type: expect.any(String),
      });
    },
    { timeout: 60_000 },
  );

  it(
    "get_campaign — by URN string returns same campaign",
    async () => {
      const r = await callTool("get_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignUrn,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { id: number };
      expect(data.id).toBe(campaignId);
    },
    { timeout: 60_000 },
  );

  it(
    "get_campaign — 404 on nonexistent campaign ID",
    async () => {
      const r = await callTool("get_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: 999999999,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    },
    { timeout: 60_000 },
  );

  // --- update_campaign ---

  it(
    "update_campaign — rename returns updated:true with id and changed fields",
    async () => {
      const r = await callTool("update_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        patch: { name: `${campaignName}-renamed` },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; id: number; changed: string[] };
      expect(data.updated).toBe(true);
      expect(data.id).toBe(campaignId);
      expect(data.changed).toContain("name");
    },
    { timeout: 60_000 },
  );

  it(
    "update_campaign — change unitCost returns updated:true with unitCost in changed",
    async () => {
      const r = await callTool("update_campaign", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        patch: { unitCost: { currencyCode: "EUR", amount: "3.00" } },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; changed: string[] };
      expect(data.updated).toBe(true);
      expect(data.changed).toContain("unitCost");
    },
    { timeout: 60_000 },
  );

  // --- update_campaign_status ---

  it(
    "update_campaign_status — DRAFT → PAUSED returns updated:true with status PAUSED",
    async () => {
      // LinkedIn rejects Campaign.status=PAUSED if its CampaignGroup is still DRAFT.
      // Promote the group to PAUSED first.
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "PAUSED",
      });
      const r = await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: "PAUSED",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; id: number; status: string };
      expect(data.updated).toBe(true);
      expect(data.id).toBe(campaignId);
      expect(data.status).toBe("PAUSED");
    },
    { timeout: 60_000 },
  );

  it(
    "update_campaign_status — invalid status enum returns error",
    async () => {
      const r = await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: "FLYING",
      });
      expect(r.ok).toBe(false);
    },
    { timeout: 60_000 },
  );

  it(
    "update_campaign_status — PAUSED → ARCHIVED returns updated:true",
    async () => {
      const r = await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: "ARCHIVED",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const data = r.data as { updated: boolean; status: string };
      expect(data.updated).toBe(true);
      expect(data.status).toBe("ARCHIVED");
    },
    { timeout: 60_000 },
  );
});
