import { describe, expect, it } from "vitest";
import {
  serializeOrMap,
  serializeTargetingCriteria,
} from "../../src/tools/targeting.js";

// Helpers to keep assertions readable
const enc = encodeURIComponent;

describe("serializeOrMap", () => {
  it("serializes a single facet entry as flat key:value — no wrapping parens", () => {
    const result = serializeOrMap({
      "urn:li:adTargetingFacet:industries": ["urn:li:industry:1862"],
    });
    expect(result).toBe(
      `${enc("urn:li:adTargetingFacet:industries")}:List(${enc("urn:li:industry:1862")})`,
    );
  });

  it("joins multiple facets with commas — no individual parens", () => {
    const result = serializeOrMap({
      "urn:li:adTargetingFacet:titles": ["urn:li:title:26"],
      "urn:li:adTargetingFacet:industries": ["urn:li:industry:1862"],
    });
    const titlePart = `${enc("urn:li:adTargetingFacet:titles")}:List(${enc("urn:li:title:26")})`;
    const industryPart = `${enc("urn:li:adTargetingFacet:industries")}:List(${enc("urn:li:industry:1862")})`;
    expect(result).toBe(`${titlePart},${industryPart}`);
    // Must NOT contain individual wrapping parens like "(urn%3A...:List(...))"
    expect(result).not.toMatch(/\([^)]*:List\(/);
  });
});

describe("serializeTargetingCriteria", () => {
  it("simple include — 1 facet, 1 URN", () => {
    const result = serializeTargetingCriteria({
      include: {
        and: [
          {
            or: {
              "urn:li:adTargetingFacet:locations": [
                "urn:li:geo:103644278",
              ],
            },
          },
        ],
      },
    });
    const expected =
      `(include:(and:List((or:(` +
      `${enc("urn:li:adTargetingFacet:locations")}:List(${enc("urn:li:geo:103644278")})` +
      `)))))`;
    expect(result).toBe(expected);
  });

  it("include with multi-facet or — produces ONE (or:(...)) not two separate clauses", () => {
    const result = serializeTargetingCriteria({
      include: {
        and: [
          {
            or: {
              "urn:li:adTargetingFacet:titles": ["urn:li:title:26"],
              "urn:li:adTargetingFacet:industries": ["urn:li:industry:1862"],
            },
          },
        ],
      },
    });
    // Must be exactly one (or:(...)) wrapping both facets
    const orCount = (result.match(/\(or:/g) ?? []).length;
    expect(orCount).toBe(1);
    // Both facets must appear inside that single or
    expect(result).toContain(enc("urn:li:adTargetingFacet:titles"));
    expect(result).toContain(enc("urn:li:adTargetingFacet:industries"));
    // Exact expected string
    const titlePart = `${enc("urn:li:adTargetingFacet:titles")}:List(${enc("urn:li:title:26")})`;
    const industryPart = `${enc("urn:li:adTargetingFacet:industries")}:List(${enc("urn:li:industry:1862")})`;
    expect(result).toBe(`(include:(and:List((or:(${titlePart},${industryPart})))))`);
  });

  it("exclude with multiple facets — no extra parens around each entry", () => {
    const result = serializeTargetingCriteria({
      exclude: {
        or: {
          "urn:li:adTargetingFacet:seniorities": ["urn:li:seniority:1"],
          "urn:li:adTargetingFacet:staffCountRanges": ["urn:li:staffCountRange:A"],
        },
      },
    });
    const senPart = `${enc("urn:li:adTargetingFacet:seniorities")}:List(${enc("urn:li:seniority:1")})`;
    const staffPart = `${enc("urn:li:adTargetingFacet:staffCountRanges")}:List(${enc("urn:li:staffCountRange:A")})`;
    expect(result).toBe(`(exclude:(or:(${senPart},${staffPart})))`);
    // Regression guard: old code produced (facet:List(...)) — parens before facet key
    expect(result).not.toMatch(/\(or:\(\(/);
  });

  it("include + exclude combined — both sections present, correctly structured", () => {
    const result = serializeTargetingCriteria({
      include: {
        and: [
          {
            or: {
              "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278"],
            },
          },
        ],
      },
      exclude: {
        or: {
          "urn:li:adTargetingFacet:seniorities": ["urn:li:seniority:1"],
        },
      },
    });
    const locPart = `${enc("urn:li:adTargetingFacet:locations")}:List(${enc("urn:li:geo:103644278")})`;
    const senPart = `${enc("urn:li:adTargetingFacet:seniorities")}:List(${enc("urn:li:seniority:1")})`;
    expect(result).toBe(
      `(include:(and:List((or:(${locPart})))),exclude:(or:(${senPart})))`,
    );
  });
});
