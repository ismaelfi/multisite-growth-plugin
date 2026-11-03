/**
 * Compose the portfolio report: local evidence + live page checks + Search
 * Console, one row per curated site, and one next action for each.
 */
import { connectionView, saveSecrets } from "./config.js";
import { searchConsoleReport } from "./gsc.js";
import { tregSearchConsoleReport, tregStatus } from "./treg.js";
import { syncIssues } from "./db.js";
import { pathScope } from "./scope.js";
import { inspectLiveSite } from "./scan.js";
import { localFacts } from "./local.js";

/** @template T, R @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        results[index] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** @param {number|null} value */
function average(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** @param {string} severity @param {string} label @param {string} detail @param {string} kind */
function action(severity, label, detail, kind, key) {
  return { severity, label, detail, kind, key };
}

/**
 * One action, chosen from the strongest evidence available.
 * @param {any} site
 * @param {any} live
 * @param {any} local
 * @param {any} gsc
 * @param {{connected: boolean}} connection
 */
export function nextActionFor(site, live, local, gsc, connection) {
  if (!site.domain) {
    return action("warn", "Add the public domain", "The folder is linked, but there is no URL to inspect.", "edit", "setup:domain");
  }
  if (!live?.reachable) {
    return action("critical", "The live site did not respond", live?.error ? String(live.error).slice(0, 180) : "No response from the homepage.", "site", "site:unreachable");
  }
  if (gsc?.status === "no_property") {
    return action("warn", "No Search Console property for this domain", "The connected Search Console account cannot see a matching property.", "gsc", "gsc:no-property");
  }
  if (gsc?.status === "error" || gsc?.status === "no_access") {
    return action("warn", "Search Console could not be read", gsc.error ? String(gsc.error).slice(0, 180) : "The property is not readable by this grant.", "gsc", "gsc:read-error");
  }
  if (typeof gsc?.clickDeltaPct === "number" && gsc.previousClicks >= 20 && gsc.clickDeltaPct <= -20) {
    return action("critical", `Clicks are down ${Math.abs(gsc.clickDeltaPct)}%`, `${gsc.previousClicks} → ${gsc.clicks} clicks in the last ${gsc.days ?? 28} days.`, "gsc", "gsc:traffic-drop");
  }
  const seoFailures = (live.seo?.checks ?? []).filter((check) => check.status === "fail").sort((left, right) => right.weight - left.weight);
  const geoFailures = (live.geo?.checks ?? []).filter((check) => check.status === "fail").sort((left, right) => right.weight - left.weight);
  if (seoFailures.length > 0) {
    const first = seoFailures[0];
    return action(first.weight >= 8 ? "critical" : "warn", first.action, `${first.label}: ${first.detail}`, "seo", `seo:${first.id}`);
  }
  if (geoFailures.length > 0) {
    const first = geoFailures[0];
    return action("warn", first.action, `${first.label}: ${first.detail}`, "geo", `geo:${first.id}`);
  }
  if (local?.git?.dirty > 0) {
    return action("warn", `Review ${local.git.dirty} uncommitted file${local.git.dirty === 1 ? "" : "s"}`, `On ${local.git.branch} in this folder. A clean tree makes the next deploy predictable.`, "git", "git:dirty");
  }
  if (!connection.connected) {
    return action("ok", "Search Console not connected", "SEO and GEO are checked; demand is not measured.", "gsc", "gsc:not-connected");
  }
  if (!local?.exists) {
    return action("warn", "Link the project folder", "Live checks work, but local deploy and git evidence is missing.", "edit", "setup:folder");
  }
  return action("ok", "No urgent action", "The public checks pass and the local tree is clean.", "none", "ok");
}

/**
 * @param {ReturnType<import('./config.js').defaultConfig>} config
 * @param {ReturnType<import('./config.js').defaultSecrets>} secrets
 * @param {{ now?: Date, force?: boolean }} [options]
 */
export async function buildReport(config, secrets, options = {}) {
  const now = options.now ?? new Date();
  const days = config.days;
  const selectedSites = options.siteId ? config.sites.filter((site) => site.id === options.siteId) : config.sites;
  const oauth = connectionView(config, secrets);
  const clientId = config.google.clientId || process.env.WEBSITE_GROWTH_GOOGLE_CLIENT_ID || "";
  const clientSecret = secrets.google.clientSecret || process.env.WEBSITE_GROWTH_GOOGLE_CLIENT_SECRET || "";
  const tokens = secrets.google.tokens;
  const treg = await tregStatus();

  let gsc = { connected: false, provider: null, email: null, properties: 0, error: null, sites: {} };
  if (treg.signedIn) {
    try {
      gsc = await tregSearchConsoleReport(selectedSites, { days, status: treg, now });
    } catch (error) {
      gsc = {
        connected: false,
        provider: "treg",
        email: treg.account,
        team: treg.team,
        balanceUsd: treg.balanceUsd,
        properties: 0,
        error: error instanceof Error ? error.message : String(error),
        sites: {},
      };
    }
  }
  // OAuth is the fallback when treg is absent, signed out, or its GSC tool fails.
  if (!gsc.connected && oauth.connected && tokens) {
    try {
      gsc = await searchConsoleReport(selectedSites, { clientId, clientSecret }, tokens, {
        days,
        now,
        onTokens: (next) => {
          secrets.google.tokens = next;
          saveSecrets(secrets);
        },
      });
      gsc.provider = "oauth";
    } catch (error) {
      gsc = { connected: false, provider: "oauth", email: oauth.email, properties: 0, error: error instanceof Error ? error.message : String(error), sites: {} };
    }
  }
  const connection = { connected: Boolean(gsc.connected), provider: gsc.provider ?? null };

  const rows = await mapLimit(selectedSites, 4, async (site) => {
    let live = null;
    if (site.domain) {
      live = await inspectLiveSite(site.domain);
    }
    const local = site.path ? localFacts(site.path) : null;
    const siteGsc = gsc.sites?.[site.id] ?? {
      status: gsc.connected ? "no_property" : gsc.error ? "error" : "not_connected",
      error: gsc.error ?? null,
    };
    const nextAction = nextActionFor(site, live, local, siteGsc, connection);
    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      path: site.path,
      scope: pathScope(site.path),
      tags: site.tags,
      url: site.domain ? `https://${site.domain}/` : "",
      live: live
        ? {
            reachable: live.reachable,
            url: live.url,
            status: live.status ?? null,
            responseMs: live.responseMs ?? null,
            bytes: live.bytes ?? null,
            error: live.error ?? null,
            facts: live.facts ?? null,
            robots: live.robots ?? null,
            sitemap: live.sitemap ?? null,
            llms: live.llms ?? null,
            fetchedAt: live.fetchedAt,
          }
        : null,
      seo: live?.seo ?? null,
      geo: live?.geo ?? null,
      local,
      gsc: { ...siteGsc, days },
      nextAction,
    };
  });

  const sites = rows.filter((row) => row && !row.error);
  const scoresSeo = sites.map((site) => site.seo?.score).filter((score) => typeof score === "number");
  const scoresGeo = sites.map((site) => site.geo?.score).filter((score) => typeof score === "number");
  const gscRows = sites.map((site) => site.gsc).filter((row) => row.status === "ok");
  const needs = sites
    .filter((site) => site.nextAction.severity === "critical" || site.nextAction.severity === "warn")
    .sort((left, right) => (left.nextAction.severity === right.nextAction.severity ? (left.seo?.score ?? 0) - (right.seo?.score ?? 0) : left.nextAction.severity === "critical" ? -1 : 1))
    .map((site) => ({
      siteId: site.id,
      siteName: site.name,
      domain: site.domain,
      severity: site.nextAction.severity,
      label: site.nextAction.label,
      detail: site.nextAction.detail,
      kind: site.nextAction.kind,
    }));

  const previousClicks = gscRows.reduce((sum, row) => sum + (row.previousClicks || 0), 0);
  const totalClicks = gscRows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const report = {
    generatedAt: now.toISOString(),
    days,
    connection: {
      connected: gsc.connected,
      provider: gsc.provider ?? null,
      email: gsc.email ?? null,
      team: gsc.team ?? treg.team ?? null,
      role: gsc.role ?? treg.role ?? null,
      balanceUsd: gsc.balanceUsd ?? treg.balanceUsd ?? null,
      properties: gsc.properties ?? 0,
      error: gsc.error ?? null,
    },
    treg,
    stats: {
      sites: sites.length,
      withDomain: sites.filter((site) => site.domain).length,
      reachable: sites.filter((site) => site.live?.reachable).length,
      needsAttention: needs.length,
      critical: needs.filter((item) => item.severity === "critical").length,
      clicks: totalClicks,
      previousClicks,
      clickDeltaPct: previousClicks ? Math.round(((totalClicks - previousClicks) / previousClicks) * 1000) / 10 : null,
      impressions: gscRows.reduce((sum, row) => sum + (row.impressions || 0), 0),
      avgSeo: average(scoresSeo.length ? scoresSeo.reduce((sum, score) => sum + score, 0) / scoresSeo.length : null),
      avgGeo: average(scoresGeo.length ? scoresGeo.reduce((sum, score) => sum + score, 0) / scoresGeo.length : null),
      blockedAi: sites.filter((site) => (site.live?.robots?.blocked?.length ?? 0) > 0).length,
    },
    needs,
    sites,
  };
  syncIssues(report);
  return report;
}
