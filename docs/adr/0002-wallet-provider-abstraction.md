# ADR 0002 — A tiny WalletProvider seam: DevProvider today, NimiqPayProvider on June 3

**Status:** Accepted · 2026-05-30
**Deciders:** nimiq.kids lead (autonomous)

## Context
The real Nimiq Pay Mini Apps SDK (the in-wallet provider a mini-app uses to read accounts and sign
transactions) drops **June 3 2026** — its exact injection mechanism and method shapes are unconfirmed.
We must (a) have a fully runnable demo **now** and (b) swap to the real SDK with no app rewrite.

## Decision
Define one minimal interface that the entire app touches:

```ts
interface WalletProvider {
  readonly kind: "dev" | "nimiq-pay";
  getAddress(): Promise<string>;                                  // parent funding address
  sendTransaction(opts: SendTxOptions): Promise<string>;          // sign+broadcast funding tx -> hash
  requestCashlink?(opts): Promise<{url; cashlinkAddress; fundingTxHash}>;  // used if SDK exposes it
}
```
- **DevProvider** — signs+broadcasts with a funded **testnet** key via `@nimiq/core`. Makes the loop
  run end-to-end today. Verified API path in `docs/NIMIQ-CASHLINK-REFERENCE.md`.
- **NimiqPayProvider** — stub mirroring the documented Hub API shape (`chooseAddress`,
  `signTransaction`), tolerant of both `serializedTx`/`raw` returns; lit up June 3.
- `makeProvider()` — a single factory: `globalThis.nimiqPay ? NimiqPayProvider : DevProvider`.

## Why
- The app never imports SDK internals; the entire June-3 surface collapses to `shared/wallet/` +
  one `CASHLINK_BASE` constant. Eight specific things to confirm are enumerated in SPEC §9 with a
  defined fallback each — **none blocks the build.**
- Keeps the PARENT side self-custodied: the provider only *moves* funds from the parent wallet,
  and `mintCashlink()`/codec are ours.
  **Update (V2):** this argument covers the parent wallet only. Kid accounts are derived from a
  server-held seed and signed for by this server — server custody, outside the provider
  abstraction. See `docs/WALLET-CONTRACT.md`.

## Consequences
- Demo robustness: DevProvider stays as the dev/testnet path even after June 3, so CI and local
  demos never depend on a wallet host.
- If June 3 differs from the Hub shape, only `nimiqpay-provider.ts` changes.
