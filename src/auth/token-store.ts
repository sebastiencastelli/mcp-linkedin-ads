import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { decryptJson, encryptJson } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

/**
 * Persisted OAuth token shape. Refresh token is rotated by LinkedIn at every
 * refresh — we MUST always rewrite both fields, never the access token alone.
 */
export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch milliseconds when the access token expires. */
  expiresAt: number;
  /** Unix epoch milliseconds when the refresh token expires (≈ now + 365d). */
  refreshExpiresAt: number;
  /** Space-separated scopes returned by LinkedIn. */
  scope: string;
  /** Unix epoch milliseconds of the last successful refresh (or initial issuance). */
  lastRefreshedAt: number;
}

/**
 * Atomic, encrypted token storage. Uses tmp-file + rename so a crash during
 * write never leaves a corrupted token file. Single-process safe; concurrent
 * writes from the same process are serialised in token-manager.ts.
 */
export class TokenStore {
  private readonly filePath: string;

  constructor(
    private readonly dataDir: string,
    private readonly encryptionKey: string,
  ) {
    this.filePath = join(dataDir, "token.json");
  }

  async exists(): Promise<boolean> {
    return existsSync(this.filePath);
  }

  async read(): Promise<StoredToken | null> {
    if (!(await this.exists())) return null;
    try {
      const blob = await readFile(this.filePath, "utf8");
      return decryptJson<StoredToken>(blob.trim(), this.encryptionKey);
    } catch (err) {
      logger.error({ err }, "Failed to read or decrypt token store");
      throw new Error(
        "Token store exists but cannot be decrypted. The ENCRYPTION_KEY may have changed. " +
          "Delete the token file and re-authenticate via the wizard.",
      );
    }
  }

  async write(token: StoredToken): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const blob = encryptJson(token, this.encryptionKey);
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, blob, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  async clear(): Promise<void> {
    if (!(await this.exists())) return;
    const { unlink } = await import("node:fs/promises");
    await unlink(this.filePath);
  }
}
