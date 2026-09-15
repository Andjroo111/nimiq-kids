// gzip for text responses.
//
// Andjroo, 2026-07-31: the egg timer "feels laggy to load". Measured at 1.6 Mbps, the
// single biggest thing in front of the egg was `wiggle.html` at 195.7 KB — the rig,
// shipped as plain text. `serveStatic` sets no Content-Encoding and neither did
// anything in front of it, so every byte of a 3000-line HTML file crossed the wire
// verbatim. It gzips to about a quarter of that, for one middleware and no change to
// a single asset.
//
// ⚠️ TEXT ONLY. A PNG or a JPEG is already compressed; running deflate over one burns
// CPU to make it very slightly bigger. The content-type test is the whole filter.
//
// ⚠️ THIS MUST BE THE OUTERMOST MIDDLEWARE. src/serve-cache.ts rewrites HTML bodies
// (the version stamps, the timer token) by reading `c.res.text()` — hand it a gzipped
// body and it reads mojibake and writes it back out as the page. Registered first =
// runs outermost = compresses what everything else has finished producing.
import type { MiddlewareHandler } from "hono";

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest|xml)|image\/svg)/;
// Below about a packet there is nothing to win and the gzip header is pure overhead.
const MIN_BYTES = 1024;

export function compressText(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const res = c.res;
    if (res.status !== 200 || res.headers.get("content-encoding")) return;
    if (!COMPRESSIBLE.test(res.headers.get("content-type") ?? "")) return;
    if (!(c.req.header("accept-encoding") ?? "").includes("gzip")) return;

    // ⚠️ Reading the body consumes the stream, so the small-body path has to hand back
    // a rebuilt Response rather than returning — the original can no longer be sent.
    const raw = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    if (raw.byteLength < MIN_BYTES) {
      c.res = new Response(raw, { status: 200, headers });
      return;
    }
    headers.set("content-encoding", "gzip");
    headers.set("vary", "accept-encoding");
    // Both describe the identity body and are now wrong. content-length would truncate
    // the response; a strong etag would have two different bodies under one validator.
    headers.delete("content-length");
    headers.delete("etag");
    c.res = new Response(Bun.gzipSync(raw), { status: 200, headers });
  };
}
