/**
 * Unit tests for bulk_pause_campaigns — verifies that the tool issues a
 * single BATCH_PARTIAL_UPDATE call instead of N individual PARTIAL_UPDATE
 * calls, and that the MCP response is correctly derived from LinkedIn's
 * 204 / 207 responses.
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stubs so we can import bulk.ts without a real MCP server or axios
// ---------------------------------------------------------------------------

// Stub the MCP server: capture what registerTool() receives.
let capturedHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;
const fakeServer = {
  registerTool: vi.fn((_name: string, _meta: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    if (_name === "bulk_pause_campaigns") capturedHandler = handler;
  }),
};

// Stub axios instance: we intercept client.request().
const mockRequest = vi.fn();
const fakeClient = { request: mockRequest };

// ---------------------------------------------------------------------------
// Import the module under test (uses ESM — vitest handles the .js extension)
// ---------------------------------------------------------------------------
// We do a dynamic import after mocking to avoid module-level side effects.

async function loadAndRegister() {
  const mod = await import("../../src/tools/bulk.js");
  // Reset handler capture before each registration
  capturedHandler = null;
  mod.registerBulkTools(fakeServer as never, fakeClient as never);
  return capturedHandler!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockResponse(status: number, data: unknown = null) {
  return { status, data, headers: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bulk_pause_campaigns", () => {
  it("issues exactly ONE API request for N campaigns", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockResolvedValueOnce(makeMockResponse(204));

    await handler({ account_id: "123456789", campaign_ids: ["111", "222", "333"] });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    mockRequest.mockReset();
  });

  it("builds the correct URL with ids=List(...) Restli syntax", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockResolvedValueOnce(makeMockResponse(204));

    await handler({ account_id: "123456789", campaign_ids: ["111", "222", "333"] });

    const callArg: { url: string } = mockRequest.mock.calls[0][0] as { url: string };
    expect(callArg.url).toBe(
      "/adAccounts/123456789/adCampaigns?ids=List(111,222,333)",
    );
    mockRequest.mockReset();
  });

  it("sets the X-RestLi-Method: BATCH_PARTIAL_UPDATE header", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockResolvedValueOnce(makeMockResponse(204));

    await handler({ account_id: "123456789", campaign_ids: ["111"] });

    const callArg = mockRequest.mock.calls[0][0] as { headers: Record<string, string> };
    expect(callArg.headers["X-RestLi-Method"]).toBe("BATCH_PARTIAL_UPDATE");
    mockRequest.mockReset();
  });

  it("builds the correct entities body", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockResolvedValueOnce(makeMockResponse(204));

    await handler({ account_id: "123456789", campaign_ids: ["111", "222", "333"] });

    const callArg = mockRequest.mock.calls[0][0] as { data: { entities: Record<string, unknown> } };
    expect(callArg.data.entities).toEqual({
      "111": { patch: { $set: { status: "PAUSED" } } },
      "222": { patch: { $set: { status: "PAUSED" } } },
      "333": { patch: { $set: { status: "PAUSED" } } },
    });
    mockRequest.mockReset();
  });

  it("returns all paused:true on 204 response", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockResolvedValueOnce(makeMockResponse(204, null));

    const result = (await handler({
      account_id: "123456789",
      campaign_ids: ["111", "222"],
    })) as { content: Array<{ text: string }> };

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.totalRequested).toBe(2);
    expect(payload.succeeded).toBe(2);
    expect(payload.failed).toBe(0);
    expect(payload.details.every((d: { paused: boolean }) => d.paused)).toBe(true);
    mockRequest.mockReset();
  });

  it("parses 207 partial success — marks failed campaigns correctly", async () => {
    const handler = await loadAndRegister();
    // 207 body: campaign 111 OK, campaign 222 failed
    mockRequest.mockResolvedValueOnce(
      makeMockResponse(207, {
        results: {
          "111": { status: 204 },
          "222": { status: 400, code: "INVALID_CAMPAIGN_STATUS", message: "Cannot pause" },
        },
      }),
    );

    const result = (await handler({
      account_id: "123456789",
      campaign_ids: ["111", "222"],
    })) as { content: Array<{ text: string }> };

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(1);

    const failed = payload.details.find((d: { campaign_id: string }) => d.campaign_id === "222");
    expect(failed.paused).toBe(false);
    expect(failed.error).toBe("Cannot pause");

    const ok = payload.details.find((d: { campaign_id: string }) => d.campaign_id === "111");
    expect(ok.paused).toBe(true);
    mockRequest.mockReset();
  });

  it("marks all campaigns as failed when the batch call throws (4xx)", async () => {
    const handler = await loadAndRegister();
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error("LinkedIn 400"), {
        response: { status: 400, data: { message: "Bad request" } },
      }),
    );

    const result = (await handler({
      account_id: "123456789",
      campaign_ids: ["111", "222"],
    })) as { content: Array<{ text: string }> };

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.succeeded).toBe(0);
    expect(payload.failed).toBe(2);
    expect(payload.details.every((d: { paused: boolean }) => !d.paused)).toBe(true);
    mockRequest.mockReset();
  });
});
