import { z } from "zod";

/**
 * Common LinkedIn Marketing API building blocks. Every tool reuses these
 * rather than redefining ad-hoc types — keeps validation messages and Claude
 * documentation consistent.
 */

export const StatusEnum = z
  .enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED", "CANCELED", "COMPLETED", "PENDING_DELETION"])
  .describe(
    "Lifecycle state of an ad entity. ACTIVE = serving impressions, PAUSED = stopped but can resume, ARCHIVED = soft-deleted (no longer in default lists), CANCELED = stopped permanently before launch.",
  );
export type Status = z.infer<typeof StatusEnum>;

/**
 * Campaign-group-specific status enum. LinkedIn's campaign groups API
 * documents CANCELLED (double-L) as a distinct terminal state, unlike the
 * single-L CANCELED used on campaigns and creatives. Both variants are
 * included here so that values returned by the API round-trip correctly.
 */
export const CampaignGroupStatusEnum = z
  .enum([
    "DRAFT",
    "ACTIVE",
    "PAUSED",
    "ARCHIVED",
    "CANCELED",
    "CANCELLED",
    "COMPLETED",
    "PENDING_DELETION",
  ])
  .describe(
    "Lifecycle state of a campaign group. Identical to StatusEnum but adds CANCELLED " +
      "(double-L) which appears in the LinkedIn campaign groups API documentation.",
  );
export type CampaignGroupStatus = z.infer<typeof CampaignGroupStatusEnum>;

export const AccountIdSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    "LinkedIn Ad Account identifier. Accepts either a bare numeric ID (e.g. 123456789) " +
      'or a full URN (e.g. "urn:li:sponsoredAccount:123456789"). Get the list with the ' +
      "list_ad_accounts tool.",
  );

export const CampaignIdSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    'Campaign identifier — either bare numeric ID or full URN ("urn:li:sponsoredCampaign:..."). ' +
      "List campaigns first with list_campaigns to discover the right ID.",
  );

export const CampaignGroupIdSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    'Campaign group identifier — either bare numeric ID or full URN ("urn:li:sponsoredCampaignGroup:..."). ' +
      "Campaign groups are containers that hold one or more campaigns and share a total budget.",
  );

export const CreativeIdSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    'Creative identifier — either bare numeric ID or full URN ("urn:li:sponsoredCreative:...").',
  );

export const DateRangeSchema = z
  .object({
    start: z
      .object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      })
      .describe("Inclusive start date."),
    end: z
      .object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      })
      .optional()
      .describe(
        "Inclusive end date. Omit for an open-ended range (e.g. campaign with no end date).",
      ),
  })
  .describe(
    "LinkedIn date range with year/month/day components (NOT ISO strings). " +
      "Used for campaign run schedules and analytics queries.",
  );
export type DateRange = z.infer<typeof DateRangeSchema>;

export const MoneySchema = z
  .object({
    currencyCode: z
      .string()
      .length(3)
      .describe('ISO 4217 currency code, e.g. "USD", "EUR", "GBP".'),
    amount: z
      .string()
      .describe(
        "Amount as a decimal STRING (LinkedIn returns money as strings to avoid float precision issues). " +
          'Example: "150.00" — NOT 150 cents.',
      ),
  })
  .describe("LinkedIn money type. Currency code + decimal amount as string.");
export type Money = z.infer<typeof MoneySchema>;

export const LocaleSchema = z
  .object({
    country: z.string().length(2).describe('ISO 3166-1 alpha-2 country code, e.g. "US", "FR".'),
    language: z.string().length(2).describe('ISO 639-1 language code, e.g. "en", "fr".'),
  })
  .describe('LinkedIn locale tuple. Example: { country: "FR", language: "fr" }.');

/**
 * Legacy index-based pagination — kept for endpoints that have NOT yet
 * migrated to cursor-based pagination (e.g. the creatives `q=criteria` finder).
 * Do NOT use for `q=search` endpoints (use CursorPaginationSchema instead).
 */
export const PaginationSchema = z
  .object({
    start: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Zero-based offset of the first item to return."),
    count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Number of items per page (max 100 for most LinkedIn endpoints)."),
  })
  .describe("Legacy LinkedIn start/count pagination (for non-search endpoints).");
export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * Cursor-based pagination for all `q=search` finders on LinkedIn API v202401+.
 * Index-based start/count is no longer accepted on these endpoints.
 */
export const CursorPaginationSchema = z
  .object({
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Number of items per page (1–100). Defaults to 25."),
    pageToken: z
      .string()
      .optional()
      .describe(
        "Opaque cursor returned as nextPageToken in the previous response. " +
          "Omit for the first page.",
      ),
  })
  .describe(
    "Cursor-based pagination (LinkedIn API v202401+). Use pageToken from the previous " +
      "response to fetch subsequent pages. Applies to all q=search finders.",
  );
export type CursorPagination = z.infer<typeof CursorPaginationSchema>;
