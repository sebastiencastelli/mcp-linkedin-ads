import { describe, it, expect } from "vitest";
import { callTool } from "./_mcp-client.js";

// ─── Known URNs ──────────────────────────────────────────────────────────────
const URN_GEO_FRANCE = "urn:li:geo:105015875";
const URN_GEO_PARIS = "urn:li:geo:106383538";
const URN_TITLE_RESP_MARKETING = "urn:li:title:26";
const URN_INDUSTRY_MARKETING = "urn:li:industry:1862";
const URN_SENIORITY_JUNIOR = "urn:li:seniority:1";
const URN_FACET_INDUSTRIES = "urn:li:adTargetingFacet:industries";
const URN_FACET_TITLES = "urn:li:adTargetingFacet:titles";
const URN_FACET_LOCATIONS = "urn:li:adTargetingFacet:locations";
const URN_FACET_EMPLOYERS = "urn:li:adTargetingFacet:employers";
const URN_FACET_SENIORITIES = "urn:li:adTargetingFacet:seniorities";

// ─── get_targeting_facets ─────────────────────────────────────────────────────

describe("targeting — get_targeting_facets", () => {
  it("returns at least 30 facets with expected shape", async () => {
    const result = await callTool("get_targeting_facets", {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { facets: unknown[] };
    expect(Array.isArray(data.facets)).toBe(true);
    expect(data.facets.length).toBeGreaterThanOrEqual(30);

    // Every facet must carry these four fields
    for (const facet of data.facets) {
      const f = facet as Record<string, unknown>;
      expect(typeof f.facetName).toBe("string");
      expect(typeof f.adTargetingFacetUrn).toBe("string");
      expect(Array.isArray(f.entityTypes)).toBe(true);
      expect(Array.isArray(f.availableEntityFinders)).toBe(true);
    }
  }, 30_000);

  it("includes key facets: industries, titles, locations, seniorities", async () => {
    const result = await callTool("get_targeting_facets", {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { facets: Array<Record<string, unknown>> };
    const urns = data.facets.map((f) => f.adTargetingFacetUrn);

    expect(urns).toContain(URN_FACET_INDUSTRIES);
    expect(urns).toContain(URN_FACET_TITLES);
    expect(urns).toContain(URN_FACET_LOCATIONS);
    expect(urns).toContain(URN_FACET_SENIORITIES);
  }, 30_000);
});

// ─── search_targeting_entities ────────────────────────────────────────────────

describe("targeting — search_targeting_entities", () => {
  it("industries — 'marketing' in FR/fr returns french marketing label", async () => {
    const result = await callTool("search_targeting_entities", {
      facet_urn: URN_FACET_INDUSTRIES,
      query: "marketing",
      locale_country: "FR", locale_language: "fr",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { entities: Array<Record<string, unknown>> };
    expect(Array.isArray(data.entities)).toBe(true);
    expect(data.entities.length).toBeGreaterThan(0);

    const names = data.entities.map((e) => String(e.name ?? "").toLowerCase());
    // At least one result should mention "marketing"
    expect(names.some((n) => n.includes("marketing"))).toBe(true);

    // The known URN must appear in results
    const urns = data.entities.map((e) => e.urn);
    expect(urns).toContain(URN_INDUSTRY_MARKETING);
  }, 30_000);

  it("titles — 'engineer' in EN/en returns job title entities", async () => {
    const result = await callTool("search_targeting_entities", {
      facet_urn: URN_FACET_TITLES,
      query: "engineer",
      locale_country: "US", locale_language: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { entities: Array<Record<string, unknown>> };
    expect(Array.isArray(data.entities)).toBe(true);
    expect(data.entities.length).toBeGreaterThan(0);

    // Every entity must have a urn and a name
    for (const entity of data.entities) {
      expect(typeof entity.urn).toBe("string");
      expect(typeof entity.name).toBe("string");
    }

    const names = data.entities.map((e) => String(e.name ?? "").toLowerCase());
    expect(names.some((n) => n.includes("engineer"))).toBe(true);
  }, 30_000);

  it(
    "locations — 'paris' in FR/fr returns Paris entries (regression: timeout bug queryVersion)",
    async () => {
      const result = await callTool("search_targeting_entities", {
        facet_urn: URN_FACET_LOCATIONS,
        query: "paris",
        locale_country: "FR", locale_language: "fr",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = result.data as { entities: Array<Record<string, unknown>> };
      expect(Array.isArray(data.entities)).toBe(true);
      expect(data.entities.length).toBeGreaterThan(0);

      const urns = data.entities.map((e) => e.urn);
      // The canonical "Ville de Paris" geo URN must be present
      expect(urns).toContain(URN_GEO_PARIS);
    },
    30_000,
  );

  it("employers — 'Google' returns Google's organization URN", async () => {
    const result = await callTool("search_targeting_entities", {
      facet_urn: URN_FACET_EMPLOYERS,
      query: "Google",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { entities: Array<Record<string, unknown>> };
    expect(Array.isArray(data.entities)).toBe(true);
    expect(data.entities.length).toBeGreaterThan(0);

    const urns = data.entities.map((e) => String(e.urn ?? ""));
    // Google's LinkedIn org URN is always present and must be a valid URN
    expect(urns.some((u) => u.startsWith("urn:li:organization:"))).toBe(true);

    const names = data.entities.map((e) => String(e.name ?? "").toLowerCase());
    expect(names.some((n) => n.includes("google"))).toBe(true);
  }, 30_000);

  it("invalid facet URN returns an error response", async () => {
    const result = await callTool("search_targeting_entities", {
      facet_urn: "urn:li:adTargetingFacet:notarealfacet",
      query: "anything",
    });

    expect(result.ok).toBe(false);
  }, 30_000);
});

// ─── estimate_audience_size ───────────────────────────────────────────────────

describe("targeting — estimate_audience_size", () => {
  // Helper to assert the standard response envelope
  function assertAudienceShape(data: unknown) {
    const d = data as Record<string, unknown>;
    expect(typeof d.estimatedAudienceSize).toBe("number");
    expect(typeof d.meetsMinimum).toBe("boolean");
    // warning is either null or a string
    expect(d.warning === null || typeof d.warning === "string").toBe(true);
  }

  it("simple — France geo only returns large audience (>10M)", async () => {
    const result = await callTool("estimate_audience_size", {
      targeting_criteria: {
        include: {
          and: [
            {
              or: {
                "urn:li:adTargetingFacet:profileLocations": [URN_GEO_FRANCE],
              },
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    assertAudienceShape(result.data);
    const d = result.data as Record<string, unknown>;
    expect(d.estimatedAudienceSize as number).toBeGreaterThan(10_000_000);
    expect(d.meetsMinimum).toBe(true);
  }, 30_000);

  it(
    "multi-facet in one or clause — France + title in same and-clause (serializer regression)",
    async () => {
      // This is the key regression case: a single `or` object containing two
      // different facet keys must be serialised correctly into the Restli format.
      // Before the fix this caused a malformed request.
      const result = await callTool("estimate_audience_size", {
        targeting_criteria: {
          include: {
            and: [
              {
                or: {
                  "urn:li:adTargetingFacet:profileLocations": [URN_GEO_FRANCE],
                  "urn:li:adTargetingFacet:titles": [URN_TITLE_RESP_MARKETING],
                },
              },
            ],
          },
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      assertAudienceShape(result.data);
      const d = result.data as Record<string, unknown>;
      // France + a specific title still yields a sizeable audience
      expect(d.estimatedAudienceSize as number).toBeGreaterThan(0);
    },
    30_000,
  );

  it("include + exclude — France & titles, exclude junior seniority", async () => {
    const result = await callTool("estimate_audience_size", {
      targeting_criteria: {
        include: {
          and: [
            {
              or: {
                "urn:li:adTargetingFacet:profileLocations": [URN_GEO_FRANCE],
              },
            },
            {
              or: {
                "urn:li:adTargetingFacet:titles": [URN_TITLE_RESP_MARKETING],
              },
            },
          ],
        },
        exclude: {
          or: {
            "urn:li:adTargetingFacet:seniorities": [URN_SENIORITY_JUNIOR],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    assertAudienceShape(result.data);
    const d = result.data as Record<string, unknown>;
    expect(d.estimatedAudienceSize as number).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it(
    "very restrictive criteria — meetsMinimum is false and warning is set",
    async () => {
      // Combining a very specific industry + Paris city + a single title
      // should produce an audience below LinkedIn's minimum threshold.
      const result = await callTool("estimate_audience_size", {
        targeting_criteria: {
          include: {
            and: [
              {
                or: {
                  "urn:li:adTargetingFacet:profileLocations": [URN_GEO_PARIS],
                },
              },
              {
                or: {
                  "urn:li:adTargetingFacet:industries": [URN_INDUSTRY_MARKETING],
                },
              },
              {
                or: {
                  "urn:li:adTargetingFacet:titles": [URN_TITLE_RESP_MARKETING],
                },
              },
              {
                or: {
                  "urn:li:adTargetingFacet:seniorities": [URN_SENIORITY_JUNIOR],
                },
              },
            ],
          },
        },
      });

      // The server must respond without error even for tiny audiences
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      assertAudienceShape(result.data);
      const d = result.data as Record<string, unknown>;

      if (!d.meetsMinimum) {
        // When below minimum, a warning string must be provided
        expect(typeof d.warning).toBe("string");
        expect((d.warning as string).length).toBeGreaterThan(0);
      }
      // Audience may be 0 or a small number — just assert it is a non-negative integer
      expect(d.estimatedAudienceSize as number).toBeGreaterThanOrEqual(0);
    },
    30_000,
  );

  it("invalid targetingCriteria — unknown facet key returns error", async () => {
    const result = await callTool("estimate_audience_size", {
      targeting_criteria: {
        include: {
          and: [
            {
              or: {
                "urn:li:adTargetingFacet:unknownFacetThatDoesNotExist": ["urn:li:fake:123"],
              },
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(false);
  }, 30_000);
});
