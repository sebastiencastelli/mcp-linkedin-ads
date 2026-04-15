import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { ensureUrn, urnId } from "../linkedin/urn.js";
import { AccountIdSchema, CursorPaginationSchema } from "../schemas/common.js";
import { truncate, type PagedResponse } from "../utils/pagination.js";
import { callLinkedIn, jsonResult } from "./_helpers.js";

interface AdAccount {
  id: number;
  name: string;
  type: string;
  status: string;
  currency: string;
  reference?: string;
  notifiedOnCampaignOptimization?: boolean;
  notifiedOnCreativeApproval?: boolean;
  notifiedOnEndOfCampaign?: boolean;
  test?: boolean;
}

/**
 * Account-level tools. The flow Claude follows is always:
 *   1. list_ad_accounts → discover the IDs of every Ad Account this OAuth
 *      member can access (own accounts + clients where they were invited).
 *   2. get_ad_account / list_campaigns / etc., passing the account_id from
 *      step 1.
 */
export function registerAccountTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "list_ad_accounts",
    {
      title: "List Ad Accounts",
      description:
        "Returns every LinkedIn Ad Account the authenticated member has access to. " +
        "ALWAYS call this first when starting a new task — Claude needs the account_id " +
        "to perform any other action. The same OAuth grant covers Sébastien's own accounts " +
        "AND any client accounts where he has been invited as a manager.",
      inputSchema: {
        pagination: CursorPaginationSchema.optional().describe(
          "Optional pagination (cursor-based, v202401+). Omit for the first page.",
        ),
      },
    },
    async ({ pagination }) => {
      const { pageSize = 25, pageToken } = pagination ?? {};
      let qs = `q=search&pageSize=${pageSize}`;
      if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
      const data = await callLinkedIn<PagedResponse<AdAccount>>(
        client,
        `/adAccounts?${qs}`,
      );
      const trunc = truncate(data.elements, 50);
      return jsonResult({
        ...trunc,
        nextPageToken: data.metadata?.nextPageToken ?? null,
        accounts: trunc.elements.map((a) => ({
          id: a.id,
          urn: ensureUrn("sponsoredAccount", a.id),
          name: a.name,
          type: a.type,
          status: a.status,
          currency: a.currency,
          test: a.test ?? false,
        })),
      });
    },
  );

  server.registerTool(
    "get_ad_account",
    {
      title: "Get Ad Account",
      description:
        "Fetch full details of a specific Ad Account by ID. Use this when you need " +
        "settings beyond what list_ad_accounts returns (notifications, billing reference, etc.).",
      inputSchema: {
        account_id: AccountIdSchema,
      },
    },
    async ({ account_id }) => {
      const id = urnId(ensureUrn("sponsoredAccount", account_id));
      const data = await callLinkedIn<AdAccount>(client, `/adAccounts/${id}`);
      return jsonResult(data);
    },
  );
}
