import { TokenStore } from "./auth/token-store.js";
import { TokenManager } from "./auth/token-manager.js";
import { loadConfig } from "./config.js";
import { createLinkedInClient } from "./linkedin/client.js";
import { buildHttpServer } from "./server/http.js";
import { registerHealthRoute } from "./server/routes/health.js";
import { registerMcpRoute } from "./server/routes/mcp.js";
import { registerOauthRoutes } from "./server/routes/oauth.js";
import { registerSetupRoutes } from "./server/routes/setup.js";
import { logger } from "./utils/logger.js";

/**
 * Application entry point. Wires together:
 *   - Config loading (fail fast on invalid env)
 *   - Token store + token manager (loads any persisted token)
 *   - LinkedIn HTTP client (axios + interceptors)
 *   - Fastify HTTP server with all routes (/health, /mcp, /setup, /oauth)
 *
 * Listens on 0.0.0.0:${PORT} so the Docker container can be reached from
 * the Caddy reverse proxy on the host.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.PORT, publicUrl: config.PUBLIC_URL }, "Starting MCP LinkedIn Ads");

  const tokenStore = new TokenStore(config.DATA_DIR, config.ENCRYPTION_KEY);
  const tokenManager = new TokenManager(config, tokenStore);
  await tokenManager.init();

  const linkedinClient = createLinkedInClient(config, tokenManager);

  const app = await buildHttpServer(config);
  registerHealthRoute(app, tokenManager);
  registerMcpRoute(app, config, linkedinClient);
  registerOauthRoutes(app, config, tokenManager);
  registerSetupRoutes(app, config, tokenManager);

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  logger.info({ port: config.PORT }, "MCP server listening");

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error during startup");
  process.exit(1);
});
