# Chernivtsi City MCP

Public, read-only MCP server for Chernivtsi, Ukraine, deployed on Cloudflare Workers.

- MCP endpoint: `https://chernivtsi-city-mcp.hackaton-scope-creep.workers.dev/mcp`
- Health: `https://chernivtsi-city-mcp.hackaton-scope-creep.workers.dev/health`
- Protocol: MCP `2026-07-28`, stateless Streamable HTTP, with legacy-client fallback.
- Stack: Cloudflare Workers, D1, Cache API, `agents/mcp/server`, `@modelcontextprotocol/server` v2, Zod 4.

The deployed server does **not** use Vercel AI SDK. AI SDK is an MCP client/agent toolkit; this project is an MCP server. An AI SDK client can be added later without changing the server.

## What it covers

- Official Chernivtsi announcements, anonsy, news, and council documents.
- Upcoming events from the official city Telegram channel, Karabas, Concert.ua, and city fairs.
- Chernivtsi open-data catalog and resource metadata.
- Geoportal dataset export/preview (schools, kindergartens, healthcare, housing, land leases, etc.).
- Addresses, places, nearest places, driving/walking routes, and public-transport route candidates.
- Communal building leases, land leases, arrears, housing accounts, tariffs, and road/construction projects.
- Dataset/catalog search over the bundled HelloData snapshot.

The server is read-only. It does not pay taxes, file documents, or buy tickets. It links to official sources instead.

## Connect

Claude Code / other Streamable HTTP MCP clients:

```sh
claude mcp add --transport http chernivtsi \
  https://chernivtsi-city-mcp.hackaton-scope-creep.workers.dev/mcp
```

Or use the URL directly in an MCP client:

```text
https://chernivtsi-city-mcp.hackaton-scope-creep.workers.dev/mcp
```

## Example prompts

- "What did the Chernivtsi city council announce in the last week?"
- "I want to travel to Chernivtsi on 5 November — are there any events?"
- "What road should I take from Головна 100 to Руська 1?"
- "Which bus or trolleybus routes connect Головна and Руська?"
- "Find schools near Головна 100."
- "Which communal leases have the largest arrears?"
- "What is the current heat tariff for households in Chernivtsi?"
- "Find the dataset about parking fines."

## Tools

| Tool | Purpose |
| --- | --- |
| `city_announcements_list` | List/search official announcements; supports `since` |
| `city_announcement_get` | Full announcement text, date, attachments |
| `city_news_list` | List/search official news |
| `city_events_search` | Upcoming events, date/venue/proximity filters |
| `city_event_get` | One event by URL |
| `city_documents_search` | Council decisions, draft decisions, mayor orders |
| `city_page_get` | Allowlisted city service/tax/transport/contact pages |
| `opendata_search` | CKAN catalog search (local fallback) |
| `opendata_dataset_get` | Dataset metadata and resources (local fallback) |
| `opendata_resource_preview` | CSV/JSON preview with local fallback note |
| `geoportal_datasets` | List geoportal datasets |
| `geoportal_preview` | Export/preview geoportal CSV on demand |
| `catalog_search` | Search the bundled dataset catalog |
| `catalog_dataset_get` | One catalog dataset and its resources |
| `address_search` | Address register lookup with coordinates |
| `place_search` | Schools, clinics, culture, parks, waste, shelters, etc. |
| `travel_route` | Driving or walking route with turn-by-turn steps |
| `transit_candidates` | Route-level bus/trolleybus candidates |
| `transit_routes_search` | Search route numbers, names, and stops |
| `nearby_search` | Nearby places and events |
| `leases_search` | Communal building leases |
| `lease_get` | One lease by id or contract |
| `arrears_ranking` | Arrears by anonymised tenant or street |
| `land_leases_search` | Communal land lease contracts |
| `housing_lookup` | Building manager, debt, recent housing accounts |
| `tariffs_search` | Communal tariffs |
| `budget_projects_search` | Road and construction projects |

Prompts: `chernivtsi_trip_brief`, `city_weekly_brief`.

## Data sources and refresh

| Source | Status from Workers | Strategy |
| --- | --- | --- |
| `t.me/ChernivtsiCityCouncil` | Accessible | Live official fallback for announcements/news/events |
| `city.cv.ua` | 403 from Cloudflare/datacenter IPs | Cached in D1; refresh locally with `scripts/sync_city.py` |
| `data.gov.ua` | 403 from Cloudflare | Bundled catalog + D1 data; refresh locally with `scripts/build_seed.py` |
| `map.city.cv.ua` | Accessible | Two-step CSV export reproduced on demand |
| `karabas.com`, `concert.ua` | Accessible | Live JSON-LD event adapters |
| OpenStreetMap / OSRM / Nominatim | Accessible | Live routing/geocoding with cache |

`city.cv.ua` and `data.gov.ua` block requests from Cloudflare Workers. The server therefore has a local-cache fallback:

```bash
python3 scripts/sync_city.py
npx wrangler d1 execute chernivtsi-city --remote --file=seed/city_sync.sql
```

Run this from a Ukrainian network. It refreshes cached service pages and recent/searchable council documents. The official Telegram channel is fetched live by the Worker, so announcements and events keep updating without a local sync.

## Local development

```bash
npm install
npm run seed:build          # reads ../HelloData by default; set HELLODATA_DIR to override
npm run seed:local          # local D1
npm run dev                 # http://localhost:8787/mcp
```

Tests and checks:

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

## Deployment

```bash
npx wrangler d1 create chernivtsi-city
# set database_id in wrangler.jsonc
npm run seed:build
npm run seed:remote
npx wrangler deploy
```

The D1 seed includes `finance_slim.sqlite` tables, the address register, places, transit routes/stops, fairs, and the dataset catalog. Individual tenants and sole proprietors are anonymised in derived tables.

## Privacy and safety

- Read-only tools only; no writes, payments, or purchases.
- Individual tenants are masked as `Фізична особа`.
- Every result carries source URLs and snapshot dates where available.
- Public endpoint; caching reduces upstream load. Add a Cloudflare rate-limiting rule for heavy use.

## Known limits

- Public-transport data is route/stop-level; there are no live vehicle positions or complete GTFS trips.
- `data.gov.ua` XLSX/XLS resources are not converted at runtime.
- `city.cv.ua` document search from the deployed Worker uses a local cache; run `scripts/sync_city.py` to refresh it.
- Routing uses public OpenStreetMap services and is an estimate, not a live traffic service.
