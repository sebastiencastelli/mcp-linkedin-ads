# Smoke tests

End-to-end tests that hit a **live deployed MCP server** and exercise every tool against the real LinkedIn Marketing API. Designed to:

1. Validate that tool schemas match what the LLM sees
2. Confirm every response shape is parsed correctly
3. Cover happy paths, error paths, and edge cases
4. Run without any AI in the loop (pure programmatic JSON-RPC calls)

## Running

```bash
MCP_URL=https://your-mcp-domain.example.com/mcp \
MCP_TOKEN=<your-mcp-api-token> \
SMOKE_ACCOUNT_ID=<your-linkedin-ad-account-id> \
SMOKE_KNOWN_CAMPAIGN_ID=<an-existing-campaign-id-on-that-account> \
  pnpm test tests/smoke/
```

The env vars are required — the helper will throw if any is missing. See `_mcp-client.ts` for details.

## What each test creates and cleans up

Tests that need to mutate state create a **sandbox group** with a timestamped name like `[SMOKE-H-2026-04-15T09-30-00]` so parallel runs don't collide. Every test has an `afterAll` that archives everything it created (group, campaigns, creatives). Failures mid-test still attempt cleanup.

## Expected state prerequisites

- Ad Account `SMOKE_ACCOUNT_ID` reachable via the configured OAuth token
- At least one existing campaign (passed via `SMOKE_KNOWN_CAMPAIGN_ID`) for campaign-scoped analytics tests

## Files

- `_mcp-client.ts` — shared JSON-RPC helper (don't put tests here)
- `hierarchy.smoke.test.ts` — accounts, groups, campaigns
- `creatives.smoke.test.ts` — creatives + assets upload
- `targeting.smoke.test.ts` — facets, entities, audience
- `analytics-bulk.smoke.test.ts` — analytics, bulk, duplicate
