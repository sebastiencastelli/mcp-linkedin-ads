import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { ensureUrn, urnId } from "../linkedin/urn.js";
import { AccountIdSchema, CampaignIdSchema } from "../schemas/common.js";
import { callLinkedIn, callLinkedInWithHeaders, extractCreatedId, jsonResult } from "./_helpers.js";

/**
 * Shape returned by a Restli BATCH_PARTIAL_UPDATE call when the server sends
 * back partial errors (HTTP 207). The `results` map keys are the numeric
 * campaign IDs as strings.
 */
interface BatchPartialUpdateResponse {
  results?: Record<string, { status: number; code?: string; message?: string }>;
}

/**
 * Composite ("smart") tools that combine several primitive operations. They
 * exist so Claude doesn't have to orchestrate dozens of low-level calls when
 * the user asks for a common multi-step action like "pause everything that
 * underperforms" or "duplicate this campaign with a new budget".
 */
export function registerBulkTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "bulk_pause_campaigns",
    {
      title: "Bulk Pause Campaigns",
      description:
        "Pause multiple campaigns in a single LinkedIn BATCH_PARTIAL_UPDATE API call. " +
        "Useful when Claude needs to react to a batch of underperformers identified via " +
        "get_campaign_analytics. Returns a per-campaign success/failure summary.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_ids: z
          .array(CampaignIdSchema)
          .min(1)
          .max(50)
          .describe("List of campaign IDs/URNs to pause (max 50 per call)."),
      },
    },
    async ({ account_id, campaign_ids }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));

      // Resolve all IDs to their bare numeric string form (e.g. "123").
      const ids = campaign_ids.map((cid) => urnId(ensureUrn("sponsoredCampaign", cid)));

      // Build the URL with ids=List(id1,id2,...) — Restli syntax requires
      // commas and parentheses to stay raw (not percent-encoded), matching
      // the same convention used in analytics.ts for List(...) params.
      const url = `/adAccounts/${accId}/adCampaigns?ids=List(${ids.join(",")})`;

      // Build the BATCH_PARTIAL_UPDATE body.
      const entities: Record<string, { patch: { $set: { status: string } } }> = {};
      for (const id of ids) {
        entities[id] = { patch: { $set: { status: "PAUSED" } } };
      }

      // A single API call replaces N individual PARTIAL_UPDATE calls.
      // LinkedIn returns 204 on full success, or 207 with per-entity results
      // when some entities fail.
      let batchResponse: BatchPartialUpdateResponse | null = null;
      let batchError: Error | null = null;

      try {
        batchResponse = await callLinkedIn<BatchPartialUpdateResponse>(client, url, {
          method: "POST",
          data: { entities },
          headers: {
            "X-RestLi-Method": "BATCH_PARTIAL_UPDATE",
            "X-RestLi-Protocol-Version": "2.0.0",
          },
        });
      } catch (err) {
        batchError = err as Error;
      }

      // Build per-campaign details from the response.
      const details = ids.map((id, i) => {
        const campaignId = campaign_ids[i];

        // Hard failure: the whole call was rejected (4xx/5xx).
        if (batchError !== null) {
          return { campaign_id: campaignId, paused: false, error: batchError.message };
        }

        // 204 or 207 with no per-entity results map → everything succeeded.
        if (!batchResponse?.results) {
          return { campaign_id: campaignId, paused: true };
        }

        // 207 with per-entity results: check the status for this specific ID.
        const entityResult = batchResponse.results[id];
        if (entityResult === undefined || entityResult.status === 204 || entityResult.status === 200) {
          return { campaign_id: campaignId, paused: true };
        }

        const errMsg =
          entityResult.message ??
          entityResult.code ??
          `LinkedIn status ${entityResult.status}`;
        return { campaign_id: campaignId, paused: false, error: errMsg };
      });

      return jsonResult({
        totalRequested: campaign_ids.length,
        succeeded: details.filter((d) => d.paused).length,
        failed: details.filter((d) => !d.paused).length,
        details,
      });
    },
  );

  server.registerTool(
    "duplicate_campaign",
    {
      title: "Duplicate Campaign",
      description:
        "Read an existing campaign, modify a subset of its settings (name, budget, schedule, " +
        "status), and create a new campaign with the result. Targeting and creatives are NOT " +
        "duplicated automatically — only the campaign shell.",
      inputSchema: {
        account_id: AccountIdSchema,
        source_campaign_id: CampaignIdSchema,
        name: z.string().describe("Name for the new campaign."),
        daily_budget: z
          .object({ currencyCode: z.string().length(3), amount: z.string() })
          .optional()
          .describe("Optional new daily budget."),
        run_schedule: z
          .object({ start: z.number().int(), end: z.number().int().optional() })
          .optional(),
      },
    },
    async ({ account_id, source_campaign_id, name, daily_budget, run_schedule }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const srcId = urnId(ensureUrn("sponsoredCampaign", source_campaign_id));

      const source = await callLinkedIn<Record<string, unknown>>(
        client,
        `/adAccounts/${accId}/adCampaigns/${srcId}`,
      );

      const newBody: Record<string, unknown> = {
        ...source,
        name,
        status: "DRAFT",
      };
      // Strip read-only fields LinkedIn rejects on POST
      for (const k of [
        "id",
        "version",
        "changeAuditStamps",
        "servingStatuses",
        "test",
        "isServing",
      ]) {
        delete newBody[k];
      }
      if (daily_budget) newBody.dailyBudget = daily_budget;
      if (run_schedule) newBody.runSchedule = run_schedule;

      const { headers: createHeaders } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${accId}/adCampaigns`,
        {
          method: "POST",
          data: newBody,
          headers: { "X-RestLi-Method": "CREATE" },
        },
      );
      const newId = extractCreatedId(createHeaders);
      return jsonResult({
        duplicated: true,
        sourceId: Number(srcId),
        newId,
        newUrn: newId !== undefined ? ensureUrn("sponsoredCampaign", newId) : undefined,
      });
    },
  );
}
