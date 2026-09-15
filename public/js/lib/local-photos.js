// A kid's photographs, on the kid's device, and nowhere else.
//
// Andjroo, 2026-08-03: "This needs to be noncustodial. So if we're syncing anything to the
// server, we should get rid of that." A photo sticker is the kid's own face; it now lives in
// this browser's IndexedDB and the server is told only the handle (`local:<uuid>`) that the
// sticker row carries. Prior art: NimConnect keeps its private layer local the same way
// (nimiq-recon C1-248), and VeriLock's rule is the sharper version of it — files never leave
// the device (C1-237).
//
// WHY IndexedDB AND NOT localStorage. localStorage is ~5MB per origin, strings only (a photo
// pays a ~33% base64 tax on the way in), and it fails by THROWING at quota — that throw is
// the bug behind #277, where a kid could fill the egg timer's photo tray and then silently
// be unable to add another. IndexedDB stores a Blob natively and its quota is a share of
// free disk.
//
// WHY A WARM CACHE. `stickerFace()` in box-glyphs.js renders a face synchronously, inside
// markup built by a dozen callers; an async read there would mean rewriting every one of
// them or flashing a placeholder on every render. So the active kid's photos are read once
// at `selectChild` and held as object URLs in a Map that `resolveLocalPhoto` reads with no
// await. A ref that is not in the Map — another kid, another device — renders the "photo
// lives on the other tablet" face, which is the accepted consequence of local bytes.

const DB_NAME = "kidphotos";
const DB_VERSION = 1;
const STORE = "photos";
const PREFIX = "local:";

/** ref -> object URL, for the kid currently warmed. Cleared on every warm. */
const urls = new Map();

export function isLocalPhotoRef(url) {
  return typeof url === "string" && url.startsWith(PREFIX);
}

/** The object URL for a handle, or null when this device does not hold that photo. Sync. */
export function resolveLocalPhoto(ref) {
  return urls.get(ref) ?? null;
}

/** Remember a handle's object URL for the synchronous resolver. */
export function rememberLocalPhoto(ref, url) {
  urls.set(ref, url);
  return ref;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no_indexeddb"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by the ref itself; `kidId` is the namespace — one shared tablet is ONE
        // origin, so a sibling's photos have to be excluded by index, not by database.
        db.createObjectStore(STORE, { keyPath: "ref" }).createIndex("kidId", "kidId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * File a photo on this device. Returns its `local:<uuid>` handle, which is the only part of
 * it that ever reaches the server.
 *
 * Throws on a full disk (`QuotaExceededError`) — the caller has to say so out loud rather
 * than drop the photo silently, which is the other half of the #277 bug.
 */
export async function saveLocalPhoto(kidId, blob) {
  const ref = `${PREFIX}${crypto.randomUUID()}`;
  const db = await openDb();
  try {
    await tx(db, "readwrite", (store) => store.put({ ref, kidId, blob, createdAt: Date.now() }));
  } finally {
    db.close();
  }
  return rememberLocalPhoto(ref, URL.createObjectURL(blob));
}

/**
 * Load one kid's photos into the synchronous cache. Call before rendering anything that can
 * contain a sticker face — `selectChild` does, so a kid switch swaps the whole set.
 *
 * Never throws: a browser in private mode with IndexedDB blocked must still run the app,
 * just with placeholder faces.
 */
export async function warmLocalPhotos(kidId) {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  let db = null;
  try {
    db = await openDb();
    const rows = await tx(db, "readonly", (store) => store.index("kidId").getAll(kidId));
    for (const row of rows ?? []) {
      if (row?.blob) rememberLocalPhoto(row.ref, URL.createObjectURL(row.blob));
    }
  } catch {
    // no store, no photos, placeholder faces — not a reason to fail a boot
  } finally {
    db?.close();
  }
  return urls.size;
}

/** Every warmed handle, newest last — the local pool the polaroid draws from. */
export function localPhotoUrls() {
  return [...urls.values()];
}

/** Forget one photo on this device. The sticker row on the server outlives it as a placeholder. */
export async function deleteLocalPhoto(ref) {
  const url = urls.get(ref);
  if (url) { URL.revokeObjectURL(url); urls.delete(ref); }
  let db = null;
  try {
    db = await openDb();
    await tx(db, "readwrite", (store) => store.delete(ref));
  } catch {
    // already gone, or no store to delete it from
  } finally {
    db?.close();
  }
}
