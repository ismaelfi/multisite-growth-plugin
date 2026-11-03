import { percentageChange as delta } from "./metrics.js";
/**
 * Google Search Console: one OAuth grant, every property it can read.
 *
 * The grant is deliberately read-only (`webmasters.readonly`). Tokens live in
 * the profile's private secrets file; the browser never receives them.
 */
import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const API = "https://www.googleapis.com/webmasters/v3";
const SCOPE = "openid email https://www.googleapis.com/auth/webmasters.readonly";

/** @param {Buffer|string} value */
function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

export function redirectUri(origin) {
  return `${origin.replace(/\/$/u, "")}/portfolio/api/google/callback`;
}

/** @param {{ clientId: string }} config @param {{ origin: string, state: string, verifier: string }} input */
export function buildAuthorization(config, { origin, state, verifier }) {
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

export function newPkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier };
}

/** @param {URLSearchParams} params */
async function tokenRequest(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body?.error_description || body?.error || `token endpoint returned ${response.status}`;
    throw new Error(String(reason));
  }
  return body;
}

/**
 * @param {{ clientId: string, clientSecret: string }} config
 * @param {{ origin: string, code: string, verifier: string }} input
 */
export async function exchangeCode(config, { origin, code, verifier }) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri(origin),
    code_verifier: verifier,
  });
  if (config.clientSecret) params.set("client_secret", config.clientSecret);
  const body = await tokenRequest(params);
  const tokens = {
    accessToken: String(body.access_token || ""),
    refreshToken: String(body.refresh_token || ""),
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in) || 3600) * 1000,
    scope: String(body.scope || SCOPE),
    tokenType: String(body.token_type || "Bearer"),
    email: "",
    connectedAt: new Date().toISOString(),
  };
  try {
    const info = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (info.ok) {
      const user = await info.json();
      tokens.email = typeof user.email === "string" ? user.email : "";
    }
  } catch {
    // The grant is still usable without an email label.
  }
  return tokens;
}

/**
 * @param {{ clientId: string, clientSecret: string }} config
 * @param {{ accessToken: string, refreshToken: string, expiresAt: number }} tokens
 */
export async function refreshAccessToken(config, tokens) {
  if (!tokens.refreshToken) throw new Error("This grant has no refresh token. Connect Google again.");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: config.clientId,
  });
  if (config.clientSecret) params.set("client_secret", config.clientSecret);
  const body = await tokenRequest(params);
  return {
    ...tokens,
    accessToken: String(body.access_token || ""),
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in) || 3600) * 1000,
    scope: String(body.scope || tokens.scope || SCOPE),
    tokenType: String(body.token_type || "Bearer"),
    // A refresh response usually omits refresh_token; keep the original.
    refreshToken: String(body.refresh_token || tokens.refreshToken),
  };
}

/** @param {{accessToken: string, expiresAt: number}} tokens */
export function tokenIsFresh(tokens) {
  return Boolean(tokens.accessToken) && Number(tokens.expiresAt) > Date.now() + 90_000;
}

/**
 * @param {{ clientId: string, clientSecret: string }} config
 * @param {any} tokens
 * @param {(next: any) => void} onTokens
 */
async function usableToken(config, tokens, onTokens) {
  if (tokenIsFresh(tokens)) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error("Google access expired. Connect Google again.");
  const refreshed = await refreshAccessToken(config, tokens);
  onTokens(refreshed);
  return refreshed.accessToken;
}

/** @param {string} path @param {any} options */
async function googleFetch(config, tokens, onTokens, path, options = {}) {
  let accessToken = await usableToken(config, tokens, onTokens);
  let response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 && tokens.refreshToken) {
    const refreshed = await refreshAccessToken(config, tokens);
    onTokens(refreshed);
    accessToken = refreshed.accessToken;
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  }
  return response;
}

/** @param {string} value */
function propertyHost(value) {
  const text = value.trim();
  if (text.toLowerCase().startsWith("sc-domain:")) return text.slice("sc-domain:".length).toLowerCase();
  try {
    return new URL(text).host.toLowerCase();
  } catch {
    return "";
  }
}

/** @param {string} host */
function withoutWww(host) {
  return host.replace(/^www\./u, "");
}

/**
 * Match one curated domain to the best Search Console property.
 * @param {string} domain
 * @param {string[]} properties
 */
export function matchProperty(domain, properties) {
  const clean = withoutWww(domain.toLowerCase());
  let best = null;
  for (const property of properties) {
    const host = withoutWww(propertyHost(property));
    if (host !== clean) continue;
    const lower = property.toLowerCase();
    let rank = 10;
    if (lower === `sc-domain:${clean}`) rank = 1;
    else if (lower.startsWith("sc-domain:")) rank = 2;
    else if (lower === `https://${clean}/` || lower === `https://${domain.toLowerCase()}/`) rank = 3;
    else if (lower === `https://www.${clean}/`) rank = 4;
    else if (lower.startsWith("http://")) rank = 6;
    else rank = 5;
    if (!best || rank < best.rank) best = { property, rank };
  }
  return best?.property ?? null;
}

/** @param {Date} date */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** @param {Date} date @param {number} days */
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Search Console data lags a few days; ending at -3 avoids counting partial days as a drop. */
export function dateWindows(days, now = new Date()) {
  const end = addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -3);
  const start = addDays(end, -(days - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return {
    current: { startDate: isoDate(start), endDate: isoDate(end) },
    previous: { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) },
  };
}

export async function listProperties(config, tokens, onTokens) {
  const response = await googleFetch(config, tokens, onTokens, "/sites");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Search Console list failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const body = await response.json();
  return Array.isArray(body.siteEntry) ? body.siteEntry.map((entry) => String(entry.siteUrl || "")).filter(Boolean) : [];
}

async function queryTotals(config, tokens, onTokens, property, window) {
  const path = `/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const response = await googleFetch(config, tokens, onTokens, path, {
    method: "POST",
    body: JSON.stringify({ ...window, rowLimit: 1 }),
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) return null;
    const text = await response.text().catch(() => "");
    throw new Error(`Search Console query failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const body = await response.json();
  const row = Array.isArray(body.rows) ? body.rows[0] : null;
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: Number(row.clicks) || 0,
    impressions: Number(row.impressions) || 0,
    ctr: Number(row.ctr) || 0,
    position: Number(row.position) || 0,
  };
}

/** @param {number} current @param {number} previous */

/** @template T, R @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fill `gsc` on every site. A missing property is reported as such, never as
 * zero traffic.
 * @param {Array<{id: string, domain: string}>} sites
 * @param {{clientId: string, clientSecret: string}} config
 * @param {any} tokens
 * @param {{ days: number, onTokens: (next: any) => void, now?: Date }} options
 */
export async function searchConsoleReport(sites, config, tokens, { days, onTokens, now = new Date() }) {
  const result = {
    connected: true,
    email: tokens.email || "",
    properties: 0,
    error: null,
    sites: {},
  };
  let properties;
  try {
    properties = await listProperties(config, tokens, onTokens);
  } catch (error) {
    result.connected = false;
    result.error = error instanceof Error ? error.message : String(error);
    for (const site of sites) result.sites[site.id] = { status: "error", error: result.error };
    return result;
  }
  result.properties = properties.length;
  const windows = dateWindows(days, now);
  await mapLimit(sites, 4, async (site) => {
      if (!site.domain) {
        result.sites[site.id] = { status: "no_domain" };
        return;
      }
      const property = matchProperty(site.domain, properties);
      if (!property) {
        result.sites[site.id] = { status: "no_property", available: properties.slice(0, 8) };
        return;
      }
      try {
        const [current, previous] = await Promise.all([
          queryTotals(config, tokens, onTokens, property, windows.current),
          queryTotals(config, tokens, onTokens, property, windows.previous),
        ]);
        if (!current || !previous) {
          result.sites[site.id] = { status: "no_access", property };
          return;
        }
        result.sites[site.id] = {
          status: "ok",
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
        result.sites[site.id] = { status: "error", property, error: error instanceof Error ? error.message : String(error) };
      }
  });
  return result;
}

export { SCOPE };
