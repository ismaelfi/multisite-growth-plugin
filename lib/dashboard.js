import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { overview, cachedReport, listIssues, issueDetail, issueAction, refresh, upsertSite, readEvidence } from './portfolio.js';

const siteSchema = z.object({id:z.string().min(1).max(64).optional(),name:z.string().min(1).max(80).optional(),domain:z.string().min(1).max(300),path:z.string().max(500).optional(),tags:z.array(z.string().max(24)).max(6).optional()}).strict();
const actionSchema = z.object({action:z.enum(['ignore','reopen','snooze','verify']),hours:z.number().positive().max(720).optional()}).strict();
const refreshSchema = z.object({siteId:z.string().min(1).max(64).optional()}).strict();
function json(response,status,body) {
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify(body));
}
async function body(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32000) throw Object.assign(new Error('Request too large'),{status:413});
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createDashboard() {
  // Read the packaged assets only. Website/issue text is rendered with textContent.
  const assets = new Map([
    ['/', ['text/html; charset=utf-8',readFileSync(new URL('../ui/index.html',import.meta.url))]],
    ['/app.js', ['text/javascript; charset=utf-8',readFileSync(new URL('../ui/app.js',import.meta.url))]],
    ['/style.css', ['text/css; charset=utf-8',readFileSync(new URL('../ui/style.css',import.meta.url))]]
  ]);
  return createServer(async (request,response) => {
    try {
      const host = request.headers.host ?? '';
      const expected = `127.0.0.1:${request.socket.localPort}`;
      if (host !== expected) return json(response,403,{error:'Unexpected host'});
      const origin = request.headers.origin;
      const fetchSite = request.headers['sec-fetch-site'];
      if ((origin && origin !== `http://${expected}`) || (fetchSite && !['same-origin','none'].includes(fetchSite))) return json(response,403,{error:'Cross-origin access refused'});
      const url = new URL(request.url,'http://'+expected);
      if (request.method === 'GET') {
        const asset = assets.get(url.pathname);
        if (asset) {
          response.writeHead(200,{'content-type':asset[0],'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
          return response.end(asset[1]);
        }
        if (url.pathname === '/api/portfolio') return json(response,200,{overview:overview(),...cachedReport(),issues:listIssues({limit:500})});
        const issueMatch = /^\/api\/issues\/(iss_[a-z0-9]+)$/.exec(url.pathname);
        if (issueMatch) return json(response,200,issueDetail(issueMatch[1]));
        const evidenceMatch = /^\/api\/evidence\/([a-z0-9-]+)$/.exec(url.pathname);
        if (evidenceMatch) return json(response,200,readEvidence(evidenceMatch[1]));
      }
      if (request.method === 'POST') {
        // A custom header blocks cross-origin simple requests; no CORS is enabled.
        if (request.headers['x-website-growth'] !== 'dashboard' || !request.headers['content-type']?.startsWith('application/json')) return json(response,403,{error:'Dashboard JSON request required'});
        if (url.pathname === '/api/refresh') return json(response,200,await refresh(refreshSchema.parse(await body(request)).siteId));
        if (url.pathname === '/api/sites') return json(response,200,await upsertSite(siteSchema.parse(await body(request))));
        const issueMatch = /^\/api\/issues\/(iss_[a-z0-9]+)$/.exec(url.pathname);
        if (issueMatch) {
          const input = actionSchema.parse(await body(request));
          return json(response,200,await issueAction(issueMatch[1],input.action,input));
        }
      }
      json(response,404,{error:'Not found'});
    } catch (error) {json(response,error.status ?? (error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500),{error:error.message});}
  });
}

export async function startDashboard(port = 54182) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid dashboard port');
  const server = createDashboard();
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
