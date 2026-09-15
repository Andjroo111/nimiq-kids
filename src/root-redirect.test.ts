// The public competition instance (HATCH_LEGACY_BOOT=0) serves the marketing site at
// "/" — that is the page a judge lands on. The app is unmoved, so /portal/, /parent/
// and /kid/ must stay untouched by this middleware. The family install (no flag) now
// lands on /portal/: the legacy root demo it used to serve was deleted 2026-08-01.
// Env save/restore mirrors kid-boot.test.ts.
//
// Paths here are cwd-relative on purpose: bun test runs from the repo root, the same
// convention cache-busting.test.ts uses for serveStatic({ root: "./public" }).
import { test, expect, afterEach } from "bun:test";
import { Hono } from "hono";
import { rootRedirectWhenLegacyClosed } from "./root-redirect";

const prev = process.env.HATCH_LEGACY_BOOT;
afterEach(() => {
  if (prev === undefined) delete process.env.HATCH_LEGACY_BOOT;
  else process.env.HATCH_LEGACY_BOOT = prev;
});

const app = new Hono();
app.use("/*", rootRedirectWhenLegacyClosed);
// Stand-ins for a root the middleware must never fall through to any more. If either
// of these is ever reached, the middleware has stopped handling "/" and the assertion
// below says so by name rather than by a status code.
app.get("/", (c) => c.text("legacy demo"));
app.get("/index.html", (c) => c.text("legacy demo"));
app.get("/portal/", (c) => c.text("portal chooser"));
app.get("/parent/", (c) => c.text("parent app"));
app.get("/kid/", (c) => c.text("kid app"));

test("legacy boot closed: the bare domain serves the marketing site, not the app", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  for (const path of ["/", "/index.html"]) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toBe("legacy demo");
    // the two things a judge must find on the homepage
    expect(html).toContain('id="video-slot"');
    expect(html).toContain('data-section="roadmap"');
  }
});

test("legacy boot closed: the marketing site links the demo and the live app", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const html = await (await app.request("/")).text();
  // Demo: the SEEDED family (Mom + Sam + Ava, jobs on the board, allowance already
  // earned) only exists on the testnet instance, which runs HATCH_DEMO_SEED=1 and
  // mints one private household per visitor. This page used to point "Try the demo"
  // at /portal/?choose, but on THIS instance that is the live mainnet chooser: no
  // Sam, no Ava, nothing seeded, and it asks a visitor to create a real family with
  // real money. Verified live 2026-07-31, which is how the mistake was caught.
  expect(html).toContain('href="https://demo.nimiq.kids/demo"');
  expect(html).not.toContain('href="/portal/?choose"');
  expect(html).toContain('href="/parent/"'); // Live: self-serve onboarding
});

test("every demo link points only at the branded demo host", async () => {
  // The demo instance also answers on an older internal alias. A competition
  // visitor must only ever see the branded host, never the alias — so assert a
  // whitelist (any absolute /demo link must equal the branded URL) rather than
  // blacklisting the alias by name (Andjroo, 2026-07-31).
  process.env.HATCH_LEGACY_BOOT = "0";
  const html = await (await app.request("/")).text();
  const BRANDED = "https://demo.nimiq.kids/demo";
  expect(html).toContain(`href="${BRANDED}"`);
  const stray = [...html.matchAll(/href="(https?:\/\/[^"]+\/demo)"/g)]
    .map((m) => m[1])
    .filter((u) => u !== BRANDED);
  expect(stray).toEqual([]);
});

test("the roadmap link scrolls to the roadmap instead of reloading", async () => {
  // Both the menu and the footer linked "Roadmap" to "/", which just re-serves this
  // same page and lands the visitor back at the top.
  process.env.HATCH_LEGACY_BOOT = "0";
  const html = await (await app.request("/")).text();
  expect(html).toContain('id="roadmap"');
  expect(html).toContain('href="#roadmap"');
});

test("marketing copy carries no em or en dashes", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const html = await (await app.request("/")).text();
  expect(html).not.toMatch(/[—–]/);
});

test("legacy boot closed: other surfaces are untouched", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  for (const path of ["/portal/", "/parent/", "/kid/"]) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
  }
});

test("family install: the bare domain lands on the app chooser, not a legacy shell", async () => {
  // public/index.html + public/js/app.js were deleted 2026-08-01. They were a second,
  // older copy of screens /parent/ and /kid/ already own, the only surface still
  // rendering raw chore titles, and the only registrar of the service worker — which
  // had therefore been dead in production since "/" became the marketing site.
  delete process.env.HATCH_LEGACY_BOOT;
  for (const path of ["/", "/index.html"]) {
    const res = await app.request(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/portal/");
  }
});

test("a family install never serves the marketing page", async () => {
  // It has no marketing surface: that page is the competition instance's landing and
  // stays gated on the flag. A family install is an app install.
  delete process.env.HATCH_LEGACY_BOOT;
  const res = await app.request("/");
  expect(res.headers.get("location")).toBe("/portal/");
});

// ---------------------------------------------------------------------------
// The walkthrough video: ONE switch (VIDEO_URL) drives both GET /video and the
// player on the marketing page. Before this, the page had a hardcoded VIDEO_ID
// that needed a code edit and a deploy, while /video read the env var — two
// mechanisms for one thing, guaranteed to drift.
// ---------------------------------------------------------------------------
import { youtubeId, applyVideoUrl } from "./root-redirect";

test("youtubeId accepts every shape a person might paste", () => {
  const id = "dQw4w9WgXcQ";
  for (const url of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?list=PL123&v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `  https://www.youtube.com/watch?v=${id}  `,
  ]) {
    expect(youtubeId(url)).toBe(id);
  }
});

test("youtubeId rejects what is not a YouTube link", () => {
  for (const url of ["", "   ", "https://vimeo.com/12345", "https://loom.com/share/abc", "not a url"]) {
    expect(youtubeId(url)).toBeNull();
  }
});

test("VIDEO_URL substitutes the id into the page's own VIDEO_ID constant", () => {
  const page = 'x\n    const VIDEO_ID = "";\n    y';
  expect(applyVideoUrl(page, "https://youtu.be/dQw4w9WgXcQ"))
    .toContain('const VIDEO_ID = "dQw4w9WgXcQ";');
});

test("no VIDEO_URL leaves the page exactly as written, placeholder and all", () => {
  const page = 'x\n    const VIDEO_ID = "";\n    y';
  expect(applyVideoUrl(page, undefined)).toBe(page);
  expect(applyVideoUrl(page, "")).toBe(page);
});

test("a non-YouTube VIDEO_URL leaves the page alone (/video still redirects to it)", () => {
  const page = 'x\n    const VIDEO_ID = "";\n    y';
  expect(applyVideoUrl(page, "https://www.loom.com/share/abc123")).toBe(page);
});

test("a VIDEO_ID hardcoded in the file still wins when no env var is set", () => {
  const page = 'x\n    const VIDEO_ID = "hardcoded99";\n    y';
  expect(applyVideoUrl(page, undefined)).toContain('const VIDEO_ID = "hardcoded99";');
});
