import axios, { AxiosError } from "axios";

/**
 * Lightweight HTTP JSON-RPC client for the deployed MCP server.
 * Used by smoke tests to call tools exactly as Claude would, but programmatically.
 *
 * Reads MCP_URL and MCP_TOKEN from env. Defaults to the deployed instance.
 */
const MCP_URL = process.env.MCP_URL;
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!MCP_URL || !MCP_TOKEN) {
  throw new Error(
    "Smoke tests require MCP_URL and MCP_TOKEN environment variables.\n" +
      "Example:\n" +
      "  MCP_URL=https://mcp-linkedin.example.com/mcp \\\n" +
      "  MCP_TOKEN=<your-mcp-api-token> \\\n" +
      "  pnpm test tests/smoke/",
  );
}

export interface McpCallOptions {
  /** Abort after this many ms. Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Result of a tool call. Either `ok: true` with parsed JSON, or `ok: false`
 * with the raw error message the server sent back. Both cases are "expected"
 * in smoke tests (some tests assert on errors).
 */
export type McpToolResult =
  | { ok: true; data: unknown; raw: string }
  | { ok: false; error: string; raw: string };

/** Parse SSE "data: {...}" frames and extract the first JSON-RPC response. */
function parseSseFrames(body: string): unknown | null {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // ignore malformed frames
      }
    }
  }
  return null;
}

let rpcIdCounter = 1;

/**
 * Call a single tool on the MCP server. Handles both SSE and plain JSON
 * responses. Returns structured success/error that smoke tests can assert on.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  options: McpCallOptions = {},
): Promise<McpToolResult> {
  const id = rpcIdCounter++;
  try {
    const resp = await axios.post(
      MCP_URL,
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      },
      {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        timeout: options.timeoutMs ?? 60_000,
        // Always treat non-2xx as a thrown error (handled below)
        validateStatus: (s) => s >= 200 && s < 300,
        responseType: "text",
        transformResponse: [(d: unknown) => (typeof d === "string" ? d : String(d))],
      },
    );

    const raw = resp.data as string;
    const rpc =
      raw.startsWith("event:") || raw.startsWith("data:")
        ? parseSseFrames(raw)
        : safeJsonParse(raw);

    if (rpc && typeof rpc === "object" && "error" in rpc) {
      const err = (rpc as { error: { message?: string } }).error;
      return { ok: false, error: err.message ?? JSON.stringify(err), raw };
    }

    if (rpc && typeof rpc === "object" && "result" in rpc) {
      const result = (rpc as { result: { content?: Array<{ type: string; text: string }>; isError?: boolean } })
        .result;
      if (result.isError) {
        const errorText = result.content?.[0]?.text ?? "unknown tool error";
        return { ok: false, error: errorText, raw };
      }
      // Tools return their payload as a JSON string inside content[0].text
      const text = result.content?.[0]?.text;
      if (text === undefined) {
        return { ok: true, data: null, raw };
      }
      try {
        return { ok: true, data: JSON.parse(text), raw };
      } catch {
        // Not JSON — return as raw string
        return { ok: true, data: text, raw };
      }
    }

    return { ok: false, error: `Unexpected MCP response: ${raw.slice(0, 200)}`, raw };
  } catch (e) {
    const err = e as AxiosError;
    const raw = (err.response?.data as string) ?? err.message;
    return { ok: false, error: err.message, raw };
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Ad Account ID used by every smoke test — set SMOKE_ACCOUNT_ID in env. */
const rawAccountId = process.env.SMOKE_ACCOUNT_ID;
if (!rawAccountId) {
  throw new Error(
    "Smoke tests require SMOKE_ACCOUNT_ID env var (a LinkedIn Ad Account ID " +
      "reachable via the configured OAuth token).",
  );
}
export const TEST_ACCOUNT_ID = Number(rawAccountId);
if (!Number.isFinite(TEST_ACCOUNT_ID) || TEST_ACCOUNT_ID <= 0) {
  throw new Error(`SMOKE_ACCOUNT_ID must be a positive integer, got: ${rawAccountId}`);
}

/** A known campaign ID on TEST_ACCOUNT_ID used by campaign-scoped analytics smoke tests. */
export const KNOWN_CAMPAIGN_ID = process.env.SMOKE_KNOWN_CAMPAIGN_ID
  ? Number(process.env.SMOKE_KNOWN_CAMPAIGN_ID)
  : undefined;

/** Timestamp helper for setting runSchedule.start safely in the future. */
export function futureTimestamp(daysFromNow = 30): number {
  return Date.now() + daysFromNow * 24 * 3600 * 1000;
}

/** Unique name prefix so each smoke-test run is identifiable in Campaign Manager. */
export function uniqueName(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `[SMOKE-${prefix}-${ts}]`;
}
