import type { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { refreshAccessToken } from "./oauth-flow.js";
import type { StoredToken, TokenStore } from "./token-store.js";

/** Refresh the access token if it expires within this window. */
const REFRESH_LEEWAY_MS = 5 * 60 * 1000; // 5 minutes

export class TokenNotConfiguredError extends Error {
  constructor() {
    super(
      "LinkedIn OAuth has not been completed yet. " +
        "Open /setup in your browser and click 'Connect LinkedIn'.",
    );
    this.name = "TokenNotConfiguredError";
  }
}

export class RefreshTokenExpiredError extends Error {
  constructor() {
    super(
      "The LinkedIn refresh token has expired (it lasts ~365 days). " +
        "Open /setup in your browser and re-run the OAuth flow to obtain new credentials.",
    );
    this.name = "RefreshTokenExpiredError";
  }
}

/**
 * Holds the in-memory cache of the OAuth token and serialises refresh
 * operations so two concurrent requests can never trigger two simultaneous
 * refresh calls (which would invalidate one of the resulting refresh tokens
 * since LinkedIn rotates them).
 */
export class TokenManager {
  private cached: StoredToken | null = null;
  private inflightRefresh: Promise<StoredToken> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly store: TokenStore,
  ) {}

  async init(): Promise<void> {
    this.cached = await this.store.read();
    if (this.cached) {
      logger.info(
        { expiresAt: new Date(this.cached.expiresAt).toISOString(), scope: this.cached.scope },
        "Token store loaded",
      );
    } else {
      logger.warn("No token in store yet — OAuth flow has not been completed");
    }
  }

  isConfigured(): boolean {
    return this.cached !== null;
  }

  getStatus(): {
    configured: boolean;
    expiresAt: string | null;
    refreshExpiresAt: string | null;
    lastRefreshedAt: string | null;
    scope: string | null;
  } {
    if (!this.cached) {
      return {
        configured: false,
        expiresAt: null,
        refreshExpiresAt: null,
        lastRefreshedAt: null,
        scope: null,
      };
    }
    return {
      configured: true,
      expiresAt: new Date(this.cached.expiresAt).toISOString(),
      refreshExpiresAt: new Date(this.cached.refreshExpiresAt).toISOString(),
      lastRefreshedAt: new Date(this.cached.lastRefreshedAt).toISOString(),
      scope: this.cached.scope,
    };
  }

  /** Persist a freshly-obtained token (called by the OAuth callback route). */
  async setToken(token: StoredToken): Promise<void> {
    await this.store.write(token);
    this.cached = token;
    logger.info({ scope: token.scope }, "Stored a new LinkedIn OAuth token");
  }

  /** Drop the stored token (used by /setup logout flow if added later). */
  async clearToken(): Promise<void> {
    await this.store.clear();
    this.cached = null;
    logger.info("Cleared LinkedIn OAuth token");
  }

  /**
   * Returns a usable access token, refreshing it transparently if it has
   * expired or will expire within REFRESH_LEEWAY_MS. Throws a typed error if
   * the OAuth flow has never been completed or if the refresh token itself
   * has expired (in which case the user must re-authenticate).
   */
  async getValidToken(): Promise<string> {
    if (!this.cached) throw new TokenNotConfiguredError();
    const now = Date.now();
    if (this.cached.expiresAt - now > REFRESH_LEEWAY_MS) {
      return this.cached.accessToken;
    }
    if (this.cached.refreshExpiresAt <= now) {
      throw new RefreshTokenExpiredError();
    }
    const refreshed = await this.refreshOnce();
    return refreshed.accessToken;
  }

  /**
   * Coalesces concurrent refresh requests into a single in-flight call. The
   * second-arrived caller awaits the same promise as the first one rather
   * than triggering a parallel refresh that would invalidate a token.
   */
  private async refreshOnce(): Promise<StoredToken> {
    if (this.inflightRefresh) return this.inflightRefresh;
    if (!this.cached) throw new TokenNotConfiguredError();
    const refreshToken = this.cached.refreshToken;
    this.inflightRefresh = (async () => {
      try {
        logger.info("Refreshing LinkedIn access token");
        const next = await refreshAccessToken(this.config, refreshToken);
        await this.store.write(next);
        this.cached = next;
        logger.info(
          { expiresAt: new Date(next.expiresAt).toISOString() },
          "LinkedIn access token refreshed",
        );
        return next;
      } catch (err) {
        logger.error({ err }, "Failed to refresh LinkedIn access token");
        throw err;
      } finally {
        this.inflightRefresh = null;
      }
    })();
    return this.inflightRefresh;
  }
}
