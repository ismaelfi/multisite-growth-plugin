import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "dsh-portfolio-test-"));
process.env.WEBSITE_GROWTH_DATA_DIR = join(home, "portfolio");
mkdirSync(join(home, "portfolio"), { recursive: true });
const db = await import("../lib/db.js");
const { syncIssues, attachIssues, listIssues, getIssue, issueDetail, recordAttempt, recordVerification, snoozeIssue, createBatch, getBatch, reopenIssue } = db;
const { pathScope } = await import("../lib/scope.js");

function reportWith(action) {
  const site = {
    id: "site-a",
    name: "A",
    domain: "a.com",
    path: "/Users/test/Sites/a",
    live: { reachable: true },
    nextAction: action,
  };
  return {
    stats: { needsAttention: 1, critical: 0 },
    needs: [{ siteId: "site-a", siteName: "A", domain: "a.com", severity: action?.severity ?? "warn", label: action?.label ?? "", detail: "", kind: action?.kind ?? "" }],
    sites: [site],
  };
}

const action = { key: "seo:title", kind: "seo", severity: "warn", label: "Fix title", detail: "No title" };

test("issues get stable identity, occurrences, fixed and regressed state", () => {
  const first = reportWith(action);
  syncIssues(first);
  attachIssues(first);
  assert.equal(first.sites[0].issue.status, "open");
  assert.equal(first.sites[0].issue.occurrences, 1);
  const id = first.sites[0].issue.id;

  const second = reportWith(action);
  syncIssues(second);
  attachIssues(second);
  assert.equal(second.sites[0].issue.id, id);
  assert.equal(second.sites[0].issue.occurrences, 2);

  const gone = reportWith({ key: "ok", kind: "none", severity: "ok", label: "", detail: "" });
  gone.sites[0].seo = { checks: [{ id: "title", status: "pass" }] };
  syncIssues(gone);
  assert.equal(getIssue(id).status, "fixed");

  const back = reportWith(action);
  syncIssues(back);
  attachIssues(back);
  assert.equal(back.sites[0].issue.status, "regressed");
});

test("attempts link to a session and verification records still present", () => {
  const id = listIssues({ status: "regressed" })[0].id;
  const attempt = recordAttempt(id, { sessionId: "session-1", workspaceId: "ws-1", prompt: "fix it" });
  assert.equal(attempt.issue.status, "in_progress");
  recordVerification(id, false, "still there");
  const detail = issueDetail(id);
  assert.equal(detail.issue.status, "open");
  assert.equal(detail.attempts[0].status, "still_present");
  assert.equal(detail.attempts[0].sessionId, "session-1");
  recordVerification(id, true, "verified after the fix");
  const fixed = issueDetail(id);
  assert.equal(fixed.issue.status, "fixed");
  assert.equal(fixed.attempts[0].status, "verified_fixed");
});

test("snoozing removes an issue from the needs queue until it is reopened", () => {
  const id = listIssues()[0].id;
  reopenIssue(id);
  snoozeIssue(id, 1);
  const report = reportWith(action);
  attachIssues(report);
  assert.equal(report.needs.length, 0);
  assert.equal(report.sites[0].issue.status, "snoozed");
});

test("batch records persist and estimate one session per site", () => {
  const ids = listIssues().filter((issue) => issue.status !== "fixed" && issue.status !== "ignored").map((issue) => issue.id);
  const batch = createBatch(ids);
  assert.ok(batch.id.startsWith("bat_"));
  assert.equal(batch.siteCount, 1);
  assert.equal(getBatch(batch.id).issues.length, ids.length);
});

test("path scope only allows the configured Sites root", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-sites-"));
  process.env.DSH_PORTFOLIO_ROOTS = root;
  const inside = join(root, "site");
  mkdirSync(inside);
  assert.equal(pathScope(inside).allowed, true);
  assert.equal(pathScope("/etc").allowed, false);
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
