/**
 * Local project evidence: what the folder itself can prove.
 *
 * This is deliberately read-only and bounded. Every command has a timeout and
 * every file read is capped, so a huge repository cannot stall the panel.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeDomain } from "./config.js";

const MAX_FILE = 200_000;
const SITE_ROOT = join(process.env.HOME ?? "", "Sites", "Perso");

/** @param {string} path */
function safeRead(path, limit = MAX_FILE) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > limit) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1_000_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    }).trim();
  } catch {
    return "";
  }
}

/** @param {string} path */
export function readPackage(path) {
  const raw = safeRead(join(path, "package.json"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      homepage: typeof parsed.homepage === "string" ? parsed.homepage : "",
      scripts: parsed.scripts && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts).slice(0, 20) : [],
      dependencies: {
        ...(parsed.dependencies && typeof parsed.dependencies === "object" ? parsed.dependencies : {}),
        ...(parsed.devDependencies && typeof parsed.devDependencies === "object" ? parsed.devDependencies : {}),
      },
    };
  } catch {
    return null;
  }
}

/** @param {Record<string, string>} dependencies */
function frameworkOf(dependencies) {
  if (dependencies.astro) return "Astro";
  if (dependencies.next) return "Next.js";
  if (dependencies.nuxt) return "Nuxt";
  if (dependencies["@sveltejs/kit"]) return "SvelteKit";
  if (dependencies["@remix-run/react"]) return "Remix";
  if (dependencies.vite) return "Vite";
  if (dependencies.gatsby) return "Gatsby";
  if (dependencies.react) return "React";
  if (dependencies.wordpress || dependencies["@wordpress/scripts"]) return "WordPress";
  return "";
}

/** @param {string} path */
function gitFacts(path) {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], path);
  if (!branch) return null;
  const status = run("git", ["status", "--porcelain=v1"], path);
  const remote = run("git", ["remote", "get-url", "origin"], path);
  const last = run("git", ["log", "-1", "--format=%cI%x00%s"], path);
  const [at, subject] = last.split("\u0000");
  const changed = status ? status.split("\n").filter(Boolean).length : 0;
  return {
    branch,
    remote: remote || "",
    dirty: changed,
    lastCommitAt: at || "",
    lastCommitSubject: subject || "",
  };
}

/** @param {string} directory @param {number} depth */
function newestMtime(directory, depth = 2) {
  if (!existsSync(directory)) return "";
  let newest = 0;
  const walk = (dir, level) => {
    if (level < 0) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path, level - 1);
        else if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch {
        // A disappearing file is not a failure of the scan.
      }
    }
  };
  walk(directory, depth);
  return newest ? new Date(newest).toISOString() : "";
}

/** @param {string} path */
export function localFacts(path) {
  if (!path || !existsSync(path)) {
    return { exists: false, path: path || "", error: path ? "Folder not found" : "No folder linked" };
  }
  const pkg = readPackage(path);
  const git = gitFacts(path);
  const entries = (() => {
    try {
      return new Set(readdirSync(path));
    } catch {
      return new Set();
    }
  })();
  const envFiles = [...entries].filter((name) => name === ".env" || name.startsWith(".env."));
  const deploy = existsSync(join(path, "wrangler.jsonc")) || existsSync(join(path, "wrangler.toml"))
    ? "Cloudflare"
    : existsSync(join(path, "vercel.json"))
      ? "Vercel"
      : existsSync(join(path, "netlify.toml"))
        ? "Netlify"
        : "";
  return {
    exists: true,
    path,
    name: pkg?.name ?? basename(path),
    framework: pkg ? frameworkOf(pkg.dependencies) : "",
    description: pkg?.description ?? "",
    scripts: pkg?.scripts ?? [],
    deploy,
    envFiles,
    hasDist: existsSync(join(path, "dist")),
    distUpdatedAt: newestMtime(join(path, "dist"), 1),
    git,
    updatedAt: newestMtime(path, 1),
  };
}

/**
 * Find a domain in the project's own files. Ordered from strongest to weakest
 * so the UI can say how the suggestion was made.
 * @param {string} path
 * @param {string} folder
 */
export function detectDomain(path, folder) {
  const pkg = readPackage(path);
  const folderDomain = normalizeDomain(folder);
  if (folderDomain) return { domain: folderDomain, source: "folder name" };
  if (pkg?.homepage && !/github|npmjs|vercel|netlify|cloudflare|astro\.build/iu.test(pkg.homepage)) {
    const domain = normalizeDomain(pkg.homepage);
    if (domain) return { domain, source: "package.json homepage" };
  }
  if (pkg?.name && pkg.name.includes(".") && !pkg.name.startsWith("@")) {
    const domain = normalizeDomain(pkg.name);
    if (domain) return { domain, source: "package name" };
  }
  for (const name of ["astro.config.mjs", "astro.config.ts", "astro.config.js", "next.config.js", "next.config.mjs"]) {
    const raw = safeRead(join(path, name));
    const match = /\bsite\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/u.exec(raw);
    if (match) {
      const domain = normalizeDomain(match[1]);
      if (domain) return { domain, source: name };
    }
  }
  const cname = safeRead(join(path, "public", "CNAME")).trim();
  if (cname) {
    const domain = normalizeDomain(cname.split(/\s+/u)[0]);
    if (domain) return { domain, source: "public/CNAME" };
  }
  for (const name of ["wrangler.jsonc", "wrangler.toml"]) {
    const raw = safeRead(join(path, name));
    const route = /"(?:pattern|route)"\s*:\s*"([^"]+\.(?:com|fr|co|es|io|site|ai|dev|net|org|ma)[^"]*)"/iu.exec(raw);
    if (route) {
      const domain = normalizeDomain(route[1].replace(/\/\*/u, ""));
      if (domain) return { domain, source: name };
    }
  }
  for (const name of [".env", ".env.local", ".env.production"]) {
    const raw = safeRead(join(path, name));
    const match = /^(?:PUBLIC_)?(?:SITE_URL|SITE|URL|DOMAIN|ASTRO_SITE)\s*=\s*["']?(https?:\/\/[^"'\s]+)/imu.exec(raw);
    if (match) {
      const domain = normalizeDomain(match[1]);
      if (domain) return { domain, source: name };
    }
  }
  const readme = safeRead(join(path, "README.md"));
  const projectTokens = `${folder} ${pkg?.name ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/gu, " ").split(/\s+/u).filter((token) => token.length >= 4);
  for (const match of readme.matchAll(/https?:\/\/[^\s)<>"']+/gu)) {
    if (/github|npmjs|astro\.build|cloudflare|vercel|netlify|localhost|127\.0\.0\.1|schema\.org|fonts\./iu.test(match[0])) continue;
    const domain = normalizeDomain(match[0]);
    if (!domain) continue;
    // Only trust a README URL that actually names this project's folder or
    // package. Template READMEs otherwise leak acme-dental.com everywhere.
    if (projectTokens.some((token) => domain.replace(/\./gu, "").includes(token))) return { domain, source: "README" };
  }
  return { domain: "", source: "" };
}

/**
 * Candidate websites under ~/Sites/Perso. Suggestions only: the person still
 * chooses what belongs in the portfolio.
 */
export function discoverSites(root = SITE_ROOT) {
  if (!existsSync(root)) return { root, candidates: [] };
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { root, candidates: [] };
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || /^(node_modules|dist|Videos|Backlink|infra|ISSUES|fix|disk)$/u.test(entry.name)) continue;
    const path = join(root, entry.name);
    const hasProject = existsSync(join(path, "package.json")) || existsSync(join(path, "index.html")) || ["astro.config.mjs", "astro.config.ts", "wrangler.jsonc", "next.config.js"].some((name) => existsSync(join(path, name)));
    if (!hasProject) continue;
    const { domain, source } = detectDomain(path, entry.name);
    const pkg = readPackage(path);
    candidates.push({
      folder: entry.name,
      path,
      name: pkg?.name && !pkg.name.startsWith("@") ? pkg.name : entry.name,
      domain,
      domainSource: source,
      framework: pkg ? frameworkOf(pkg.dependencies) : "",
      hasGit: existsSync(join(path, ".git")),
    });
  }
  candidates.sort((left, right) => left.folder.localeCompare(right.folder));
  return { root, candidates };
}

export { SITE_ROOT };
