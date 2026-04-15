import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../../src/utils/crypto.js";

const KEY = "0".repeat(64); // 32 bytes hex
const ALT_KEY = "f".repeat(64);

describe("crypto", () => {
  it("round-trips an arbitrary JSON object", () => {
    const original = { foo: "bar", n: 42, nested: { a: [1, 2, 3] } };
    const blob = encryptJson(original, KEY);
    const recovered = decryptJson(blob, KEY);
    expect(recovered).toEqual(original);
  });

  it("produces a different ciphertext for the same plaintext (random IV)", () => {
    const value = { secret: "abc" };
    const blob1 = encryptJson(value, KEY);
    const blob2 = encryptJson(value, KEY);
    expect(blob1).not.toEqual(blob2);
  });

  it("fails to decrypt with the wrong key", () => {
    const blob = encryptJson({ x: 1 }, KEY);
    expect(() => decryptJson(blob, ALT_KEY)).toThrow();
  });

  it("fails to decrypt a tampered blob", () => {
    const blob = encryptJson({ x: 1 }, KEY);
    const tampered =
      blob.slice(0, blob.length - 4) +
      (blob.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(() => decryptJson(tampered, KEY)).toThrow();
  });

  it("rejects an invalid encryption key", () => {
    expect(() => encryptJson({}, "tooshort")).toThrow(/64-char hex/);
  });
});
