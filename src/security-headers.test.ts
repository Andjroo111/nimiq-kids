// The policy itself, pinned. Whether the app still WORKS under it is a browser question and
// `tools/csp-sweep.mjs` is what answers it — these are the lines that must not quietly drift.

import { test, expect } from "bun:test";
import { Hono } from "hono";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const app = new Hono()
  .use("/*", securityHeaders())
  .get("/json", (c) => c.json({ ok: true }))
  .get("/html", (c) => c.html("<p>hi</p>"))
  .get("/nope", (c) => c.json({ error: "no" }, 404));

const headers = async (path: string) => (await app.request(path)).headers;

const directive = (name: string): string =>
  contentSecurityPolicy().split("; ").find((d) => d.startsWith(`${name} `) || d === name) ?? "";

test("every response carries the set, whatever its kind or status", async () => {
  for (const path of ["/json", "/html", "/nope"]) {
    const h = await headers(path);
    expect(h.get("content-security-policy"), path).toBe(contentSecurityPolicy());
    expect(h.get("x-content-type-options"), path).toBe("nosniff");
    expect(h.get("x-frame-options"), path).toBe("SAMEORIGIN");
    expect(h.get("referrer-policy"), path).toBe("same-origin");
    expect(h.get("permissions-policy"), path).toContain("geolocation=()");
  }
});

test("frame-ancestors is the clickjacking half, and it is not open", () => {
  // parentAuth returns ok on the bearer token alone and the parent app sends `{}` as the
  // approve body, so a framed /parent/ turns one redressed click into an approved payout.
  expect(directive("frame-ancestors")).toBe("frame-ancestors 'self'");
});

test("nothing may be injected as a base or an object", () => {
  expect(directive("base-uri")).toBe("base-uri 'none'");
  expect(directive("object-src")).toBe("object-src 'none'");
});

test("connect-src names every host and no more", () => {
  // The bound on where an injected script could post a stolen bearer token. It is only worth
  // anything while it stays short, so this fails when a host is added without a reason.
  // riv.nimiq.kids (2026-09-18): the marketing page's characters are .riv files fetched by the
  // Rive runtime from Andjroo's own host; a GET of public art, CORS *, nothing posted.
  expect(directive("connect-src"))
    .toBe("connect-src 'self' https://hub.nimiq.com https://bot.nimiq.tech https://riv.nimiq.kids");
});

test("fonts and stylesheets come from this origin only", () => {
  // Both used to name Google, because a vendored address-display.css @imported Fira Mono from
  // it, which put a request carrying the visitor's IP on every parent screen of an app for
  // children. The font is served from /fonts now. `vendor-fonts.test.ts` is the half that
  // catches a component sync putting the @import back; this is the half that catches someone
  // widening the policy to accommodate it.
  expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline'");
  expect(directive("font-src")).toBe("font-src 'self'");
  expect(contentSecurityPolicy()).not.toContain("fonts.googleapis.com");
  expect(contentSecurityPolicy()).not.toContain("fonts.gstatic.com");
});

test("frame-src names every host and no more", () => {
  expect(directive("frame-src"))
    .toBe("frame-src 'self' https://hub.nimiq.com https://www.youtube-nocookie.com");
});

test("script-src still carries unsafe-inline, and that is the debt to pay off", () => {
  // Stated rather than assumed. The portal, demo, invite and marketing pages are
  // server-rendered with inline <script> blocks; moving them into files is what earns its
  // removal, and this test is where the next reader learns the keyword is deliberate.
  expect(directive("script-src")).toBe("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
  expect(directive("default-src")).toBe("default-src 'self'");
});

test("wasm can compile, and eval still cannot", () => {
  // The egg timer's frame and egg are a Rive runtime, which is WebAssembly: without this
  // keyword the app draws the timer with no egg in it and says so only in the console.
  // ⚠️ TOKENS, NOT SUBSTRINGS. "'wasm-unsafe-eval'" contains "'unsafe-eval'", so a
  // `not.toContain` on the whole policy passes hardest when the policy is at its most open.
  const tokens = directive("script-src").split(" ");
  expect(tokens).toContain("'wasm-unsafe-eval'");
  expect(tokens).not.toContain("'unsafe-eval'");
  // the runtime's CDN fallback stays refused; the local wasm is what is allowed to run
  expect(directive("connect-src")).not.toContain("jsdelivr");
});

test("no third-party analytics origin is allowed anywhere in the policy", () => {
  // The beacon was injected by the tunnel, not by this repo, so nothing in the source tree
  // would show it coming back. RUM is off in the Cloudflare dashboard as of 2026-08-03, and
  // this is what keeps the policy from quietly re-accommodating it: someone re-enabling it has
  // to change this line too, rather than a third party silently reappearing on a kid's screen.
  expect(contentSecurityPolicy()).not.toContain("cloudflareinsights.com");
});

test("the camera stays available to the kid app and nothing else is", async () => {
  expect((await headers("/json")).get("permissions-policy"))
    .toBe("camera=(self), microphone=(), geolocation=(), payment=()");
});
