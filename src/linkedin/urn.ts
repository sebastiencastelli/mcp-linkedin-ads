/**
 * LinkedIn URN helpers.
 *
 * URNs are LinkedIn's typed identifier format. Almost every entity in the
 * Marketing API is referenced by URN rather than a bare numeric ID. Quirks
 * to know:
 *
 *   - Some endpoints accept URL-encoded URNs in query params, others want
 *     them raw inside a JSON body. Use `encodeUrn()` for query params and
 *     pass the raw URN inside JSON.
 *   - Restli list syntax for query params: `List(urn1,urn2)` — each URN
 *     individually URL-encoded, then the wrapping `List(...)` itself encoded.
 *   - The Conversion entity uses a different namespace prefix (`urn:lla:`).
 */

export type UrnType =
  | "sponsoredAccount"
  | "sponsoredCampaignGroup"
  | "sponsoredCampaign"
  | "sponsoredCreative"
  | "organization"
  | "person"
  | "geo"
  | "industry"
  | "seniority"
  | "function"
  | "title"
  | "skill"
  | "school"
  | "degree"
  | "fieldOfStudy"
  | "image"
  | "video"
  | "ugcPost"
  | "share";

const URN_PREFIX_BY_TYPE: Record<UrnType, string> = {
  sponsoredAccount: "urn:li:sponsoredAccount",
  sponsoredCampaignGroup: "urn:li:sponsoredCampaignGroup",
  sponsoredCampaign: "urn:li:sponsoredCampaign",
  sponsoredCreative: "urn:li:sponsoredCreative",
  organization: "urn:li:organization",
  person: "urn:li:person",
  geo: "urn:li:geo",
  industry: "urn:li:industry",
  seniority: "urn:li:seniority",
  function: "urn:li:function",
  title: "urn:li:title",
  skill: "urn:li:skill",
  school: "urn:li:school",
  degree: "urn:li:degree",
  fieldOfStudy: "urn:li:fieldOfStudy",
  image: "urn:li:image",
  video: "urn:li:video",
  ugcPost: "urn:li:ugcPost",
  share: "urn:li:share",
};

export function buildUrn(type: UrnType, id: string | number): string {
  return `${URN_PREFIX_BY_TYPE[type]}:${id}`;
}

export interface ParsedUrn {
  namespace: string; // e.g. "li"
  type: string; // e.g. "sponsoredCampaign"
  id: string;
}

const URN_REGEX = /^urn:([a-zA-Z]+):([a-zA-Z]+):(.+)$/;

export function parseUrn(urn: string): ParsedUrn {
  const m = URN_REGEX.exec(urn);
  if (!m) throw new Error(`Invalid URN format: ${urn}`);
  return { namespace: m[1]!, type: m[2]!, id: m[3]! };
}

export function isUrn(value: string): boolean {
  return URN_REGEX.test(value);
}

/** URL-encode a URN for use inside a query string parameter. */
export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn);
}

/**
 * Build a Restli `List(...)` query string value from an array of URNs.
 * Each URN is individually encoded, then the wrapping `List(...)` is
 * returned (NOT yet encoded — let URLSearchParams or your http lib do
 * the outer encoding once).
 */
export function buildUrnList(urns: string[]): string {
  return `List(${urns.map(encodeUrn).join(",")})`;
}

/**
 * Coerce a value that might be a URN, a numeric id, or a stringified id
 * into a full URN of the requested type. Lets tools accept either form
 * from Claude (e.g. `account_id: 123456` or `account_id: "urn:li:sponsoredAccount:123456"`).
 */
export function ensureUrn(type: UrnType, value: string | number): string {
  if (typeof value === "number") return buildUrn(type, value);
  if (isUrn(value)) {
    const parsed = parseUrn(value);
    if (parsed.type !== type) {
      throw new Error(`Expected URN of type ${type}, got ${parsed.type}`);
    }
    return value;
  }
  return buildUrn(type, value);
}

/** Extract the numeric/string id from a URN, regardless of type. */
export function urnId(urn: string): string {
  return parseUrn(urn).id;
}
