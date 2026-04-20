import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { ensureUrn, urnId } from "../linkedin/urn.js";
import {
  AccountIdSchema,
  CampaignGroupIdSchema,
  CampaignIdSchema,
  CursorPaginationSchema,
  StatusEnum,
} from "../schemas/common.js";
import {
  CampaignCreateSchema,
  CampaignUpdateSchema,
} from "../schemas/campaign.js";
import { truncate, type PagedResponse } from "../utils/pagination.js";
import { callLinkedIn, callLinkedInWithHeaders, extractCreatedId, jsonResult } from "./_helpers.js";

interface Campaign {
  id: number;
  account: string;
  campaignGroup: string;
  name: string;
  type: string;
  status: string;
  costType: string;
  objectiveType: string;
  // Champs budget/coût présents dans les réponses LinkedIn mais non documentés dans l'interface de base
  dailyBudget?: { currencyCode: string; amount: string };
  totalBudget?: { currencyCode: string; amount: string };
  unitCost?: { currencyCode: string; amount: string };
}

export function registerCampaignTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "list_campaigns",
    {
      title: "List Campaigns",
      description:
        "List campaigns in an Ad Account, optionally filtered by status and/or campaign group. " +
        "Use this to discover campaign IDs before update/pause/analytics calls.",
      inputSchema: {
        account_id: AccountIdSchema,
        status: z.array(StatusEnum).optional(),
        campaign_group_id: CampaignGroupIdSchema.optional(),
        pagination: CursorPaginationSchema.optional(),
      },
    },
    async ({ account_id, status, campaign_group_id, pagination }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const { pageSize = 25, pageToken } = pagination ?? {};
      // Build query string manually to keep commas/parens unencoded (LinkedIn Restli syntax).
      let qs = `q=search&pageSize=${pageSize}`;
      if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
      const filters: string[] = [];
      if (status?.length) filters.push(`status:(values:List(${status.join(",")}))`);
      if (campaign_group_id !== undefined) {
        const grpUrn = ensureUrn("sponsoredCampaignGroup", campaign_group_id);
        filters.push(`campaignGroup:(values:List(${encodeURIComponent(grpUrn)}))`);
      }
      if (filters.length) qs += `&search=(${filters.join(",")})`;
      const data = await callLinkedIn<PagedResponse<Campaign>>(
        client,
        `/adAccounts/${accId}/adCampaigns?${qs}`,
      );
      const trunc = truncate(data.elements, 50);
      // Ne pas spreader trunc pour éviter d'inclure elements[] (JSON brut volumineux)
      return jsonResult({
        truncated: trunc.truncated,
        total: trunc.total,
        shown: trunc.shown,
        nextPageToken: data.metadata?.nextPageToken ?? null,
        campaigns: trunc.elements.map((c) => ({
          id: c.id,
          urn: ensureUrn("sponsoredCampaign", c.id),
          name: c.name,
          status: c.status,
          type: c.type,
          objectiveType: c.objectiveType,
          costType: c.costType,
          dailyBudget: c.dailyBudget ?? null,
          totalBudget: c.totalBudget ?? null,
          unitCost: c.unitCost ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Get Campaign",
      description: "Fetch the full details of a single campaign (settings, targeting, schedule).",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
      },
    },
    async ({ account_id, campaign_id }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const campId = urnId(ensureUrn("sponsoredCampaign", campaign_id));
      const raw = await callLinkedIn<Record<string, unknown>>(
        client,
        `/adAccounts/${accId}/adCampaigns/${campId}`,
      );
      // Retirer les champs verbeux qui polluent le contexte sans valeur opérationnelle
      const {
        offsitePreferences: _offsitePreferences,
        connectedTelevisionOnly: _connectedTelevisionOnly,
        storyDeliveryEnabled: _storyDeliveryEnabled,
        audienceExpansionEnabled: _audienceExpansionEnabled,
        creativeSelection: _creativeSelection,
        version: _version,
        changeAuditStamps: _changeAuditStamps,
        associatedEntity: _associatedEntity,
        test: _test,
        format: _format,
        ...clean
      } = raw;
      return jsonResult(clean);
    },
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create Campaign",
      description:
        "Create a new Sponsored Content campaign in one call: name, type, objective, budget, " +
        "targeting, schedule, optimisation, and locale. Defaults to DRAFT status — set status " +
        "to ACTIVE to launch immediately. Build the targetingCriteria with the targeting tools " +
        "(get_targeting_facets + search_targeting_entities + estimate_audience_size).",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign: CampaignCreateSchema,
      },
    },
    async ({ account_id, campaign }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const body: Record<string, unknown> = {
        ...campaign,
        account: ensureUrn("sponsoredAccount", account_id),
        campaignGroup: ensureUrn("sponsoredCampaignGroup", campaign.campaignGroupId),
      };
      delete (body as Record<string, unknown>).campaignGroupId;
      const { headers } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${accId}/adCampaigns`,
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
        urn: createdId !== undefined ? ensureUrn("sponsoredCampaign", createdId) : undefined,
      });
    },
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update Campaign",
      description:
        "Partially update a campaign — change budget, bid, dates, targeting, status, etc. " +
        "Only include the fields you want to change.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
        patch: CampaignUpdateSchema,
      },
    },
    async ({ account_id, campaign_id, patch }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const campId = urnId(ensureUrn("sponsoredCampaign", campaign_id));
      const cleanPatch: Record<string, unknown> = { ...patch };
      if (cleanPatch.campaignGroupId) {
        cleanPatch.campaignGroup = ensureUrn(
          "sponsoredCampaignGroup",
          cleanPatch.campaignGroupId as string | number,
        );
        delete cleanPatch.campaignGroupId;
      }
      await callLinkedIn(client, `/adAccounts/${accId}/adCampaigns/${campId}`, {
        method: "POST",
        data: { patch: { $set: cleanPatch } },
        headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
      });
      return jsonResult({ updated: true, id: Number(campId), changed: Object.keys(cleanPatch) });
    },
  );

  server.registerTool(
    "update_campaign_status",
    {
      title: "Update Campaign Status",
      description:
        "Convenience tool to pause/resume/archive a campaign without thinking about the " +
        "patch shape. Common states: ACTIVE, PAUSED, ARCHIVED, DRAFT.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
        status: StatusEnum,
      },
    },
    async ({ account_id, campaign_id, status }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const campId = urnId(ensureUrn("sponsoredCampaign", campaign_id));
      await callLinkedIn(client, `/adAccounts/${accId}/adCampaigns/${campId}`, {
        method: "POST",
        data: { patch: { $set: { status } } },
        headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
      });
      return jsonResult({ updated: true, id: Number(campId), status });
    },
  );
}
