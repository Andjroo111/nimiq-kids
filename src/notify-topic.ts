// Minting the ntfy topic a parent's phone subscribes to (#124).
//
// Notifications were off unless a parent found Settings and pasted a topic URL into a bare
// `type="url"` input, which is this app asking a non-technical parent to know what ntfy.sh
// is. So every `notifyParent` call was a no-op for a family that never did that: a kid
// finished a chore, the server built a good message with a deep link to that exact approval,
// and dropped it on the floor. The loop's latency became "whenever the parent next remembers
// to open the app", which by week two is not daily.
//
// A TOPIC URL IS A BEARER SECRET. Anyone who has it can read every notification this family
// ever gets, and on ntfy's public server there is nothing else guarding it. That is the whole
// reason a parent must never be asked to invent one: "smith-family-chores" is guessable, and
// a parent typing into a text box will write exactly that.

/** Where topics live. Overridable so a family can point at a self-hosted ntfy without a
 *  code change; the default is the public server the phone app ships pointed at. */
export function ntfyBase(): string {
  return (process.env.HATCH_NTFY_BASE ?? "https://ntfy.sh").replace(/\/+$/, "");
}

/** 24 random bytes as base64url: 32 characters, 192 bits.
 *
 *  base64url rather than a hand-rolled alphabet because its output character set is
 *  `[A-Za-z0-9_-]`, which is EXACTLY what ntfy accepts for a topic, and because mapping
 *  random bytes onto an arbitrary alphabet with `% n` biases the first `256 % n` characters.
 *  That bias is invisible in every test you would think to write and it is real entropy
 *  lost from a bearer secret, so the fix is to not need the modulo at all.
 *
 *  `crypto` is the WebCrypto global, not `Math.random`. This is a secret. */
export function newNotifyTopic(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** The full URL stored in `families.notify_url` and POSTed to by `notifyParent`. */
export function newNotifyUrl(): string {
  return `${ntfyBase()}/${newNotifyTopic()}`;
}

/** ntfy's own topic rule, used to tell a generated URL from a parent's pasted one. */
export const NTFY_TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;
