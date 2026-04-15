import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { registerAccountTools } from "./accounts.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerBulkTools } from "./bulk.js";
import { registerCampaignGroupTools } from "./campaign-groups.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerCreativeTools } from "./creatives.js";
import { registerTargetingTools } from "./targeting.js";

/**
 * Register every LinkedIn Ads MCP tool on the given server. Order doesn't
 * matter functionally but groups tools logically in the listing.
 */
export function registerAllTools(server: McpServer, client: AxiosInstance): void {
  registerAccountTools(server, client);
  registerCampaignGroupTools(server, client);
  registerCampaignTools(server, client);
  registerCreativeTools(server, client);
  registerTargetingTools(server, client);
  registerAnalyticsTools(server, client);
  registerBulkTools(server, client);
}
