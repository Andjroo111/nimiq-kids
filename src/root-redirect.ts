// What "/" serves, per instance.
//
// PUBLIC COMPETITION INSTANCE (HATCH_LEGACY_BOOT=0): "/" is the marketing site,
// public/site/index.html. Judges land on the video and the roadmap, not on an app
// they have to sign into. Until 2026-07-30 this middleware 302'd "/" to /portal/;
// the portal is still there and still does its job, it just is not the bare-domain
// landing any more.
//
// The app did NOT move. /portal/, /parent/ and /kid/ are byte-for-byte where they
// were, so every invite link already in the wild, every nimiqpay:// deep link, the
// mini-app entry (src/miniapp.ts pins /parent/) and every installed PWA keep working.
// Only "/" and "/index.html" change meaning, and only on this instance.
//
// JUDGE-DEMO INSTANCE (HATCH_DEMO_ENABLED=1): "/" still goes straight to /demo. That
// instance exists to hand a visitor a working family, and a pitch page in front of
// it is friction. This branch is what keeps the testnet demo's bare domain working.
//
// FAMILY INSTALL (HATCH_LEGACY_BOOT unset): "/" goes to /portal/, the app chooser.
// It used to serve a legacy demo shell (public/index.html + public/js/app.js), which
// was DELETED 2026-08-01: it was the only surface that still rendered raw chore
// titles, the only place that registered the service worker (so the SW had been
// dead in production since "/" stopped serving it on 2026-07-30), and it carried a
// second, older copy of screens /parent/ and /kid/ already own. A family install is
// an app install, not a marketing surface, so the portal is the right landing.
//
// If public/site/index.html is ever missing (a half-finished deploy) we fall back to
// the /portal/ redirect rather than 404 the bare domain — which is now also what the
// family install does, so there is one fallback rather than two behaviours.
import type { MiddlewareHandler } from "hono";
import { demoSeedEnabled } from "./routes/demo";

/** The marketing page. Relative to cwd, the same convention serveStatic's root uses. */
const SITE_HTML = "./public/site/index.html";

/**
 * The YouTube id out of any shape of watch/share/embed/shorts URL, or null.
 * A bare id (11 chars, no slashes) is accepted as-is so VIDEO_URL can be set to
 * either the full link or just the id without anyone having to remember which.
 */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/**
 * ONE switch for the walkthrough: the VIDEO_URL env var.
 *
 * It already drives GET /video (src/server.ts). This makes it drive the player on
 * the marketing page too, by substituting the id into the page's own `VIDEO_ID`
 * constant at serve time. The page keeps working exactly as written, so it can
 * still be hardcoded by editing the file, but on a deployed instance setting the
 * env var is enough: no code edit, no PR, no rebuild.
 *
 * Set it on the Mini in ~/gdkc/secrets/hatch-competition.env, then
 *   launchctl kickstart -k gui/$(id -u)/com.hatch.competition
 *
 * A non-YouTube VIDEO_URL (Loom, Vimeo, a file) is left alone here: /video still
 * redirects to it, and the page keeps its placeholder rather than building an
 * iframe for an embed shape this page does not know how to render.
 */
export function applyVideoUrl(html: string, url = process.env.VIDEO_URL): string {
  const id = youtubeId(url ?? "");
  if (!id) return html;
  return html.replace(/const VIDEO_ID = "[^"]*";/, `const VIDEO_ID = ${JSON.stringify(id)};`);
}

export const rootRedirectWhenLegacyClosed: MiddlewareHandler = async (c, next) => {
  if (
    (c.req.path === "/" || c.req.path === "/index.html")
    && (c.req.method === "GET" || c.req.method === "HEAD")
  ) {
    if (demoSeedEnabled()) return c.redirect("/demo", 302);
    // The marketing page is the competition instance's landing and is gated on the
    // flag; a family install has no marketing page to serve and goes to the app.
    if (process.env.HATCH_LEGACY_BOOT === "0") {
      const file = Bun.file(SITE_HTML);
      if (await file.exists()) return c.html(applyVideoUrl(await file.text()));
    }
    return c.redirect("/portal/", 302);
  }
  await next();
};
