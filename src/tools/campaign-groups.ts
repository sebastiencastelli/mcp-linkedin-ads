import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { ensureUrn, urnId } from "../linkedin/urn.js";
import {
  AccountIdSchema,
  CampaignGroupIdSchema,
  CampaignGroupStatusEnum,
  CursorPaginationSchema,
  MoneySchema,
} from "../schemas/common.js";
import { truncate, type PagedResponse } from "../utils/pagination.js";
import { callLinkedIn, callLinkedInWithHeaders, extractCreatedId, jsonResult } from "./_helpers.js";

interface CampaignGroup {
  id: number;
  account: string;
  name: string;
  status: string;
  totalBudget?: { currencyCode: string; amount: string };
  runSchedule?: { start: number; end?: number };
  test?: boolean;
}

export function registerCampaignGroupTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "list_campaign_groups",
    {
      title: "List Campaign Groups",
      description:
        "List all campaign groups in an Ad Account. Campaign groups are containers for " +
        "campaigns sharing a total budget and run schedule. Filter by status if needed.",
      inputSchema: {
        account_id: AccountIdSchema,
        status: z
          .array(CampaignGroupStatusEnum)
          .optional()
          .describe("Optional status filter, e.g. ['ACTIVE', 'PAUSED', 'CANCELLED']."),
        pagination: CursorPaginationSchema.optional(),
      },
    },
    async ({ account_id, status, pagination }) => {
      const id = urnId(ensureUrn("sponsoredAccount", account_id));
      const { pageSize = 25, pageToken } = pagination ?? {};
      // Build query string manually to keep commas/parens unencoded (LinkedIn Restli syntax).
      let qs = `q=search&pageSize=${pageSize}`;
      if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
      if (status?.length) {
        qs += `&search=(status:(values:List(${status.join(",")})))`;
      }
      const data = await callLinkedIn<PagedResponse<CampaignGroup>>(
        client,
        `/adAccounts/${id}/adCampaignGroups?${qs}`,
      );
      const trunc = truncate(data.elements, 50);
      return jsonResult({
        ...trunc,
        nextPageToken: data.metadata?.nextPageToken ?? null,
        groups: trunc.elements.map((g) => ({
          id: g.id,
          urn: ensureUrn("sponsoredCampaignGroup", g.id),
          name: g.name,
          status: g.status,
          totalBudget: g.totalBudget,
          runSchedule: g.runSchedule,
        })),
      });
    },
  );

  server.registerTool(
    "create_campaign_group",
    {
      title: "Create Campaign Group",
      description:
        "Create a new campaign group inside an Ad Account. The group acts as a container " +
        "for one or more campaigns and can enforce a shared total budget.",
      inputSchema: {
        account_id: AccountIdSchema,
        name: z.string().min(1).max(100).describe("Group name (visible in Campaign Manager)."),
        status: CampaignGroupStatusEnum.default("DRAFT"),
        total_budget: MoneySchema.optional().describe(
          "Optional total budget cap shared across all campaigns in the group.",
        ),
        run_schedule: z
          .object({
            start: z.number().int().describe("Unix epoch ms when the group becomes active."),
            end: z.number().int().optional(),
          })
          .describe("Run schedule for the group."),
      },
    },
    async ({ account_id, name, status, total_budget, run_schedule }) => {
      const id = urnId(ensureUrn("sponsoredAccount", account_id));
      const body: Record<string, unknown> = {
        account: ensureUrn("sponsoredAccount", account_id),
        name,
        status,
        runSchedule: run_schedule,
      };
      if (total_budget) body.totalBudget = total_budget;
      const { headers } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${id}/adCampaignGroups`,
        {
          method: "POST",
          data: body,
          headers: { "X-RestLi-Method": "CREATE" },
        },
      );
      const createdId = extractCreatedId(headers);
      return jsonResult({
        created: true,
        id: createdId,
        urn: createdId !== undefined ? ensureUrn("sponsoredCampaignGroup", createdId) : undefined,
      });
    },
  );

  server.registerTool(
    "update_campaign_group",
    {
      title: "Update Campaign Group",
      description:
        "Partially update a campaign group: rename, change status (pause/resume/archive), " +
        "adjust total budget or run schedule. Only include the fields you want to change.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_group_id: CampaignGroupIdSchema,
        name: z.string().optional(),
        status: CampaignGroupStatusEnum.optional(),
        total_budget: MoneySchema.optional(),
        run_schedule: z
          .object({
            start: z.number().int(),
            end: z.number().int().optional(),
          })
          .optional(),
      },
    },
    async ({ account_id, campaign_group_id, name, status, total_budget, run_schedule }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const groupId = urnId(ensureUrn("sponsoredCampaignGroup", campaign_group_id));
      const patch: Record<string, unknown> = {};
      if (name !== undefined) patch.name = name;
      if (status !== undefined) patch.status = status;
      if (total_budget !== undefined) patch.totalBudget = total_budget;
      if (run_schedule !== undefined) patch.runSchedule = run_schedule;
      await callLinkedIn(client, `/adAccounts/${accId}/adCampaignGroups/${groupId}`, {
        method: "POST",
        data: { patch: { $set: patch } },
        headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
      });
      return jsonResult({ updated: true, id: Number(groupId), changed: Object.keys(patch) });
    },
  );
}
