import { readFile, stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import axios from "axios";
import { z } from "zod";
import { ensureUrn, urnId } from "../linkedin/urn.js";
import {
  AccountIdSchema,
  CampaignIdSchema,
  CreativeIdSchema,
  PaginationSchema,
  StatusEnum,
} from "../schemas/common.js";
import {
  ImageCreativeInputSchema,
  TextCreativeInputSchema,
  VideoCreativeInputSchema,
} from "../schemas/creative.js";
import { logger } from "../utils/logger.js";
import { truncate, type PagedResponse } from "../utils/pagination.js";
import { callLinkedIn, callLinkedInWithHeaders, extractCreatedId, jsonResult } from "./_helpers.js";

interface Creative {
  id: number;
  campaign: string;
  account: string;
  intendedStatus: string;
  isServing?: boolean;
  reviewStatus?: string;
  content?: unknown;
}

// ---------------------------------------------------------------------------
// Deprecated legacy helper — kept for reference only. DO NOT USE in new tools.
// The /assets?action=registerUpload endpoint returns a digitalmediaAsset URN
// which is NOT accepted as content.reference in /creatives. Use createImagePost
// or createVideoPost instead.
// ---------------------------------------------------------------------------
interface RegisterUploadResponse {
  value: {
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
        uploadUrl: string;
        headers?: Record<string, string>;
      };
    };
    asset: string;
  };
}

/** @deprecated Use createImagePost / createVideoPost instead. */
async function uploadAsset(
  client: AxiosInstance,
  ownerUrn: string,
  filePath: string,
  recipe: "feedshare-image" | "ads-video",
): Promise<string> {
  const fileStat = await stat(filePath);
  logger.info({ filePath, size: fileStat.size, recipe }, "Uploading asset to LinkedIn");

  const register = await callLinkedIn<RegisterUploadResponse>(
    client,
    "/assets?action=registerUpload",
    {
      method: "POST",
      data: {
        registerUploadRequest: {
          owner: ownerUrn,
          recipes: [`urn:li:digitalmediaRecipe:${recipe}`],
          serviceRelationships: [
            {
              identifier: "urn:li:userGeneratedContent",
              relationshipType: "OWNER",
            },
          ],
        },
      },
    },
  );

  const uploadUrl =
    register.value.uploadMechanism[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ].uploadUrl;
  const assetUrn = register.value.asset;

  const fileBuffer = await readFile(filePath);
  await axios.put(uploadUrl, fileBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120_000,
  });

  logger.info({ assetUrn }, "Asset uploaded successfully");
  return assetUrn;
}

// ---------------------------------------------------------------------------
// Image upload helpers — new Images API (v202306+)
// ---------------------------------------------------------------------------

interface InitializeImageUploadResponse {
  value: {
    uploadUrl: string;
    image: string; // urn:li:image:...
  };
}

/**
 * Step 1 of new image flow: initialize upload via POST /images?action=initializeUpload.
 * Returns { uploadUrl, imageUrn }.
 * Ref: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
 */
async function initializeImageUpload(
  client: AxiosInstance,
  ownerUrn: string,
): Promise<{ uploadUrl: string; imageUrn: string }> {
  const resp = await callLinkedIn<InitializeImageUploadResponse>(
    client,
    "/images?action=initializeUpload",
    {
      method: "POST",
      data: {
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      },
    },
  );
  return { uploadUrl: resp.value.uploadUrl, imageUrn: resp.value.image };
}

// ---------------------------------------------------------------------------
// Video upload helpers — new Videos API (v202306+)
// ---------------------------------------------------------------------------

interface InitializeVideoUploadResponse {
  value: {
    uploadInstructions: Array<{ uploadUrl: string; lastByte: number; firstByte: number }>;
    video: string; // urn:li:video:...
    uploadToken: string;
  };
}

/**
 * Step 1 of new video flow: initialize upload via POST /videos?action=initializeUpload.
 * Returns { uploadInstructions, videoUrn, uploadToken }.
 * Ref: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
 */
async function initializeVideoUpload(
  client: AxiosInstance,
  ownerUrn: string,
  fileSizeBytes: number,
): Promise<{ uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>; videoUrn: string; uploadToken: string }> {
  const resp = await callLinkedIn<InitializeVideoUploadResponse>(
    client,
    "/videos?action=initializeUpload",
    {
      method: "POST",
      data: {
        initializeUploadRequest: {
          owner: ownerUrn,
          fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
    },
  );
  return {
    uploadInstructions: resp.value.uploadInstructions,
    videoUrn: resp.value.video,
    uploadToken: resp.value.uploadToken,
  };
}

/**
 * Finalize a video upload via POST /videos?action=finalizeUpload.
 * Must be called after all chunk PUTs are done.
 */
async function finalizeVideoUpload(
  client: AxiosInstance,
  videoUrn: string,
  uploadToken: string,
  etags: string[],
): Promise<void> {
  await callLinkedIn<unknown>(
    client,
    "/videos?action=finalizeUpload",
    {
      method: "POST",
      data: {
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken,
          uploadedPartIds: etags,
        },
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Post creation helpers — Posts API
// ---------------------------------------------------------------------------

interface PostCallToAction {
  actionType: string;
  landingPage: string;
}

interface PostBody {
  author: string;
  commentary: string;
  visibility: string;
  lifecycleState: string;
  distribution: {
    feedDistribution: string;
    targetEntities: unknown[];
    thirdPartyDistributionChannels: unknown[];
  };
  content: {
    media: {
      id: string;
      title: string;
      altText?: string;
    };
  };
  adContext: {
    dscAdType: string;
    dscAdAccount: string;
    isDsc: boolean;
  };
  callToAction?: PostCallToAction;
}

/**
 * Create an ad-backed UGC post wrapping a media asset and return the post URN
 * (urn:li:ugcPost:... or urn:li:share:...) extracted from the x-restli-id header.
 *
 * Body shape follows the LinkedIn Posts API for sponsored content:
 *   POST /rest/posts
 * Ref: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *
 * Key fields:
 *   - adContext.dscAdAccount: the sponsoredAccount URN that owns this ad
 *   - adContext.dscAdType: SINGLE_IMAGE or VIDEO
 *   - adContext.isDsc: false (DSC = Dynamic Smart Creative, not used here)
 *   - distribution.feedDistribution: NONE (ad-only post, not organic feed)
 *   - callToAction.actionType + landingPage: CTA button on the creative
 *
 * The returned post URN is used as content.reference when creating the creative.
 */
async function createAdPost(
  client: AxiosInstance,
  authorUrn: string,
  accountUrn: string,
  mediaUrn: string,
  commentary: string,
  title: string,
  adType: "SINGLE_IMAGE" | "VIDEO",
  callToAction?: { actionType: string; landingPage: string },
): Promise<string> {
  const body: PostBody = {
    author: authorUrn,
    commentary,
    visibility: "PUBLIC",
    lifecycleState: "PUBLISHED",
    distribution: {
      feedDistribution: "NONE",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: {
      media: {
        id: mediaUrn,
        title,
        altText: title,
      },
    },
    adContext: {
      dscAdType: adType,
      dscAdAccount: accountUrn,
      isDsc: false,
    },
    ...(callToAction !== undefined && { callToAction }),
  };

  logger.info({ authorUrn, accountUrn, mediaUrn, adType }, "Creating ad post via /posts");

  // Use the legacy /ugcPosts endpoint which is part of Marketing Developer Platform
  // (same tier as Advertising API). The newer /posts endpoint requires Community
  // Management API which is a separate product.
  const ugcBody = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: commentary },
        shareMediaCategory: adType === "VIDEO" ? "VIDEO" : "IMAGE",
        media: [
          {
            status: "READY",
            media: mediaUrn,
            title: { text: title },
          },
        ],
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    // adContext tells LinkedIn this is a dark post (ad-only, not organic)
    adContext: {
      dscAdAccount: accountUrn,
      dscAdType: adType,
      isDsc: false,
    },
  };
  // callToAction omitted — not part of ugcPosts share schema; CTA is carried on creative body

  logger.info({ authorUrn, accountUrn, mediaUrn, adType }, "Creating ad post via /ugcPosts");

  const { headers } = await callLinkedInWithHeaders<unknown>(client, "/ugcPosts", {
    method: "POST",
    data: ugcBody,
    headers: { "X-RestLi-Method": "CREATE" },
  });

  const rawId = headers["x-restli-id"] ?? headers["x-linkedin-id"];
  if (!rawId) {
    throw new Error(
      `POST /ugcPosts succeeded but no x-restli-id header found in response. ` +
        `Cannot proceed without a post URN to attach to the creative.`,
    );
  }
  const postUrn = decodeURIComponent(rawId);
  logger.info({ postUrn }, "Ad post created successfully");
  // Silence unused-param warning for callToAction (CTA is on creative, not post)
  void callToAction;
  return postUrn;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCreativeTools(server: McpServer, client: AxiosInstance): void {
  server.registerTool(
    "list_creatives",
    {
      title: "List Creatives",
      description: "List creatives in an Ad Account, optionally filtered by campaign or status.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema.optional(),
        status: z.array(StatusEnum).optional(),
        pagination: PaginationSchema.optional(),
      },
    },
    async ({ account_id, campaign_id, status, pagination }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const { start = 0, count = 25 } = pagination ?? {};
      // Build query string manually to keep commas/parens/colons unencoded (LinkedIn Restli syntax).
      // The `criteria` finder accepts filters as direct top-level List(...) params,
      // NOT as a nested search=(...) expression.
      let qs = `q=criteria&start=${start}&count=${count}`;
      if (campaign_id !== undefined) {
        qs += `&campaigns=List(${encodeURIComponent(ensureUrn("sponsoredCampaign", campaign_id))})`;
      }
      if (status?.length) {
        qs += `&intendedStatuses=List(${status.join(",")})`;
      }
      const data = await callLinkedIn<PagedResponse<Creative>>(
        client,
        `/adAccounts/${accId}/creatives?${qs}`,
      );
      const trunc = truncate(data.elements, 50);
      return jsonResult({
        ...trunc,
        creatives: trunc.elements,
      });
    },
  );

  server.registerTool(
    "get_creative",
    {
      title: "Get Creative",
      description: "Fetch full details of a single creative.",
      inputSchema: {
        account_id: AccountIdSchema,
        creative_id: CreativeIdSchema,
      },
    },
    async ({ account_id, creative_id }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      // LinkedIn 2026-04 doc: creative URN must be URL-encoded in the path segment.
      // e.g. /adAccounts/123/creatives/urn%3Ali%3AsponsoredCreative%3A456
      const credUrn = encodeURIComponent(ensureUrn("sponsoredCreative", creative_id));
      const data = await callLinkedIn<Creative>(
        client,
        `/adAccounts/${accId}/creatives/${credUrn}`,
      );
      return jsonResult(data);
    },
  );

  server.registerTool(
    "create_image_creative",
    {
      title: "Create Image Creative",
      description:
        "Create a Single Image sponsored content ad in one call. The tool: (1) initializes an " +
        "image upload via the LinkedIn Images API, (2) PUTs the binary, (3) creates an ad post " +
        "via the Posts API to wrap the image, (4) creates the creative referencing that post. " +
        "Returns the new creative URN and intermediate URNs for debugging.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
        organization_urn: z
          .string()
          .describe(
            'Owning organization page URN (e.g. "urn:li:organization:12345"). LinkedIn requires ' +
              "a page to act as the author of the ad post.",
          ),
        creative: ImageCreativeInputSchema,
      },
    },
    async ({ account_id, campaign_id, organization_urn, creative }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const campaignUrn = ensureUrn("sponsoredCampaign", campaign_id);

      // --- Step 1+2: upload image via legacy /assets endpoint (Marketing tier) ---
      // Uses uploadAsset() which calls /assets?action=registerUpload + PUT binary.
      // Returns urn:li:digitalmediaAsset:... which we then wrap in a ugcPost.
      const imageUrn = await uploadAsset(
        client,
        organization_urn,
        creative.imagePath,
        "feedshare-image",
      );

      // --- Step 3: create an ad post wrapping the image ---
      const postUrn = await createAdPost(
        client,
        organization_urn,
        accountUrn,
        imageUrn,
        creative.introText,
        creative.headline,
        "SINGLE_IMAGE",
        { actionType: creative.callToAction, landingPage: creative.landingPageUrl },
      );

      // --- Step 4: create the creative referencing the post URN ---
      const creativeBody = {
        campaign: campaignUrn,
        intendedStatus: creative.intendedStatus,
        ...(creative.name !== undefined && { name: creative.name }),
        content: {
          reference: postUrn,
        },
      };

      logger.info({ campaignUrn, postUrn }, "Creating image creative");
      const { headers: createHeaders } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${accId}/creatives`,
        {
          method: "POST",
          data: creativeBody,
          headers: { "X-RestLi-Method": "CREATE" },
        },
      );
      const createdId = extractCreatedId(createHeaders);
      logger.info({ createdId }, "Image creative created");
      return jsonResult({
        created: true,
        id: createdId,
        urn: createdId !== undefined ? ensureUrn("sponsoredCreative", createdId) : undefined,
        imageUrn,
        postUrn,
      });
    },
  );

  server.registerTool(
    "create_video_creative",
    {
      title: "Create Video Creative",
      description:
        "Create a Sponsored Video creative in one call. The tool: (1) initializes a video " +
        "upload via the LinkedIn Videos API, (2) PUTs binary chunks to each signed upload URL, " +
        "(3) finalizes the upload, (4) creates an ad post wrapping the video, (5) creates the " +
        "creative referencing that post. Note: LinkedIn may need several minutes to finish " +
        "encoding the video — the creative is created as DRAFT and will become reviewable once " +
        "encoding completes.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
        organization_urn: z
          .string()
          .describe('Owning organization page URN (e.g. "urn:li:organization:12345").'),
        creative: VideoCreativeInputSchema,
      },
    },
    async ({ account_id, campaign_id, organization_urn, creative }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const accountUrn = ensureUrn("sponsoredAccount", account_id);
      const campaignUrn = ensureUrn("sponsoredCampaign", campaign_id);

      // --- Step 1+2: upload video via legacy /assets endpoint (Marketing tier) ---
      // Uses uploadAsset() which calls /assets?action=registerUpload + PUT binary.
      // Returns urn:li:digitalmediaAsset:... which we then wrap in a ugcPost.
      const videoUrn = await uploadAsset(
        client,
        organization_urn,
        creative.videoPath,
        "ads-video",
      );

      // --- Step 3: create an ad post wrapping the video ---
      const postUrn = await createAdPost(
        client,
        organization_urn,
        accountUrn,
        videoUrn,
        creative.introText,
        creative.headline,
        "VIDEO",
        { actionType: creative.callToAction, landingPage: creative.landingPageUrl },
      );

      // --- Step 5: create the creative referencing the post URN ---
      const creativeBody = {
        campaign: campaignUrn,
        intendedStatus: creative.intendedStatus,
        ...(creative.name !== undefined && { name: creative.name }),
        content: {
          reference: postUrn,
        },
      };

      logger.info({ campaignUrn, postUrn }, "Creating video creative");
      const { headers: createHeaders } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${accId}/creatives`,
        {
          method: "POST",
          data: creativeBody,
          headers: { "X-RestLi-Method": "CREATE" },
        },
      );
      const createdId = extractCreatedId(createHeaders);
      logger.info({ createdId }, "Video creative created");
      return jsonResult({
        created: true,
        id: createdId,
        urn: createdId !== undefined ? ensureUrn("sponsoredCreative", createdId) : undefined,
        videoUrn,
        postUrn,
        note: "Encoding may take several minutes. The creative will be reviewable once LinkedIn finishes encoding.",
      });
    },
  );

  server.registerTool(
    "create_text_creative",
    {
      title: "Create Text Creative",
      description:
        "Create a right-rail Text Ad creative. Only valid for TEXT_AD campaign type. Char " +
        "limits are tight: 25 chars headline, 75 chars description.",
      inputSchema: {
        account_id: AccountIdSchema,
        campaign_id: CampaignIdSchema,
        creative: TextCreativeInputSchema,
      },
    },
    async ({ account_id, campaign_id, creative }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const campaignUrn = ensureUrn("sponsoredCampaign", campaign_id);
      const body = {
        campaign: campaignUrn,
        intendedStatus: creative.intendedStatus,
        name: creative.name,
        content: {
          textAd: {
            headline: creative.headline,
            description: creative.description,
            landingPage: creative.landingPageUrl,
          },
        },
      };
      const { headers: createHeaders } = await callLinkedInWithHeaders<unknown>(
        client,
        `/adAccounts/${accId}/creatives`,
        {
          method: "POST",
          data: body,
          headers: { "X-RestLi-Method": "CREATE" },
        },
      );
      const createdId = extractCreatedId(createHeaders);
      return jsonResult({
        created: true,
        id: createdId,
        urn: createdId !== undefined ? ensureUrn("sponsoredCreative", createdId) : undefined,
      });
    },
  );

  server.registerTool(
    "update_creative_status",
    {
      title: "Update Creative Status",
      description: "Pause / resume / archive a creative.",
      inputSchema: {
        account_id: AccountIdSchema,
        creative_id: CreativeIdSchema,
        status: StatusEnum,
      },
    },
    async ({ account_id, creative_id, status }) => {
      const accId = urnId(ensureUrn("sponsoredAccount", account_id));
      const credUrn = ensureUrn("sponsoredCreative", creative_id);
      await callLinkedIn(
        client,
        `/adAccounts/${accId}/creatives/${encodeURIComponent(credUrn)}`,
        {
          method: "POST",
          data: { patch: { $set: { intendedStatus: status } } },
          headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
        },
      );
      return jsonResult({ updated: true, urn: credUrn, status });
    },
  );
}
