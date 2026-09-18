// gzip on the wire for what shrinks, and never for what does not. Hermetic:
// serveStatic + app.request(), the same shape as cache-busting.test.ts.
import { test, expect } from "bun:test";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compressText } from "./serve-compress";

const app = new Hono();
app.use("/*", compressText());
app.use("/*", serveStatic({ root: "./public" }));
const get = (p: string) => app.request(p, { headers: { "accept-encoding": "gzip, br" } });

test("rive.wasm is gzipped, as application/wasm, to well under half its size", async () => {
  // 2026-09-18: 1.9MB raw was the single biggest thing in front of the egg and the
  // hexagon on a cold load, and both documents fetch it. It gzips to ~782KB.
  const res = await get("/kid/timer/rive-kit/rive.wasm?v=t");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-encoding")).toBe("gzip");
  expect(res.headers.get("content-type")).toContain("application/wasm");   // streaming compile needs it
  expect(res.headers.get("content-length")).toBeNull();                    // the identity length would truncate
  const body = new Uint8Array(await res.arrayBuffer());
  expect(body.byteLength).toBeLessThan(1_000_000);
  expect(body.byteLength).toBeGreaterThan(100_000);
  const raw = Bun.gunzipSync(body);
  expect(raw.byteLength).toBe(Bun.file("./public/kid/timer/rive-kit/rive.wasm").size);
});

test("a .riv is not touched: its images are PNGs already", async () => {
  const res = await get("/kid/timer/rive-kit/eggplate.riv?v=t");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-encoding")).toBeNull();
});

test("the big body is gzipped once per process: the second request is the same bytes, faster", async () => {
  const a = new Uint8Array(await (await get("/kid/timer/rive-kit/rive.wasm?v=t")).arrayBuffer());
  const t0 = performance.now();
  const b = new Uint8Array(await (await get("/kid/timer/rive-kit/rive.wasm?v=u")).arrayBuffer());   // a new stamp, same file
  const ms = performance.now() - t0;
  expect(b).toEqual(a);
  // a fresh gzip of 1.9MB is ~22ms on the Mini; a memo hit is the file read (0.3ms)
  // plus the request. Proven to fail with the memo disabled: 24ms and 27ms.
  expect(ms).toBeLessThan(12);
});
