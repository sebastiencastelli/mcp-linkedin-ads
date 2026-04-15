# MCP LinkedIn Ads

Model Context Protocol server that connects the LinkedIn Marketing API (Advertising Standard tier) to Claude — Web, Desktop, and CLI. Pilot your LinkedIn advertising accounts conversationally: ask Claude to audit performance, adjust bids, create campaigns, pause underperformers, estimate audiences, and more.

One deployment = one LinkedIn OAuth grant = access to **every Ad Account** the authenticated member has a role on (own accounts + client accounts where invited as a manager).

## Who it's for

- **LinkedIn Ads freelancers & agencies** managing multiple client accounts and tired of clicking in Campaign Manager
- **In-house marketing teams** wanting instant performance reports and AI-driven optimizations
- **Growth / RevOps engineers** building automations on top of LinkedIn advertising data
- **B2B SaaS companies** connecting their ad spend and campaign state to internal AI assistants

## What's inside

- HTTP + SSE server in Node 22 / TypeScript, using `@modelcontextprotocol/sdk`
- **23 MCP tools** across 5 domains:
  - Hierarchy: list/get/create/update on Ad Accounts, Campaign Groups, Campaigns
  - Creatives: list/get/create (text, image, video) /update on Sponsored Content
  - Targeting: facets catalogue, entity typeahead, audience size estimation
  - Analytics: account-level and campaign-level reporting (78 metrics, 23 pivots, 4 granularities)
  - Composites: `duplicate_campaign`, `bulk_pause_campaigns` (single BATCH_PARTIAL_UPDATE call)
- Embedded web wizard at `/setup` for one-click OAuth bootstrap
- Token store encrypted at rest (AES-256-GCM); refresh tokens rotated automatically
- Exponential backoff on 429 and 5xx; cursor-based pagination where LinkedIn requires it
- Docker Compose deployment — Caddy variant (auto HTTPS via Let's Encrypt) or nginx variant for servers with an existing reverse proxy

## Quick start

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full 30-minute install guide. High-level:

1. Provision a Linux server with Docker + a domain you control
2. Create a LinkedIn Developer App, add the **Advertising API** product
3. Clone the repo, run `./scripts/generate-secrets.sh` to bootstrap `docker/.env`
4. Add the redirect URI in LinkedIn Developer Portal
5. `docker compose up -d --build`
6. Open `https://your-domain/setup`, paste the API token, click **Connect LinkedIn**
7. Point Claude (Code / Desktop / Web) at `https://your-domain/mcp` with the bearer token

## Documentation

- [`docs/INSTALL.md`](docs/INSTALL.md) — step-by-step installation
- [`docs/TOOLS.md`](docs/TOOLS.md) — full tool reference with examples
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design decisions and extension points
- [`tests/smoke/README.md`](tests/smoke/README.md) — how to run end-to-end smoke tests against a live deployment

## Testing

```bash
pnpm test                          # 35 unit tests (URN, crypto, serializers, bulk batch)
pnpm typecheck                     # TypeScript strict
MCP_URL=… MCP_TOKEN=… pnpm test tests/smoke/   # 76 end-to-end smoke tests
```

## Out of scope

The following LinkedIn products are **not** covered by this MCP. They require separate LinkedIn API approvals (Community Management API, Lead Sync, Matched Audiences, Conversions API, Audience Insights, Media Planning, Event Management). This server focuses purely on the Advertising API (Standard tier).

- Matched Audiences (DMP segments, website retargeting)
- Lead Sync from Lead Gen Forms → CRM
- Conversions API (server-side event tracking)
- Event Management APIs
- Community Management — note this blocks programmatic image/video upload; see `docs/TOOLS.md` for the limitation and workarounds
- Multi-tenant mode (one deployment = one LinkedIn member, which already covers N Ad Accounts via Campaign Manager invitations)

## Contributing

Pull requests welcome. Before submitting:

1. `pnpm typecheck` must pass
2. `pnpm test` (unit tests) must pass
3. Add a smoke test if you add a new tool or change input/output shape
4. Follow the existing code style (run `pnpm format` if configured)

## License

MIT. See [`LICENSE`](LICENSE).
