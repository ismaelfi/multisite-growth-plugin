import test from "node:test";
import assert from "node:assert/strict";

import { buildAuthorization, redirectUri, searchConsoleReport } from "../lib/gsc.js";

test("authorization uses the exact loopback callback and PKCE", () => {
  const url = new URL(
    buildAuthorization(
      { clientId: "123.apps.googleusercontent.com" },
      { origin: "http://127.0.0.1:54181", state: "state-1", verifier: "verifier-1" },
    ),
  );
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "123.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri("http://127.0.0.1:54181"));
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:54181/portfolio/api/google/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.match(url.searchParams.get("scope"), /webmasters\.readonly/u);
});

test("Search Console report maps properties and keeps previous-period deltas", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith("/sites")) {
      return new Response(JSON.stringify({ siteEntry: [{ siteUrl: "sc-domain:example.com" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("searchAnalytics/query")) {
      const body = JSON.parse(options.body);
      const current = body.startDate >= "2026-10-03";
      return new Response(
        JSON.stringify({ rows: [{ clicks: current ? 100 : 80, impressions: current ? 1000 : 900, ctr: current ? 0.1 : 0.08, position: current ? 8 : 9 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };
  try {
    const report = await searchConsoleReport(
      [
        { id: "example", domain: "example.com" },
        { id: "other", domain: "other.com" },
      ],
      { clientId: "client", clientSecret: "secret" },
      { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000, email: "me@example.com" },
      { days: 28, onTokens: () => {}, now: new Date("2026-11-02T12:00:00Z") },
    );
    assert.equal(report.connected, true);
    assert.equal(report.properties, 1);
    assert.equal(report.sites.example.status, "ok");
    assert.equal(report.sites.example.property, "sc-domain:example.com");
    assert.equal(report.sites.example.clicks, 100);
    assert.equal(report.sites.example.previousClicks, 80);
    assert.equal(report.sites.example.clickDeltaPct, 25);
    assert.equal(report.sites.other.status, "no_property");
    assert.ok(calls.some((url) => url.includes("sc-domain%3Aexample.com")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
