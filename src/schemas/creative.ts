import { z } from "zod";
import { StatusEnum } from "./common.js";

/**
 * Creative schemas — one per format. LinkedIn's unified /creatives endpoint
 * uses a discriminated union but expressing the full union in Zod is overkill
 * for our tools, so we expose one creator tool per common format and keep the
 * shape narrow.
 */

export const CreativeStatusEnum = StatusEnum.describe("Creative lifecycle status.");

export const ImageCreativeInputSchema = z
  .object({
    name: z.string().optional().describe("Internal name for the creative (not shown to viewers)."),
    intendedStatus: StatusEnum.default("DRAFT"),
    headline: z.string().min(1).max(70).describe("Main headline shown above the image (max 70 chars)."),
    introText: z
      .string()
      .max(600)
      .describe("Body text shown above the post (max 600 chars)."),
    imagePath: z
      .string()
      .describe(
        "Local filesystem path to the image to upload (PNG/JPG, ≤5MB, recommended 1200×627). " +
          "The tool registers + uploads the asset before creating the creative.",
      ),
    landingPageUrl: z.string().url().describe("Destination URL clicked from the ad."),
    callToAction: z
      .enum([
        "APPLY",
        "DOWNLOAD",
        "GET_QUOTE",
        "LEARN_MORE",
        "SIGN_UP",
        "SUBSCRIBE",
        "REGISTER",
        "JOIN",
        "ATTEND",
        "REQUEST_DEMO",
        "VIEW_QUOTE",
      ])
      .describe("Button label shown on the ad."),
  })
  .describe(
    "All fields needed to create a Single Image sponsored content ad in one call. " +
      "The tool handles asset upload then creative creation.",
  );

export const VideoCreativeInputSchema = z
  .object({
    name: z.string().optional(),
    intendedStatus: StatusEnum.default("DRAFT"),
    headline: z.string().min(1).max(70),
    introText: z.string().max(600),
    videoPath: z
      .string()
      .describe(
        "Local filesystem path to the video file (MP4 H.264, 3s–30min, ≤200MB). " +
          "The tool uploads, polls until LinkedIn finishes encoding, then creates the creative.",
      ),
    landingPageUrl: z.string().url(),
    callToAction: z.enum([
      "APPLY",
      "DOWNLOAD",
      "LEARN_MORE",
      "SIGN_UP",
      "SUBSCRIBE",
      "REGISTER",
      "REQUEST_DEMO",
    ]),
  })
  .describe("All fields needed to create a Sponsored Video creative in one call.");

export const TextCreativeInputSchema = z
  .object({
    name: z.string().optional(),
    intendedStatus: StatusEnum.default("DRAFT"),
    headline: z.string().min(1).max(25).describe("Text Ad headline (max 25 chars)."),
    description: z.string().min(1).max(75).describe("Text Ad body (max 75 chars)."),
    landingPageUrl: z.string().url(),
  })
  .describe(
    "Right-rail Text Ad — only available for TEXT_AD type campaigns. Very small char limits.",
  );
