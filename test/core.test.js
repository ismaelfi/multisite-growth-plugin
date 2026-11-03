import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDomain, normalizeSites } from "../lib/config.js";
import { dateWindows, matchProperty } from "../lib/gsc.js";
import { analyzeHtml, analyzeRobots, scoreGeo, scoreSeo } from "../lib/scan.js";
import { nextActionFor } from "../lib/report.js";

test("normalizeDomain strips scheme, path, www and port", () => {
  assert.equal(normalizeDomain("https://www.Example.com/about?x=1"), "www.example.com");
  assert.equal(normalizeDomain("example.com:8443"), "example.com");
  assert.equal(normalizeDomain("not a domain"), "");
});

test("normalizeSites keeps ids stable and unique", () => {
  const sites = normalizeSites([
    { id: "example-com", name: "example.com", domain: "https://www.example.com/" },
    { name: "example.com", domain: "example.com" },
    { name: "no domain" },
  ]);
  assert.equal(sites[0].id, "example-com");
  assert.equal(sites[0].domain, "www.example.com");
  assert.equal(sites[1].id, "example-com-2");
  assert.equal(sites[2].domain, "");
});

test("Search Console windows end three days ago", () => {
  const windows = dateWindows(28, new Date("2026-11-02T10:00:00Z"));
  assert.deepEqual(windows.current, { startDate: "2026-10-03", endDate: "2026-10-30" });
  assert.deepEqual(windows.previous, { startDate: "2026-09-05", endDate: "2026-10-02" });
});

test("property matching prefers sc-domain and ignores www", () => {
  const properties = ["https://www.example.com/", "https://example.com/", "sc-domain:example.com", "sc-domain:other.com"];
  assert.equal(matchProperty("www.example.com", properties), "sc-domain:example.com");
  assert.equal(matchProperty("example.com", ["https://www.example.com/", "https://example.com/"]), "https://example.com/");
  assert.equal(matchProperty("example.com", ["sc-domain:other.com"]), null);
});

test("robots policy is case-insensitive and respects specific groups", () => {
  const policy = analyzeRobots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n");
  assert.deepEqual(policy.blocked, ["GPTBot"]);
  assert.equal(policy.bots.PerplexityBot, "allowed");
  const open = analyzeRobots("User-agent: *\nDisallow: /admin\n");
  assert.deepEqual(open.blocked, []);
});

test("HTML analysis finds the evidence and scores it", () => {
  const html = `<!doctype html><html lang="en"><head>
    <title>A clear, useful title for the page</title>
    <meta name="description" content="A description long enough to explain exactly what this page answers to a visitor, in one extractable sentence.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="Example">
    <meta property="og:image" content="https://example.com/og.png">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is this?"}]}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","sameAs":["https://x.com/example","https://github.com/example"]}</script>
  </head><body><h1>Example</h1><h2>What does it do?</h2><h2>Who is it for?</h2>
    <p>${"word ".repeat(120)}</p><img src="a.jpg" alt="A real description">
    <a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="https://other.com">Out</a>
  </body></html>`;
  const facts = analyzeHtml(html, "https://example.com/");
  assert.equal(facts.titleLength, 34);
  assert.equal(facts.h1Count, 1);
  assert.equal(facts.questionHeadings, 2);
  assert.equal(facts.hasFaqSchema, true);
  assert.equal(facts.hasEntitySchema, true);
  assert.equal(facts.sameAs, 2);
  assert.equal(facts.internalLinks, 3);
  assert.equal(facts.externalLinks, 1);
  const extras = {
    sitemap: { ok: true, url: "https://example.com/sitemap.xml" },
    llms: { ok: true, url: "https://example.com/llms.txt" },
    robots: { ok: true, url: "https://example.com/robots.txt" },
    robotsPolicy: { blocked: [] },
  };
  const seo = scoreSeo(facts, extras);
  const geo = scoreGeo(facts, extras);
  assert.ok(seo.score >= 80, `seo ${seo.score}`);
  assert.ok(geo.score >= 80, `geo ${geo.score}`);
  assert.ok(seo.checks.some((check) => check.id === "schema" && check.status === "pass"));
});

test("a missing page never invents a score", () => {
  const seo = scoreSeo(analyzeHtml("", "https://example.com/"), {
    sitemap: { ok: false, url: "" },
    llms: { ok: false, url: "" },
    robots: { ok: false, url: "" },
    robotsPolicy: { blocked: [] },
  });
  assert.ok(seo.score < 40);
});

test("next action prioritizes an unreachable site", () => {
  const action = nextActionFor(
    { id: "a", name: "A", domain: "a.com" },
    { reachable: false, error: "fetch failed" },
    null,
    { status: "not_connected" },
    { connected: false },
  );
  assert.equal(action.severity, "critical");
  assert.match(action.label, /did not respond/u);
});
