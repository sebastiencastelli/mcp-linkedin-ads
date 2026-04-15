import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import type { TokenManager } from "../../auth/token-manager.js";
import { makeCookieOrBearerAuth } from "../middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, "..", "views");

/**
 * Render an HTML view file with simple {{ KEY }} substitution. We deliberately
 * avoid a full template engine — the wizard is two static pages.
 */
async function renderView(name: string, vars: Record<string, string> = {}): Promise<string> {
  const tpl = await readFile(join(VIEWS_DIR, name), "utf8");
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function registerSetupRoutes(
  app: FastifyInstance,
  config: AppConfig,
  tokenManager: TokenManager,
): void {
  const auth = makeCookieOrBearerAuth(config);

  // Login page — public, posts the API token to set the session cookie.
  app.get("/setup", async (req, reply) => {
    const cookieToken = (req as { cookies?: Record<string, string> }).cookies?.mcp_session;
    if (cookieToken && timingSafeEqual(cookieToken, config.MCP_API_TOKEN)) {
      reply.redirect("/setup/dashboard", 302);
      return;
    }
    const html = await renderView("login.html", { PUBLIC_URL: config.PUBLIC_URL });
    reply.type("text/html").send(html);
  });

  app.post<{ Body: { token?: string } }>("/setup/login", async (req, reply) => {
    const provided = (req.body?.token ?? "").trim();
    if (!provided || !timingSafeEqual(provided, config.MCP_API_TOKEN)) {
      reply.code(401).type("text/html").send("<h1>Wrong token</h1><p><a href='/setup'>Try again</a></p>");
      return;
    }
    reply.setCookie("mcp_session", provided, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    reply.redirect("/setup/dashboard", 302);
  });

  app.post("/setup/logout", { preHandler: auth }, async (req, reply) => {
    reply.clearCookie("mcp_session", { path: "/" });
    reply.redirect("/setup", 302);
  });

  // Dashboard — shows OAuth status and the connect button.
  app.get("/setup/dashboard", { preHandler: auth }, async (req, reply) => {
    const status = tokenManager.getStatus();
    const mcpUrl = `${config.PUBLIC_URL}/mcp`;

    const desktopSnippet = JSON.stringify(
      {
        mcpServers: {
          "linkedin-ads": {
            url: mcpUrl,
            headers: { Authorization: `Bearer ${config.MCP_API_TOKEN}` },
          },
        },
      },
      null,
      2,
    );

    const codeSnippet = JSON.stringify(
      {
        mcpServers: {
          "linkedin-ads": {
            type: "http",
            url: mcpUrl,
            headers: { Authorization: `Bearer ${config.MCP_API_TOKEN}` },
          },
        },
      },
      null,
      2,
    );

    const html = await renderView("dashboard.html", {
      PUBLIC_URL: config.PUBLIC_URL,
      MCP_URL: mcpUrl,
      MCP_API_TOKEN: config.MCP_API_TOKEN,
      OAUTH_CONFIGURED: status.configured ? "yes" : "no",
      OAUTH_STATUS_JSON: JSON.stringify(status, null, 2),
      DESKTOP_SNIPPET: desktopSnippet
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;"),
      CODE_SNIPPET: codeSnippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    });
    reply.type("text/html").send(html);
  });

  app.get("/setup/status", { preHandler: auth }, async () => {
    return tokenManager.getStatus();
  });

  // Success page after the OAuth callback redirects here. Same dashboard,
  // but with a banner.
  app.get("/setup/success", { preHandler: auth }, async (req, reply) => {
    reply.redirect("/setup/dashboard?oauth=ok", 302);
  });
}
