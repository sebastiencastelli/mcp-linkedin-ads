import { describe, expect, it } from "vitest";
import { buildAnalyticsQuery } from "../../src/tools/analytics.js";

describe("buildAnalyticsQuery", () => {
  const accountUrn = "urn:li:sponsoredAccount:123456789";
  const baseQuery = {
    pivot: "CAMPAIGN" as const,
    timeGranularity: "ALL" as const,
    dateRange: {
      start: { year: 2025, month: 1, day: 1 },
      end: { year: 2025, month: 12, day: 31 },
    },
    fields: ["impressions", "clicks"] as [string, ...string[]],
  };

  it("always injects pivotValues into fields — even when caller omits it", () => {
    const qs = buildAnalyticsQuery(baseQuery, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="));
    expect(fieldsParam).toBeDefined();
    const fields = fieldsParam!.split("=")[1].split(",");
    expect(fields).toContain("pivotValues");
  });

  it("always injects dateRange into fields — even when caller omits it", () => {
    const qs = buildAnalyticsQuery(baseQuery, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="));
    const fields = fieldsParam!.split("=")[1].split(",");
    expect(fields).toContain("dateRange");
  });

  it("does not duplicate pivotValues if caller already includes it", () => {
    const query = {
      ...baseQuery,
      fields: ["impressions", "pivotValues", "clicks"] as [string, ...string[]],
    };
    const qs = buildAnalyticsQuery(query, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="))!;
    const fields = fieldsParam.split("=")[1].split(",");
    const pvCount = fields.filter((f) => f === "pivotValues").length;
    expect(pvCount).toBe(1);
  });

  it("does not duplicate dateRange if caller already includes it", () => {
    const query = {
      ...baseQuery,
      fields: ["impressions", "dateRange"] as [string, ...string[]],
    };
    const qs = buildAnalyticsQuery(query, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="))!;
    const fields = fieldsParam.split("=")[1].split(",");
    const drCount = fields.filter((f) => f === "dateRange").length;
    expect(drCount).toBe(1);
  });

  it("preserves all user-requested fields alongside injected ones", () => {
    const query = {
      ...baseQuery,
      fields: ["impressions", "clicks", "costInLocalCurrency", "videoViews"] as [string, ...string[]],
    };
    const qs = buildAnalyticsQuery(query, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="))!;
    const fields = fieldsParam.split("=")[1].split(",");
    expect(fields).toContain("impressions");
    expect(fields).toContain("clicks");
    expect(fields).toContain("costInLocalCurrency");
    expect(fields).toContain("videoViews");
    expect(fields).toContain("pivotValues");
    expect(fields).toContain("dateRange");
  });

  it("uses raw commas in fields (no URL encoding)", () => {
    const qs = buildAnalyticsQuery(baseQuery, accountUrn);
    const fieldsParam = qs.split("&").find((p) => p.startsWith("fields="))!;
    expect(fieldsParam).not.toContain("%2C");
    expect(fieldsParam).toContain(",");
  });

  it("builds correct dateRange Restli format with raw parens/colons", () => {
    const qs = buildAnalyticsQuery(baseQuery, accountUrn);
    expect(qs).toContain("dateRange=(start:(year:2025,month:1,day:1),end:(year:2025,month:12,day:31))");
  });

  it("defaults to account scope when no campaigns/creatives/accounts filter", () => {
    const qs = buildAnalyticsQuery(baseQuery, accountUrn);
    expect(qs).toContain(`accounts=List(${encodeURIComponent(accountUrn)})`);
  });

  it("uses campaigns filter when provided", () => {
    const query = { ...baseQuery, campaigns: [111, 222] };
    const qs = buildAnalyticsQuery(query, accountUrn);
    expect(qs).toContain("campaigns=List(");
    expect(qs).toContain(encodeURIComponent("urn:li:sponsoredCampaign:111"));
    expect(qs).toContain(encodeURIComponent("urn:li:sponsoredCampaign:222"));
    expect(qs).not.toContain("accounts=List(");
  });

  it("URL-encodes URNs inside List() but keeps List() commas raw", () => {
    const query = { ...baseQuery, campaigns: [111] };
    const qs = buildAnalyticsQuery(query, accountUrn);
    expect(qs).toContain("campaigns=List(urn%3Ali%3AsponsoredCampaign%3A111)");
  });
});
