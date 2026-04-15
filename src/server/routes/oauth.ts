import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
} from "../../auth/oauth-flow.js";
import type { TokenManager } from "../../auth/token-manager.js";
import { logger } from "../../utils/logger.js";
import { makeCookieOrBearerAuth } from "../middleware/auth.js";

/**
 * In-memory state cache for the OAuth handshake. Maps `state` → expiry epoch ms.
 * Single-process only — fine for our scope. TTL 10 minutes.
 */
const stateCache = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function rememberState(state: string): void {
  // Garbage-collect expired states whenever we add a new one
  const now = Date.now();
  for (const [k, exp] of stateCache.entries()) {
    if (exp < now) stateCache.delete(k);
  }
  stateCache.set(state, now + STATE_TTL_MS);
}

function consumeState(state: string): boolean {
  const exp = stateCache.get(state);
  if (!exp || exp < Date.now()) return false;
  stateCache.delete(state);
  return true;
}

export function registerOauthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  tokenManager: TokenManager,
): void {
  const auth = makeCookieOrBearerAuth(config);

  // GET /oauth/start — kick off the LinkedIn OAuth flow. Authenticated by
  // the wizard cookie so randoms can't burn quota or spam OAuth requests.
  app.get("/oauth/start", { preHandler: auth }, async (req, reply) => {
    const state = randomBytes(24).toString("hex");
    rememberState(state);
    const url = buildAuthorizationUrl(config, state);
    logger.info({ state }, "Starting LinkedIn OAuth flow");
    reply.redirect(url, 302);
  });

  // GET /oauth/callback — LinkedIn redirects here after the user grants
  // consent. NOT authenticated (LinkedIn won't pass our cookies through),
  // but state validation ensures only flows we initiated are accepted.
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/oauth/callback", async (req, reply) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      logger.warn({ error, error_description }, "LinkedIn returned an OAuth error");
      reply.code(400).type("text/html").send(
        `<h1>OAuth error</h1><p>LinkedIn said: <code>${error}</code></p><p>${
          error_description ?? ""
        }</p>`,
      );
      return;
    }
    if (!code || !state) {
      reply.code(400).send({ error: "missing_code_or_state" });
      return;
    }
    if (!consumeState(state)) {
      reply.code(400).send({ error: "invalid_or_expired_state" });
      return;
    }

    try {
      const token = await exchangeCodeForToken(config, code);
      await tokenManager.setToken(token);
      logger.info("OAuth flow completed — token stored");
      reply.redirect("/setup/success", 302);
    } catch (err) {
      logger.error({ err }, "Failed to exchange OAuth code for token");
      reply.code(500).type("text/html").send(
        `<h1>Token exchange failed</h1><p>${(err as Error).message}</p>`,
      );
    }
  });
}
