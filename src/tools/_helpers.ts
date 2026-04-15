import type { AxiosInstance, AxiosRequestConfig } from "axios";
import { formatLinkedInError } from "../linkedin/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Wrap a LinkedIn HTTP call so that any error becomes a `LinkedInApiError`
 * with a Claude-friendly message. Also logs request/response timing for
 * troubleshooting.
 */
export async function callLinkedIn<T>(
  client: AxiosInstance,
  endpoint: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const started = Date.now();
  try {
    const resp = await client.request<T>({ url: endpoint, ...config });
    logger.debug(
      { endpoint, status: resp.status, durationMs: Date.now() - started },
      "LinkedIn call OK",
    );
    return resp.data;
  } catch (err) {
    logger.warn(
      { endpoint, durationMs: Date.now() - started },
      "LinkedIn call failed",
    );
    throw formatLinkedInError(err, endpoint);
  }
}

/**
 * Like callLinkedIn but also returns the response headers. Required for
 * CREATE calls where LinkedIn returns the new resource ID in the
 * `X-RestLi-Id` header rather than in the response body.
 */
export async function callLinkedInWithHeaders<T>(
  client: AxiosInstance,
  endpoint: string,
  config?: AxiosRequestConfig,
): Promise<{ data: T; headers: Record<string, string> }> {
  const started = Date.now();
  try {
    const resp = await client.request<T>({ url: endpoint, ...config });
    logger.debug(
      { endpoint, status: resp.status, durationMs: Date.now() - started },
      "LinkedIn call OK",
    );
    return {
      data: resp.data,
      headers: resp.headers as Record<string, string>,
    };
  } catch (err) {
    logger.warn(
      { endpoint, durationMs: Date.now() - started },
      "LinkedIn call failed",
    );
    throw formatLinkedInError(err, endpoint);
  }
}

/**
 * Extract a numeric resource ID from LinkedIn CREATE response headers.
 *
 * LinkedIn may return the new ID via:
 *   1. `x-restli-id` (most endpoints)
 *   2. `x-linkedin-id` (older variants)
 *   3. `location` header — e.g. "/adAccounts/514213130/creatives/1247234164"
 *      where the last path segment is the ID.
 *
 * Returns the ID as a number, or undefined when none of the headers are present.
 */
export function extractCreatedId(headers: Record<string, string>): number | undefined {
  const direct = headers["x-restli-id"] ?? headers["x-linkedin-id"];
  if (direct !== undefined) {
    const n = Number(direct);
    return Number.isNaN(n) ? undefined : n;
  }
  const location = headers["location"];
  if (location) {
    const segment = location.split("/").pop();
    if (segment) {
      // The segment may be URL-encoded (e.g. a URN). Try extracting the
      // numeric tail after the last colon first (handles URN format), then
      // fall back to the whole segment.
      const decoded = decodeURIComponent(segment);
      const afterColon = decoded.split(":").pop() ?? decoded;
      const n = Number(afterColon);
      return Number.isNaN(n) ? undefined : n;
    }
  }
  return undefined;
}

/** Build a JSON tool result content block in the MCP-expected shape. */
export function jsonResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
