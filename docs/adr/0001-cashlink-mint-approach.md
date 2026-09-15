# ADR 0001 — Mint Cashlinks ourselves (keypair + funding tx), not via a wallet popup

**Status:** Accepted · 2026-05-30
**Deciders:** nimiq.kids lead (autonomous)

## Context
The Nimiq edge — "kid claims with no account, money is real and instant" — *is* the product.
We must produce **real, claimable Nimiq Cashlinks**. A Cashlink is not a protocol primitive; it is
(1) a freshly generated keypair, (2) a funding transaction to that keypair's address, and (3) a URL
whose `#fragment` carries the private key so the recipient can sweep the funds with no account.

Two ways to produce one:
- **A. Roll it ourselves** — generate the keypair, fund via our `WalletProvider`, encode the URL with
  our verified codec (`docs/NIMIQ-CASHLINK-REFERENCE.md`).
- **B. Ask the host** — call a native `requestCashlink()` if the June-3 Mini Apps SDK exposes one.

## Decision
**Build A now; prefer B opportunistically later.** `mintCashlink()` checks
`provider.requestCashlink?` first and falls back to our local mint. The local mint is the permanent,
SDK-independent path that makes the whole loop run **today** on testnet.

## Why
- Verified working end-to-end against `@nimiq/core@2.5.1` in Bun (round-trip + address rebuild pass).
- Zero dependency on an unreleased SDK → no June-3 blocker; the demo is runnable now.
- The byte format matches `nimiq/hub` `Cashlink.ts`, so links open natively in the Nimiq wallet.
- If June 3 ships native minting, it's a one-line preference with identical UX.

## Consequences
- We hold a **testnet** parent funding key server-side (DevProvider) — never a child key, never mainnet.
- The cashlink secret lives only in the URL `#fragment` (never query string, never server logs).
  Stored `url` in DB is testnet-only; production hardening (encrypt-at-rest / drop-after-claim) is tracked.
- One empirical unknown remains: the base-URL prefix (`hub.` vs `wallet.`), isolated to a single
  constant and verified in Phase 4.
