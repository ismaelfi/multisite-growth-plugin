---
name: website-growth
description: Manage the user's curated multi-website growth portfolio, review SEO and GEO evidence, investigate changes, and track the local issue backlog. Use for portfolio growth reviews and follow-up work on these websites.
---

# Website Growth

Use the plugin's portfolio tools to read the curated sites and their cached evidence. This is a local port of DSH Portfolio, independent of the DSH process. Read `portfolio_overview` first to discover the sites, data directory, cache age, and migration state; do not ask the user to list sites already present.

## Visual dashboard

For native UI on supported hosts, use `portfolio_app`, which declares global and conversation entrypoints. It renders the portfolio through the MCP Apps bridge, without starting a web server. Do not claim the sidebar is visibly present unless you can observe it. Hosts may need plugin rediscovery after upgrades.

For the browser fallback, call `portfolio_dashboard`, then open the returned loopback URL with the Codex `open_in_codex` browser target when available. This is a local web dashboard inside the app browser panel, not a custom native sidebar. If the tool is not loaded, run `npm run dashboard` from the plugin folder and open the printed URL. Dashboard buttons update the same local ledger; no paid research runs on page load.

## Portfolio review

Read `portfolio_report` and `issues_list`. State the report date and whether a partial refresh made portfolio aggregates stale. Use `portfolio_refresh` for fresh public-page and Search Console data when the task needs it. A single-site refresh preserves other cached sites; their observations retain their own dates.

Prioritize business impact using measured traffic and conversion evidence where available. A technical failure or checklist score alone does not establish revenue impact. Do not call absent GSC access zero traffic. The scan covers the homepage and standard files, not the entire website. The legacy GEO score is a heuristic readiness checklist; it does not measure visibility in AI answers. `llms.txt`, question headings and FAQ schema are suggestions to evaluate for the site, not universal requirements or proven ranking factors. AI training crawler policies are distinct from search access; do not change crawler permissions merely to raise a score.

## Treg research

Use the connected Treg catalog tools, or the local `treg` CLI if needed. Discover capabilities with `catalog_search`, inspect parameters and current price with `catalog_get`, then call the selected endpoint. Follow the available Treg skill for current call conventions and cost handling. Avoid repeating paid calls when current stored evidence answers the request. If a connector is unavailable, check `treg_connection_status` and use the CLI; do not copy tokens.

Use real SERPs, keyword data, backlinks and AI mentions/citations as the question requires. Keep these evidence types separate:

- **Measured:** first-party Search Console/analytics results for a stated period.
- **Estimated:** provider keyword volumes or modeled metrics.
- **Sampled:** AI answers, mentions and citations for particular prompts/models/markets.
- **Heuristic:** page readiness checks and recommendations.

After research, use `evidence_record` to save a compact finding with source, actual collection time, market/language, measurement type, supporting URLs, and endpoint/call ID and cost when returned. For AI probes also retain the prompt and model when known. Do not invent missing provider metadata or claim sampled AI answers represent all users. Never store credentials in evidence. No paid research runs automatically on startup or while reading cached reports.

## Follow-through

Read `issue_detail` before acting on a finding. Imported DSH session/workspace IDs remain historical references and must not be used as Codex chat IDs. `issue_update` records local state; it never creates or messages chats. It does not authorize publishing, deployments, advertising spend or outreach.

When the user requests a fix, inspect the linked site's actual repository instructions and evidence, implement within the authorized scope, and run appropriate checks. Use `issue_update` with `attempt` to record work and an actual Codex chat ID only when known. Verify with `issue_update` action `verify`; a finding is fixed only when its specific check passes. If the live site still has the old deployment, distinguish a local fix from live verification.

## CLI fallback

If plugin tools have not loaded into this chat yet, run `node scripts/cli.mjs` from this plugin's root (two directories above this skill folder). Commands: `overview`, `report [siteId]`, `refresh [siteId]`, `issues [siteId]`, `issue <issueId> [verify|ignore|reopen|snooze]`, `gsc <siteId>`, `treg`, `evidence <siteId>`, `save-evidence <json-file>`. Paths passed to the CLI must be shell-quoted; use JSON files for structured evidence. `local-config.json` points to the external private data directory, which is not bundled into the plugin cache.
