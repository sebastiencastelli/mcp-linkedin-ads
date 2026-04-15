import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM symmetric encryption for the OAuth token blob.
 *
 * Stored format (single base64 string):
 *   base64( iv (12 bytes) || authTag (16 bytes) || ciphertext )
 *
 * The encryption key MUST be 32 bytes (256 bits), provided as a 64-char hex
 * string in ENCRYPTION_KEY. We use a fresh random IV per encryption call so
 * the same plaintext never produces the same ciphertext.
 */

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes).");
  }
  return Buffer.from(hexKey, "hex");
}

export function encryptJson(value: unknown, hexKey: string): string {
  const key = deriveKey(hexKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptJson<T = unknown>(blob: string, hexKey: string): T {
  const key = deriveKey(hexKey);
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Encrypted blob is too short or corrupted.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
