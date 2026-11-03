import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { percentageChange } from './metrics.js';
import { dataDir, ensureDataDir, loadConfig, loadCache, loadSecrets, saveCache, saveConfig, normalizeSite } from './config.js';
import { attachIssues, listIssues, issueSummary, issueDetail, getIssue, ignoreIssue, snoozeIssue, reopenIssue, recordAttempt, recordVerification } from './db.js';
import { buildReport } from './report.js';
import { findingResolved } from './verification.js';
import { pathScope } from './scope.js';
import { tregStatus, tregSiteDetails } from './treg.js';

export function siteById(id) {
  const site = loadConfig().sites.find(site => site.id === id);
  if (!site) throw new Error(`Unknown site: ${id}`);
  return site;
}

export function overview() {
  const config = loadConfig();
  const cache = loadCache();
  const migrationPath = join(dataDir(), 'migration.json');
  return { dataDir: dataDir(), days: config.days, sites: config.sites,
    cachedReportAt: cache?.report?.generatedAt ?? null,
    cacheAgeHours: cache ? Math.round((Date.now()-Date.parse(cache.savedAt ?? cache.report.generatedAt))/360000)/10 : null,
    issues: issueSummary(),
    migration: existsSync(migrationPath) ? JSON.parse(readFileSync(migrationPath, 'utf8')) : null,
    limits: ['Homepage and standard-file checks only.', 'SEO/GEO scores are heuristic readiness checks, not measured rankings or AI visibility.', 'Imported DSH session links are historical.', 'No publishing, deployment, or automatic paid research.'] };
}

export function cachedReport(siteId) {
  if (siteId) siteById(siteId);
  const cache = loadCache();
  if (!cache) return { report: null, message: 'No cached report. Run a refresh.' };
  const report = attachIssues(cache.report);
  for (const site of report.sites) {
    if (site.gsc?.status === "ok") site.gsc.clickDeltaPct = percentageChange(site.gsc.clicks, site.gsc.previousClicks);
  }
  if (siteId) {
    return { generatedAt: report.generatedAt, cached: true, site: report.sites.find(site => site.id === siteId) ?? null };
  }
  return { report, cached: true };
}

// Serialize operations within a server; refuse concurrent writers across chats/processes.
import { openSync, closeSync, unlinkSync } from 'node:fs';
export async function withWriteLock(fn) {
  ensureDataDir();
  const lock = join(dataDir(), '.write.lock');
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another portfolio write is running. Retry after it completes. If a process crashed, inspect .write.lock before removing it.'); throw error; }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await fn(); }
  finally { closeSync(fd); unlinkSync(lock); }
}

export async function refresh(siteId) {
  if (siteId) siteById(siteId);
  return withWriteLock(async () => {
    const config = loadConfig();
    const old = loadCache()?.report;
    const report = await buildReport(config, loadSecrets(), { siteId });
    if (!siteId) saveCache(report);
    else if (old) {
      // Preserve other sites and their timestamps; portfolio aggregates are stale.
      const merged = { ...old, sites: old.sites.filter(site => site.id !== siteId).concat(report.sites),
        partialRefreshAt: report.generatedAt, aggregatesStale: true };
      saveCache(merged);
    } else saveCache({ ...report, partial: true });
    return { report: attachIssues(report), refreshedSiteId: siteId ?? null };
  });
}

export async function gscDetails(siteId) {
  const site = siteById(siteId);
  const status = await tregStatus();
  if (!status.signedIn) throw new Error('Treg CLI is not signed in. Connect Treg or use the available Treg connector.');
  const details = await tregSiteDetails({ ...site, url: `https://${site.domain}/` }, loadConfig().days, status);
  return { siteId, fetchedAt: new Date().toISOString(), details };
}

export async function upsertSite(input) {
  return withWriteLock(() => {
    const config = loadConfig();
    const index = input.id ? config.sites.findIndex(site => site.id === input.id) : -1;
    if (input.id && index < 0) throw new Error('Unknown site ID; omit id to add a site.');
    if (index < 0 && config.sites.length >= 60) throw new Error('Portfolio is limited to 60 sites.');
    const current = index >= 0 ? config.sites[index] : {};
    const site = normalizeSite({ ...current, ...input }, new Set(config.sites.filter((_,i) => i !== index).map(site => site.id)));
    if (input.domain && !site.domain) throw new Error('Invalid domain.');
    if (index >= 0) config.sites[index] = site;
    else config.sites.push(site);
    saveConfig(config);
    return { site, cacheNeedsRefresh: true };
  });
}

export async function issueAction(id, action, options = {}) {
  const issue = getIssue(id);
  if (!issue) throw new Error(`Unknown issue: ${id}`);
  if (action === 'verify') {
    const result = await refresh(issue.siteId);
    const site = result.report.sites.find(site => site.id === issue.siteId);
    const fixed = findingResolved(site, issue.key);
    if (!fixed) return { fixed: false, message: 'No passing evidence for this specific finding; status retained.', detail: issueDetail(id) };
    return withWriteLock(() => ({ fixed: true, issue: recordVerification(id, true, 'Specific finding passed a live re-scan.') }));
  }
  return withWriteLock(() => {
    if (action === 'ignore') return ignoreIssue(id);
    if (action === 'reopen') return reopenIssue(id);
    if (action === 'snooze') {
      const hours = options.hours ?? 24;
      if (!Number.isFinite(hours) || hours <= 0 || hours > 720) throw new Error('hours must be between 0 and 720.');
      return snoozeIssue(id, hours);
    }
    if (action === 'attempt') {
      const scope = pathScope(siteById(issue.siteId).path);
      if (!scope.allowed) throw new Error(scope.reason);
      return recordAttempt(id, { sessionId: options.chatId ?? '', prompt: options.note ?? '' });
    }
    throw new Error(`Unknown issue action: ${action}`);
  });
}

export function readEvidence(siteId) {
  siteById(siteId);
  const path = join(dataDir(), 'evidence.json');
  const rows = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  return rows.filter(row => row.siteId === siteId);
}

export async function saveEvidence(input) {
  siteById(input.siteId);
  if (!['measured', 'estimated', 'sampled', 'heuristic'].includes(input.measurementType)) throw new Error('Invalid measurementType.');
  if (!input.source || !input.summary || !input.collectedAt || !Number.isFinite(Date.parse(input.collectedAt))) throw new Error('source, summary, and an ISO collectedAt timestamp are required.');
  if (Number.isNaN(input.costUsd) || input.costUsd < 0) throw new Error('Invalid cost.');
  return withWriteLock(() => {
    const path = join(dataDir(), 'evidence.json');
    const rows = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    const row = { ...input, id: randomUUID(), recordedAt: new Date().toISOString() };
    rows.push(row);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(rows,null,2)+'\n', {mode:0o600});
    renameSync(temp, path);
    return row;
  });
}

export { listIssues, issueDetail, tregStatus };
