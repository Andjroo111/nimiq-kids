// Nimiq Cashlink codec — VERIFIED against nimiq/hub Cashlink.ts and @nimiq/core@2.5.1.
// See docs/NIMIQ-CASHLINK-REFERENCE.md. This file is isomorphic (no @nimiq/core import) so it
// runs in both Bun and the browser. A Cashlink is a bearer link: the URL #fragment carries the
// 32-byte private key of a freshly-funded address, so the recipient claims with no account.
//
// Byte layout: privateKey(32) || value(uint64 BE, 8) || [msgLen(1) || msg] (if msg or theme) || [theme(1) if !=0]
// Then base64url (+→-, /→_, keep '=' padding) and insert '~' every 256 chars (WhatsApp/iPhone fix).

/**
 * The bytes Nimiq Wallet looks for to recognise a transaction as a Cashlink funding.
 *
 * Quoted from `nimiq/hub` `src/lib/Cashlink.ts`, which derives it as
 * `'CASH'.split('').map(c => c.charCodeAt(0) + 63)` behind a leading 0:
 *
 *     FUNDING:  new Uint8Array([0, 130, 128, 146, 135])   // 'CASH'
 *     CLAIMING: new Uint8Array([0, 139, 136, 141, 138])   // 'LINK'
 *
 * Only FUNDING is ours to write. The claim transaction is built by whichever wallet claims
 * the link, so CLAIMING is recorded here for recognition only and is deliberately unused.
 *
 * ⚠️ THESE ARE BYTES, NOT A STRING, AND THE DIFFERENCE IS THE WHOLE BUG. Four of the five
 * are above 0x7F, so round-tripping them through a JS string and `TextEncoder` yields the
 * UTF-8 encoding of U+0082, U+0080, U+0092, U+0087 — nine bytes (`00 c2 82 c2 80 c2 92
 * c2 87`), not five. That is a transaction no wallet recognises, written by code that looks
 * exactly like it wrote the marker. This is why `SendTxOptions` carries `extraDataBytes`.
 */
export const CASHLINK_FUNDING_MARKER = new Uint8Array([0, 130, 128, 146, 135]);

/** The counterpart marker, written by the CLAIMING wallet. Here for recognition only. */
export const CASHLINK_CLAIMING_MARKER = new Uint8Array([0, 139, 136, 141, 138]);

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(str: string): Uint8Array {
  // Accept both '=' (what render() emits) and '.' padding (Nimiq BufferUtils' native pad char),
  // so we decode links regardless of which wallet/version produced them.
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode the cashlink payload (the part after `#`). `privKey` = privateKey.serialize() (32 bytes). */
export function encodeCashlinkPayload(
  privKey: Uint8Array,
  valueLuna: number,
  message = "",
  theme = 0,
): string {
  if (privKey.length !== 32) throw new Error(`cashlink privKey must be 32 bytes, got ${privKey.length}`);
  const msg = new TextEncoder().encode(message);
  if (msg.length > 255) throw new Error("cashlink message too long (max 255 bytes)");
  const hasMsgOrTheme = msg.length > 0 || theme !== 0;
  const len = 32 + 8 + (hasMsgOrTheme ? 1 + msg.length : 0) + (theme !== 0 ? 1 : 0);
  const buf = new Uint8Array(len);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set(privKey, o); o += 32;
  view.setBigUint64(o, BigInt(valueLuna), false); o += 8; // big-endian
  if (hasMsgOrTheme) { buf[o++] = msg.length; buf.set(msg, o); o += msg.length; }
  if (theme !== 0) buf[o++] = theme;
  return toBase64Url(buf).replace(/[A-Za-z0-9_]{257,}/g, (m) => m.replace(/.{256}/g, "$&~"));
}

export interface DecodedCashlink {
  priv: Uint8Array;
  value: number;
  message: string;
  theme: number;
}

export function decodeCashlinkPayload(payload: string): DecodedCashlink {
  const bytes = fromBase64Url(payload.replace(/~/g, ""));
  if (bytes.length < 40) throw new Error("cashlink payload too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const priv = bytes.slice(0, 32);
  const value = Number(view.getBigUint64(32, false));
  let o = 40, message = "", theme = 0;
  if (o < bytes.length) {
    const mlen = bytes[o++];
    message = new TextDecoder().decode(bytes.slice(o, o + mlen)); o += mlen;
    if (o < bytes.length) theme = bytes[o++];
  }
  return { priv, value, message, theme };
}

/** Extract the payload from a full cashlink URL (`https://.../cashlink/#<payload>`). */
export function payloadFromUrl(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(i + 1) : url;
}
