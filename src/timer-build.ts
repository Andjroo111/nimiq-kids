// The version token for the vendored egg timer (`public/kid/timer/`).
//
// Andjroo, 2026-07-31: "I have said 'it looks exactly the same' twice in one session
// and neither time could I check." The iframe src carried no version, so a stale copy
// and a slow one looked identical — and nothing under /kid/timer/ could be cached
// either, because a URL that never changes cannot safely be cached hard.
//
// ⚠️ THE TOKEN IS DERIVED, NEVER TYPED. `timer.html` and `wiggle.html` each carry a
// hand-written BUILD string, and hand-written strings get forgotten — that is exactly
// how "it looks the same" happens. This appends the NEWEST FILE TIME in the whole
// vendored tree, so editing any one of the 111 files changes the token whether or not
// anyone remembered to bump anything. Everything the timer pulls is stamped with it
// (see `VER` in timer.html / wiggle.html) and served immutable against it.
//
// ⚠️ THE MTIME IS ALSO WHAT THE ON-SCREEN STAMP SHOWS, as a clock time. That is the
// part Andjroo reads: a copy written at 18:42:07 is a copy written at 18:42:07, and no
// forgotten constant can make it claim otherwise.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "./public/kid/timer";
// A stat walk of 111 files is ~1ms, but the kid HTML is not the only thing that asks.
// Two seconds is short enough that a vendor copy shows up on the next reload.
const RESCAN_MS = 2_000;

let checkedAt = 0;
let token = "";

function newestMs(dir: string): number {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const t = e.isDirectory() ? newestMs(p) : statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

/** `<timer BUILD>-<newest mtime in ms>`, e.g. `tmr-a0844a-1785438127450`. */
export function timerVersion(now: number = Date.now()): string {
  if (token && now - checkedAt < RESCAN_MS) return token;
  checkedAt = now;
  try {
    const ms = Math.round(newestMs(DIR));
    const build = /const BUILD='([^']+)'/.exec(readFileSync(join(DIR, "index.html"), "utf8"))?.[1];
    // ⚠️ 13 digits of epoch ms, and the timer's stamp parses them back out with
    // /-(\d{12,})$/. Keep the mtime last and keep it unpadded.
    token = `${build ?? "timer"}-${ms}`;
  } catch {
    // A missing directory must not take the app down — the timer just goes back to
    // being uncacheable, which is where it started.
    token = token || "timer-0";
  }
  return token;
}
