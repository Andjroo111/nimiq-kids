// Minimal ambient types for local-photos.js so src/local-photos.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same pattern and
// same caveat as public/js/lib/esc.d.ts: local-photos.js is the implementation of record.

/** Whether a sticker's assetUrl is a `local:<uuid>` handle rather than a server URL. */
export function isLocalPhotoRef(url: unknown): boolean;

/** The object URL for a handle warmed on THIS device, or null. Synchronous by design —
 *  stickerFace() renders inside markup built by a dozen callers and cannot await. */
export function resolveLocalPhoto(ref: string): string | null;

/** Put a handle's object URL into the synchronous cache. */
export function rememberLocalPhoto(ref: string, url: string): string;

/** File a photo in this device's IndexedDB. Returns its `local:<uuid>` handle.
 *  Rejects on a full disk — the caller has to say so rather than lose the photo. */
export function saveLocalPhoto(kidId: string, blob: Blob): Promise<string>;

/** Load one kid's photos into the cache, replacing whoever was warm before. Never rejects:
 *  a browser with IndexedDB blocked gets placeholder faces, not a failed boot. */
export function warmLocalPhotos(kidId: string): Promise<number>;

/** Every warmed object URL — the local pool the polaroid rig draws from. */
export function localPhotoUrls(): string[];

/** Forget one photo on this device. The sticker row outlives it as a placeholder. */
export function deleteLocalPhoto(ref: string): Promise<void>;
