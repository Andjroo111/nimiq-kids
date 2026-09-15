# ADR 0003 — Network ops don't run in the Bun server; SIM is the default demo, RPC/browser is the real path

**Status:** Accepted · 2026-05-30
**Deciders:** nimiq.kids lead (autonomous) · found during Phase 4 verify

## Context
`@nimiq/core@2.5.1`'s **nodejs** entry (`nodejs/worker.mjs`) drives the light client through a
`worker_threads` worker. Under **Bun 1.2.8** that worker throws at startup
(`"config" is a constant` reassignment → `Worker has been terminated`), so
`Client.create()` never establishes consensus. Verified directly: a standalone testnet connect
probe spews worker errors and never syncs. Meanwhile the **crypto primitives** (`KeyPair`,
`PrivateKey`, `Address`, `TransactionBuilder`, sign, the cashlink codec) work perfectly in Bun with
no worker — proven by tests and a real keypair→address→codec round-trip.

So: our server-side `getClient()` (consensus, `getAccount` balance polling, `sendTransaction`
broadcast) cannot run in the Bun process as written.

## Decision
1. **SIM mode is the default, runnable demo.** `SimProvider` never touches the network; the full
   approve → mint → claim → celebrate loop runs offline with real-format cashlinks. This is what
   ships for the competition demo today and is labeled "Demo mode" in the UI.
2. **The real on-chain path does network ops OFF the Bun server:**
   - **Broadcast + balance/claim detection → HTTP JSON-RPC** to a Nimiq Albatross testnet node, OR
   - the **browser web-client** (the WASM web build runs fine in a browser/webview), which is also
     where the real Mini Apps wallet signing will live on June 3.
   The server stays the app-data + cashlink-record layer.
3. The crypto/codec/`TransactionBuilder` stay server-usable (they don't need the worker), so building
   and signing a tx server-side is fine; only *consensus/broadcast/read* moves to RPC/browser.

## Consequences
- No regression to the demo: SIM is unaffected and is the default.
- `src/nimiq/client.ts` `getClient()` and `claims.ts` are correct in shape but won't run under Bun
  until the RPC/browser swap lands — tracked as a p1 issue. They are never hit in SIM.
- This actually *simplifies* the June-3 story: signing + network are already destined for the client
  side (the wallet), matching ADR 0002's provider seam.
- Open empirical items for the live run: cashlink base URL (`hub.` vs `wallet.`), block-explorer
  host, claim-fee headroom, and the **Albatross `networkId`** (defaults TestAlbatross=5 /
  MainAlbatross=24; `@nimiq/core@2.5.1` exposes no enum and the builder doesn't validate it) —
  all single-constant, verified once on real testnet.

## Update — 2026-06-20 (v0.6.0): the RPC swap landed
`src/nimiq/client.ts` no longer creates a light-client. Network ops (head height, broadcast,
balance) now go over HTTP JSON-RPC via the shared **`nimiq-settlement`** package
(`createRpcSender`), and `@nimiq/core` is offline-crypto only. `NIMIQ_RPC_URL` + `NIMIQ_NETWORK_ID`
configure the node + network. SIM is still the default and the providers are still never hit in SIM,
so the funded-key Phase 4 run is still what confirms the empirical items above (now including
`networkId`).
