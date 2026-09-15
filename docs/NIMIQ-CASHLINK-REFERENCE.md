# Nimiq Cashlink — Verified Technical Reference

> **This file is ground truth.** Every API signature and the cashlink codec below were
> verified against the real `@nimiq/core@2.5.1` package running in Bun on 2026-05-30
> (keypair → address → encode → decode → rebuilt-address round-trip all pass), and the
> byte format was cross-checked against the canonical `nimiq/hub` `src/lib/Cashlink.ts`.
> Where `docs/SPEC.md` and this file disagree, **this file wins.**

## TL;DR corrections to SPEC.md

- ❌ There is **no `Cashlink` class** in `@nimiq/core` or `@nimiq/utils`. We hand-roll the
  codec (below). `@nimiq/utils/request-link-encoding` is for *payment request* links
  (`nimiq:<addr>?amount=`), which are a **different thing** — do not use them for cashlinks.
- ❌ `tx.hash()` already returns a **hex string** — do **not** call `.toHex()` on it.
- ✅ Sign with `tx.sign(keyPair, undefined)` **or** `keyPair.signTransaction(tx)` (mutates tx).
- ✅ `@nimiq/core@2.5.1` has **no `BufferUtils`/`SerialBuffer`** exports — use the codec below.
- ✅ Crypto primitives (`KeyPair`, `PrivateKey`, `Address`) load in Bun server-side with **no
  network client** and **no manual WASM init** — a plain `import` is enough.

## Package

```jsonc
// package.json
"@nimiq/core": "2.5.1"   // Albatross PoS web-client WASM (crypto + light client)
```
Lazy-import to keep WASM off the cold path: `const Nimiq = await import("@nimiq/core")`.

## Verified API surface (v2.5.1)

```ts
// keys & addresses
Nimiq.KeyPair.generate(): KeyPair
Nimiq.KeyPair.derive(priv: PrivateKey): KeyPair
keyPair.privateKey: PrivateKey
keyPair.toAddress(): Address
keyPair.signTransaction(tx: Transaction): void        // mutates tx, sets proof
Nimiq.PrivateKey.deserialize(bytes: Uint8Array): PrivateKey   // 32 bytes
Nimiq.PrivateKey.fromHex(hex): PrivateKey
priv.serialize(): Uint8Array                          // 32 bytes
priv.toHex(): string
Nimiq.Address.fromUserFriendlyAddress(s: string): Address
addr.toUserFriendlyAddress(): string

// transactions
Nimiq.TransactionBuilder.newBasic(sender, recipient, value: bigint, fee: bigint|null, validityStartHeight: number, networkId: number): Transaction
Nimiq.TransactionBuilder.newBasicWithData(sender, recipient, data: Uint8Array, value: bigint, fee: bigint|null, validityStartHeight: number, networkId: number): Transaction
tx.sign(keyPair, undefined): void                     // OR keyPair.signTransaction(tx)
tx.hash(): string                                     // hex — DO NOT .toHex() it
tx.serialize(): Uint8Array
tx.toHex(): string

// client (light client; connects over wss to seed nodes)
const config = new Nimiq.ClientConfiguration()
config.network("testalbatross")                       // testnet; default is "mainalbatross"
const client = await Nimiq.Client.create(config.build())
await client.waitForConsensusEstablished()
await client.getHeadHeight(): Promise<number>
await client.getNetworkId(): Promise<number>          // pass to TransactionBuilder
await client.sendTransaction(tx): Promise<PlainTransactionDetails>
await client.getAccount(addr): Promise<PlainAccount>  // .balance is a number (luna)
await client.getTransactionsByAddress(addr, ...): Promise<PlainTransactionDetails[]>
client.addTransactionListener(cb, [addr]): Promise<number>   // post-MVP push upgrade
```

Notes:
- `1 NIM = 100_000 luna`. Values are `bigint` in the builder, `number` luna in `PlainAccount.balance`.
- Albatross confirmations are ~1 s. Always `await waitForConsensusEstablished()` once before
  reading balances; reuse a **singleton** client.
- For server use the package main (`nodejs/index.js`) resolves automatically; the same `import`
  works in the browser PWA (`bundler`/`web` build) — keep the codec isomorphic.

## The Cashlink codec (VERIFIED, copy-pasteable)

A Nimiq Cashlink is a **bearer link**: the URL fragment carries the *private key* of a freshly
generated address that the sender funds. Whoever opens the link can sweep the funds — so the kid
claims with **no account**. Byte layout (from `nimiq/hub` `Cashlink.ts`):

```
privateKey            32 bytes
value                  8 bytes   uint64, BIG-ENDIAN, luna
[ if message or theme ]
  messageLength        1 byte
  message              N bytes   UTF-8
[ if theme != 0 ]
  theme                1 byte
```
Then `base64url` (`+`→`-`, `/`→`_`), keep `=` padding, and insert `~` every 256 chars (WhatsApp/iPhone
URL-wrapping fix; harmless for short links). Parsing strips `~`, base64url-decodes, reads the layout.

```ts
// shared/nimiq/cashlink-codec.ts  (isomorphic, ~70 lines, NO @nimiq/core needed here)
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");   // keeps '=' padding, like hub
}
function fromBase64Url(str: string): Uint8Array {
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode the cashlink payload (the part after `#`). `privKey` = priv.serialize() (32 bytes). */
export function encodeCashlinkPayload(privKey: Uint8Array, valueLuna: number, message = "", theme = 0): string {
  const msg = new TextEncoder().encode(message);
  const hasMsgOrTheme = msg.length > 0 || theme !== 0;
  const len = 32 + 8 + (hasMsgOrTheme ? 1 + msg.length : 0) + (theme !== 0 ? 1 : 0);
  const buf = new Uint8Array(len);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set(privKey, o); o += 32;
  view.setBigUint64(o, BigInt(valueLuna), false); o += 8;       // big-endian
  if (hasMsgOrTheme) { buf[o++] = msg.length; buf.set(msg, o); o += msg.length; }
  if (theme !== 0) buf[o++] = theme;
  return toBase64Url(buf).replace(/[A-Za-z0-9_]{257,}/g, (m) => m.replace(/.{256}/g, "$&~"));
}

export function decodeCashlinkPayload(payload: string) {
  const bytes = fromBase64Url(payload.replace(/~/g, ""));
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
```

### Base URL (the one empirical unknown)
The base URL prefix is a single constant. Default:
```ts
export const CASHLINK_BASE = NETWORK === "test"
  ? "https://hub.nimiq-testnet.com/cashlink/#"
  : "https://hub.nimiq.com/cashlink/#";
```
> ⚠️ **Verify in Phase 4** by actually opening a generated testnet link in a phone browser and
> confirming the Nimiq wallet loads + offers to claim. If the live wallet expects
> `wallet.nimiq(-testnet).com/cashlink/#` instead, swap this ONE constant. Everything else is proven.

## Mint flow (the load-bearing path)

```ts
// 1. generate the cashlink keypair (holds funds in transit)
const Nimiq = await import("@nimiq/core");
const clKey  = Nimiq.KeyPair.generate();
const clAddr = clKey.toAddress();                       // the address we POLL for claim

// 2. fund it from the PARENT wallet via the WalletProvider abstraction (never via app funds)
const fundingTxHash = await provider.sendTransaction({
  recipient: clAddr.toUserFriendlyAddress(),
  valueLuna,                                            // include fee headroom in funding if fee>0
  extraDataBytes: CASHLINK_FUNDING_MARKER,              // the MARKER, never the message
});

// 3. build the shareable URL — secret lives ONLY in the #fragment
const url = CASHLINK_BASE + encodeCashlinkPayload(clKey.privateKey.serialize(), valueLuna, message);
```

### The funding transaction carries a MARKER, not the message

⚠️ This section said `extraData: message` until 2026-08-02 and both halves of that were wrong.

```ts
// src/nimiq/cashlink-codec.ts — quoted from nimiq/hub src/lib/Cashlink.ts
export const CASHLINK_FUNDING_MARKER = new Uint8Array([0, 130, 128, 146, 135]); // 'CASH' + 63
```

Nimiq Wallet identifies a Cashlink by the **recipient data on its funding transaction**. Without
those five bytes the transfer is an ordinary payment in every wallet's history — the link still
claims perfectly well, which is why this was invisible. `nimiq/hub` does the split explicitly:
`recipientData: CashlinkExtraData.FUNDING` alongside a separate `cashlinkMessage`.

And the message must **not** be there. It is parent-authored free text about a child and it was
going on chain in the clear, permanently, on a public mainnet instance. It travels in the URL
payload, which is where the Hub reads it from and where it always was (step 3 above).

⚠️ **The marker cannot go through `extraData`.** That field is encoded with `TextEncoder`, i.e.
UTF-8, and four of the five bytes are above 0x7F — so the string route emits **nine** bytes
(`00 c2 82 c2 80 c2 92 c2 87`) and produces a transaction no wallet recognises, from code that
reads exactly like it wrote the marker. There is no string that encodes to those five bytes.
That is what `SendTxOptions.extraDataBytes` is for, and `cashlink-funding-marker.test.ts` fails
if anyone routes it back through the string field.

**Verified by broadcast on mainnet**, not by a unit test asserting we wrote what we intended:
see the transaction quoted in that test file's companion note in ops #13.

## Claim detection (MVP = polling)

```ts
const client = await getClient();
const acct = await client.getAccount(Nimiq.Address.fromUserFriendlyAddress(clAddr));
const claimed = (acct?.balance ?? 0) < valueLuna;       // kid swept it -> balance ~0
```
Poll `GET /api/cashlinks/:id/status` every 3 s for 60 s, then back off (3→5→10 s) with a manual
"Check again" button. `addTransactionListener` push is a post-MVP upgrade — polling is plenty for a <90 s demo.

## Funding-amount gotcha (decide in build)
A claim is itself a transaction and pays a fee. If Albatross requires a non-zero fee at claim time,
fund the cashlink with `valueLuna + claimFeeHeadroom` so the kid receives the intended amount.
Start with `fee = 0` (Albatross accepts 0-fee txs); if testnet mempool rejects, bump to 138 luna and
add the same headroom to the funding value. Confirm empirically in Phase 4.
