/**
 * Local issue ledger: stable issue identity, attempts linked to DSH sessions,
 * verification results, and batch plans. SQLite lives beside the config in
 * ~/.dsh/portfolio/portfolio.db. Nothing here leaves the machine.
 */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureDataDir } from "./config.js";
import { join } from "node:path";
import { dataDir } from "./config.js";
import { findingResolved } from "./verification.js";

let database = null;
let failed = false;

function open() {
  if (database || failed) return database;
  try {
    ensureDataDir();
    database = new DatabaseSync(join(dataDir(), "portfolio.db"));
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        site_name TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT '',
        action_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        label TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        last_verified_at TEXT,
        occurrences INTEGER NOT NULL DEFAULT 1,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        workspace_id TEXT,
        snoozed_until TEXT,
        resolved_at TEXT,
        resolution TEXT,
        UNIQUE(site_id, action_key)
      );
      CREATE INDEX IF NOT EXISTS issues_status ON issues(status, severity, last_seen);
      CREATE INDEX IF NOT EXISTS issues_site ON issues(site_id);

      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        session_id TEXT,
        workspace_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        note TEXT,
        prompt TEXT
      );
      CREATE INDEX IF NOT EXISTS attempts_issue ON attempts(issue_id, started_at);
      CREATE INDEX IF NOT EXISTS attempts_session ON attempts(session_id);

      CREATE TABLE IF NOT EXISTS issue_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS events_issue ON issue_events(issue_id, id);

      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS batch_issues (
        batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        position INTEGER NOT NULL,
        PRIMARY KEY (batch_id, issue_id)
      );
    `);
    failed = false;
  } catch (error) {
    failed = true;
    console.warn("dsh-portfolio: sqlite unavailable; issue history disabled:", error?.message || error);
    database = null;
  }
  return database;
}

function now() {
  return new Date().toISOString();
}

/** @param {string} siteId @param {string} key */
export function issueIdFor(siteId, key) {
  return `iss_${createHash("sha256").update(`${siteId}\u0000${key}`).digest("hex").slice(0, 20)}`;
}

function publicIssue(row) {
  if (!row) return null;
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    domain: row.domain,
    key: row.action_key,
    kind: row.kind,
    severity: row.severity,
    label: row.label,
    detail: row.detail,
    status: row.status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastVerifiedAt: row.last_verified_at,
    occurrences: row.occurrences,
    attemptCount: row.attempt_count,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    snoozedUntil: row.snoozed_until,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

function event(db, issueId, type, detail = "") {
  db.prepare("INSERT INTO issue_events (issue_id, at, type, detail) VALUES (?, ?, ?, ?)").run(issueId, now(), type, detail);
}

/**
 * Merge one report into the ledger. Findings that disappeared from a reachable
 * site become fixed; a fixed finding that returns becomes regressed.
 * @param {any} report
 */
export function syncIssues(report) {
  const db = open();
  if (!db || !report?.sites) return;
  const nowIso = now();
  const seen = new Set();
  const reachable = new Set(report.sites.filter((site) => site.live?.reachable).map((site) => site.id));
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const site of report.sites) {
      const action = site.nextAction;
      if (!action?.key || action.key === "ok" || action.severity === "ok") continue;
      const id = issueIdFor(site.id, action.key);
      seen.add(id);
      const existing = db.prepare("SELECT * FROM issues WHERE id = ?").get(id);
      if (!existing) {
        db.prepare(
          `INSERT INTO issues (id, site_id, site_name, domain, action_key, kind, severity, label, detail, status, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).run(id, site.id, site.name, site.domain || "", action.key, action.kind, action.severity, action.label, action.detail || "", nowIso, nowIso);
        event(db, id, "opened", action.label);
        continue;
      }
      let status = existing.status;
      if (status === "fixed") status = "regressed";
      else if (status === "ignored") status = "ignored";
      else if (status === "snoozed" && existing.snoozed_until && existing.snoozed_until > nowIso) status = "snoozed";
      else if (status === "snoozed") status = "open";
      else if (status === "in_progress") status = "in_progress";
      else if (status === "regressed") status = "regressed";
      else status = "open";
      const resolvedAt = status === "fixed" || status === "regressed" ? null : existing.resolved_at;
      db.prepare(
        `UPDATE issues SET site_name = ?, domain = ?, kind = ?, severity = ?, label = ?, detail = ?, status = ?,
         last_seen = ?, last_verified_at = ?, occurrences = occurrences + 1, resolved_at = ? WHERE id = ?`,
      ).run(site.name, site.domain || "", action.kind, action.severity, action.label, action.detail || "", status, nowIso, nowIso, resolvedAt, id);
      if (existing.status === "fixed") event(db, id, "regressed", action.label);
      else if (existing.status === "snoozed" && status === "open") event(db, id, "reopened", "snooze expired");
    }
    // A finding is fixed only when its site was actually reachable in this scan;
    // an outage must not wipe out the site's other open findings.
    const open = db.prepare("SELECT id, site_id, status, action_key FROM issues WHERE status IN ('open','in_progress','snoozed','regressed')").all();
    for (const issue of open) {
      if (seen.has(issue.id) || !findingResolved(report.sites.find(site => site.id === issue.site_id), issue.action_key)) continue;
      db.prepare("UPDATE issues SET status = 'fixed', resolved_at = ?, resolution = ?, last_verified_at = ? WHERE id = ?").run(nowIso, "specific check passed in the latest scan", nowIso, issue.id);
      event(db, issue.id, "fixed", "specific check passed in the latest scan");
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may not have started.
    }
    console.warn("dsh-portfolio: issue sync failed:", error?.message || error);
  }
}

/**
 * Merge current issue state into a report for the UI and remove snoozed,
 * ignored, or fixed findings from the "needs you" queue.
 * @param {any} report
 */
export function attachIssues(report) {
  const db = open();
  if (!db || !report?.sites) return report;
  const rows = db.prepare("SELECT * FROM issues").all();
  const byKey = new Map(rows.map((row) => [`${row.site_id}\u0000${row.action_key}`, row]));
  const nowIso = now();
  const active = [];
  for (const site of report.sites) {
    const row = site.nextAction?.key ? byKey.get(`${site.id}\u0000${site.nextAction.key}`) : null;
    site.issue = publicIssue(row);
    if (!row) continue;
    const snoozed = row.status === "snoozed" && row.snoozed_until && row.snoozed_until > nowIso;
    if (row.status === "open" || row.status === "in_progress" || row.status === "regressed" || snoozed) active.push(publicIssue(row));
  }
  const bySite = new Map(rows.map((row) => [row.site_id, row]));
  report.needs = (report.needs ?? []).filter((need) => {
    const issue = bySite.get(need.siteId);
    return issue ? !["snoozed", "ignored", "fixed"].includes(issue.status) : true;
  });
  report.issues = active.sort((left, right) => (left.severity === right.severity ? left.lastSeen.localeCompare(right.lastSeen) : left.severity === "critical" ? -1 : 1));
  if (report.stats) {
    report.stats.needsAttention = report.needs.length;
    report.stats.critical = report.needs.filter((need) => need.severity === "critical").length;
    report.stats.openIssues = active.filter((issue) => issue.status !== "snoozed").length;
    report.stats.snoozed = active.filter((issue) => issue.status === "snoozed").length;
  }
  return report;
}

export function getIssue(id) {
  const db = open();
  if (!db) return null;
  return publicIssue(db.prepare("SELECT * FROM issues WHERE id = ?").get(id));
}

export function listIssues({ status, siteId, limit = 100 } = {}) {
  const db = open();
  if (!db) return [];
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (siteId) {
    where.push("site_id = ?");
    params.push(siteId);
  }
  const sql = `SELECT * FROM issues${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, last_seen DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map(publicIssue);
}

export function issueDetail(id) {
  const db = open();
  if (!db) return null;
  const issue = publicIssue(db.prepare("SELECT * FROM issues WHERE id = ?").get(id));
  if (!issue) return null;
  const attempts = db.prepare("SELECT * FROM attempts WHERE issue_id = ? ORDER BY started_at DESC LIMIT 20").all(id).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    note: row.note,
  }));
  const events = db.prepare("SELECT * FROM issue_events WHERE issue_id = ? ORDER BY id DESC LIMIT 40").all(id).map((row) => ({ at: row.at, type: row.type, detail: row.detail }));
  return { issue, attempts, events };
}

/** @param {string} issueId @param {{sessionId?: string, workspaceId?: string, prompt?: string}} input */
export function recordAttempt(issueId, { sessionId = "", workspaceId = "", prompt = "" } = {}) {
  const db = open();
  if (!db) return null;
  const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId);
  if (!issue) return null;
  const attempt = {
    id: `att_${randomUUID()}`,
    startedAt: now(),
    sessionId,
    workspaceId,
  };
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "INSERT INTO attempts (id, issue_id, session_id, workspace_id, status, started_at, prompt) VALUES (?, ?, ?, ?, 'opened', ?, ?)",
    ).run(attempt.id, issueId, sessionId, workspaceId, attempt.startedAt, prompt);
    db.prepare(
      "UPDATE issues SET status = 'in_progress', session_id = ?, workspace_id = ?, attempt_count = attempt_count + 1 WHERE id = ?",
    ).run(sessionId, workspaceId, issueId);
    event(db, issueId, "attempt", sessionId ? `session ${sessionId}` : "session not linked");
    db.exec("COMMIT");
    return { ...attempt, status: "opened", issue: publicIssue(db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId)) };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    console.warn("dsh-portfolio: attempt write failed:", error?.message || error);
    return null;
  }
}

/** @param {string} issueId @param {boolean} fixed @param {string} [note] */
export function recordVerification(issueId, fixed, note = "") {
  const db = open();
  if (!db) return null;
  const at = now();
  try {
    db.exec("BEGIN IMMEDIATE");
    const latest = db.prepare("SELECT * FROM attempts WHERE issue_id = ? ORDER BY started_at DESC LIMIT 1").get(issueId);
    if (latest && (latest.status === "opened" || latest.status === "still_present")) {
      db.prepare("UPDATE attempts SET status = ?, ended_at = ?, note = ? WHERE id = ?").run(fixed ? "verified_fixed" : "still_present", at, note, latest.id);
    }
    db.prepare("UPDATE issues SET last_verified_at = ?, status = ?, resolved_at = ?, resolution = ? WHERE id = ?").run(
      at,
      fixed ? "fixed" : "open",
      fixed ? at : null,
      fixed ? note || "verified by re-scan" : "still present after verification",
      issueId,
    );
    event(db, issueId, fixed ? "verified_fixed" : "still_present", note);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    console.warn("dsh-portfolio: verification write failed:", error?.message || error);
  }
  return getIssue(issueId);
}

/** @param {string} issueId @param {number} hours */
export function snoozeIssue(issueId, hours) {
  const db = open();
  if (!db) return null;
  const until = new Date(Date.now() + Math.max(1, hours) * 3_600_000).toISOString();
  db.prepare("UPDATE issues SET status = 'snoozed', snoozed_until = ? WHERE id = ?").run(until, issueId);
  event(db, issueId, "snoozed", `until ${until}`);
  return getIssue(issueId);
}

/** @param {string} issueId */
export function ignoreIssue(issueId) {
  const db = open();
  if (!db) return null;
  db.prepare("UPDATE issues SET status = 'ignored', snoozed_until = NULL WHERE id = ?").run(issueId);
  event(db, issueId, "ignored");
  return getIssue(issueId);
}

/** @param {string} issueId */
export function reopenIssue(issueId) {
  const db = open();
  if (!db) return null;
  db.prepare("UPDATE issues SET status = 'open', snoozed_until = NULL, resolved_at = NULL WHERE id = ?").run(issueId);
  event(db, issueId, "reopened", "manual");
  return getIssue(issueId);
}

/** @param {string[]} siteIds */
export function archiveIssuesForSites(siteIds) {
  const db = open();
  if (!db || siteIds.length === 0) return;
  const stmt = db.prepare("UPDATE issues SET status = 'ignored', resolution = ? WHERE site_id = ? AND status IN ('open','in_progress','snoozed','regressed')");
  for (const siteId of siteIds) stmt.run("site removed from the portfolio", siteId);
}

/** @param {string[]} issueIds */
export function createBatch(issueIds) {
  const db = open();
  if (!db) return null;
  const ids = [...new Set(issueIds)].filter(Boolean);
  if (ids.length === 0) return null;
  const issues = ids.map((id) => publicIssue(db.prepare("SELECT * FROM issues WHERE id = ?").get(id))).filter(Boolean);
  if (issues.length === 0) return null;
  const batch = { id: `bat_${randomUUID()}`, createdAt: now(), issueCount: issues.length, siteCount: new Set(issues.map((issue) => issue.siteId)).size };
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO batches (id, created_at, status) VALUES (?, ?, 'queued')").run(batch.id, batch.createdAt);
    issues.forEach((issue, index) => db.prepare("INSERT INTO batch_issues (batch_id, issue_id, position) VALUES (?, ?, ?)").run(batch.id, issue.id, index));
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    console.warn("dsh-portfolio: batch write failed:", error?.message || error);
    return null;
  }
  return { ...batch, estimatedMinutes: batch.issueCount * 4, issues };
}

/** @param {string} id */
export function getBatch(id) {
  const db = open();
  if (!db) return null;
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
  if (!batch) return null;
  const rows = db
    .prepare("SELECT bi.status AS batch_status, i.* FROM batch_issues bi JOIN issues i ON i.id = bi.issue_id WHERE bi.batch_id = ? ORDER BY bi.position")
    .all(id);
  return {
    id: batch.id,
    createdAt: batch.created_at,
    status: batch.status,
    estimatedMinutes: rows.length * 4,
    issues: rows.map((row) => ({ ...publicIssue(row), batchStatus: row.batch_status })),
  };
}

export function issueSummary() {
  const db = open();
  if (!db) return { open: 0, in_progress: 0, snoozed: 0, fixed: 0, ignored: 0, regressed: 0, total: 0 };
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM issues GROUP BY status").all();
  const summary = { open: 0, in_progress: 0, snoozed: 0, fixed: 0, ignored: 0, regressed: 0, total: 0 };
  for (const row of rows) {
    summary[row.status] = row.n;
    summary.total += row.n;
  }
  return summary;
}

export function recentAttempts(limit = 20) {
  const db = open();
  if (!db) return [];
  return db
    .prepare("SELECT a.*, i.site_name, i.label FROM attempts a JOIN issues i ON i.id = a.issue_id ORDER BY a.started_at DESC LIMIT ?")
    .all(limit)
    .map((row) => ({
      id: row.id,
      issueId: row.issue_id,
      siteName: row.site_name,
      label: row.label,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }));
}

export function closeDb() {
  try {
    database?.close();
  } catch {
    // ignore
  }
  database = null;
}
