// Media metadata (family mode). Files live under MEDIA_DIR on the family's own
// server (self-hosted; kid photos never leave the house) — rows here are metadata.

import { getDb } from "./db";

export type MediaKind = "image" | "audio" | "video";
export type MediaRole = "hatch" | "task_icon" | "proof" | "sound" | "sticker" | "clip";

export interface MediaAsset {
  id: string; family_id: string; child_id: string | null;
  kind: MediaKind; role: MediaRole; mime: string; bytes: number; path: string;
  created_at: number;
}

const uid = () => crypto.randomUUID();

export function createMedia(
  familyId: string, childId: string | null, kind: MediaKind, role: MediaRole,
  mime: string, bytes: number, path: string,
): MediaAsset {
  const m: MediaAsset = {
    id: uid(), family_id: familyId, child_id: childId, kind, role, mime, bytes, path,
    created_at: Date.now(),
  };
  getDb().run(
    "INSERT INTO media_assets (id, family_id, child_id, kind, role, mime, bytes, path, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [m.id, m.family_id, m.child_id, m.kind, m.role, m.mime, m.bytes, m.path, m.created_at],
  );
  return m;
}
export function getMedia(id: string): MediaAsset | null {
  return (getDb().query("SELECT * FROM media_assets WHERE id=?").get(id) as MediaAsset) ?? null;
}
export function listMedia(childId: string, role?: MediaRole): MediaAsset[] {
  if (role) {
    return getDb().query("SELECT * FROM media_assets WHERE child_id=? AND role=? ORDER BY created_at DESC")
      .all(childId, role) as MediaAsset[];
  }
  return getDb().query("SELECT * FROM media_assets WHERE child_id=? ORDER BY created_at DESC")
    .all(childId) as MediaAsset[];
}
/**
 * Forget one asset, and anything that points at it.
 *
 * `kid_prefs.hatch_asset_id` is a real FK and the DB runs `PRAGMA foreign_keys = ON`, so
 * the bare DELETE this used to be threw SQLITE_CONSTRAINT_FOREIGNKEY on the one photo a
 * kid was most likely to be deleting — the one they had selected. purgeFamily has always
 * cleared kid_prefs before media_assets; the single-asset path never did.
 *
 * The mode goes back to `surprise` with it. Leaving `hatch_mode='photo'` and a null asset
 * renders fine (util.js checks both), but the Studio sheet reads the mode alone to light
 * up its toggle, so it would show photo mode selected with no photo behind it.
 */
export function deleteMedia(id: string): void {
  const db = getDb();
  db.transaction(() => {
    clearReferences(db, id);
    db.run("DELETE FROM media_assets WHERE id=?", [id]);
  })();
}

/** Every FK that points at a media asset, cleared. Both columns are REAL foreign keys under
 *  `PRAGMA foreign_keys = ON`, so a DELETE that skips either one throws. */
function clearReferences(db: ReturnType<typeof getDb>, id: string): void {
  db.run(
    "UPDATE kid_prefs SET hatch_mode='surprise', hatch_asset_id=NULL, updated_at=? WHERE hatch_asset_id=?",
    [Date.now(), id],
  );
  db.run("UPDATE approvals SET photo_asset_id=NULL WHERE photo_asset_id=?", [id]);
}

/**
 * Forget one approval's proof photo — row, pointer, and the path of the file to unlink.
 *
 * A proof photo is the shortest-lived thing a kid uploads: it exists to answer "did you
 * really do it?", and that question is over the moment the parent decides. Returning the
 * path rather than unlinking here keeps the caller in charge of ordering — the bytes go
 * after the transaction commits (see media-files.ts).
 *
 * Returns null when there was no photo, which is the common case.
 */
export function dropApprovalProof(approvalId: string): string | null {
  const db = getDb();
  const row = db.query(
    "SELECT m.id AS id, m.path AS path FROM approvals a JOIN media_assets m ON m.id = a.photo_asset_id WHERE a.id=?",
  ).get(approvalId) as { id: string; path: string } | null;
  if (!row) return null;
  db.transaction(() => {
    clearReferences(db, row.id);
    db.run("DELETE FROM media_assets WHERE id=?", [row.id]);
  })();
  return row.path;
}

/** Proof photos older than `cutoff` — the TTL backstop's work list, id + path together so
 *  the caller can delete the row and unlink the file without a second query. */
export function expiredProofs(cutoff: number): { id: string; path: string }[] {
  return getDb().query(
    "SELECT id, path FROM media_assets WHERE role='proof' AND created_at < ?",
  ).all(cutoff) as { id: string; path: string }[];
}

// ---- kid prefs (Little Timer trio: hatch / sounds / background) ----
export interface KidPrefs {
  child_id: string; background_id: string; music_id: string;
  timer_sound_id: string; alarm_sound_id: string;
  hatch_mode: "surprise" | "photo"; hatch_asset_id: string | null;
  timer_style_id: string;
  /** The scene behind the running timer. NULL = same as background_id. */
  timer_background_id: string | null;
  updated_at: number;
}

export function getPrefs(childId: string): KidPrefs {
  const db = getDb();
  let p = db.query("SELECT * FROM kid_prefs WHERE child_id=?").get(childId) as KidPrefs | null;
  if (!p) {
    db.run("INSERT INTO kid_prefs (child_id, updated_at) VALUES (?,?)", [childId, Date.now()]);
    p = db.query("SELECT * FROM kid_prefs WHERE child_id=?").get(childId) as KidPrefs;
  }
  return p;
}
export function updatePrefs(
  childId: string,
  patch: Partial<Pick<KidPrefs, "background_id" | "music_id" | "timer_sound_id" | "alarm_sound_id" | "hatch_mode" | "hatch_asset_id" | "timer_style_id" | "timer_background_id">>,
): KidPrefs {
  getPrefs(childId); // ensure row
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [col, v] of [
    ["background_id", patch.background_id], ["music_id", patch.music_id],
    ["timer_sound_id", patch.timer_sound_id], ["alarm_sound_id", patch.alarm_sound_id],
    ["hatch_mode", patch.hatch_mode], ["hatch_asset_id", patch.hatch_asset_id],
    ["timer_style_id", patch.timer_style_id],
    ["timer_background_id", patch.timer_background_id],
  ] as const) {
    if (v !== undefined) { fields.push(`${col}=?`); vals.push(v); }
  }
  if (fields.length) {
    fields.push("updated_at=?");
    vals.push(Date.now(), childId);
    getDb().run(`UPDATE kid_prefs SET ${fields.join(", ")} WHERE child_id=?`, vals as never[]);
  }
  return getPrefs(childId);
}
