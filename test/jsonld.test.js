import test from "node:test";
import assert from "node:assert/strict";

import { analyzeHtml, scoreGeo, scoreSeo } from "../lib/scan.js";

const extras = {
  sitemap: { ok: true, url: "https://example.com/sitemap.xml" },
  llms: { ok: true, url: "https://example.com/llms.txt" },
  robots: { ok: true, url: "https://example.com/robots.txt" },
  robotsPolicy: { blocked: [] },
};

const page = (head) => `<!doctype html><html lang="en"><head>
<title>A clear title for the example page</title>
<meta name="description" content="A description that is long enough to explain what this page answers in one extractable sentence.">
${head}
</head><body><h1>Example</h1><h2>What is this?</h2><p>${"word ".repeat(100)}</p></body></html>`;

test("unquoted JSON-LD attributes are detected (minified HTML)", () => {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Example" },
      { "@type": "WebSite", name: "Example" },
      { "@type": "Organization", name: "Example", sameAs: ["https://x.com/example", "https://github.com/example"] },
      { "@type": "SoftwareApplication", name: "Example", offers: { "@type": "Offer", price: "0" } },
      { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What is this?" }] },
    ],
  };
  const facts = analyzeHtml(page(`<script type=application/ld+json>${JSON.stringify(graph)}</script>`), "https://example.com/");
  assert.equal(facts.schemaBlocks, 1);
  assert.equal(facts.schemaInvalid, 0);
  assert.ok(facts.schemaTypes.includes("FAQPage"));
  assert.ok(facts.schemaTypes.includes("Organization"));
  assert.equal(facts.hasFaqSchema, true);
  assert.equal(facts.hasEntitySchema, true);
  assert.equal(facts.sameAs, 2);
  assert.equal(scoreSeo(facts, extras).checks.find((check) => check.id === "schema").status, "pass");
  assert.equal(scoreGeo(facts, extras).checks.find((check) => check.id === "faq").status, "pass");
});

test("quoted, single-quoted, uppercase, parameterised and reordered attributes all work", () => {
  const blocks = [
    `<script type="application/ld+json">{"@type":"WebPage"}</script>`,
    `<script type='application/ld+json'>{"@type":"WebSite"}</script>`,
    `<script data-x=1 TYPE=APPLICATION/LD+JSON nonce=abc>{"@type":"Organization"}</script>`,
    `<script type="application/ld+json; charset=utf-8">{"@type":"FAQPage"}</script>`,
    `<script nonce=abc defer type=application/ld+json>{"@type":"BreadcrumbList"}</script>`,
    `<script type=text/javascript>{"@type":"NotSchema"}</script>`,
  ].join("");
  const facts = analyzeHtml(page(blocks), "https://example.com/");
  assert.equal(facts.schemaBlocks, 5);
  assert.equal(facts.schemaInvalid, 0);
  assert.ok(facts.schemaTypes.includes("WebPage"));
  assert.ok(facts.schemaTypes.includes("FAQPage"));
  assert.ok(!facts.schemaTypes.includes("NotSchema"));
});

test("malformed JSON-LD is counted but does not break the page analysis", () => {
  const html = page(`<script type=application/ld+json>{"@type":"WebPage"</script><script type=application/ld+json>{"@type":"Organization"}</script>`);
  const facts = analyzeHtml(html, "https://example.com/");
  assert.equal(facts.schemaBlocks, 2);
  assert.equal(facts.schemaInvalid, 1);
  assert.ok(facts.schemaTypes.includes("Organization"));
});
