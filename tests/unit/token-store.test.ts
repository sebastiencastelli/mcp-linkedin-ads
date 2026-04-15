import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenStore, type StoredToken } from "../../src/auth/token-store.js";

const KEY = "a".repeat(64);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sampleToken = (): StoredToken => ({
  accessToken: "AT-123",
  refreshToken: "RT-456",
  expiresAt: Date.now() + 60_000,
  refreshExpiresAt: Date.now() + 365 * 86_400_000,
  scope: "r_ads rw_ads r_ads_reporting",
  lastRefreshedAt: Date.now(),
});

describe("TokenStore", () => {
  it("returns null when no token file exists", async () => {
    const store = new TokenStore(dir, KEY);
    expect(await store.exists()).toBe(false);
    expect(await store.read()).toBeNull();
  });

  it("writes and reads back a token", async () => {
    const store = new TokenStore(dir, KEY);
    const token = sampleToken();
    await store.write(token);
    expect(await store.exists()).toBe(true);
    expect(await store.read()).toEqual(token);
  });

  it("clears the stored token", async () => {
    const store = new TokenStore(dir, KEY);
    await store.write(sampleToken());
    await store.clear();
    expect(await store.exists()).toBe(false);
  });

  it("throws a helpful error when the encryption key changes", async () => {
    const store = new TokenStore(dir, KEY);
    await store.write(sampleToken());
    const wrongStore = new TokenStore(dir, "b".repeat(64));
    await expect(wrongStore.read()).rejects.toThrow(/cannot be decrypted/);
  });
});
