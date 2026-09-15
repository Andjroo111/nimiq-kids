// Static server for the sound-pack audition site, mounted at /sounds.
//
// Byte-range support is not optional here: iOS Safari will not play media from an origin
// that answers a Range request with a plain 200, so without this the page loads and every
// tap silently does nothing on an iPhone.
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";

const ROOT = new URL("./site", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 3961);
const PREFIX = "/sounds";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json",
};

function typeOf(p: string) {
  const dot = p.lastIndexOf(".");
  return TYPES[p.slice(dot)] ?? "application/octet-stream";
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);

    if (path === PREFIX) return Response.redirect(`${PREFIX}/`, 302);
    if (path.startsWith(PREFIX + "/")) path = path.slice(PREFIX.length);
    if (path === "/" || path === "") path = "/index.html";

    // Contain traversal before touching disk.
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) return new Response("no", { status: 403 });

    let info;
    try {
      info = await stat(file);
    } catch {
      return new Response("not found", { status: 404 });
    }
    if (!info.isFile()) return new Response("not found", { status: 404 });

    const ct = typeOf(file);
    const size = info.size;
    const headers: Record<string, string> = {
      "content-type": ct,
      "accept-ranges": "bytes",
      "cache-control": ct.startsWith("audio/") ? "public, max-age=300" : "no-cache",
    };

    const range = req.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : size - 1;
        if (!m[1] && m[2]) {                       // suffix form: bytes=-500
          start = Math.max(0, size - Number(m[2]));
          end = size - 1;
        }
        if (start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { ...headers, "content-range": `bytes */${size}` },
          });
        }
        end = Math.min(end, size - 1);
        return new Response(Bun.file(file).slice(start, end + 1), {
          status: 206,
          headers: {
            ...headers,
            "content-range": `bytes ${start}-${end}/${size}`,
            "content-length": String(end - start + 1),
          },
        });
      }
    }

    return new Response(Bun.file(file), {
      headers: { ...headers, "content-length": String(size) },
    });
  },
});

console.log(`sound-pack site on http://localhost:${PORT}${PREFIX}/`);
