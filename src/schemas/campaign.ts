import { z } from "zod";
import { DateRangeSchema, MoneySchema, StatusEnum } from "./common.js";

/**
 * Campaign-related schemas for LinkedIn Sponsored Content. Mirrors the
 * adCampaigns endpoint shape with descriptions tuned for Claude to pick the
 * right values without guessing.
 */

export const ObjectiveTypeEnum = z
  .enum([
    "BRAND_AWARENESS",
    "WEBSITE_VISIT",
    "ENGAGEMENT",
    "VIDEO_VIEW",
    "LEAD_GENERATION",
    "WEBSITE_CONVERSION",
    "JOB_APPLICANT",
    "TALENT_LEADS",
  ])
  .describe(
    "High-level marketing goal of the campaign. Drives which optimization targets and " +
      "creative formats are valid. Note: LinkedIn's public doc shows plural forms " +
      "(WEBSITE_VISITS, etc.) but the live API accepts the SINGULAR forms used here " +
      "(WEBSITE_VISIT, VIDEO_VIEW, etc.) — confirmed empirically on a real account.",
  );

export const CampaignTypeEnum = z
  .enum([
    "TEXT_AD",
    "SPONSORED_UPDATES",
    "SPONSORED_INMAILS",
    "DYNAMIC",
    "EVENT_AD",
  ])
  .describe(
    "Underlying ad format. SPONSORED_UPDATES is the most common (image/video/carousel ads in feed). " +
      "TEXT_AD is right-rail text ads. SPONSORED_INMAILS is Message Ads. DYNAMIC is dynamic creatives. " +
      "EVENT_AD promotes LinkedIn Events (added v202501).",
  );

export const CostTypeEnum = z
  .enum(["CPC", "CPM", "CPV"])
  .describe(
    "Pricing model. CPC = cost per click, CPM = cost per 1000 impressions, " +
      "CPV = cost per video view. Must match objectiveType (e.g. VIDEO_VIEW requires CPV).",
  );

export const OptimizationTargetTypeEnum = z
  .enum([
    "MAX_CLICK",
    "MAX_IMPRESSION",
    "MAX_CONVERSION",
    "MAX_LEAD",
    "MAX_VIDEO_VIEW",
    "MAX_QUALIFIED_LEAD",
    "MAX_REACH",
    "TARGET_COST_PER_CLICK",
    "TARGET_COST_PER_IMPRESSION",
    "TARGET_COST_PER_VIDEO_VIEW",
    "CAP_COST_AND_MAXIMIZE_CLICKS",
    "CAP_COST_AND_MAXIMIZE_IMPRESSIONS",
    "CAP_COST_AND_MAXIMIZE_VIDEO_VIEWS",
    "CAP_COST_AND_MAXIMIZE_LEADS",
    "ENHANCED_CONVERSION",
    "NONE",
  ])
  .describe(
    "How LinkedIn's auto-bidder should optimise delivery. NONE = manual bidding only. " +
      "MAX_* = maximise the metric without a cost cap. TARGET_COST_PER_* = hit a target CPA/CPM/CPV. " +
      "CAP_COST_AND_MAXIMIZE_* = stay within a cost cap while maximising volume.",
  );

/**
 * Targeting criteria. LinkedIn uses a recursive include/exclude tree with
 * AND/OR boolean operators. Each leaf points to a facet URN (e.g.
 * urn:li:adTargetingFacet:industries) holding a list of entity URNs.
 *
 * Example shape:
 *   {
 *     include: { and: [
 *       { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278"] } },
 *       { or: { "urn:li:adTargetingFacet:industries": ["urn:li:industry:96"] } }
 *     ]},
 *     exclude: { or: { "urn:li:adTargetingFacet:seniorities": ["urn:li:seniority:1"] }}
 *   }
 */
export const TargetingCriteriaSchema: z.ZodType<unknown> = z
  .object({
    include: z
      .object({
        and: z
          .array(
            z
              .object({
                or: z
                  .record(z.string(), z.array(z.string()))
                  .describe("Map facet URN → array of entity URNs combined with OR."),
              })
              .describe("Each AND clause is itself an OR-combination of values from one facet."),
          )
          .describe("Outer AND list of inner OR clauses."),
      })
      .optional(),
    exclude: z
      .object({
        or: z
          .record(z.string(), z.array(z.string()))
          .describe("Facet URN → entity URNs to exclude (OR-combined)."),
      })
      .optional(),
  })
  .describe(
    "Targeting tree. Build by first calling get_targeting_facets to discover available facets, " +
      "then search_targeting_entities to find entity URNs (e.g. industries, geos, seniorities), " +
      "then assemble the include/exclude tree. estimate_audience_size lets you preview reach before launch.",
  );

export const RunScheduleSchema = z
  .object({
    start: z
      .number()
      .int()
      .describe("Unix epoch milliseconds when the campaign should start serving."),
    end: z
      .number()
      .int()
      .optional()
      .describe(
        "Unix epoch milliseconds when the campaign should stop. Omit for an open-ended schedule.",
      ),
  })
  .describe("Campaign run schedule, expressed in milliseconds since epoch.");

export const CampaignCreateSchema = z
  .object({
    name: z.string().min(1).max(255).describe("Human-readable campaign name."),
    campaignGroupId: z
      .union([z.number().int().positive(), z.string()])
      .describe(
        "ID or URN of the parent campaign group. Create one first with create_campaign_group if needed.",
      ),
    type: CampaignTypeEnum,
    objectiveType: ObjectiveTypeEnum,
    costType: CostTypeEnum,
    unitCost: MoneySchema.describe(
      "Bid amount required by LinkedIn for all campaigns. When optimizationTargetType = NONE " +
        "this is the manual CPC/CPM/CPV bid; with auto-bidding strategies it acts as a cost cap.",
    ),
    dailyBudget: MoneySchema.optional().describe("Daily budget cap. Either this or totalBudget."),
    totalBudget: MoneySchema.optional().describe(
      "Lifetime budget cap. Either this or dailyBudget.",
    ),
    runSchedule: RunScheduleSchema,
    targetingCriteria: TargetingCriteriaSchema,
    optimizationTargetType: OptimizationTargetTypeEnum.default("NONE"),
    locale: z
      .object({
        country: z.string().length(2),
        language: z.string().length(2),
      })
      .describe('Required campaign locale, e.g. { country: "FR", language: "fr" }.'),
    status: StatusEnum.default("DRAFT").describe(
      "Initial status. Use DRAFT to create without serving, ACTIVE to launch immediately.",
    ),
    offsiteDeliveryEnabled: z
      .boolean()
      .default(false)
      .describe(
        "Whether to extend delivery to LinkedIn Audience Network (off-LinkedIn partner sites). " +
          "Defaults to false (LinkedIn feed only).",
      ),
    politicalIntent: z
      .enum(["NOT_DECLARED", "POLITICAL", "NOT_POLITICAL"])
      .default("NOT_DECLARED")
      .describe(
        "Required by LinkedIn for compliance (EU DSA / US political advertising rules). " +
          "NOT_DECLARED is the default used by Campaign Manager for standard commercial campaigns. " +
          "Use POLITICAL for political/issue advocacy ads.",
      ),
  })
  .describe(
    "All fields needed to create a Sponsored Content campaign in one call. The tool handles " +
      "wrapping into the LinkedIn JSON shape (urn:li:sponsoredCampaignGroup:..., etc.).",
  );

export const CampaignUpdateSchema = CampaignCreateSchema.partial()
  .extend({
    status: StatusEnum.optional(),
  })
  .describe(
    "Partial update payload — only include the fields you want to change. " +
      "LinkedIn applies a Restli PARTIAL_UPDATE patch.",
  );
