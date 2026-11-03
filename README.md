# Multisite Growth Plugin

A local-first website growth workspace for Codex. Open Website Growth from the native app sidebar on hosts supporting OpenAI MCP entrypoints, or use the browser dashboard and chat tools. Track homepage SEO/GEO readiness, Search Console performance, research evidence and verified issues across multiple websites.

**MIT licensed. No hosted backend required. Your portfolio stays on your machine.**

## What it does

- Portfolio dashboard with search, filters, site details and a persistent issue ledger.
- Live homepage, robots.txt, sitemap and llms.txt observations.
- Search Console traffic and comparison periods through your Treg team connection.
- Treg-assisted keyword, backlink and AI-visibility research through the existing Treg tools or CLI.
- Evidence records with source, collection time, measurement type, market, prompt/model and returned cost where available.
- Issue attempts, snoozing, ignoring, reopening and verification against the specific finding.
- Optional one-time import from a local DSH Portfolio installation.

## Install

Requires Node.js **22.13+**, npm and a current Codex desktop/CLI version supporting portable plugins. The dashboard launcher currently targets macOS and Linux.

```sh
git clone https://github.com/ismaelfi/multisite-growth-plugin.git
cd multisite-growth-plugin
npm ci
codex plugin marketplace add .
codex plugin add website-growth@multisite-growth
```

Install dependencies in the clone before adding the plugin; plugin installation does not run npm for you. Open a new Codex chat and select **Website Growth**. The repository is named `multisite-growth-plugin`; the stable plugin ID is `website-growth`.

Try: “Open my website growth dashboard”, “Review my website portfolio”, or “Use Treg to research AI visibility for this website and save the evidence.” New installations start with an empty portfolio; add websites in the dashboard or through chat.

## Native sidebar app

The plugin advertises a **Website Growth** global sidebar entry and a conversation-panel entry using the documented [OpenAI MCP UI entrypoints](https://developers.openai.com/plugins/build/extensions). The `portfolio_app` tool serves a bundled `text/html;profile=mcp-app` resource. Its UI calls the portfolio tools over MCP; it does not start or fetch a localhost web server.

Reload your desktop app after installing/upgrading so it can rediscover plugin entrypoints. Availability depends on the host and its support for local MCP app entrypoints. For this marketplace install, the documented desktop deep link is:

```text
codex://plugins/website-growth@multisite-growth/app/portfolio_app
```

Existing personal installations may use a different marketplace name in that link. Headless hosts can continue using the same tools without the app UI. The browser dashboard below remains available.

## Browser dashboard

Ask Codex to call `portfolio_dashboard` and open the returned loopback URL in its browser panel. This is a local web UI in the app browser, not a native sidebar extension. The MCP-started dashboard runs while its MCP process remains active.

For a persistent terminal session:

```sh
npm run dashboard
```

Open the printed URL (default `http://127.0.0.1:54182/`) in Codex's browser panel or an ordinary browser. Use `WEBSITE_GROWTH_PORT` to choose another port. The dashboard binds only to loopback, rejects cross-origin API access and requires same-origin JSON writes. Do not expose it through a public tunnel or proxy: it intentionally has no remote authentication.

## Data and Treg

By default, data lives at `$XDG_DATA_HOME/website-growth`, or `~/.local/share/website-growth`. Override `WEBSITE_GROWTH_DATA_DIR`, or create an untracked `local-config.json` in the plugin directory containing an absolute `dataDir` path. Data stays outside the plugin package and survives plugin reinstalls. Keep the same override when launching the dashboard and MCP server so they use the same portfolio.

Treg is optional for public-page checks. For Search Console, install/sign in to the Treg CLI and connect a team Search Console tool. The plugin uses that existing connection without reading the token. The present bridge recognizes tool names `google-search-console` through `google-search-console-6`. If your tool has a different name, adjust `GSC_TOOLS` in `lib/treg.js`.

Paid keyword, backlink and AI-visibility research uses the separately connected Treg catalog tools or CLI, guided by the bundled skill. No paid catalog research runs on dashboard load or a technical refresh. Missing Search Console access remains missing data, not zero traffic.

The 13 MCP tools cover overview, native app, browser dashboard, cached report, refresh, site edits, GSC details, issue list/details/actions, evidence list/record and Treg connection status. Use `node scripts/cli.mjs overview` for the CLI fallback.

## Import DSH Portfolio

With Python 3 available:

```sh
python3 scripts/import-dsh.py --source /path/to/dsh/portfolio --destination /path/to/new/growth-data
```

Then point `WEBSITE_GROWTH_DATA_DIR` to the destination. The importer refuses an existing destination, takes a consistent SQLite backup including committed WAL history, copies the curated sites and cached report, and excludes `secrets.json` and OAuth client credentials. It records migration provenance. The import is a snapshot; subsequent DSH changes do not sync. DSH session IDs remain historical references, not Codex chat links.

## Measurement limits

- Homepage and standard-file checks are not a sitewide audit or a rankings model.
- The inherited GEO score is a heuristic checklist. It does not predict AI citations; sampled answers and mentions are separate research evidence.
- FAQ markup, llms.txt and crawler policies require site-specific judgment. Training crawler access is different from search access.
- Single-site refreshes preserve other observations and mark portfolio aggregates stale until a full refresh.
- Percentage growth from a zero baseline is undefined, not a 100% gain.
- Only the current highest-priority finding per site is added during a scan. The ledger retains older findings until passing evidence resolves them.
- Paid research costs can be recorded; the plugin is not a billing reconciliation system or an enforced monthly spending limit.
- No scheduling, automatic code edits, deployments, publishing or outreach is enabled.

## Develop

```sh
npm ci
npm test
npm run build:ui
npm run dashboard
```

Tests cover HTML/robots/JSON-LD parsing, GSC periods, issue transitions, verification, SQLite migration, MCP protocol/tool flows and dashboard access boundaries. CI runs the test suite on Node 22 and 24. The browser UI uses packaged HTML/CSS/JavaScript with no external assets or build step. The native MCP app reuses that UI with an MCP transport adapter; its committed HTML bundle is rebuilt with `npm run build:ui` (also run before tests).

Do not commit `local-config.json`, data directories, databases, report snapshots, evidence or credentials. The release exporter copies an explicit application-code allowlist. See [PROVENANCE.md](PROVENANCE.md) and [LICENSE](LICENSE).
