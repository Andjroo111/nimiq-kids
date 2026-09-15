// The marketing page's one embed, and the header that silently broke it.
//
// `Referrer-Policy: same-origin` (src/security-headers.ts) is correct and is staying: a
// kid-app URL can carry a child id. But it applies to EVERY outbound request the document
// makes, including the hero's YouTube iframe, so YouTube got no Referer, could not tell which
// site was embedding it, and served "Error 153, Video player configuration error" instead of a
// player. The hero looked broken while the video was public, `playableInEmbed: true` and fully
// processed the whole time.
//
// That is the expensive part: the failure is indistinguishable from a bad upload. Two separate
// videos were re-recorded and re-uploaded on the theory that the video was at fault before the
// header was suspected. So this is a test rather than a comment, and it fails loudly if the
// attribute is ever dropped — the next person to lose an afternoon to this should be nobody.
//
// It is deliberately NOT a browser test. `tools/csp-sweep.mjs` is where "does it actually
// render" lives; what belongs here is the coupling, because the coupling is invisible: nothing
// in the marketing page hints that a header set in a middleware three directories away decides
// whether its hero works.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { securityHeaders } from "./security-headers";
import { applyVideoUrl } from "./root-redirect";

const PAGE = new URL("../public/site/index.html", import.meta.url).pathname;
const html = readFileSync(PAGE, "utf8");

/**
 * The policies that still send an origin on a cross-origin request. `origin` and
 * `origin-when-cross-origin` send it unconditionally; the two `strict-` forms withhold it only
 * on an https-to-http downgrade, which cannot happen to `https://www.youtube-nocookie.com`.
 * Anything outside this set — `same-origin`, `no-referrer`, and the empty string — reproduces
 * the bug, so the assertion names what works instead of just banning today's known-bad value.
 */
const SENDS_ORIGIN_CROSS_ORIGIN = [
  "origin",
  "origin-when-cross-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
];

test("the hero iframe opts out of the document's referrer policy", () => {
  // Guard the guard: if the page is ever restructured and this block moves or is renamed, an
  // empty match would pass every assertion below while proving nothing at all.
  const builder = html.match(/var f = document\.createElement\("iframe"\);[\s\S]{0,3000}?slot\.replaceChildren\(f\);/);
  expect(builder, "could not find the iframe builder in public/site/index.html").not.toBeNull();
  const block = builder![0];

  expect(block, "the embed must be the privacy-preserving nocookie host")
    .toContain("https://www.youtube-nocookie.com/embed/");

  const set = block.match(/f\.referrerPolicy = "([^"]*)"/);
  expect(
    set,
    "f.referrerPolicy is not set, so Referrer-Policy: same-origin strips the Referer and YouTube answers Error 153",
  ).not.toBeNull();
  expect(SENDS_ORIGIN_CROSS_ORIGIN).toContain(set![1]);
});

test("the policy chosen leaks an origin and never a path", () => {
  // The whole point of the document-level header is that a kid-app URL can carry a child id.
  // An override that sent the full URL would trade a broken hero for the leak the header was
  // written to prevent, so `unsafe-url` and the two `no-referrer-when-downgrade`-style
  // full-URL policies must never appear on this element.
  const set = html.match(/f\.referrerPolicy = "([^"]*)"/);
  expect(set).not.toBeNull();
  expect(set![1]).not.toBe("unsafe-url");
  expect(set![1]).not.toBe("no-referrer-when-downgrade");
  // Belt and braces: the marketing page must not try to fix this by widening the whole
  // document instead, which would apply to every other outbound request it ever grows.
  expect(html).not.toMatch(/<meta[^>]+name="referrer"/i);
});

test("the header this works around is still the one being sent", async () => {
  // If this ever fails, the override above may have become unnecessary rather than wrong.
  // Read the note at the top of this file before deleting anything.
  const app = new Hono().use("/*", securityHeaders()).get("/", (c) => c.html("<p>hi</p>"));
  expect((await app.request("/")).headers.get("referrer-policy")).toBe("same-origin");
});

test("substituting the video id keeps the referrer override intact", () => {
  // applyVideoUrl rewrites this page at serve time, which is the only form a visitor ever
  // receives. A replace that clobbered the surrounding script would put the bug straight back.
  const served = applyVideoUrl(html, "https://www.youtube.com/watch?v=X_gk7pNNbmY");
  expect(served).toContain('const VIDEO_ID = "X_gk7pNNbmY";');
  expect(served).toMatch(/f\.referrerPolicy = "strict-origin-when-cross-origin"/);
});
