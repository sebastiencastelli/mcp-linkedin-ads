# Smoke tests

End-to-end tests that hit the **live deployed MCP server** (https://mcp-linkedin.sebastiencastelli.com) and exercise every tool against the real LinkedIn Marketing API. Designed to:

1. Validate that tool schemas match what the LLM sees
2. Confirm every response shape is parsed correctly
3. Cover happy paths, error paths, and edge cases
4. Run without any AI in the loop (pure programmatic JSON-RPC calls)

## Running

```bash
pnpm test tests/smoke/
```

Override defaults via env:

```bash
MCP_URL=https://other/mcp MCP_TOKEN=xxx pnpm test tests/smoke/
```

## What each test creates and cleans up

Tests that need to mutate state create a **sandbox group** with a timestamped name like `[SMOKE-H-2026-04-15T09-30-00]` so parallel runs don't collide. Every test has an `afterAll` that archives everything it created (group, campaigns, creatives). Failures mid-test still attempt cleanup.

## Expected state prerequisites

- Ad Account `514213130` ("Sébastien Castelli") reachable via the configured OAuth token
- At least one existing campaign to read metadata from (used by `get_campaign`, `get_creative`, `list_creatives` with campaign_id)

## Files

- `_mcp-client.ts` — shared JSON-RPC helper (don't put tests here)
- `hierarchy.smoke.test.ts` — accounts, groups, campaigns
- `creatives.smoke.test.ts` — creatives + assets upload
- `targeting.smoke.test.ts` — facets, entities, audience
- `analytics-bulk.smoke.test.ts` — analytics, bulk, duplicate
