import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AxiosInstance } from "axios";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { registerAllTools } from "../../tools/index.js";
import { logger } from "../../utils/logger.js";
import { makeBearerAuth } from "../middleware/auth.js";

/**
 * Bridges the MCP `StreamableHTTPServerTransport` (the official HTTP+SSE
 * transport for remote MCP servers) onto a Fastify route. This is what
 * Claude.ai web, Claude Desktop, and Claude Code all connect to.
 *
 * The transport is "stateless" mode: each request creates a fresh transport
 * + server pair. That avoids tracking SSE sessions across reconnects, which
 * is the simplest correct approach for our scope (single-user, low traffic).
 */
export function registerMcpRoute(
  app: FastifyInstance,
  config: AppConfig,
  client: AxiosInstance,
): void {
  const auth = makeBearerAuth(config);

  app.all("/mcp", { preHandler: auth }, async (req, reply) => {
    try {
      // StreamableHTTPServerTransport stateless mode requires a fresh
      // McpServer + transport per request — a single McpServer instance
      // cannot be connected to multiple transports concurrently.
      reply.hijack();
      const mcpServer = new McpServer({
        name: "linkedin-ads",
        version: "0.1.0",
      });
      registerAllTools(mcpServer, client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
      req.raw.on("close", () => {
        transport.close().catch((err) => logger.warn({ err }, "Transport close failed"));
        mcpServer.close().catch((err) => logger.warn({ err }, "Server close failed"));
      });
    } catch (err) {
      logger.error({ err }, "MCP transport error");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ error: "mcp_transport_error" }));
      }
    }
  });
}
