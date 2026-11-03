#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as portfolio from '../lib/portfolio.js';
import { startDashboard } from '../lib/dashboard.js';

const server = new McpServer({ name: 'website-growth', version: '0.2.0' });
const siteId = z.string().min(1).max(64);
let dashboard;
function tool(name, description, inputSchema, fn, readOnly = true, openWorld = false) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: openWorld } }, async args => {
    try {
      const value = await fn(args);
      return { content: [{type: 'text', text: JSON.stringify(value, null, 2)}] };
    } catch (error) {
      return { isError: true, content: [{type: 'text', text: error.message}] };
    }
  });
}
tool('portfolio_overview', 'List curated websites, local data location, import provenance, cache age and issue counts. Reads no credentials.', {}, () => portfolio.overview());
tool('portfolio_dashboard', 'Start the local visual dashboard and return its loopback URL. Open that URL in the Codex browser panel. No remote hosting or research calls.', {}, async () => {
  dashboard ??= startDashboard(0).catch(error => { dashboard = null; throw error; });
  const {url} = await dashboard;
  return {url,message:'Open this URL in the Codex browser panel. The server runs while this MCP process remains active.'};
}, false);
tool('portfolio_report', 'Read the cached homepage SEO/GEO readiness and Search Console report. Readiness scores are heuristic; preserve timestamps and missing data.', {siteId: siteId.optional()}, args => portfolio.cachedReport(args.siteId));
tool('portfolio_refresh', 'Fetch public homepage and standard files plus Search Console through the signed-in Treg CLI. Update only the local cache and issue ledger. No paid catalog research or website changes.', {siteId: siteId.optional()}, args => portfolio.refresh(args.siteId), false, true);
tool('site_upsert', 'Add a curated website, or update an existing site by ID. Omitted update fields are preserved. Does not scan or edit the website.', {
  id:siteId.optional(), name:z.string().min(1).max(80).optional(), domain:z.string().max(300).optional(),
  path:z.string().max(500).optional(), tags:z.array(z.string().max(24)).max(6).optional()
}, args => portfolio.upsertSite(args), false);
tool('site_gsc_details', 'Read top queries, pages, URL inspection and sitemaps through the Treg team Search Console connection. No paid catalog research.', {siteId}, args => portfolio.gscDetails(args.siteId), true, true);
tool('issues_list', 'Read the local issue backlog. Imported session IDs refer to DSH, not Codex chats.', {
  siteId:siteId.optional(), status:z.enum(['open','in_progress','snoozed','fixed','ignored','regressed','archived']).optional(), limit:z.number().int().min(1).max(500).default(100)
}, args => portfolio.listIssues(args));
tool('issue_detail', 'Read one issue and its attempts and event history.', {issueId:z.string()}, args => portfolio.issueDetail(args.issueId));
tool('issue_update', 'Snooze, ignore, reopen or record a local attempt; verify re-scans one site and requires the specific check to pass. Recording an attempt does not create or message any chat.', {
  issueId:z.string(), action:z.enum(['snooze','ignore','reopen','attempt','verify']), hours:z.number().positive().max(720).optional(), chatId:z.string().max(200).optional(), note:z.string().max(12000).optional()
}, args => portfolio.issueAction(args.issueId,args.action,args), false, true);
tool('evidence_list', 'Read research evidence, provenance and recorded API costs for a website.', {siteId}, args => portfolio.readEvidence(args.siteId));
tool('evidence_record', 'Save a compact research finding after obtaining real data. This tool makes no external API call. Never include secrets or tokens.', {
  siteId, source:z.string().min(1).max(500), collectedAt:z.string().datetime({offset:true}),
  measurementType:z.enum(['measured','estimated','sampled','heuristic']), summary:z.string().min(1).max(12000),
  country:z.string().max(100).optional(), language:z.string().max(100).optional(),
  sourceUrls:z.array(z.string().url()).max(50).optional(), endpointId:z.string().max(300).optional(),
  callId:z.string().max(300).optional(), costUsd:z.number().finite().nonnegative().optional(),
  prompt:z.string().max(4000).optional(), model:z.string().max(200).optional()
}, args => portfolio.saveEvidence(args), false);
tool('treg_connection_status', 'Check the signed-in local Treg CLI account, team and balance. Does not expose tokens or make paid research calls.', {}, () => portfolio.tregStatus({refresh:true}), true, true);
await server.connect(new StdioServerTransport());
server.server.onclose = async () => {if(dashboard)(await dashboard).server.close();};
