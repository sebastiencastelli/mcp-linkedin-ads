import { z } from "zod";

/**
 * Analytics query schema. Maps to /rest/adAnalytics with a curated set of
 * the most useful pivots and metrics. Note: LinkedIn does not paginate this
 * endpoint and caps responses at 15 000 rows — the tool must split a query
 * by date range if it would exceed that, or instruct Claude to narrow the
 * window.
 */

export const PivotEnum = z
  .enum([
    // Ad hierarchy
    "ACCOUNT",
    "CAMPAIGN_GROUP",
    "CAMPAIGN",
    "CREATIVE",
    "CONVERSION",
    // Advertiser-side
    "COMPANY",
    "SHARE",
    // Conversation / Message Ads
    "CONVERSATION_NODE",
    "CONVERSATION_NODE_OPTION_INDEX",
    // Placement & device
    "SERVING_LOCATION",
    "CARD_INDEX",
    "PLACEMENT_NAME",
    "IMPRESSION_DEVICE_TYPE",
    // Live events
    "EVENT_STAGE",
    // Audience demographics
    "MEMBER_COMPANY",
    "MEMBER_INDUSTRY",
    "MEMBER_SENIORITY",
    "MEMBER_JOB_TITLE",
    "MEMBER_JOB_FUNCTION",
    "MEMBER_COUNTRY_V2",
    "MEMBER_REGION_V2",
    "MEMBER_COMPANY_SIZE",
  ])
  .describe(
    "Dimension to group results by. ACCOUNT/CAMPAIGN_GROUP/CAMPAIGN/CREATIVE walk down the " +
      "ad hierarchy. MEMBER_* pivots break down audience demographics — useful for understanding " +
      "who your ads reached. CONVERSATION_NODE* pivots are only meaningful for Conversation/Message Ads. " +
      "EVENT_STAGE returns PRE_LIVE / LIVE / POST_LIVE breakdowns for live-event campaigns. " +
      "Note: OBJECTIVE_TYPE is intentionally excluded — it exists only on the statistics finder, " +
      "not on q=analytics, and will return a 400 error if used here.",
  );

export const TimeGranularityEnum = z
  .enum(["DAILY", "MONTHLY", "YEARLY", "ALL"])
  .describe(
    "Time bucketing of the results. ALL = single aggregated row per pivot value. " +
      "DAILY = one row per day per pivot value (can hit the 15k row cap quickly). " +
      "YEARLY = one row per calendar year per pivot value.",
  );

export const MetricEnum = z
  .enum([
    // Core delivery
    "impressions",
    "clicks",
    "costInLocalCurrency",
    "costInUsd",

    // Website conversions
    "externalWebsiteConversions",
    "externalWebsitePostClickConversions",
    "externalWebsitePostViewConversions",

    // Engagement
    "landingPageClicks",
    "likes",
    "shares",
    "comments",
    "follows",
    "reactions",
    "commentLikes",
    "otherEngagements",
    "totalEngagements",

    // Video
    "videoViews",
    "videoStarts",
    "videoCompletions",
    "videoFirstQuartileCompletions",
    "videoMidpointCompletions",
    "videoThirdQuartileCompletions",
    "videoWatchTime",
    "averageVideoWatchTime",
    "fullScreenPlays",

    // Reach
    "approximateMemberReach",
    "audiencePenetration",

    // Lead gen (mail / InMail)
    "leadGenerationMailContactInfoShares",
    "leadGenerationMailInterestedClicks",
    "oneClickLeadFormOpens",
    "oneClickLeads",

    // Conversions & lead scoring
    "conversionValueInLocalCurrency",
    "qualifiedLeads",
    "postClickQualifiedLeads",
    "postViewQualifiedLeads",
    "registrations",
    "postClickRegistrations",
    "postViewRegistrations",
    "jobApplications",
    "postClickJobApplications",
    "postViewJobApplications",
    "jobApplyClicks",
    "subscriptionClicks",
    "talentLeads",

    // Carousel
    "cardClicks",
    "cardImpressions",

    // Conversation / Message Ads
    "actionClicks",
    "opens",
    "sends",
    "textUrlClicks",
    "companyPageClicks",

    // Viral family
    "viralImpressions",
    "viralClicks",
    "viralReactions",
    "viralShares",
    "viralComments",
    "viralFollows",
    "viralLikes",
    "viralRegistrations",
    "viralTotalEngagements",
    "viralVideoStarts",
    "viralVideoViews",
    "viralVideoCompletions",
    "viralVideoFirstQuartileCompletions",
    "viralVideoMidpointCompletions",
    "viralVideoThirdQuartileCompletions",
    "viralSubscriptionClicks",
    "viralCardClicks",
    "viralCardImpressions",
    "viralPostViewRegistrations",
  ])
  .describe(
    "A reporting metric. Note: LinkedIn returns at most ~20 metrics per call — " +
      "request only what you need. costInLocalCurrency is in the account's currency, " +
      "costInUsd is converted. " +
      "Note LinkedIn cap response size at 15,000 rows per call. Narrow the dateRange or add filters if you hit that. " +
      "Certains metrics (ex: audiencePenetration, cardClicks) ne sont disponibles que sur certains pivots.",
  );

export const AnalyticsQuerySchema = z
  .object({
    pivot: PivotEnum,
    timeGranularity: TimeGranularityEnum,
    dateRange: z
      .object({
        start: z.object({
          year: z.number().int().min(2015).max(2100),
          month: z.number().int().min(1).max(12),
          day: z.number().int().min(1).max(31),
        }),
        end: z.object({
          year: z.number().int().min(2015).max(2100),
          month: z.number().int().min(1).max(12),
          day: z.number().int().min(1).max(31),
        }),
      })
      .describe(
        "Reporting window (inclusive). LinkedIn keeps performance data for ~10 years. " +
          "Demographic pivots are kept ~2 years.",
      ),
    fields: z
      .array(MetricEnum)
      .min(1)
      .max(20)
      .describe(
        "Metrics to fetch. LinkedIn defaults to only impressions+clicks if you do not " +
          "specify, so always pass an explicit list. Maximum 20 metrics per call.",
      ),
    campaigns: z
      .array(z.union([z.number().int(), z.string()]))
      .optional()
      .describe(
        "Optional filter: list of campaign IDs/URNs to scope the report. If omitted, " +
          "covers the whole account.",
      ),
    accounts: z
      .array(z.union([z.number().int(), z.string()]))
      .optional()
      .describe("Optional filter: scope to specific Ad Accounts (URNs)."),
    creatives: z
      .array(z.union([z.number().int(), z.string()]))
      .optional()
      .describe("Optional filter: scope to specific creative URNs."),
  })
  .describe(
    "Analytics query for LinkedIn /rest/adAnalytics. Pivot defines the row grouping, " +
      "fields define the columns, dateRange + timeGranularity define the time slicing, " +
      "and the optional campaign/account/creative arrays narrow the scope.",
  );
