// Serve-time cache busting: HTML asset stamps and the sw.js cache name must
// follow the boot version with no manual bumps. v0.10.0 shipped the manual-bump
// failure this guards against (sw.js stuck at "v12", HTML at "?v=2" across a
// deploy that replaced the bundles). Hermetic: serveStatic + app.request().
import { test, expect } from "bun:test";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cacheBusting } from "./serve-cache";

const app = new Hono();
app.use("/*", cacheBusting("BOOTSTAMP"));
app.use("/*", serveStatic({ root: "./public" }));

test("kid HTML carries the boot stamp, never a hard-coded one", async () => {
  const res = await app.request("/kid/");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("/dist/app-shell.js?v=BOOTSTAMP");
  expect(html).not.toMatch(/\?v=\d+["']/);
  // no-STORE, not no-cache. The body rewrite above strips etag and last-modified, so
  // `no-cache` ("revalidate first") has nothing to revalidate against, and a client that
  // treats that leniently -- Android WebView does -- serves a frozen document forever.
  // A kiosk tablet was found on a three-day-old index.html this way, naming three-day-old
  // asset stamps, which a force-stop and relaunch could not shift. See serve-cache.ts.
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("every HTML document is no-store, and sw.js/manifests stay no-cache", async () => {
  // The split is the point: a document freezes a screen, a service worker cannot.
  for (const path of ["/kid/", "/parent/", "/portal/"]) {
    const res = await app.request(path);
    expect(res.headers.get("cache-control"), path).toBe("no-store");
  }
  for (const path of ["/sw.js", "/manifest.webmanifest"]) {
    const res = await app.request(path);
    expect(res.headers.get("cache-control"), path).toBe("no-cache");
  }
});

test("parent HTML carries the boot stamp", async () => {
  const res = await app.request("/parent/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("/dist/parent-shell.js?v=BOOTSTAMP");
});

// Replacing an existing ?v= only protects pages that remembered the
// placeholder. The portal chooser didn't, so its app-shell.js URL never changed
// across a deploy and the edge kept serving the previous bundle for the full
// max-age — the pill fix shipped and the live portal still showed the old face
// (Andjroo, 7/31). Every /kid/ stylesheet had the same hole. The stamp is minted
// now, so a page only has to reference the asset.
test("HTML asset URLs get a stamp minted even without a placeholder", async () => {
  const res = await app.request("/portal/");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("/dist/app-shell.js?v=BOOTSTAMP");
  expect(html).not.toMatch(/src="\/[^"?]*\.js"/);
});

test("every local js/css in every served page ends up stamped", async () => {
  for (const path of ["/", "/portal/", "/kid/", "/parent/"]) {
    const html = await (await app.request(path)).text();
    expect([path, html.match(/(?:src|href)="\/(?!\/)[^"?]*\.(?:js|css)"/g)]).toEqual([path, null]);
  }
});

// External hosts own their own caching; rewriting their URLs would break SRI
// and cache-bust someone else's CDN on every one of our boots.
test("absolute and protocol-relative asset URLs are left alone", async () => {
  const probe = new Hono();
  probe.use("/*", cacheBusting("BOOTSTAMP"));
  probe.get("/p.html", (c) => c.html(
    '<script src="https://cdn.example/x.js"></script>' +
    '<script src="//cdn.example/y.js"></script>' +
    '<link href="/local.css">',
  ));
  const html = await (await probe.request("/p.html")).text();
  expect(html).toContain('src="https://cdn.example/x.js"');
  expect(html).toContain('src="//cdn.example/y.js"');
  expect(html).toContain('href="/local.css?v=BOOTSTAMP"'); // ours, so ours to stamp
});

test("sw.js cache name follows the boot stamp and stays no-cache", async () => {
  const res = await app.request("/sw.js");
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain('const VERSION = "BOOTSTAMP"');
  expect(js).not.toContain('"v12"');
  expect(js).toContain("?v=BOOTSTAMP");
  expect(res.headers.get("cache-control")).toBe("no-cache");
});

test("stamped assets are immutable, unstamped ones must revalidate", async () => {
  // Was /app.css, which belonged to the legacy root shell deleted 2026-08-01.
  // The kid app's stylesheet is the same case: a real, served, stampable asset.
  const stamped = await app.request("/kid/kid.css?v=BOOTSTAMP");
  expect(stamped.status).toBe(200);
  expect(stamped.headers.get("cache-control")).toContain("immutable");

  // An unstamped module is NOT content-addressed, so it may not be cached as if it
  // were. It has to say so out loud: with no Cache-Control at all an edge caches a
  // .js by extension, and a deploy that changes any module but the HTML's own entry
  // point stays invisible until that object expires. This bit the live demo.
  const plain = await app.request("/kid/js/main.js");
  expect(plain.status).toBe(200);
  expect(plain.headers.get("cache-control")).toBe("no-cache");

  // The import graph below the entry point is the case that actually broke: the HTML
  // rewrite cannot reach an ES `import`, so these URLs used to arrive bare. They are
  // stamped now, but a direct hit on the bare URL must still revalidate.
  const imported = await app.request("/kid/js/waiting.js");
  expect(imported.status).toBe(200);
  expect(imported.headers.get("cache-control")).toBe("no-cache");
});

test("served JS carries the stamp into its own imports", async () => {
  const res = await app.request("/kid/js/main.js?v=BOOTSTAMP");
  expect(res.status).toBe(200);
  const js = await res.text();
  // Every relative module specifier is versioned, so a deploy cannot be masked by an
  // edge object sitting on the bare URL.
  const bare = [...js.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']*\.js)["']/g)].map((m) => m[1]);
  expect(bare.filter((u) => !u.includes("?v="))).toEqual([]);
  expect(js).toContain('./chart.js?v=BOOTSTAMP');
  // A root-relative dynamic import is just as exposed, and is covered too.
  expect(js).toContain('/kid/js/bridge.js?v=BOOTSTAMP');
  // And the stamped module URL that produces is cacheable for real.
  const stamped = await app.request("/kid/js/waiting.js?v=BOOTSTAMP");
  expect(stamped.headers.get("cache-control")).toContain("immutable");
});

// Redrawn art has to reach the tablet. /assets/ URLs are built from the DATABASE
// (stickers.asset_url), so the HTML rewrite never stamps them, and Bun serves them with
// no validator and no Cache-Control at all — which leaves Cloudflare free to cache the
// .png at the edge by extension and keep serving last week's drawing after a deploy.
// The 2026-08-04 sticker re-cut replaced all 30 files at their existing URLs.
test("an unstamped asset is revalidated, so redrawn art is never invisible", async () => {
  // Was /assets/stickers/star.png until the sticker art left the tree (2026-09-15). The app
  // icon is the one unstamped /assets/ picture that ships regardless, and the rule is the same.
  const res = await app.request("/assets/icon.png");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-cache");
});
