// Serve-time cache busting (PWA lesson: never rely on manual version bumps).
// Every boot mints a fresh stamp; a deploy always restarts the server (launchd
// kickstart), so deploy = a new stamp on every HTML asset URL and a new sw.js
// cache name. Browsers, installed PWAs, and any edge cache re-fetch, and the
// SW's skipWaiting + gated controllerchange reload (app.js) finishes the swap
// without user action. v0.10.0 shipped a forgotten manual bump (sw.js stuck at
// "v12", HTML at "?v=2") — this middleware makes that mistake impossible.
import type { MiddlewareHandler } from "hono";
import { timerVersion } from "./timer-build";

export const BOOT_VERSION = String(Date.now());
const STAMP_RE = /\?v=[A-Za-z0-9.-]+/g;
const TIMER_TOKEN = "__TIMER_BUILD__";
// Local .js/.css that shipped with NO ?v= placeholder to replace. Those URLs
// never changed across a deploy, so the edge served the previous bundle for the
// full max-age — the portal chooser sat on a 4h-old app-shell.js after the
// v0.34.3 deploy (Andjroo, 7/31), and every /kid/ stylesheet had the same hole.
// Minting the stamp here means a page only has to reference an asset correctly,
// not remember the placeholder. Root-relative only: "//host/x.js" and absolute
// URLs are someone else's cache to manage.
const UNSTAMPED_RE = /(src|href)="(\/(?!\/)[^"?#\s]*\.(?:js|css))"/g;
// The import graph BELOW the entry point. UNSTAMPED_RE only sees HTML attributes, and
// an ES `import` is not one: /kid/js/main.js?v=<stamp> arrived fresh while its own
// `import ... from "./waiting.js"` resolved to a bare URL. Cloudflare caches a .js by
// extension, so a deploy touching only imported modules stayed invisible behind a
// 4-hour edge object — proven on the live demo 2026-08-01, no service worker involved.
// Stamping the specifier gives every module a per-boot URL, which both busts that
// object and makes the module honestly immutable.
// Relative and root-relative specifiers, and only ones with no query of their own —
// `import("/kid/js/bridge.js")` is as exposed as `from "./waiting.js"`. A bare or
// cross-origin specifier is someone else's to resolve, and `.js` inside an ordinary
// string has no `from`/`import(` in front of it.
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*)(["'])((?:\.{1,2}\/|\/(?!\/))[^"'?#]*\.js)\2/g;

// ⚠️ THE VENDORED EGG TIMER IS THE ONE THING HERE THAT VERSIONS ITSELF.
// Everything it pulls — its own 72KB page, the 196KB rig, 5.7MB of art, the icons,
// the backgrounds — carries `?v=<timerVersion()>`, minted from the vendored files'
// own mtimes. So those URLs are content-addressed and can be cached hard, and they
// must NOT get the blanket `no-cache` that every other .html gets: without this the
// timer re-downloaded 5.05MB every single time Andjroo tapped it, with no 304
// possible, because the body rewrite below strips etag and last-modified.
// ⚠️ AND IT MUST RETURN BEFORE UNSTAMPED_RE. The timer's own asset URLs are RELATIVE
// on purpose (it is served from / in anim-demo and /kid/timer/ here), so they do not
// match that pattern today — but the early return is what guarantees the two schemes
// never meet, and it is also what leaves Bun's own validators on the response.
const timerAsset = (p: string, v: string | undefined) => !!v && p.startsWith("/kid/timer/");

export function cacheBusting(version: string = BOOT_VERSION): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const p = c.req.path;
    if (timerAsset(p, c.req.query("v"))) {
      if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    // sw.js and the manifests: `no-cache` is right. A service worker is re-fetched on its
    // own schedule and browsers already bypass their cache for it; nothing here is a
    // document that can freeze a screen.
    if (p === "/sw.js" || p === "/manifest.webmanifest" || p.endsWith("manifest.json")) {
      c.header("Cache-Control", "no-cache");
    }
    // HTML DOCUMENTS get `no-store`, and the difference is not pedantry.
    //
    // `no-cache` means "revalidate before reuse", which needs a VALIDATOR to revalidate
    // against — and the body rewrite below strips etag and last-modified, so these
    // responses have none. A correct client then makes an unconditional GET. Android
    // WebView does not: it reuses the stored copy, and on 2026-08-27 a kiosk tablet was
    // found running an index.html three days old, naming three-day-old asset stamps,
    // against a server that had deployed twice since. A force-stop and relaunch did not
    // shift it, because relaunching only re-issues the same cacheable navigation.
    //
    // `no-store` has no such hole: there is nothing kept, so there is nothing to serve
    // stale. It costs one small document per navigation and it is the document that names
    // every stamped asset, so freezing it freezes the whole app while every asset around
    // it revalidates correctly -- which reads to a human as "my deploy did not land".
    if (p === "/" || p === "/parent" || p.endsWith("/") || p.endsWith(".html")) {
      c.header("Cache-Control", "no-store");
    }
    if (c.res.status !== 200) return;
    // A stamped asset URL is content-addressed for this boot — cache hard.
    // An UNSTAMPED one is not, and must never be treated as if it were. The HTML
    // rewrite below stamps every src= and href= it can see, but it cannot see an ES
    // module `import`: /kid/js/main.js?v=<stamp> is fresh and its own
    // `import ... from "./waiting.js"` resolves to a bare, unstamped URL. With no
    // Cache-Control of its own that response is a static .js, which Cloudflare caches
    // at the edge by extension, so a deploy that changes any module BUT the entry point
    // is invisible until that object expires. Verified on the live demo 2026-08-01: the
    // server had the new waiting.js (`fetch(url, {cache:'reload'})` proved it) while the
    // page kept booting the old one, with no service worker anywhere near it.
    // `no-cache` is revalidate-then-use, not don't-store: the etag survives on these
    // responses (only the HTML branch below strips it), so the steady state is a 304.
    if (p.endsWith(".js") || p.endsWith(".css")) {
      c.header("Cache-Control", c.req.query("v")
        ? "public, max-age=31536000, immutable"
        : "no-cache");
    }
    // ⚠️ /assets/ IS THE SAME HOLE, one directory over, and REDRAWN ART IS HOW IT SHOWS.
    // Sticker URLs come out of the database (`stickers.asset_url`, written at seed by
    // stickerAssetUrl), so the HTML rewrite below never sees them and they arrive bare —
    // no ?v=, and no Cache-Control, ETag or Last-Modified of their own either (verified
    // by curl against a running instance). Cloudflare caches .png at the edge by
    // EXTENSION whether or not the origin asked it to, which is exactly the failure
    // written up for unstamped modules above: the fix ships, the origin serves it, and
    // the tablet keeps drawing last week's picture with nothing failing anywhere.
    //
    // The 2026-08-04 re-cut rewrote all 30 stickers at their existing URLs, so this is
    // not hypothetical — without it that deploy is invisible.
    //
    // `no-cache` is revalidate-then-use. These responses carry no validator today, so a
    // revalidation is a full refetch rather than a 304; that is the honest cost and it is
    // still the right trade for art that changes. The cheaper fix — stamping the URL and
    // marking it immutable — is a bigger change than it looks, because the bare path is
    // PERSISTED in the DB and a boot stamp baked in there would be stale the next deploy.
    if (p.startsWith("/assets/")) c.header("Cache-Control", "no-cache");
    const ct = c.res.headers.get("content-type") ?? "";
    // Stamp the module graph. Done for every served .js, not just the stamped ones, so
    // that whichever URL a browser arrives on, everything it pulls next is versioned.
    if (ct.includes("javascript") && p !== "/sw.js") {
      const src = await c.res.text();
      const body = src.replace(IMPORT_RE, `$1$2$3?v=${version}$2`);
      const h = new Headers(c.res.headers);
      h.delete("content-length");
      if (body !== src) { h.delete("etag"); h.delete("last-modified"); }
      c.res = new Response(body, { status: 200, headers: h });
      return;
    }
    // Substitute the stamp into HTML asset URLs and the sw.js cache version.
    if (p === "/sw.js" || ct.includes("text/html")) {
      let body = await c.res.text();
      body = body.replace(STAMP_RE, `?v=${version}`);
      // The kid shell carries the timer's token so js/eggtimer.js can stamp the iframe
      // src without a round trip. Substituted per request, not per boot: vendoring a
      // new timer must not need a server restart to become visible.
      if (body.includes(TIMER_TOKEN)) body = body.replaceAll(TIMER_TOKEN, timerVersion());
      if (ct.includes("text/html")) body = body.replace(UNSTAMPED_RE, `$1="$2?v=${version}"`);
      if (p === "/sw.js") body = body.replace(/const VERSION = "[^"]*"/, `const VERSION = "${version}"`);
      const h = new Headers(c.res.headers);
      h.delete("content-length");
      h.delete("etag");
      h.delete("last-modified");
      c.res = new Response(body, { status: 200, headers: h });
    }
  };
}
