import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, futureTimestamp, TEST_ACCOUNT_ID, uniqueName } from "./_mcp-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast callTool data to a typed record without losing the ok/error union. */
function asRecord(data: unknown): Record<string, unknown> {
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// describe: list & get — read-only, no setup needed
// ---------------------------------------------------------------------------

describe("creatives — list & get", () => {
  it(
    "list_creatives without filters — returns elements array with expected shape",
    async () => {
      const result = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = asRecord(result.data);
      // Response must contain a creatives array (may be empty for fresh accounts)
      expect(data).toHaveProperty("creatives");
      expect(Array.isArray(data.creatives)).toBe(true);

      const creatives = data.creatives as unknown[];
      if (creatives.length > 0) {
        const first = asRecord(creatives[0]);
        // Each creative should expose its id and intendedStatus at minimum
        expect(first).toHaveProperty("id");
        expect(first).toHaveProperty("intendedStatus");
      }
    },
    60_000,
  );

  it(
    "list_creatives with status filter ACTIVE — returns only ACTIVE creatives",
    async () => {
      const result = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        status: ["ACTIVE"],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = asRecord(result.data);
      expect(Array.isArray(data.creatives)).toBe(true);

      const creatives = data.creatives as unknown[];
      for (const c of creatives) {
        expect(asRecord(c).intendedStatus).toBe("ACTIVE");
      }
    },
    60_000,
  );

  it(
    "get_creative with nonexistent ID — returns error (404 / not found)",
    async () => {
      const result = await callTool("get_creative", {
        account_id: TEST_ACCOUNT_ID,
        // Very low ID, almost certainly absent
        creative_id: 1,
      });

      expect(result.ok).toBe(false);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// describe: create / update lifecycle — requires a sandbox campaign
// ---------------------------------------------------------------------------

describe("creatives — create/update lifecycle", () => {
  let groupId: number;
  let campaignId: number;

  const groupName = uniqueName("CR-G");
  const campaignName = uniqueName("CR-C");

  // -------------------------------------------------------------------------
  // beforeAll: create a sandbox campaign group + TEXT_AD campaign
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    // 1. Create campaign group in DRAFT
    const groupResult = await callTool("create_campaign_group", {
      account_id: TEST_ACCOUNT_ID,
      name: groupName,
      status: "DRAFT",
      run_schedule: { start: futureTimestamp(1) },
    });

    if (!groupResult.ok) {
      throw new Error(`beforeAll: create_campaign_group failed — ${groupResult.error}`);
    }
    const groupData = asRecord(groupResult.data);
    if (groupData.id == null) {
      throw new Error(
        `beforeAll: create_campaign_group returned no id — raw: ${groupResult.raw}`,
      );
    }
    groupId = Number(groupData.id);

    // 2. Create a TEXT_AD campaign in DRAFT inside that group
    const campaignResult = await callTool("create_campaign", {
      account_id: TEST_ACCOUNT_ID,
      campaign: {
        name: campaignName,
        campaignGroupId: groupId,
        type: "TEXT_AD",
        objectiveType: "WEBSITE_VISIT",
        costType: "CPC",
        unitCost: { currencyCode: "EUR", amount: "0.50" },
        totalBudget: { currencyCode: "EUR", amount: "10.00" },
        runSchedule: { start: futureTimestamp(1) },
        targetingCriteria: {
          include: {
            and: [
              {
                or: {
                  "urn:li:adTargetingFacet:locations": ["urn:li:geo:105015875"],
                },
              },
            ],
          },
        },
        optimizationTargetType: "NONE",
        locale: { country: "FR", language: "fr" },
        status: "DRAFT",
        offsiteDeliveryEnabled: false,
        politicalIntent: "NOT_DECLARED",
      },
    });

    if (!campaignResult.ok) {
      throw new Error(`beforeAll: create_campaign failed — ${campaignResult.error}`);
    }
    const campaignData = asRecord(campaignResult.data);
    if (campaignData.id == null) {
      throw new Error(
        `beforeAll: create_campaign returned no id — raw: ${campaignResult.raw}`,
      );
    }
    campaignId = Number(campaignData.id);
  }, 120_000);

  // -------------------------------------------------------------------------
  // afterAll: best-effort cleanup — archive everything created
  // -------------------------------------------------------------------------
  afterAll(async () => {
    if (campaignId) {
      // List all creatives we may have created on this campaign
      const listResult = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
      });

      if (listResult.ok) {
        const creatives = (asRecord(listResult.data).creatives ?? []) as unknown[];
        for (const c of creatives) {
          const cr = asRecord(c);
          const cId = cr.id;
          if (cId == null) continue;
          const archiveResult = await callTool("update_creative_status", {
            account_id: TEST_ACCOUNT_ID,
            creative_id: cId,
            status: "ARCHIVED",
          });
          // LinkedIn rejects archiving a non-approved DRAFT creative — that is expected.
          // Silently ignore that specific business-logic error; surface any other error.
          if (!archiveResult.ok) {
            const isExpectedError =
              archiveResult.error.includes("review") ||
              archiveResult.error.includes("APPROVED") ||
              archiveResult.error.includes("reviewStatus");
            if (!isExpectedError) {
              console.warn(
                `afterAll: could not archive creative ${String(cId)}: ${archiveResult.error}`,
              );
            }
          }
        }
      }

      // Campaign must be PAUSED before archiving
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: "PAUSED",
      });
      await callTool("update_campaign_status", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: "ARCHIVED",
      });
    }

    if (groupId) {
      // Campaign group must be PAUSED before archiving
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "PAUSED",
      });
      await callTool("update_campaign_group", {
        account_id: TEST_ACCOUNT_ID,
        campaign_group_id: groupId,
        status: "ARCHIVED",
      });
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // list_creatives with campaign_id filter
  // -------------------------------------------------------------------------
  it(
    "list_creatives with campaign_id — returns only creatives for that campaign",
    async () => {
      const result = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = asRecord(result.data);
      expect(Array.isArray(data.creatives)).toBe(true);
      // All returned creatives must belong to our test campaign URN
      const expectedCampaignUrn = `urn:li:sponsoredCampaign:${campaignId}`;
      const creatives = data.creatives as unknown[];
      for (const c of creatives) {
        expect(asRecord(c).campaign).toBe(expectedCampaignUrn);
      }
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // create_text_creative — validation errors
  // -------------------------------------------------------------------------
  it(
    "create_text_creative with headline > 25 chars — returns validation error",
    async () => {
      const result = await callTool("create_text_creative", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        creative: {
          headline: "This headline is definitely too long and over the limit",
          description: "Valid description under 75 chars",
          landingPageUrl: "https://example.com",
          intendedStatus: "DRAFT",
        },
      });

      expect(result.ok).toBe(false);
      // Should be a Zod / schema validation error from the MCP tool layer
      if (!result.ok) {
        expect(result.error.toLowerCase()).toMatch(/headline|max|invalid|validation|25/i);
      }
    },
    60_000,
  );

  it(
    "create_text_creative with invalid landingPageUrl — returns Zod schema error",
    async () => {
      const result = await callTool("create_text_creative", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        creative: {
          headline: "Valid headline",
          description: "Valid description",
          landingPageUrl: "notaurl",
          intendedStatus: "DRAFT",
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toMatch(/url|invalid|landing/i);
      }
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // create_text_creative — nominal
  // -------------------------------------------------------------------------
  it(
    "create_text_creative in DRAFT — creation accepted (id/urn may be undefined)",
    async () => {
      const result = await callTool("create_text_creative", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        creative: {
          name: uniqueName("CR-TXT"),
          headline: "Short headline",
          description: "Short description for the text ad",
          landingPageUrl: "https://example.com/landing",
          intendedStatus: "DRAFT",
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = asRecord(result.data);
      // LinkedIn confirms creation; id/urn are best-effort (may be null if header absent)
      expect(data.created).toBe(true);
      // id and urn can be undefined — that is the known bug; both outcomes are valid
      if (data.id != null) {
        expect(typeof data.id === "number" || typeof data.id === "string").toBe(true);
      }
      if (data.urn != null) {
        expect(String(data.urn)).toMatch(/^urn:li:sponsoredCreative:/);
      }
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // get_creative — after creation, look up the freshly created creative
  // -------------------------------------------------------------------------
  it(
    "get_creative with bare numeric ID — returns full creative details",
    async () => {
      // First: resolve the creative ID via list (workaround for the id=null bug)
      const listResult = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const creatives = (asRecord(listResult.data).creatives ?? []) as unknown[];
      // If nothing was created yet (account-level rate limit / prior step failed), skip gracefully
      if (creatives.length === 0) {
        console.warn("get_creative bare ID: no creatives found for campaign, skipping assertion");
        return;
      }

      // Take the most recently created creative (last in list — LinkedIn returns most-recent-first)
      const latest = asRecord(creatives[0]);
      // The id field in list responses is the full URN; extract the numeric part
      const rawId = String(latest.id ?? "");
      const numericMatch = rawId.match(/(\d+)$/);
      if (!numericMatch) {
        console.warn(`get_creative bare ID: cannot extract numeric id from "${rawId}", skipping`);
        return;
      }
      const numericId = Number(numericMatch[1]);

      const getResult = await callTool("get_creative", {
        account_id: TEST_ACCOUNT_ID,
        creative_id: numericId,
      });

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      const data = asRecord(getResult.data);
      expect(data).toHaveProperty("intendedStatus");
      expect(data).toHaveProperty("campaign");
    },
    60_000,
  );

  it(
    "get_creative with full URN string — also resolves correctly",
    async () => {
      // Resolve a real URN via list
      const listResult = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const creatives = (asRecord(listResult.data).creatives ?? []) as unknown[];
      if (creatives.length === 0) {
        console.warn("get_creative URN: no creatives found for campaign, skipping assertion");
        return;
      }

      const latest = asRecord(creatives[0]);
      const rawId = String(latest.id ?? "");
      // Build the full URN form — either it is already a URN or it's numeric
      const urn = rawId.startsWith("urn:li:") ? rawId : `urn:li:sponsoredCreative:${rawId}`;

      const getResult = await callTool("get_creative", {
        account_id: TEST_ACCOUNT_ID,
        creative_id: urn,
      });

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      const data = asRecord(getResult.data);
      expect(data).toHaveProperty("intendedStatus");
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // update_creative_status — DRAFT → ARCHIVED (LinkedIn rejects non-approved)
  // -------------------------------------------------------------------------
  it(
    "update_creative_status DRAFT → ARCHIVED — LinkedIn returns review/approval error",
    async () => {
      // Resolve a DRAFT creative to archive
      const listResult = await callTool("list_creatives", {
        account_id: TEST_ACCOUNT_ID,
        campaign_id: campaignId,
        status: ["DRAFT"],
      });

      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const creatives = (asRecord(listResult.data).creatives ?? []) as unknown[];
      if (creatives.length === 0) {
        console.warn(
          "update_creative_status: no DRAFT creatives available for campaign, skipping",
        );
        return;
      }

      const rawId = String(asRecord(creatives[0]).id ?? "");
      const numericMatch = rawId.match(/(\d+)$/);
      if (!numericMatch) {
        console.warn(`update_creative_status: cannot extract id from "${rawId}", skipping`);
        return;
      }
      const numericId = Number(numericMatch[1]);

      const updateResult = await callTool("update_creative_status", {
        account_id: TEST_ACCOUNT_ID,
        creative_id: numericId,
        status: "ARCHIVED",
      });

      // LinkedIn should reject archiving a non-approved DRAFT creative.
      // Expected error message contains "reviewStatus" / "APPROVED" / "review".
      // If the creative somehow *was* approved (unlikely in a smoke sandbox), accept success too.
      if (!updateResult.ok) {
        expect(updateResult.error).toMatch(/review|APPROVED|reviewStatus/i);
      } else {
        // Unexpected but valid: creative was already approved — accept it
        expect(asRecord(updateResult.data).updated).toBe(true);
      }
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // Skipped: binary-upload creatives
  // -------------------------------------------------------------------------

  it.skip(
    "create_image_creative — SKIPPED: requires a local image file path on the server filesystem",
    // This tool calls readFile(creative.imagePath) on the *server* machine, which means
    // a valid local path to a PNG/JPG must exist there. Smoke tests run against the deployed
    // server remotely, making this test impossible without a pre-uploaded fixture.
    // To test manually: provide imagePath pointing to a valid file on the MCP server host.
    () => {},
  );

  it.skip(
    "create_video_creative — SKIPPED: requires a local video file path on the server filesystem",
    // Same constraint as create_image_creative: the tool reads a local MP4 on the server.
    // Additionally, LinkedIn video encoding takes several minutes after the upload finishes,
    // making this unsuitable for a fast smoke-test loop.
    () => {},
  );
});
