// Nimiq Pay mini-app glue for the parent app (competition port, slice 1).
//
// A mini app is just a self-hosted HTTPS page loaded in Nimiq Pay's WebView —
// no manifest, no registration. The wallet surface (connect + the native
// sendBasicTransaction approval dialog) is nimiq-app-shell's dual-mode wallet;
// this module owns the small pure pieces around it: the deeplink that opens a
// URL inside Nimiq Pay, the parent-app URL that deeplink should carry, and
// recognizing "the user said no" as a normal outcome rather than an error.
// Pure + isomorphic so src/routes/invites.ts and the tests share it.

/** How long the SDK's init() waits for Nimiq Pay to inject window.nimiq. */
export const MINIAPP_INIT_TIMEOUT_MS = 10_000;

/** Deeplink that opens `url` inside Nimiq Pay's mini-app WebView. */
export function miniAppDeeplink(url: string): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(url)}`;
}

/**
 * The parent-app URL a deeplink should carry. The bearer magic link (#t=...)
 * is how the parent page authenticates (public/parent/core.js), and Nimiq
 * Pay's WebView has its own localStorage — so the token must ride along or
 * the in-wallet session lands signed out. `ref` carries an invite code for
 * invited families (no token — they aren't this household's parent).
 */
export function parentAppUrl(origin: string, token?: string | null, ref?: string | null): string {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const hash = token ? `#t=${token}` : "";
  return `${origin}/parent/${query}${hash}`;
}

/**
 * True when an error is the user declining or closing a wallet dialog
 * (mini-app PermissionDenied-style errors, Hub popup cancel). Call sites
 * treat this as a normal outcome — a calm toast, never an error state.
 *
 * Deliberately strict: a cancel needs USER or PERMISSION context (permission
 * denied, "user rejected", "cancelled by user", popup closed/dismissed) or one
 * of the known SDK literals (the Hub throws a bare "CANCELED" on popup close).
 * Bare "rejected"/"denied"/"cancelled" inside a network or consensus failure
 * ("transaction rejected", "request cancelled: timeout") must surface as a real
 * error, never be swallowed as a calm cancel.
 */
export function isUserCancel(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : typeof err === "string" ? err : "").trim();
  if (/^cancell?ed$/i.test(msg)) return true; // @nimiq/hub-api rejects with exactly 'CANCELED'
  return (
    /permission[_ ]?denied/i.test(msg)
    || /user (?:rejected|denied|declined|cancell?ed|dismissed|closed|aborted)/i.test(msg)
    || /(?:rejected|denied|declined|cancell?ed|dismissed|closed|aborted) by (?:the )?user/i.test(msg)
    || /popup (?:closed|dismissed)/i.test(msg)
  );
}
