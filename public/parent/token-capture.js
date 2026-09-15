// Pure decision for the magic-link token capture (used by core.js captureFromHash).
// Kept as its own function, with no DOM or globals, so the session-fixation rule can be
// exercised as a function with inputs rather than through the whole boot path.
//
// The magic link IS the auth model: a #t=<token> in the URL fragment supplies the identity.
// Writing an INCOMING token that differs from the current session straight into storage is
// session fixation — a crafted link could swap a signed-in parent onto another household. So a
// differing token is never committed here; it is returned as `pendingSwitch` for an explicit,
// household-named confirmation. A first sign-in (no current token) and a link that matches the
// current session commit normally.
export function decideTokenCapture(hash, currentToken) {
  const tk = /^#t=([0-9a-fA-F]{32,})$/.exec(hash || "");
  const ap = /^#approval=([\w-]+)$/.exec(hash || "");
  const out = { commit: null, pendingSwitch: null, approval: ap ? ap[1] : null, wipe: !!(tk || ap) };
  if (tk) {
    const incoming = tk[1];
    if (!currentToken || currentToken === incoming) out.commit = incoming;
    else out.pendingSwitch = incoming;
  }
  return out;
}
