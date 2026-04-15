import axios from "axios";
import type { AppConfig } from "../config.js";
import type { StoredToken } from "./token-store.js";

const AUTHORIZATION_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
}

/**
 * Build the LinkedIn 3-legged OAuth authorization URL. The `state` parameter
 * is used to defend against CSRF on the callback — it is generated and stored
 * server-side by the wizard route, then verified when LinkedIn redirects back.
 */
export function buildAuthorizationUrl(config: AppConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.LINKEDIN_CLIENT_ID,
    redirect_uri: config.redirectUri,
    state,
    scope: config.LINKEDIN_SCOPES,
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

function tokenResponseToStored(resp: LinkedInTokenResponse, now: number): StoredToken {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    expiresAt: now + resp.expires_in * 1000,
    refreshExpiresAt: now + resp.refresh_token_expires_in * 1000,
    scope: resp.scope,
    lastRefreshedAt: now,
  };
}

/**
 * Exchange a one-time authorization `code` (received on /oauth/callback) for
 * an access + refresh token pair. Called once per LinkedIn user, when the
 * wizard completes the OAuth flow.
 */
export async function exchangeCodeForToken(
  config: AppConfig,
  code: string,
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.LINKEDIN_CLIENT_ID,
    client_secret: config.LINKEDIN_CLIENT_SECRET,
  });
  const { data } = await axios.post<LinkedInTokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });
  return tokenResponseToStored(data, Date.now());
}

/**
 * Refresh an access token using the rotating refresh token. LinkedIn returns
 * a NEW refresh token at every refresh — we MUST persist both, never just the
 * access token, or the next refresh will fail with invalid_grant.
 */
export async function refreshAccessToken(
  config: AppConfig,
  refreshToken: string,
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.LINKEDIN_CLIENT_ID,
    client_secret: config.LINKEDIN_CLIENT_SECRET,
  });
  const { data } = await axios.post<LinkedInTokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });
  return tokenResponseToStored(data, Date.now());
}
