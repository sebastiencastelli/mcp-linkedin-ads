import type { AxiosError } from "axios";

/**
 * Wraps an error from the LinkedIn API in a typed shape with a Claude-friendly
 * message. The goal is that the LLM can read the message and decide what to
 * do (retry, fix params, ask the user) without having to inspect the raw HTTP
 * response.
 */
export class LinkedInApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly serviceErrorCode: number | string | undefined,
    public readonly endpoint: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

interface LinkedInErrorPayload {
  message?: string;
  serviceErrorCode?: number | string;
  status?: number;
  code?: string;
}

function extractMessage(payload: unknown): {
  message?: string;
  code?: number | string;
} {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as LinkedInErrorPayload;
  return {
    message: p.message,
    code: p.serviceErrorCode ?? p.code,
  };
}

/**
 * Translate an axios error into a `LinkedInApiError` with a message tailored
 * to common LinkedIn failure modes. The mapping table covers the codes we hit
 * most often in the Advertising API.
 */
export function formatLinkedInError(err: unknown, endpoint: string): LinkedInApiError {
  const axErr = err as AxiosError;
  const status = axErr.response?.status;
  const data = axErr.response?.data;
  const { message, code } = extractMessage(data);

  let humanMessage: string;
  switch (status) {
    case 400:
      humanMessage =
        `LinkedIn rejected the request as malformed (400). ` +
        `Verify URN formats, the X-Restli-Protocol-Version header, and required fields. ` +
        `LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 401:
      humanMessage =
        `LinkedIn returned 401 Unauthorized. The access token is invalid or expired ` +
        `and could not be refreshed automatically. The user may need to re-run the ` +
        `OAuth flow via /setup. LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 403:
      humanMessage =
        `LinkedIn returned 403 Forbidden (${code ?? "no code"}). The authenticated ` +
        `member does not have the required role on this Ad Account, or the app is ` +
        `missing the required scope/product (e.g. Matched Audiences requires a ` +
        `separate approval). LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 404:
      humanMessage =
        `LinkedIn returned 404 Not Found. The URN you passed does not exist or is ` +
        `not visible to this member. Double-check the account_id / campaign_id / ` +
        `URN format. LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 422:
      humanMessage =
        `LinkedIn returned 422 Unprocessable Entity. A field passed validation but ` +
        `was rejected by business logic (e.g. budget too low, dates in the past, ` +
        `targeting too narrow). LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 429:
      humanMessage =
        `LinkedIn returned 429 Too Many Requests. The per-app or per-member rate ` +
        `limit was exceeded. The client should back off — quota resets at midnight UTC. ` +
        `LinkedIn said: "${message ?? "no detail"}"`;
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      humanMessage =
        `LinkedIn server error (${status}). This is usually transient — retry in a ` +
        `few seconds. LinkedIn said: "${message ?? "no detail"}"`;
      break;
    default:
      humanMessage = `LinkedIn API call failed (${status ?? "no status"}): ${
        message ?? axErr.message ?? "unknown error"
      }`;
  }

  return new LinkedInApiError(humanMessage, status, code, endpoint, data);
}
