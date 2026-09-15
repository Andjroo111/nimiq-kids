// The portal chooser (public/portal/) is the bare-domain landing on the public
// instance and the only unauthenticated path to the kid sign-in inside Nimiq
// Pay's WebView. Its auto-route script hard-codes the two localStorage token
// keys — pin them to the app code so a rename can't silently strand returning
// devices on the chooser (or worse, stop auto-routing them).
import { test, expect } from "bun:test";

const read = (rel: string) => Bun.file(new URL(rel, import.meta.url)).text();
const html = await read("../public/portal/index.html");

test("portal offers both apps, unauthenticated", () => {
  expect(html).toContain('href="/parent/"');
  expect(html).toContain('href="/kid/"');
});

test("portal auto-route reads the real token keys", async () => {
  const parentKey = (await read("../public/parent/core.js")).match(/TOKEN_KEY = "([^"]+)"/)?.[1];
  const kidKey = (await read("../public/kid/js/api.js")).match(/TOKEN_KEY = "([^"]+)"/)?.[1];
  expect(parentKey).toBeTruthy();
  expect(kidKey).toBeTruthy();
  expect(html).toContain(`localStorage.getItem("${parentKey}")`);
  expect(html).toContain(`localStorage.getItem("${kidKey}")`);
});

test("portal translates through the shared shell", () => {
  expect(html).toContain("/dist/app-shell.js");
  for (const key of ["app.portalTitle", "app.portalParent", "app.portalKid"]) {
    expect(html).toContain(`data-t="${key}"`);
  }
});
