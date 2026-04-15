import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

/**
 * Build the Fastify instance with all the cross-cutting plugins. We register:
 *   - helmet for sane security headers (CSP relaxed for the wizard pages)
 *   - cookie for the wizard browser session
 *   - cors permissive on /mcp specifically (Claude.ai web makes cross-origin requests)
 *
 * Fastify's built-in logger is disabled — we use our own pino instance from
 * `src/utils/logger.ts` directly, which avoids Fastify v5's stricter logger
 * type inference colliding with downstream FastifyInstance generics.
 */
export async function buildHttpServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true, // we sit behind Caddy
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // wizard uses inline JS for simplicity
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  });

  await app.register(cookie, {
    secret: config.MCP_API_TOKEN, // signs the session cookie
  });

  // Form body parser for the wizard login form (application/x-www-form-urlencoded).
  // Fastify only handles application/json out of the box.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const parsed: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(body as string)) parsed[k] = v;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow Claude.ai and our public URL
      if (!origin || origin === "https://claude.ai" || origin === config.PUBLIC_URL) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  return app;
}
