// Invite-a-family (competition build). The parent shares a link carrying the
// family's referral code; the public landing page warmly explains nimiq.kids and
// opens it inside Nimiq Pay. Attribution is recorded server-side so a
// both-sides bonus can be granted later — the automatic bonus itself is
// deferred (docs/ROADMAP.md Phase 1). Guardrail: nothing is collected about
// the invited household beyond "this code was accepted at this time".

import { Hono } from "hono";
import type { Context } from "hono";
import * as referrals from "../repo-referrals";
import { ACCEPT_DEDUPE_WINDOW_MS } from "../repo-referrals";
import * as wrepo from "../repo-wallet";
import * as repo from "../repo";
import { parentFamilyFrom, requireParent, sha256Hex } from "../auth";
import { miniAppDeeplink, parentAppUrl } from "../miniapp";
import { clientIp } from "../client-ip";

export const invitesRoutes = new Hono(); // mounted under /api
export const inviteLanding = new Hono(); // site pages (GET /invite/:code)

/** Public origin for share links: PARENT_URL's origin when configured (the
 *  tunnel hostname), else the request's own origin. */
export function siteOrigin(reqUrl: string): string {
  const p = process.env.PARENT_URL;
  if (p) {
    try { return new URL(p).origin; } catch { /* malformed env — use the request */ }
  }
  return new URL(reqUrl).origin;
}

/** The family's invite code + shareable landing URL (+ how often it was used). */
invitesRoutes.get("/family/invite", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const invite = referrals.getOrCreateInvite(fam.id);
  return c.json({
    code: invite.code,
    shareUrl: `${siteOrigin(c.req.url)}/invite/${invite.code}`,
    accepted: referrals.countAccepts(invite.code),
    joined: referrals.countJoins(invite.code),
  });
});

/**
 * The per-instance secret that turns the dedupe digest into a MAC.
 *
 * Without it the digest is a LOOKUP, not a hash. The only input an attacker does not
 * already hold is the IP — the `code` half is stored in the very same row — and IPv4 is
 * 2^32 candidates, a few minutes of hashing. Recover one row's IP and the same candidate
 * set inverts every other row in the table. Under GDPR an IP is personal data and an
 * unkeyed hash of it still is; here it would say "this address, at this time, accepted an
 * invite from the <named> family", which is an approximate home location tied to a
 * specific household using a children's app.
 *
 * `HATCH_IP_PEPPER` overrides. Otherwise a random one is minted on first use and kept in
 * `wallet_state`, which is the instance's existing key/value store and already holds
 * instance-wide values that must survive a household purge (the HD high-water mark). It is
 * deliberately NOT derived from HATCH_MASTER_SEED: coupling a privacy pepper to the money
 * seed means leaking either one leaks the other's derivation.
 */
const IP_PEPPER_KEY = "referral_ip_pepper";
function ipPepper(): string {
  const fromEnv = process.env.HATCH_IP_PEPPER;
  if (fromEnv) return fromEnv;
  const stored = wrepo.getWalletState(IP_PEPPER_KEY);
  if (stored) return stored;
  const minted = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  wrepo.setWalletState(IP_PEPPER_KEY, minted);
  return minted;
}

/**
 * Truncated MAC of (pepper|day|code|ip) for accept dedupe. Never a raw IP, never stored
 * beyond the dedupe window, and not invertible without the instance's own secret.
 *
 * The caller's identity comes from ../client-ip, so a visitor cannot mint a fresh dedupe
 * bucket per tap by inventing a forwarded header; when nobody is identifiable they all
 * share one bucket (deduped hardest, which errs on the safe side).
 *
 * THE DAY BUCKET IS PART OF THE INPUT, so the digest for one visitor changes every day and
 * yesterday's rows cannot be correlated with today's even by someone holding the pepper.
 * The value exists only to dedupe inside `ACCEPT_DEDUPE_WINDOW_MS`, so it has no reason to
 * be stable for longer than that. One cost, stated: a visitor tapping twice across a bucket
 * boundary lands in two buckets and is counted twice. `MAX_ACCEPTS_PER_CODE` is what bounds
 * the abuse case; the dedupe is a tidiness measure on top of it.
 */
async function acceptIpHash(c: Context, code: string): Promise<string> {
  const day = Math.floor(Date.now() / ACCEPT_DEDUPE_WINDOW_MS);
  return (await sha256Hex(`${ipPepper()}|${day}|${code}|${clientIp(c)}`)).slice(0, 16);
}

/** Public: the landing page calls this when the visitor taps through to Nimiq
 *  Pay (or copies the link) — the attribution row a later bonus grant needs.
 *  Deduped per IP hash per rolling day + row-capped (repo-referrals), so the
 *  count is not spammable and the table stays bounded. Dedupe/cap hits still
 *  answer ok — the visitor did nothing wrong. */
invitesRoutes.post("/invites/:code/accept", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!referrals.getInvite(code)) return c.json({ error: "not_found" }, 404);
  referrals.recordAccept(code, await acceptIpHash(c, code));
  return c.json({ ok: true });
});

// ---- the landing page (public, no auth, English v1) ----

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Shared page chrome: Nimiq navy gradient, Mulish, one white card. */
function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escHtml(title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<style>
@font-face { font-family: Mulish; font-style: normal; font-weight: 200 1000; font-display: swap;
  src: url("/fonts/mulish-latin-wght-normal.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px;
  font-family: Mulish, system-ui, sans-serif; color: #1F2348;
  background: radial-gradient(100% 100% at bottom right, #260133, #1F2348); }
.card { width: 100%; max-width: 420px; background: #fff; border-radius: 12px;
  padding: 32px 24px 28px; text-align: center; box-shadow: 0 8px 56px rgba(0,0,0,.2); }
.hex-logo { display: inline-flex; }
.hex-logo svg { width: 48px; height: 44px; }
h1 { font-size: 24px; line-height: 1.25; margin: 14px 0 4px; text-wrap: balance; }
.brand { white-space: nowrap; }
p { font-size: 15px; line-height: 1.55; color: rgba(31,35,72,.75); margin-top: 12px; }
p.privacy { font-size: 13px; color: rgba(31,35,72,.55); }
.btn { display: block; width: 100%; margin-top: 20px; padding: 14px 20px; border: 0;
  border-radius: 999px; font: 700 16px Mulish, system-ui, sans-serif; cursor: pointer;
  text-decoration: none; color: #fff;
  background: radial-gradient(100% 100% at bottom right, #265DD7, #0582CA); }
.btn.ghost { margin-top: 10px; color: #1F2348; background: rgba(31,35,72,.07); font-weight: 600; }
.hint { font-size: 13px; color: rgba(31,35,72,.55); margin-top: 12px; }
</style>
</head>
<body>
<main class="card">${body}</main>
</body>
</html>`;
}

function landingPage(opts: { label: string; code: string; deeplink: string; appUrl: string }): string {
  const inviter = escHtml(opts.label);
  const body = `
<div class="hex-logo" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18"><g fill="none"><path fill="url(#inv-hex-grad)" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688"/><defs><radialGradient id="inv-hex-grad" cx="0" cy="0" r="1" gradientTransform="matrix(20.1956 0 0 20.2552 15.188 17.766)" gradientUnits="userSpaceOnUse"><stop stop-color="#ec991c"/><stop offset="1" stop-color="#e9b213"/></radialGradient></defs></g></svg></div>
<h1>${inviter}'s family invited you to <span class="brand">nimiq.kids</span></h1>
<p>nimiq.kids turns chores into allowance kids can watch grow. Parents fund it, approve every payout, and can pause it any time.</p>
<p>Kids get a friendly tablet chart with stickers and timers, and real savings that arrive the moment you say "well done".</p>
<p class="privacy">No accounts for kids, no ads, no tracking.</p>
<a class="btn" id="open" href="${escHtml(opts.deeplink)}">Open in Nimiq Pay</a>
<button class="btn ghost" id="copy">Copy the link for later</button>
<div class="hint" id="hint">You'll need the free Nimiq Pay app on your phone.</div>
<script>
  var CODE = ${JSON.stringify(opts.code)};
  var APP_URL = ${JSON.stringify(opts.appUrl)};
  function accept() {
    try { fetch("/api/invites/" + CODE + "/accept", { method: "POST", keepalive: true }); } catch (e) {}
  }
  document.getElementById("open").addEventListener("click", accept);
  document.getElementById("copy").addEventListener("click", function () {
    accept();
    if (navigator.clipboard) navigator.clipboard.writeText(APP_URL).catch(function () {});
    document.getElementById("hint").textContent = "Link copied. See you soon!";
  });
</script>`;
  return page(`${opts.label}'s family invited you to nimiq.kids`, body);
}

const notFoundPage = () =>
  page("nimiq.kids", `
<div class="hex-logo" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18"><g fill="none"><path fill="url(#inv-hex-grad-2)" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688"/><defs><radialGradient id="inv-hex-grad-2" cx="0" cy="0" r="1" gradientTransform="matrix(20.1956 0 0 20.2552 15.188 17.766)" gradientUnits="userSpaceOnUse"><stop stop-color="#ec991c"/><stop offset="1" stop-color="#e9b213"/></radialGradient></defs></g></svg></div>
<h1>This invite link isn't right</h1>
<p>Check the link with the family who sent it and try again.</p>`);

inviteLanding.get("/invite/:code", (c) => {
  const invite = referrals.getInvite(c.req.param("code").toUpperCase());
  if (!invite) return c.html(notFoundPage(), 404);
  const fam = repo.getFamily(invite.family_id);
  if (!fam) return c.html(notFoundPage(), 404);
  const origin = siteOrigin(c.req.url);
  const appUrl = parentAppUrl(origin, null, invite.code);
  return c.html(landingPage({
    label: fam.parent_label,
    code: invite.code,
    deeplink: miniAppDeeplink(appUrl),
    appUrl,
  }));
});
