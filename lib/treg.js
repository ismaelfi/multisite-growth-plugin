import { percentageChange as delta } from "./metrics.js";
/**
 * treg bridge: the team's own Google Search Console tool, called through the
 * local `treg` CLI. The CLI holds the credential; this process never sees it.
 *
 * Search Console calls use the team's own OAuth connection, so they are not
 * billed. If treg is missing or signed out, the OAuth fallback still works.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { dateWindows, matchProperty } from "./gsc.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;
const STATUS_TTL_MS = 60_000;
const GSC_TOOLS = [
  "google-search-console",
  "google-search-console-2",
  "google-search-console-3",
  "google-search-console-4",
  "google-search-console-5",
  "google-search-console-6",
];

/** @type {{ at: number, value: any } | null} */
let statusCache = null;
let gscTool = "";

/** @param {string} path */
function isExecutable(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

export function tregBinary() {
  const explicit = process.env.TREG_BIN?.trim();
  if (explicit && isExecutable(explicit)) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "treg"),
    "/opt/homebrew/bin/treg",
    "/usr/local/bin/treg",
  ]) {
    if (isExecutable(candidate)) return candidate;
  }
  return "treg";
}

function clean(value) {
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/gu, "").trim();
}

/** @param {string[]} args */
async function runTreg(args, timeout = TIMEOUT_MS) {
  const { stdout, stderr } = await execFileAsync(tregBinary(), args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 12_000_000,
    env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
  });
  return { stdout, stderr: clean(stderr) };
}

/**
 * Locate the signed-in team from `treg`'s own summary. Cached for a minute so
 * opening the panel does not spawn a process on every render.
 */
export async function tregStatus({ refresh = false } = {}) {
  if (!refresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const started = Date.now();
  try {
    const { stdout } = await runTreg([], 12_000);
    const text = clean(stdout);
    const account = /^account:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? "";
    const teamLine = /^team:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? "";
    const balanceMatch = /^balance:\s*\$([\d.,]+)/mu.exec(text);
    const teamMatch = /^(.*?)\s*\(([^)]+)\)\s*$/u.exec(teamLine);
    const value = {
      available: true,
      signedIn: Boolean(account),
      account,
      team: teamMatch?.[1]?.trim() || teamLine,
      role: teamMatch?.[2]?.trim() || "",
      balanceUsd: balanceMatch ? Number(balanceMatch[1].replace(/,/gu, "")) : null,
      error: null,
      checkedAt: new Date().toISOString(),
    };
    statusCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    const value = {
      available: !/ENOENT|not found/iu.test(String(error?.message || error)),
      signedIn: false,
      account: "",
      team: "",
      role: "",
      balanceUsd: null,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
    };
    statusCache = { at: Date.now(), value };
    return value;
  }
}

/** @param {string} tool @param {string} [path] @param {{ method?: string, data?: unknown, headers?: string[] }} [options] */
async function tregRawCall(tool, path = "", options = {}) {
  const args = ["--json", "call", path ? `${tool}/${path}` : tool];
  if (options.method) args.push("--method", options.method);
  for (const header of options.headers ?? []) args.push("--header", header);
  if (options.data !== undefined) args.push("--data", JSON.stringify(options.data));
  const { stdout } = await runTreg(args);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`treg returned a non-JSON answer: ${clean(stdout).slice(0, 300)}`);
  }
  if (parsed?._treg?.http_status && parsed._treg.http_status >= 400) {
    throw new Error(`treg ${parsed._treg.http_status}: ${JSON.stringify(parsed.result).slice(0, 300)}`);
  }
  return parsed;
}

/** @param {string} tool @param {string} [path] @param {{ method?: string, data?: unknown, headers?: string[] }} [options] */
async function tregCall(tool, path = "", options = {}) {
  const parsed = await tregRawCall(tool, path, options);
  return parsed?.result ?? parsed;
}

/**
 * Call the first working team GSC tool. A broken connection is skipped once;
 * the working tool is remembered for later calls.
 * @param {string} path
 * @param {{ method?: string, data?: unknown }} [options]
 */
async function gscCall(path, options = {}) {
  const order = gscTool ? [gscTool, ...GSC_TOOLS.filter((tool) => tool !== gscTool)] : GSC_TOOLS;
  let lastError;
  for (const tool of order) {
    try {
      const result = await tregCall(tool, path, options);
      gscTool = tool;
      return result;
    } catch (error) {
      lastError = error;
      if (gscTool === tool) gscTool = "";
    }
  }
  throw lastError ?? new Error("No Search Console tool is available in treg");
}

export async function tregListProperties() {
  const result = await gscCall("webmasters/v3/sites");
  const entries = Array.isArray(result?.siteEntry) ? result.siteEntry : [];
  return entries
    .filter((entry) => entry?.permissionLevel && !/unverified/iu.test(entry.permissionLevel))
    .map((entry) => String(entry.siteUrl || ""))
    .filter(Boolean);
}

/** @param {string} property @param {{startDate: string, endDate: string}} window */
async function totals(property, window) {
  const result = await gscCall(`webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    data: { ...window, rowLimit: 1 },
  });
  const row = Array.isArray(result?.rows) ? result.rows[0] : null;
  return row
    ? { clicks: Number(row.clicks) || 0, impressions: Number(row.impressions) || 0, ctr: Number(row.ctr) || 0, position: Number(row.position) || 0 }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

/** @param {number} current @param {number} previous */

/**
 * Real Search Console numbers through treg, shaped like the OAuth report.
 * @param {Array<{id: string, domain: string}>} sites
 * @param {{ days: number, status: any, now?: Date }} options
 */
export async function tregSearchConsoleReport(sites, { days, status, now = new Date() }) {
  const properties = await tregListProperties();
  const windows = dateWindows(days, now);
  const result = {
    connected: true,
    provider: "treg",
    email: status?.account || "",
    team: status?.team || "",
    role: status?.role || "",
    balanceUsd: status?.balanceUsd ?? null,
    properties: properties.length,
    error: null,
    sites: {},
  };
  let next = 0;
  const worker = async () => {
    while (next < sites.length) {
      const site = sites[next];
      next += 1;
      if (!site.domain) {
        result.sites[site.id] = { status: "no_domain" };
        continue;
      }
      const property = matchProperty(site.domain, properties);
      if (!property) {
        result.sites[site.id] = { status: "no_property", available: properties.slice(0, 8) };
        continue;
      }
      try {
        const [current, previous] = await Promise.all([totals(property, windows.current), totals(property, windows.previous)]);
        result.sites[site.id] = {
          status: "ok",
          provider: "treg",
          property,
          clicks: current.clicks,
          impressions: current.impressions,
          ctr: current.ctr,
          position: current.position,
          previousClicks: previous.clicks,
          clickDeltaPct: delta(current.clicks, previous.clicks),
          impressionsDeltaPct: delta(current.impressions, previous.impressions),
        };
      } catch (error) {
        result.sites[site.id] = { status: "error", property, provider: "treg", error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sites.length) }, worker));
  return result;
}

/** @param {any} result @param {string} dimension */
function rows(result, dimension) {
  if (!Array.isArray(result?.rows)) return [];
  return result.rows.slice(0, 12).map((row) => ({
    key: String(row.keys?.[0] ?? ""),
    clicks: Number(row.clicks) || 0,
    impressions: Number(row.impressions) || 0,
    ctr: Number(row.ctr) || 0,
    position: Number(row.position) || 0,
    dimension,
  }));
}

/**
 * Detail for one site: top queries and pages, index status, and sitemaps.
 * @param {{ id: string, name: string, domain: string, url: string }} site
 * @param {number} days
 * @param {any} status
 */
export async function tregSiteDetails(site, days, status) {
  const properties = await tregListProperties();
  const property = matchProperty(site.domain, properties);
  if (!property) return { status: "no_property", properties: properties.length };
  const windows = dateWindows(days);
  const encoded = encodeURIComponent(property);
  const [queries, pages, inspection, sitemaps] = await Promise.all([
    gscCall(`webmasters/v3/sites/${encoded}/searchAnalytics/query`, {
      method: "POST",
      data: { ...windows.current, dimensions: ["query"], rowLimit: 12 },
    }).then((result) => rows(result, "query")),
    gscCall(`webmasters/v3/sites/${encoded}/searchAnalytics/query`, {
      method: "POST",
      data: { ...windows.current, dimensions: ["page"], rowLimit: 8 },
    }).then((result) => rows(result, "page")),
    gscCall("v1/urlInspection/index:inspect", {
      method: "POST",
      data: { inspectionUrl: site.url, siteUrl: property },
    }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
    gscCall(`webmasters/v3/sites/${encoded}/sitemaps`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
  ]);
  const index = inspection?.inspectionResult?.indexStatusResult ?? null;
  return {
    status: "ok",
    provider: "treg",
    team: status?.team || "",
    property,
    queries,
    pages,
    index: index
      ? {
          verdict: index.verdict ?? "",
          coverageState: index.coverageState ?? "",
          lastCrawlTime: index.lastCrawlTime ?? "",
          pageFetchState: index.pageFetchState ?? "",
          robotsTxtState: index.robotsTxtState ?? "",
          indexingState: index.indexingState ?? "",
        }
      : null,
    indexError: inspection?.error ?? null,
    sitemaps: (Array.isArray(sitemaps?.sitemap) ? sitemaps.sitemap : []).map((entry) => ({
      path: entry.path ?? "",
      lastDownloaded: entry.lastDownloaded ?? "",
      errors: Number(entry.errors) || 0,
      warnings: Number(entry.warnings) || 0,
      submitted: Number(entry.contents?.[0]?.submitted) || 0,
      indexed: Number(entry.contents?.[0]?.indexed) || 0,
    })),
    sitemapsError: sitemaps?.error ?? null,
  };
}

/**
 * Ask Perplexity a real question and report whether the answer cites the site.
 * The team pays treg's per-hit price for this call; the ceiling is $0.01.
 * @param {string} domain
 * @param {string} prompt
 * @param {string} country
 */
export async function tregAiAnswer(domain, prompt, country = "ES") {
  const parsed = await tregRawCall("treg.ai-search.perplexity.answer", "", {
    method: "POST",
    headers: ["X-Treg-Route-Max-Cost: 0.01"],
    data: { prompt, country },
  });
  const output = parsed?.result?.output ?? parsed?.result ?? {};
  const sources = Array.isArray(output.sources) ? output.sources : [];
  const cleanDomain = domain.replace(/^www\./u, "").toLowerCase();
  const citedSources = sources.filter((source) => {
    try {
      return new URL(source.url).hostname.replace(/^www\./u, "").toLowerCase() === cleanDomain;
    } catch {
      return false;
    }
  });
  const answer = String(output.answer || output.text || "");
  const mentioned = answer.toLowerCase().includes(cleanDomain);
  return {
    prompt,
    answer,
    sourceKind: output.source_kind || "",
    sources: sources.slice(0, 12).map((source) => ({ title: source.title || "", url: source.url || "" })),
    cited: citedSources.length > 0,
    mentioned,
    citesSite: citedSources.length > 0,
    citedSources: citedSources.map((source) => source.url),
    servedBy: parsed?._treg?.served_by || parsed?._treg?.servedBy || "",
    costUsd: typeof parsed?._treg?.charged_micro === "number" ? parsed._treg.charged_micro / 1_000_000 : null,
    callId: parsed?._treg?.call_id || "",
  };
}

export function resetTregCache() {
  statusCache = null;
  gscTool = "";
}
