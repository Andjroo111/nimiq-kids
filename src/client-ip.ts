// Who is calling? One definition, one file.
//
// A rate limit keyed on a value the caller chooses is not a rate limit. Three routes
// had their own private copy of "read `cf-connecting-ip`, else `x-forwarded-for`, else
// `local`" — headers any client can send — so every per-caller brake in the app was
// decorative: send a different forwarded header and you get a fresh bucket, forever.
//
// This is also the shape that broke the demo (see `demo-flag.ts`): a predicate written
// down more than once is a bug with a delay on it. It lives here now, and the callers
// import it.
//
// THE RULE. The socket peer is the only thing a caller cannot forge. A forwarded header
// is believed only when the peer is a proxy we put there ourselves; otherwise the peer
// address IS the identity. When the adapter cannot tell us the peer at all, nothing is
// believed and everyone shares one bucket — the safe direction, since a shared bucket
// over-limits rather than under-limits.

import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

/** Everyone who is not identifiable, together in one bucket. Never a real address. */
export const UNKNOWN_CALLER = "unknown";

/**
 * Trusted proxies, as socket peer addresses.
 *
 * Default: loopback, because the Cloudflare tunnel runs on the same box as the server
 * and connects to `localhost`. Real internet traffic therefore arrives from 127.0.0.1
 * carrying `cf-connecting-ip`, which Cloudflare sets itself and overwrites if the client
 * sent one. A device on the LAN reaching the port directly arrives from its own address,
 * is not trusted, and is keyed on that address no matter what headers it invents.
 *
 * Set `HATCH_TRUSTED_PROXIES` (comma-separated) if the tunnel ever moves off-box. Set it
 * to the empty string to trust no forwarded header at all.
 */
export function trustedProxies(): ReadonlySet<string> {
  const raw = process.env.HATCH_TRUSTED_PROXIES;
  if (raw === undefined) return new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  return new Set(raw.split(",").map((s) => normalize(s.trim())).filter(Boolean));
}

/** IPv4-mapped IPv6 (`::ffff:127.0.0.1`) and the bare form must key the same bucket. */
function normalize(addr: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  return m ? m[1]! : addr;
}

/** The socket peer, or null when the adapter cannot say (tests, non-Bun runtimes). */
export function peerAddress(c: Context): string | null {
  try {
    const addr = getConnInfo(c).remote.address;
    return addr ? normalize(addr) : null;
  } catch {
    return null; // env carries no Bun server — treat as unidentifiable, never as trusted
  }
}

/**
 * The rate-limit identity of this request.
 *
 * Peer first, always. A forwarded header is read only when the peer is a trusted proxy,
 * and `cf-connecting-ip` is preferred over `x-forwarded-for` because Cloudflare sets it
 * from the connection rather than from anything the client typed.
 *
 * For `x-forwarded-for` we take the LAST hop, not the first. A proxy APPENDS what it saw
 * to whatever the client sent, so the leftmost entry is attacker-authored and the
 * rightmost is the one address in that list our own proxy vouched for.
 */
export function clientIp(c: Context): string {
  const peer = peerAddress(c);
  if (peer === null) return UNKNOWN_CALLER;
  if (!trustedProxies().has(peer)) return peer;

  const cf = c.req.header("cf-connecting-ip")?.trim();
  if (cf) return normalize(cf);

  const hops = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const last = hops[hops.length - 1];
  return last ? normalize(last) : peer;
}

/**
 * Tests only: the `env` argument `app.request()` needs before `getConnInfo` can answer,
 * i.e. a stand-in for the Bun server. Without one every request is UNKNOWN_CALLER, which
 * is correct but makes it impossible to test the trusted-proxy path — the one that
 * decides whether a forwarded header is read at all.
 */
export function peerEnv(address: string) {
  return { requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 40000 }) };
}
