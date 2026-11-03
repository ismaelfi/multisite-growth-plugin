/**
 * Local configuration and secrets for the portfolio panel.
 *
 * Everything lives in the configured Website Growth data directory:
 *   config.json   — curated sites, non-secret settings
 *   secrets.json  — Google client secret and OAuth tokens (0600)
 *   cache.json    — the last report
 *
 * The panel only reads. Writes happen through the panel's own API.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export const CONFIG_VERSION = 1;
export const DEFAULT_DAYS = 28;
export const MAX_SITES = 60;

export function dataDir() {
  if (process.env.WEBSITE_GROWTH_DATA_DIR?.trim()) return resolve(process.env.WEBSITE_GROWTH_DATA_DIR);
  try {
    const settings = JSON.parse(readFileSync(new URL("../local-config.json", import.meta.url), "utf8"));
    if (typeof settings.dataDir !== "string" || !isAbsolute(settings.dataDir)) throw new Error("local-config.json needs an absolute dataDir");
    return resolve(settings.dataDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "website-growth");
  }
}

export function configPath() {
  return join(dataDir(), "config.json");
}

export function secretsPath() {
  return join(dataDir(), "secrets.json");
}

export function cachePath() {
  return join(dataDir(), "cache.json");
}

function ensureDir() {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`${path}: ${error.message}`);
  }
}

function writePrivate(path, value) {
  ensureDir();
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

/** @param {unknown} value */
function text(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Normalize a hostname the user typed: no scheme, no path, lower case. */
export function normalizeDomain(value) {
  let host = text(value).toLowerCase();
  if (!host) return "";
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//u, "");
  host = host.split("/")[0].split("?")[0].split("#")[0];
  host = host.replace(/:\d+$/u, "").replace(/\.$/u, "");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(host)) return "";
  return host;
}

/** A stable, readable id. Existing ids survive a rename. */
export function siteId(name, domain, taken = new Set()) {
  const base = (domain || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48) || "site";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * @param {unknown} input
 * @param {Set<string>} taken
 */
export function normalizeSite(input, taken = new Set()) {
  const record = input && typeof input === "object" ? input : {};
  const domain = normalizeDomain(record.domain);
  const name = text(record.name, 80) || domain || "Untitled site";
  const existing = text(record.id, 64);
  let id = existing && /^[a-z0-9][a-z0-9-]*$/u.test(existing) && !taken.has(existing) ? existing : siteId(name, domain, taken);
  taken.add(id);
  const path = text(record.path, 500);
  return {
    id,
    name,
    domain,
    path: path && isAbsolute(path) ? resolve(path) : "",
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag) => typeof tag === "string").map((tag) => text(tag, 24)).filter(Boolean).slice(0, 6)
      : [],
  };
}

/** @param {unknown} value */
export function normalizeSites(value) {
  if (!Array.isArray(value)) throw new Error("sites must be an array");
  const limited = value.slice(0, MAX_SITES);
  const taken = new Set();
  return limited.map((site) => normalizeSite(site, taken));
}

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    sites: [],
    google: { clientId: "" },
    days: DEFAULT_DAYS,
    updatedAt: null,
  };
}

/** @returns {ReturnType<typeof defaultConfig>} */
export function loadConfig() {
  const raw = readJson(configPath());
  if (!raw || typeof raw !== "object") return defaultConfig();
  let sites = [];
  try {
    sites = normalizeSites(raw.sites ?? []);
  } catch {
    sites = [];
  }
  return {
    version: CONFIG_VERSION,
    sites,
    google: { clientId: text(raw.google?.clientId, 300) },
    days: Number.isInteger(raw.days) && raw.days >= 7 && raw.days <= 90 ? raw.days : DEFAULT_DAYS,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/** @param {ReturnType<typeof defaultConfig>} config */
export function saveConfig(config) {
  config.updatedAt = new Date().toISOString();
  writePrivate(configPath(), { ...config, version: CONFIG_VERSION });
}

export function defaultSecrets() {
  return { version: 1, google: { clientSecret: "", tokens: null } };
}

export function loadSecrets() {
  const raw = readJson(secretsPath());
  if (!raw || typeof raw !== "object") return defaultSecrets();
  return {
    version: 1,
    google: {
      clientSecret: text(raw.google?.clientSecret, 500),
      tokens:
        raw.google?.tokens && typeof raw.google.tokens === "object"
          ? {
              accessToken: text(raw.google.tokens.accessToken, 4000),
              refreshToken: text(raw.google.tokens.refreshToken, 4000),
              expiresAt: Number(raw.google.tokens.expiresAt) || 0,
              scope: text(raw.google.tokens.scope, 1000),
              tokenType: text(raw.google.tokens.tokenType, 40) || "Bearer",
              email: text(raw.google.tokens.email, 200),
              connectedAt: text(raw.google.tokens.connectedAt, 40),
            }
          : null,
    },
  };
}

export function saveSecrets(secrets) {
  writePrivate(secretsPath(), secrets);
}

/** The public view of the connection state: never a token. */
export function connectionView(config, secrets) {
  const clientId = config.google.clientId || process.env.WEBSITE_GROWTH_GOOGLE_CLIENT_ID || "";
  const clientSecret = secrets.google.clientSecret || process.env.WEBSITE_GROWTH_GOOGLE_CLIENT_SECRET || "";
  const tokens = secrets.google.tokens;
  return {
    configured: Boolean(clientId && (clientSecret || tokens)),
    hasClient: Boolean(clientId),
    hasSecret: Boolean(clientSecret),
    connected: Boolean(tokens?.refreshToken || tokens?.accessToken),
    email: tokens?.email ?? null,
    connectedAt: tokens?.connectedAt ?? null,
    canConnect: Boolean(clientId),
  };
}

export function loadCache() {
  const raw = readJson(cachePath());
  if (!raw || typeof raw !== "object" || !raw.report) return null;
  return raw;
}

export function saveCache(report) {
  writePrivate(cachePath(), { version: 1, savedAt: new Date().toISOString(), report });
}

export function clearCache() {
  const path = cachePath();
  if (existsSync(path)) writePrivate(path, { version: 1, savedAt: null, report: null });
}

/** Make sure the data directory exists with owner-only permissions. */
export function ensureDataDir() {
  ensureDir();
  const dir = dataDir();
  try {
    if (statSync(dir).mode & 0o077) chmodSync(dir, 0o700);
  } catch {
    // Best effort: a failure here does not stop a read.
  }
  return dir;
}
