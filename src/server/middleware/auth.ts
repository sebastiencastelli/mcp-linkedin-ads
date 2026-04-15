import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config.js";

/**
 * Bearer token auth for /mcp and /setup. The same token is used by Claude
 * clients (Desktop / Code / .ai web) via the Authorization header, and by the
 * wizard cookie for browser sessions. Compared in constant time to defend
 * against timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function makeBearerAuth(config: AppConfig) {
  return async function bearerAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      reply.code(401).send({ error: "missing_bearer_token" });
      return reply;
    }
    const provided = header.slice(7).trim();
    if (!timingSafeEqual(provided, config.MCP_API_TOKEN)) {
      reply.code(401).send({ error: "invalid_bearer_token" });
      return reply;
    }
  };
}

/**
 * Cookie-based variant for the wizard browser flow. Once the user pastes
 * their token in /setup and we validate it, we set an httpOnly cookie so they
 * don't have to re-paste on every page load. Same token underneath.
 */
export function makeCookieOrBearerAuth(config: AppConfig) {
  return async function cookieOrBearerAuth(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Try cookie first (browser flow)
    const cookieToken = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies
      ?.mcp_session;
    if (cookieToken && timingSafeEqual(cookieToken, config.MCP_API_TOKEN)) return;

    // Fall back to Authorization header
    const header = req.headers.authorization;
    if (header?.toLowerCase().startsWith("bearer ")) {
      const provided = header.slice(7).trim();
      if (timingSafeEqual(provided, config.MCP_API_TOKEN)) return;
    }

    reply.code(401).send({ error: "unauthorized", hint: "POST /setup/login with the API token first." });
    return reply;
  };
}
