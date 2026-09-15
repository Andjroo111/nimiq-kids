// SSRF guard for operator-supplied outbound URLs (families.notify_url). The parent-notify
// webhook is fetched server-side, from inside the Mac Mini's trust boundary — which reaches
// localhost business-ops services and a private LAN — so an unvalidated URL is a blind POST
// primitive against internal hosts. Every notify_url must be https and must not resolve to a
// private, loopback, link-local or unique-local address.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** True for loopback / private / link-local / ULA / unspecified / multicast addresses. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0) return true;                          // 0.0.0.0/8 "this host"
    if (a === 10) return true;                         // 10/8 private
    if (a === 127) return true;                        // 127/8 loopback
    if (a === 169 && b === 254) return true;           // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12 private
    if (a === 192 && b === 168) return true;           // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true;                          // 224/4 multicast + 240/4 reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::1" || s === "::") return true;                 // loopback / unspecified
    if (s.startsWith("fe80") || s.startsWith("febf")) return true; // link-local fe80::/10
    if (s.startsWith("fc") || s.startsWith("fd")) return true;  // fc00::/7 unique-local
    if (s.startsWith("ff")) return true;                        // ff00::/8 multicast
    const mapped = s.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:a.b.c.d
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not a recognizable IP literal — caller decides via hostname rules
}

function blockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost"
    || h.endsWith(".localhost") || h.endsWith(".local")
    || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa");
}

const bareHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, "");

/** Fast, DNS-free structural check: https + not an obviously-internal literal/hostname.
 *  Used to reject junk with a 400 before spending a DNS lookup; the real gate is the async one. */
export function notifyUrlShapeOk(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = bareHost(u);
  if (!host) return false;
  if (blockedHostname(host)) return false;
  if (isIP(host) && isPrivateIp(host)) return false;
  return true;
}

/** Full gate: shape check plus DNS resolution — every resolved address must be public.
 *  Unresolvable hosts are refused rather than fetched blindly. */
export async function notifyUrlSafe(raw: string): Promise<boolean> {
  if (!notifyUrlShapeOk(raw)) return false;
  const host = bareHost(new URL(raw));
  if (isIP(host)) return !isPrivateIp(host); // literal already vetted by shape check
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
