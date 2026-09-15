// Kid media uploads (hatch photos, task icons, proof shots, recorded sounds).
// Files stay on the family's own server under MEDIA_DIR — self-hosted by design.

import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as repo from "../repo";
import * as media from "../repo-media";
import { parentAuth } from "../auth";
import { familyForSubject, requestFamily } from "./families";
import { mediaDir, unlinkMediaFiles } from "../media-files";
import { sweepExpiredProofs } from "../proof-photos";

// Re-exported because this is where every caller has always imported it from, and the
// definition had to move to a leaf module the repo layer can import (see media-files.ts).
export { mediaDir };

export const mediaRoutes = new Hono();

// ---- media session cookie -------------------------------------------------
// A child's photo is served as a plain <img src="/api/media/:id/file"> with no
// Authorization header, so the bearer that every kid-app fetch() carries cannot reach
// the image request. On an instance that demands auth (mainnet, HATCH_LEGACY_BOOT=0),
// gating the file route on the bearer alone would refuse every legitimate <img>. So a
// short-lived, HMAC-signed HttpOnly cookie is set on the authenticated media surfaces
// (the gated listing and the upload response); the browser then replays it on the img
// request automatically. It only ever names the caller's OWN family, and the file route
// checks that family owns the asset — a cookie for household A can never fetch B's bytes.
// The key is per-process (regenerated on restart), so a stolen cookie dies at the next
// deploy; the client simply re-primes it on its next listing call. Relaxed instances keep
// the open kid-tablet model via familyForSubject's fall-through and never need the cookie.
const MEDIA_COOKIE = "kms";
const cookieKey = randomBytes(32);
const macFor = (familyId: string) =>
  createHmac("sha256", cookieKey).update(familyId).digest("hex").slice(0, 32);

function setMediaCookie(c: Context, familyId: string): void {
  setCookie(c, MEDIA_COOKIE, `${familyId}.${macFor(familyId)}`, {
    httpOnly: true, sameSite: "Lax", path: "/api/media", maxAge: 3600,
  });
}

/** The family id a valid media cookie vouches for, or null. */
function cookieFamily(c: Context): string | null {
  const raw = getCookie(c, MEDIA_COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const familyId = raw.slice(0, dot), mac = raw.slice(dot + 1);
  const expect = macFor(familyId);
  if (mac.length !== expect.length) return null;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expect)) ? familyId : null;
}

/** Whether the caller may read `familyId`'s media: a bearer/open resolution (familyForSubject)
 *  OR a valid media cookie for exactly that family. The cookie is what lets a bare <img> load
 *  on a strict instance where the request carries no Authorization header. */
async function mayReadFamilyMedia(c: Context, familyId: string): Promise<boolean> {
  if (await familyForSubject(c, familyId)) return true;
  return cookieFamily(c) === familyId;
}

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/**
 * A CLIP GETS ITS OWN CEILING, because 5 MB is a photo budget and a demonstration is not a
 * photo. Two minutes of 480p is comfortably past it, and the alternative — squeezing a video
 * under a limit written for a proof snapshot — makes hands on keys unreadable, which is the
 * only thing the clip is for. Still bounded: this is a household instance on a Mac mini.
 */
export const CLIP_MAX_BYTES = 40 * 1024 * 1024;
const MIME_EXT: Record<string, { ext: string; kind: media.MediaKind }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "audio/webm": { ext: "webm", kind: "audio" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "video/mp4": { ext: "mp4", kind: "video" },
};
// WHAT MAY STILL BE UPLOADED. `hatch` and `sticker` are gone (#282): a hatch photo has been
// device-local since the egg timer was vendored in, and a sticker photo now lives in the
// tablet's IndexedDB, so both roles had writers only in code that no longer exists. They stay
// in `MediaRole` because old rows on old instances still carry them; they are simply no
// longer things a client can create. A request naming one gets `invalid_role`.
const ROLES: readonly media.MediaRole[] = ["task_icon", "proof", "sound", "clip"];

mediaRoutes.post("/media", async (c) => {
  // Every new photo pays for the last one: the TTL backstop rides the write path as well as
  // the read path, so a tablet that keeps uploading keeps the instance clean on its own.
  await sweepExpiredProofs();
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "multipart_required" }, 400);
  const file = form.get("file");
  const role = String(form.get("role") ?? "") as media.MediaRole;
  const childId = String(form.get("childId") ?? "");
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
  if (!ROLES.includes(role)) return c.json({ error: "invalid_role" }, 400);
  // The owning kid names the family; family-wide uploads fall back to the request family.
  const child = childId ? repo.getChild(childId) : null;
  if (childId && !child) return c.json({ error: "child_not_found" }, 404);
  const fam = child ? await familyForSubject(c, child.family_id) : await requestFamily(c);
  if (!fam) return c.json({ error: "child_not_found" }, 404);
  const spec = MIME_EXT[file.type];
  if (!spec) return c.json({ error: "unsupported_type", allowed: Object.keys(MIME_EXT) }, 415);
  // The ceiling follows the KIND, not the role: a video is the only thing here that is
  // legitimately bigger than a photo, and `too_large` has to name the limit it actually
  // applied or a parent retries against the wrong number.
  const maxBytes = spec.kind === "video" ? CLIP_MAX_BYTES : MEDIA_MAX_BYTES;
  if (file.size > maxBytes) return c.json({ error: "too_large", maxBytes }, 413);

  const id = crypto.randomUUID();
  const day = new Date();
  const rel = join(
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    `${id}.${spec.ext}`,
  );
  const abs = join(mediaDir(), rel);
  await mkdir(join(mediaDir(), rel, ".."), { recursive: true });
  await Bun.write(abs, file);
  const asset = media.createMedia(fam.id, childId || null, spec.kind, role, file.type, file.size, rel);
  setMediaCookie(c, fam.id); // so the uploader's next bare <img> can load the file
  return c.json({ media: { id: asset.id, role: asset.role, kind: asset.kind, url: `/api/media/${asset.id}/file` } }, 201);
});

mediaRoutes.get("/media", async (c) => {
  const childId = c.req.query("childId");
  if (!childId) return c.json({ error: "childId_required" }, 400);
  // Resolve the owning child and require the caller's family to own it — the same gate the
  // POST and DELETE handlers already apply. On a relaxed instance familyForSubject falls
  // through open (the child id is the capability, the kid-tablet model); on a strict one an
  // anonymous or cross-household caller gets 404 and learns nothing about the child.
  const child = repo.getChild(childId);
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "not_found" }, 404);
  const role = c.req.query("role") as media.MediaRole | undefined;
  const list = media.listMedia(childId, role).map((m) => ({
    id: m.id, role: m.role, kind: m.kind, mime: m.mime, createdAt: m.created_at,
    url: `/api/media/${m.id}/file`,
  }));
  setMediaCookie(c, fam.id); // primes the cookie the bare <img> requests below rely on
  return c.json({ media: list });
});

mediaRoutes.get("/media/:id/file", async (c) => {
  const asset = media.getMedia(c.req.param("id"));
  if (!asset) return c.json({ error: "not_found" }, 404);
  // Only the owning family may read the bytes. familyForSubject covers bearer + relaxed-open;
  // the media cookie covers the bare <img> case that carries no Authorization header.
  if (!(await mayReadFamilyMedia(c, asset.family_id))) return c.json({ error: "not_found" }, 404);
  const f = Bun.file(join(mediaDir(), asset.path));
  if (!(await f.exists())) return c.json({ error: "file_missing" }, 404);
  c.header("Content-Type", asset.mime);
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  return c.body(f.stream());
});

mediaRoutes.delete("/media/:id", async (c) => {
  const asset = media.getMedia(c.req.param("id"));
  const fam = asset ? await familyForSubject(c, asset.family_id) : null;
  if (!asset || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  media.deleteMedia(asset.id);
  await unlinkMediaFiles([asset.path]); // best-effort
  return c.json({ ok: true });
});
