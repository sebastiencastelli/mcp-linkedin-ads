import { describe, expect, it } from "vitest";
import {
  buildUrn,
  buildUrnList,
  encodeUrn,
  ensureUrn,
  isUrn,
  parseUrn,
  urnId,
} from "../../src/linkedin/urn.js";

describe("urn", () => {
  describe("buildUrn", () => {
    it("builds a sponsoredAccount URN", () => {
      expect(buildUrn("sponsoredAccount", 123456)).toBe("urn:li:sponsoredAccount:123456");
    });
    it("accepts a string id", () => {
      expect(buildUrn("organization", "abc")).toBe("urn:li:organization:abc");
    });
  });

  describe("parseUrn", () => {
    it("parses a valid URN", () => {
      expect(parseUrn("urn:li:sponsoredCampaign:42")).toEqual({
        namespace: "li",
        type: "sponsoredCampaign",
        id: "42",
      });
    });
    it("throws on a malformed value", () => {
      expect(() => parseUrn("not-a-urn")).toThrow(/Invalid URN/);
    });
  });

  describe("isUrn", () => {
    it("recognises valid URNs", () => {
      expect(isUrn("urn:li:sponsoredCampaign:42")).toBe(true);
    });
    it("rejects bare ids", () => {
      expect(isUrn("12345")).toBe(false);
    });
  });

  describe("encodeUrn", () => {
    it("URL-encodes the colons", () => {
      expect(encodeUrn("urn:li:sponsoredAccount:1")).toBe("urn%3Ali%3AsponsoredAccount%3A1");
    });
  });

  describe("buildUrnList", () => {
    it("wraps a list in Restli List() syntax with encoded items", () => {
      const out = buildUrnList(["urn:li:sponsoredCampaign:1", "urn:li:sponsoredCampaign:2"]);
      expect(out).toBe(
        "List(urn%3Ali%3AsponsoredCampaign%3A1,urn%3Ali%3AsponsoredCampaign%3A2)",
      );
    });
  });

  describe("ensureUrn", () => {
    it("converts a number id to a URN", () => {
      expect(ensureUrn("sponsoredAccount", 999)).toBe("urn:li:sponsoredAccount:999");
    });
    it("converts a numeric string id to a URN", () => {
      expect(ensureUrn("sponsoredAccount", "999")).toBe("urn:li:sponsoredAccount:999");
    });
    it("passes through a matching URN unchanged", () => {
      expect(ensureUrn("sponsoredCampaign", "urn:li:sponsoredCampaign:5")).toBe(
        "urn:li:sponsoredCampaign:5",
      );
    });
    it("rejects a URN of the wrong type", () => {
      expect(() => ensureUrn("sponsoredCampaign", "urn:li:sponsoredAccount:5")).toThrow(
        /Expected URN of type sponsoredCampaign/,
      );
    });
  });

  describe("urnId", () => {
    it("extracts the trailing id", () => {
      expect(urnId("urn:li:sponsoredCampaign:7777")).toBe("7777");
    });
  });
});
