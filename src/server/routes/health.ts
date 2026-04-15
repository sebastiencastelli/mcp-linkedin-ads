import type { FastifyInstance } from "fastify";
import type { TokenManager } from "../../auth/token-manager.js";

export function registerHealthRoute(app: FastifyInstance, tokenManager: TokenManager): void {
  app.get("/health", async () => {
    return {
      status: "ok",
      oauth: tokenManager.getStatus(),
      uptime: process.uptime(),
    };
  });
}
