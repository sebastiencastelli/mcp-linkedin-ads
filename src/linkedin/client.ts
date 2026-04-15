import axios, { type AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import type { AppConfig } from "../config.js";
import type { TokenManager } from "../auth/token-manager.js";
import { logger } from "../utils/logger.js";
import { installAuthInterceptors } from "./interceptors/auth-refresh.js";
import { attachVersionHeaders } from "./interceptors/version-header.js";

const BASE_URL = "https://api.linkedin.com/rest";

/**
 * Build a fully-configured axios instance for the LinkedIn Marketing API.
 *
 * Stack of interceptors (request → response):
 *   1. version-header (attach LinkedIn-Version + X-Restli-Protocol-Version)
 *   2. auth-refresh   (attach Authorization Bearer, refresh on 401)
 *   3. axios-retry    (exponential backoff on 429 / 5xx, respects Retry-After)
 *
 * Every tool MUST go through this client rather than calling axios directly,
 * otherwise it will skip versioning and rate-limit handling and probably
 * break in surprising ways.
 */
export function createLinkedInClient(
  config: AppConfig,
  tokenManager: TokenManager,
): AxiosInstance {
  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 30_000,
    // LinkedIn returns JSON arrays/objects under array keys with brackets,
    // so we leave default param serialization alone — tools that need
    // Restli-shaped query strings build them manually.
  });

  client.interceptors.request.use(attachVersionHeaders(config.LINKEDIN_API_VERSION));
  installAuthInterceptors(client, tokenManager);

  axiosRetry(client, {
    retries: 3,
    retryDelay: (retryCount, error) => {
      const retryAfter = error.response?.headers?.["retry-after"];
      if (retryAfter) {
        const parsed = Number.parseInt(String(retryAfter), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed * 1000;
        }
      }
      // Exponential backoff: 1s, 2s, 4s
      return 2 ** (retryCount - 1) * 1000;
    },
    retryCondition: (error) => {
      const status = error.response?.status;
      if (status === undefined) return true; // network error
      return status === 429 || (status >= 500 && status < 600);
    },
    onRetry: (retryCount, error) => {
      logger.warn(
        { retryCount, status: error.response?.status, url: error.config?.url },
        "Retrying LinkedIn API call",
      );
    },
  });

  return client;
}
