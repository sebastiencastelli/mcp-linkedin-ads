import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { TargetingCriteriaSchema } from "../schemas/campaign.js";
import { truncate } from "../utils/pagination.js";
import { callLinkedIn, jsonResult } from "./_helpers.js";

interface AdTargetingFacet {
  adTargetingFacetUrn: string;
  facetName: string;
  availableEntityFinders?: string[];
  entityTypes?: string[];
}

interface AdTargetingEntity {
  urn: string;
  name: string;
  facetUrn: string;
}

interface AudienceCountsResponse {
  elements: Array<{ active?: number; total: number }>;
}

/**
 * Serialize a single `or` map (Record<facetUrn, entityUrns[]>) into the
 * Restli map syntax: `facet1:List(v1,v2),facet2:List(v3)`.
 * No wrapping parens around individual entries — this is a flat key:value map.
 *
 * Exported for unit testing.
 */
export function serializeOrMap(orMap: Record<string, string[]>): string {
  return Object.entries(orMap)
    .map(([facetUrn, entityUrns]) => {
      const encodedFacet = encodeURIComponent(facetUrn);
      const encodedValues = entityUrns.map((u) => encodeURIComponent(u)).join(",");
      return `${encodedFacet}:List(${encodedValues})`;
    })
    .join(",");
}

/**
 * Serialize a TargetingCriteria object into the Restli-encoded query string
 * expected by GET /audienceCounts?q=targetingCriteriaV2.
 *
 * Grammar:
 *   include:(and:List((or:(facet1:List(v1,v2),(facet2:List(v3))))))
 *   exclude:(or:(facet1:List(v1),facet2:List(v2)))
 *
 * Source: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/audience-counts
 *
 * Exported for unit testing.
 */
export function serializeTargetingCriteria(criteria: unknown): string {
  const tc = criteria as {
    include?: { and?: Array<{ or: Record<string, string[]> }> };
    exclude?: { or?: Record<string, string[]> };
  };

  const parts: string[] = [];

  if (tc.include?.and?.length) {
    // Each element of the `and` array is an `or` clause that may contain
    // multiple facets. All facets within one clause belong to ONE `(or:(...))`.
    const andClauses = tc.include.and
      .map((clause) => `(or:(${serializeOrMap(clause.or)}))`)
      .join(",");
    parts.push(`include:(and:List(${andClauses}))`);
  }

  if (tc.exclude?.or) {
    // `exclude.or` is a map — entries are key:value pairs, no individual wrapping.
    parts.push(`exclude:(or:(${serializeOrMap(tc.exclude.or)}))`);
  }

  return `(${parts.join(",")})`;
}

export function registerTargetingTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "get_targeting_facets",
    {
      title: "Get Targeting Facets",
      description:
        "List all targeting facets available on LinkedIn (industries, seniorities, job titles, " +
        "locations, etc.). Each facet has a URN that you'll use as the key in a targeting tree. " +
        "Call this once at the start of building a campaign target.",
      inputSchema: {},
    },
    // /adTargetingFacets accepts no query parameters — locale is not supported.
    // Source: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/ads-targeting
    async () => {
      const data = await callLinkedIn<{ elements: AdTargetingFacet[] }>(
        client,
        `/adTargetingFacets`,
        { timeout: 5000 },
      );
      return jsonResult({ facets: data.elements });
    },
  );

  server.registerTool(
    "search_targeting_entities",
    {
      title: "Search Targeting Entities",
      description:
        "Search the entities of a single facet by keyword (e.g. find the URN of the " +
        '"Marketing and Advertising" industry, or job titles matching "head of marketing"). ' +
        "Use the facetUrn from get_targeting_facets.",
      inputSchema: {
        facet_urn: z
          .string()
          .describe('Facet URN, e.g. "urn:li:adTargetingFacet:industries".'),
        query: z.string().min(1).describe("Free-text search query."),
        locale_country: z.string().length(2).default("US"),
        locale_language: z.string().length(2).default("en"),
        limit: z.number().int().min(1).max(50).default(25),
      },
    },
    // Bug fix: use q=typeahead (not URLSearchParams — it encodes colons/parens in locale).
    // locale must be raw Restli syntax: (language:en,country:US).
    // Source: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/ads-targeting
    async ({ facet_urn, query, locale_country, locale_language, limit }) => {
      // Build query string manually — Restli locale value must NOT be percent-encoded.
      // queryVersion=QUERY_USES_URNS is mandatory per LinkedIn 2026-04 docs; without it,
      // geo facets (locations, profileLocations) return legacy URNs or cause timeouts.
      const qs = [
        `q=typeahead`,
        `query=${encodeURIComponent(query)}`,
        `facet=${encodeURIComponent(facet_urn)}`,
        `locale=(language:${locale_language},country:${locale_country})`,
        `queryVersion=QUERY_USES_URNS`,
        `count=${limit}`,
      ].join("&");
      const data = await callLinkedIn<{ elements: AdTargetingEntity[] }>(
        client,
        `/adTargetingEntities?${qs}`,
        { timeout: 5000 },
      );
      const trunc = truncate(data.elements, limit);
      return jsonResult({ ...trunc, entities: trunc.elements });
    },
  );

  server.registerTool(
    "estimate_audience_size",
    {
      title: "Estimate Audience Size",
      description:
        "Preview the reach of a targeting tree before launching a campaign. LinkedIn requires " +
        "a minimum of 300 members for a campaign to serve, so this is the safety check you " +
        "should run before create_campaign.",
      inputSchema: {
        targeting_criteria: TargetingCriteriaSchema,
      },
    },
    // Bug fix: endpoint is GET /audienceCounts?q=targetingCriteriaV2 (not POST /audienceCounts).
    // targetingCriteria is a Restli-serialized query param, not a JSON body.
    // Response shape is elements[0].total (not top-level .total).
    // Source: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/audience-counts
    async ({ targeting_criteria }) => {
      const serialized = serializeTargetingCriteria(targeting_criteria);
      const qs = `q=targetingCriteriaV2&targetingCriteria=${serialized}`;
      const data = await callLinkedIn<AudienceCountsResponse>(
        client,
        `/audienceCounts?${qs}`,
        { method: "GET", timeout: 5000 },
      );
      const total = data.elements?.[0]?.total ?? 0;
      return jsonResult({
        estimatedAudienceSize: total,
        meetsMinimum: total >= 300,
        warning: total < 300 ? "Below LinkedIn's 300-member minimum — campaign cannot serve." : null,
      });
    },
  );
}
