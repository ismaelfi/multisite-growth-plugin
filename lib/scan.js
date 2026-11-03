/**
 * Public-page inspection: what a crawler can see on the live site, split into
 * traditional SEO facts and generative-engine (GEO/AEO) readiness.
 *
 * Every check is evidence from the page or from a standard file. Nothing here
 * estimates traffic, rankings, or citations.
 */

const USER_AGENT = "WebsiteGrowth/0.1 (+local mission control; read-only)";
const HTML_LIMIT = 2_500_000;
const TEXT_LIMIT = 300_000;
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended", "CCBot"];

/** @param {string} value */
function decodeEntities(value) {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

/** @param {string} html */
function stripTags(html) {
  return decodeEntities(html.replace(/<script\b[\s\S]*?<\/script>/giu, " ").replace(/<style\b[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

/** @param {string} tag */
function attributes(tag) {
  const attrs = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
  let match;
  while ((match = pattern.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** @param {string} html */
function metaMap(html) {
  const map = new Map();
  const pattern = /<meta\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, attrs.content || "");
  }
  return map;
}

/** @param {string} html */
function linkMap(html) {
  const map = new Map();
  const pattern = /<link\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = attributes(match[0]);
    const rel = (attrs.rel || "").toLowerCase();
    if (rel && !map.has(rel)) map.set(rel, attrs.href || "");
  }
  return map;
}

/** @param {unknown} value @param {Set<string>} out */
function collectSchemaTypes(value, out) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const type = value["@type"];
  if (typeof type === "string") out.add(type);
  if (Array.isArray(type)) for (const item of type) if (typeof item === "string") out.add(item);
  for (const [key, child] of Object.entries(value)) {
    if (key === "@context") continue;
    collectSchemaTypes(child, out);
  }
}

/** @param {unknown} value @param {number} count */
function countSameAs(value, count = 0) {
  if (Array.isArray(value)) {
    for (const item of value) count = countSameAs(item, count);
    return count;
  }
  if (!value || typeof value !== "object") return count;
  for (const [key, child] of Object.entries(value)) {
    if (key === "sameAs") {
      if (typeof child === "string" && child.trim()) count += 1;
      else if (Array.isArray(child)) count += child.filter((item) => typeof item === "string" && item.trim()).length;
    } else {
      count = countSameAs(child, count);
    }
  }
  return count;
}

/** @param {string} html */
function structuredData(html) {
  const types = new Set();
  let sameAs = 0;
  let blocks = 0;
  let invalid = 0;
  // Scan every script tag, then read its attributes with the same tolerant
  // parser used for meta/link tags. Minifiers often emit
  // `type=application/ld+json` (valid HTML, no quotes), which a strict
  // quoted regex silently misses.
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = attributes(match[1]);
    const type = String(attrs.type || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/ld+json") continue;
    blocks += 1;
    const raw = match[2].replace(/<!--[\s\S]*?-->/gu, "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectSchemaTypes(parsed, types);
      sameAs += countSameAs(parsed);
    } catch {
      invalid += 1;
    }
  }
  return { blocks, invalid, types: [...types].sort(), sameAs };
}

/**
 * Parse the public HTML into evidence. Pure: no network, no clock.
 * @param {string} html
 * @param {string} finalUrl
 */
export function analyzeHtml(html, finalUrl) {
  const metas = metaMap(html);
  const links = linkMap(html);
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title = stripTags(titleMatch?.[1] ?? "");
  const description = (metas.get("description") || "").trim();
  const robots = (metas.get("robots") || "").toLowerCase();
  const canonical = (links.get("canonical") || "").trim();
  const lang = attributes(/<html\b[^>]*>/iu.exec(html)?.[0] ?? "").lang || "";
  const viewport = metas.get("viewport") || "";
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)].map((match) => stripTags(match[1])).filter(Boolean);
  const questionHeadings = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/giu)]
    .map((match) => stripTags(match[1]))
    .filter((text) => text.endsWith("?") && text.length > 8).length;
  const schema = structuredData(html);

  const images = [...html.matchAll(/<img\b[^>]*>/giu)].map((match) => attributes(match[0]));
  const missingAlt = images.filter((attrs) => !("alt" in attrs) || !String(attrs.alt).trim()).length;

  let internalLinks = 0;
  let externalLinks = 0;
  let host = "";
  try {
    host = new URL(finalUrl).host;
  } catch {
    // A malformed final URL still leaves the counts at zero.
  }
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/giu)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) internalLinks += 1;
    else {
      try {
        const target = new URL(href, finalUrl);
        if (target.host === host) internalLinks += 1;
        else externalLinks += 1;
      } catch {
        // Ignore an unparsable href; it cannot be classified.
      }
    }
  }

  const wordText = stripTags(html);
  const wordCount = wordText ? wordText.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length : 0;
  const ogImage = metas.get("og:image") || "";
  const ogTitle = metas.get("og:title") || "";
  const twitterCard = metas.get("twitter:card") || "";

  return {
    finalUrl,
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    robots,
    noindex: /noindex|none/u.test(robots),
    canonical,
    lang,
    viewport,
    h1Count: h1s.length,
    h1: h1s[0] ?? "",
    questionHeadings,
    wordCount,
    images: images.length,
    missingAlt,
    internalLinks,
    externalLinks,
    schemaBlocks: schema.blocks,
    schemaInvalid: schema.invalid,
    schemaTypes: schema.types,
    sameAs: schema.sameAs,
    ogImage,
    ogTitle,
    twitterCard,
    hasFaqSchema: schema.types.some((type) => /^(FAQPage|QAPage|Question|HowTo)$/u.test(type)),
    hasEntitySchema: schema.types.some((type) => /^(Organization|Person|LocalBusiness|WebSite|ProfessionalService)$/u.test(type)),
    hasBreadcrumb: schema.types.includes("BreadcrumbList"),
  };
}

/**
 * Parse robots.txt into an AI-crawler policy. A bot is blocked when its own
 * group (or the wildcard group when it has none) disallows the root.
 * @param {string} text
 */
export function analyzeRobots(text) {
  /** @type {Map<string, {allow: boolean, disallow: boolean}>} */
  const groups = new Map();
  let current = [];
  let inRules = false;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (inRules) {
        current = [];
        inRules = false;
      }
      const agent = value.toLowerCase() === "*" ? "*" : value.toLowerCase();
      current.push(agent);
      if (!groups.has(agent)) groups.set(agent, { allow: false, disallow: false });
      continue;
    }
    if (field === "allow" || field === "disallow") {
      inRules = true;
      for (const agent of current) {
        const group = groups.get(agent);
        if (!group) continue;
        if (field === "disallow" && value === "/") group.disallow = true;
        if (field === "allow" && (value === "/" || value === "")) group.allow = true;
      }
    }
  }
  /** @type {Record<string, "allowed"|"blocked"|"unknown">} */
  const bots = {};
  for (const bot of AI_BOTS) {
    const own = groups.get(bot.toLowerCase());
    const wildcard = groups.get("*");
    const group = own ?? wildcard;
    if (!group) bots[bot] = "unknown";
    else if (group.disallow && !group.allow) bots[bot] = "blocked";
    else bots[bot] = "allowed";
  }
  return { bots, blocked: Object.entries(bots).filter(([, value]) => value === "blocked").map(([bot]) => bot) };
}

/** @param {unknown} value @param {string} fallback */
function safeUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    return url.protocol === "http:" || url.protocol === "https:" ? url : new URL(fallback);
  } catch {
    return new URL(fallback);
  }
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, limit?: number }} [options]
 */
async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const limit = options.limit ?? TEXT_LIMIT;
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      "accept-language": "en-GB,en;q=0.9",
    },
  });
  const buffer = await response.arrayBuffer();
  const body = Buffer.from(buffer).subarray(0, limit).toString("utf8");
  return { response, body, url: response.url, status: response.status, ms: Date.now() - started };
}

/** @param {string} url */
async function fetchSmall(url) {
  try {
    const result = await fetchText(url, { timeoutMs: 7_000, limit: 120_000 });
    return { ok: result.response.ok, status: result.status, text: result.body, url: result.url };
  } catch (error) {
    return { ok: false, status: 0, text: "", url, error: error instanceof Error ? error.message : String(error) };
  }
}

/** @typedef {ReturnType<typeof check>} Check */
function check(id, group, label, status, detail, action, weight) {
  return { id, group, label, status, detail, action, weight };
}

/**
 * @param {ReturnType<typeof analyzeHtml>} facts
 * @param {string} domain
 * @param {{ sitemap: {ok: boolean, url: string}, llms: {ok: boolean, url: string}, robots: {ok: boolean, url: string}, robotsPolicy: ReturnType<typeof analyzeRobots> }} extras
 */
export function scoreSeo(facts, extras) {
  const checks = [];
  const titleOk = facts.titleLength >= 15 && facts.titleLength <= 65;
  checks.push(check("title", "seo", "Title", facts.title ? (titleOk ? "pass" : "warn") : "fail", facts.title ? `${facts.titleLength} characters` : "No title element", "Write a unique 15–65 character title.", 8));
  const descOk = facts.descriptionLength >= 50 && facts.descriptionLength <= 165;
  checks.push(check("description", "seo", "Meta description", facts.description ? (descOk ? "pass" : "warn") : "fail", facts.description ? `${facts.descriptionLength} characters` : "No meta description", "Write a 50–165 character description with the page's promise.", 8));
  checks.push(check("h1", "seo", "One clear H1", facts.h1Count === 1 ? "pass" : facts.h1Count === 0 ? "fail" : "warn", facts.h1Count === 1 ? facts.h1 : `${facts.h1Count} H1 elements`, "Use one H1 that names the offer.", 5));
  checks.push(check("canonical", "seo", "Canonical URL", facts.canonical ? "pass" : "fail", facts.canonical || "No canonical link", "Declare the preferred URL.", 4));
  checks.push(check("lang", "seo", "Page language", facts.lang ? "pass" : "warn", facts.lang || "No lang attribute", "Set lang on the html element.", 2));
  checks.push(check("viewport", "seo", "Mobile viewport", facts.viewport ? "pass" : "fail", facts.viewport || "No viewport meta", "Add a responsive viewport meta tag.", 3));
  checks.push(check("schema", "seo", "Structured data", facts.schemaBlocks > 0 ? "pass" : "fail", facts.schemaBlocks > 0 ? `${facts.schemaTypes.length} types · ${facts.schemaInvalid} invalid block(s)` : "No JSON-LD", "Add JSON-LD for the page's real entity.", 6));
  checks.push(check("entity", "seo", "Entity schema", facts.hasEntitySchema ? "pass" : "warn", facts.hasEntitySchema ? facts.schemaTypes.filter((type) => /^(Organization|Person|LocalBusiness|WebSite|ProfessionalService)$/u.test(type)).join(", ") : "No Organization, Person, or WebSite schema", "Name the business or author and link its profiles.", 4));
  checks.push(check("social", "seo", "Social preview", facts.ogImage && facts.ogTitle ? "pass" : facts.ogImage || facts.ogTitle ? "warn" : "fail", facts.ogImage ? "og:image present" : "No og:image", "Add og:title and a real og:image.", 4));
  checks.push(check("sitemap", "seo", "Sitemap", extras.sitemap.ok ? "pass" : "fail", extras.sitemap.ok ? extras.sitemap.url : "No sitemap found", "Publish /sitemap.xml and reference it in robots.txt.", 6));
  checks.push(check("robots", "seo", "Indexable", facts.noindex ? "fail" : "pass", facts.noindex ? `robots: ${facts.robots}` : "No noindex directive", "Remove noindex if this page should rank.", 6));
  const altRatio = facts.images === 0 ? 1 : (facts.images - facts.missingAlt) / facts.images;
  checks.push(check("alt", "seo", "Image alt text", facts.images === 0 ? "pass" : altRatio >= 0.95 ? "pass" : altRatio >= 0.7 ? "warn" : "fail", `${facts.missingAlt} of ${facts.images} images missing alt`, "Describe meaningful images; leave alt empty only for decoration.", 5));
  checks.push(check("links", "seo", "Internal links", facts.internalLinks >= 3 ? "pass" : facts.internalLinks > 0 ? "warn" : "fail", `${facts.internalLinks} internal · ${facts.externalLinks} external`, "Link to the pages a visitor needs next.", 3));
  const max = checks.reduce((sum, item) => sum + item.weight, 0);
  const earned = checks.reduce((sum, item) => sum + (item.status === "pass" ? item.weight : item.status === "warn" ? item.weight * 0.5 : 0), 0);
  return { score: Math.round((earned / max) * 100), checks };
}

/**
 * @param {ReturnType<typeof analyzeHtml>} facts
 * @param {{ llms: {ok: boolean, url: string}, robotsPolicy: ReturnType<typeof analyzeRobots> }} extras
 */
export function scoreGeo(facts, extras) {
  const checks = [];
  checks.push(check("faq", "geo", "Answer block schema", facts.hasFaqSchema ? "pass" : "fail", facts.hasFaqSchema ? "FAQ/QA/HowTo schema found" : "No FAQ, Q&A, or HowTo schema", "Mark the questions the page already answers.", 20));
  checks.push(check("questions", "geo", "Question headings", facts.questionHeadings >= 2 ? "pass" : facts.questionHeadings === 1 ? "warn" : "fail", `${facts.questionHeadings} question heading(s)`, "Use the questions people actually ask as H2/H3s.", 15));
  checks.push(check("llms", "geo", "llms.txt", extras.llms.ok ? "pass" : "fail", extras.llms.ok ? extras.llms.url : "No /llms.txt", "Publish a short llms.txt: who you are, what you answer, key URLs.", 15));
  const blocked = extras.robotsPolicy.blocked;
  checks.push(check("ai-crawlers", "geo", "AI crawler access", blocked.length === 0 ? "pass" : blocked.length >= 3 ? "fail" : "warn", blocked.length === 0 ? "No AI crawler blocked" : `Blocked: ${blocked.join(", ")}`, "Allow GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and Google-Extended in robots.txt.", 15));
  checks.push(check("sameas", "geo", "Entity corroboration", facts.sameAs >= 2 ? "pass" : facts.sameAs === 1 ? "warn" : "fail", `${facts.sameAs} sameAs profile link(s)`, "Connect the entity to its real profiles with sameAs.", 10));
  checks.push(check("summary", "geo", "Clear summary", facts.descriptionLength >= 50 ? "pass" : facts.description ? "warn" : "fail", facts.description ? `${facts.descriptionLength} characters` : "No description", "State what the page answers in one extractable sentence.", 10));
  checks.push(check("citable", "geo", "Citable structure", facts.hasBreadcrumb && facts.schemaTypes.length >= 2 ? "pass" : facts.schemaTypes.length >= 2 ? "warn" : "fail", `${facts.schemaTypes.length} schema type(s)${facts.hasBreadcrumb ? " + breadcrumb" : ""}`, "Add breadcrumb and page-level schema so the answer has context.", 10));
  checks.push(check("https", "geo", "HTTPS", facts.finalUrl.startsWith("https://") ? "pass" : "fail", facts.finalUrl.startsWith("https://") ? "Served over HTTPS" : "Not HTTPS", "Serve the canonical URL over HTTPS.", 5));
  const max = checks.reduce((sum, item) => sum + item.weight, 0);
  const earned = checks.reduce((sum, item) => sum + (item.status === "pass" ? item.weight : item.status === "warn" ? item.weight * 0.5 : 0), 0);
  return { score: Math.round((earned / max) * 100), checks };
}

/**
 * Inspect one live site. Never throws for a site that is down: it returns an
 * unreachable result with both scores null.
 * @param {string} domain
 */
export async function inspectLiveSite(domain) {
  const https = `https://${domain}/`;
  let page;
  try {
    page = await fetchText(https);
  } catch (firstError) {
    try {
      page = await fetchText(`http://${domain}/`);
    } catch (secondError) {
      return {
        reachable: false,
        error: firstError instanceof Error ? firstError.message : String(firstError),
        url: https,
        seo: null,
        geo: null,
        fetchedAt: new Date().toISOString(),
      };
    }
  }
  if (!page.response.ok) {
    return { reachable: false, url: page.url, status: page.status, error: `HTTP ${page.status}`, seo: null, geo: null, fetchedAt: new Date().toISOString() };
  }
  const finalUrl = safeUrl(page.url, https).href;
  const facts = analyzeHtml(page.body, finalUrl);
  const [robots, llms, sitemap] = await Promise.all([
    fetchSmall(new URL("/robots.txt", finalUrl).href),
    fetchSmall(new URL("/llms.txt", finalUrl).href),
    fetchSmall(new URL("/sitemap.xml", finalUrl).href),
  ]);
  const robotsPolicy = analyzeRobots(robots.text);
  const sitemapOk = (sitemap.ok && /<urlset|<sitemapindex/iu.test(sitemap.text)) || /^\s*sitemap\s*:/imu.test(robots.text);
  const extras = {
    robots: { ok: robots.ok, url: new URL("/robots.txt", finalUrl).href },
    llms: { ok: llms.ok && llms.text.trim().length > 30, url: new URL("/llms.txt", finalUrl).href },
    sitemap: { ok: sitemapOk, url: new URL("/sitemap.xml", finalUrl).href },
    robotsPolicy,
  };
  return {
    reachable: true,
    url: finalUrl,
    status: page.status,
    responseMs: page.ms,
    bytes: Buffer.byteLength(page.body),
    fetchedAt: new Date().toISOString(),
    facts,
    robots: { ok: robots.ok, blocked: robotsPolicy.blocked },
    sitemap: extras.sitemap,
    llms: extras.llms,
    seo: scoreSeo(facts, extras),
    geo: scoreGeo(facts, extras),
  };
}

export { AI_BOTS };
