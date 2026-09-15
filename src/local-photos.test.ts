// The client half of #282: a sticker face whose photo is not on this device.
//
// `stickerFace` is the shared renderer both apps draw with, and it is SYNCHRONOUS — it reads
// a warm cache rather than IndexedDB, because the alternative was rewriting every caller to
// await. These tests pin the two outcomes that follow from that: a warmed handle renders the
// picture, and an unwarmed one renders the stand-in rather than a broken <img>.

import { test, expect } from "bun:test";
import { stickerFace } from "../public/js/lib/box-glyphs.js";
import { isLocalPhotoRef, rememberLocalPhoto, resolveLocalPhoto } from "../public/js/lib/local-photos.js";

test("a local handle this device does not hold renders the stand-in, never a broken image", () => {
  const html = stickerFace({ assetUrl: `local:${crypto.randomUUID()}`, label: "My photo" });
  expect(html).toContain("stk-away");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("local:"); // the handle is never emitted as a src
});

test("a warmed handle renders the photo it stands for", () => {
  const ref = `local:${crypto.randomUUID()}`;
  rememberLocalPhoto(ref, "blob:kids/abc");
  expect(resolveLocalPhoto(ref)).toBe("blob:kids/abc");
  const html = stickerFace({ assetUrl: ref, label: "My photo" });
  expect(html).toContain(`src="blob:kids/abc"`);
  expect(html).not.toContain("stk-away");
  // `stk-photo` is what keeps `object-fit: cover` on a photograph. A photo has no
  // silhouette, so filling the circle is what makes it a sticker; the drawn art is the
  // opposite and is fitted whole. Losing this class would silently start cropping one
  // and letterboxing the other, and neither would fail anywhere else.
  expect(html).toContain("stk-photo");
});

test("a server URL still renders as an image — art stickers did not move", () => {
  const html = stickerFace({ assetUrl: "/stickers/space-rocket.png", label: "Rocket" });
  expect(html).toContain(`<img src="/stickers/space-rocket.png"`);
  expect(html).not.toContain("stk-photo"); // drawn art is fitted, never cropped
});

test("isLocalPhotoRef only claims the local: shape", () => {
  expect(isLocalPhotoRef(`local:${crypto.randomUUID()}`)).toBe(true);
  expect(isLocalPhotoRef("/api/media/x/file")).toBe(false);
  expect(isLocalPhotoRef(null)).toBe(false);
  expect(isLocalPhotoRef(undefined)).toBe(false);
});

// A browser with IndexedDB blocked (private mode, or this very test process) must still boot
// the app with placeholder faces rather than throw out of selectChild.
test("warming without IndexedDB is a no-op, not a crash", async () => {
  const { warmLocalPhotos } = await import("../public/js/lib/local-photos.js");
  expect(await warmLocalPhotos("kid-1")).toBe(0);
});
