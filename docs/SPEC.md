# nimiq.kids — Build Spec (docs/SPEC.md)

> Nimiq Pay mini-app. Kids' allowance, paid instantly in NIM via Cashlinks. Competition MVP.
> Owner/lead: this is the source of truth. Reserve only look&feel + domain for Andjroo (§10).
> Stack (locked): **Bun + Hono + SQLite (D1-compatible schema) + vanilla PWA**. COPPA-safe. All files < 800 lines.
> Custody: the parent's wallet is self-custodied; **kid accounts are server-custodied** (derived
> from a server-held seed — see `docs/WALLET-CONTRACT.md`). Older wording in this file that calls
> the whole app "non-custodial" predates real kid accounts and is corrected below where it appears.

---

## 1. One-liner & Nimiq edge

**nimiq.kids: a kid finishes a chore, a parent taps Approve, and real money lands in the kid's hands in seconds — no bank, no card, no app install for the kid.**

The Nimiq edge is **load-bearing, not decorative**. nimiq.kids cannot exist on Greenlight/BusyKid rails:

| Capability | Incumbents (Greenlight/BusyKid/GoHenry) | nimiq.kids on Nimiq |
|---|---|---|
| Payout speed | Friday batch / 1–5 day ACH | **~1–2s on-chain settlement (Albatross PoS)** |
| Kid onboarding | Parent bank link + SSN/DOB, 10–30 min | **Zero install — kid opens a Cashlink URL, wallet self-creates in the browser** |
| Custody | Bank holds the funds; balances are the provider's ledger | **Real on-chain accounts the family can verify. The parent's wallet is theirs; the kid's account is derived and signed for by the server (server-custodied)** |
| Micro-rewards ($0.25 chore) | Uneconomical ($0.30–$1.50 card fees) | **Sub-cent fees make $0.25 chores viable** |
| Celebration moment | Payment OR confetti, never both | **Approve → confetti → balance rises live → real money is actually there** |

The single sentence judges must remember: **"The one allowance app where the money is actually real and actually instant — and the kid never needed a bank."** Every one of those four claims is true *only because of Nimiq Cashlinks + Albatross instant settle*. Remove Nimiq and the product is a worse Greenlight.

**Decision (mine):** We do NOT market "crypto/blockchain/wallet." The app surface says "send money in seconds to a link." Nimiq is the engine, not the pitch.

---

## 2. The winning demo loop (judge on a phone, < 90s)

Pre-seeded state: one parent ("Mom"), one kid label ("🦖 Sam"), parent wallet funded with testnet NIM (via faucet, see §3). One chore already submitted as pending: **"Empty the dishwasher 🧽 — 5 NIM."**

| t | Actor | Screen / action | What the judge sees |
|---|---|---|---|
| 0–8s | Parent | Opens nimiq.kids (already on Approvals tab). One pending card: "🦖 Sam · Empty dishwasher · 5 NIM". Taps the big **Approve & Pay** pill. | One tap. No forms. |
| 8–13s | App | Full-screen **confetti + chime**. "Paid Sam 5 NIM 🎉". Behind it: a funding tx fires from parent wallet to a freshly-minted Cashlink address. | Instant gratification. |
| 13–20s | App | Card flips to a **Cashlink ready** state with a giant QR + "Hand the phone to Sam" + a **Claim** button. | The handoff. |
| 20–30s | Kid (judge taps Claim, or scans QR with second phone) | Cashlink URL opens → wallet self-creates → claims 5 NIM. | **No signup. No install.** |
| 30–55s | App | nimiq.kids **polls the Cashlink address**, detects balance drained → kid's in-app balance animates **10 → 15 NIM**. Streak badge ticks ⭐. | Live, real settlement — not a fake number. |
| 55–85s | Kid | On the kid balance screen, taps **Send to a friend 🎁** → picks "2 NIM" → nimiq.kids mints a peer Cashlink → shows QR. Judge scans with a 3rd device (or the parent device) → claimed in seconds. | Viral peer-to-peer, same primitive. |
| 85–90s | — | Land back on parent dashboard: chore now ✅ Paid, balance updated. | Loop closed. |

**Why this wins:** every magic beat (instant confetti, live balance rise, no-install claim, peer send) is powered by the *same* Cashlink primitive, on real testnet, end-to-end. Judges can run it themselves on a phone with the DevProvider — nothing is stubbed in the demo path.

**Hard demo rules (mine):**
- The balance number MUST move only *after* on-chain confirmation of the claim, never optimistically faked. Authenticity is the whole pitch.
- If consensus/poll lags > 6s, show a friendly "💸 sending…" loader, never a spinner-of-death. Demo must degrade gracefully.
- Keep a pre-funded fallback Cashlink minted at app boot so a flaky faucet/network never kills the live demo.

---

## 3. Cashlink technical approach

### 3.1 What a Cashlink actually is (decisive statement)

A Nimiq Cashlink is **not a protocol primitive.** It is: (1) a freshly generated keypair, (2) a normal funding transaction from the sender to that keypair's address, and (3) a URL that carries the **private key + amount + optional message** so that whoever opens it can sweep the funds into their own wallet. The canonical Cashlink format is the one the official `wallet.nimiq.com` produces and consumes, implemented in **`@nimiq/utils`**. We use that exact format so links open natively in Nimiq Wallet / Nimiq Pay.

**Packages (locked versions):**

```jsonc
// package.json (deps)
"@nimiq/core":   "2.2.2",   // Albatross web-client WASM: Client, KeyPair, Address, TransactionBuilder
"@nimiq/utils":  "0.10.x",  // request-link-encoding (createNimiqRequestLink) + Cashlink helpers
"@nimiq/hub-api":"1.6.1",   // ONLY for NimiqPayProvider fallback / future real-SDK parity; NOT used by DevProvider
"hono":          "^4",
"@nimiq/identicons":"^1"    // kid/parent avatars
```

> Version note: EarnRewards locally pins `@nimiq/core@2.0.6` (legacy `Consensus.nano()`); the POS terminal uses the current `Client.create(config.build())` shape. **We standardize on the current 2.2.2 `Client` API** — do not copy the `Consensus.nano()` path.

### 3.2 The EXACT Cashlink URL/binary format

A Nimiq Cashlink URL is:

```
https://hub.nimiq-testnet.com/cashlink/#<base64url-payload>
   (or the wallet handles  nimiq.com/cashlink/#<payload>  on mainnet)
```

The `<payload>` after `#` is the **Base64URL** (URL-safe, `-`/`_`, **no padding**, then `=`→`.` per Nimiq's convention) encoding of this binary buffer:

```
[ 32 bytes ] cashlink private key (Ed25519 raw)
[  8 bytes ] value in luna, big-endian uint64   (1 NIM = 100_000 luna)
[  1 byte  ] message length L (0 if none)
[  L bytes ] UTF-8 message
[  1 byte  ] theme id (0 = none/standard; used for the celebratory wallet UI)
```

This is the `Cashlink` serialization shipped in `@nimiq/utils`. **We do not hand-roll the byte layout** — we call the helper and treat the byte spec above as documentation/validation only. The fragment (`#…`) keeps the secret out of server logs and `Referer` headers — **the private key MUST live only in the URL fragment, never in a query string, never in our DB in plaintext beyond what's needed to poll** (see §3.5 security).

### 3.3 Mint a Cashlink (copy-pasteable sketch)

```ts
// server/nimiq/cashlink.ts  (<800 lines; this file ~150)
import { getClient, NETWORK } from "./client";
import { Buffer } from "node:buffer";

// Lazy import keeps the WASM out of the cold path.
async function Nimiq() { return import("@nimiq/core"); }

export interface MintResult {
  cashlinkAddress: string;   // user-friendly "NQ.." (the address we POLL for claim)
  url: string;               // the shareable Cashlink URL (contains the secret in #fragment)
  fundingTxHash: string;
  valueLuna: number;
}

/**
 * Mint a Cashlink: generate keypair -> fund it from the provider's wallet -> encode URL.
 * `provider` is our WalletProvider abstraction (§4): DevProvider signs locally on testnet,
 * NimiqPayProvider will pop the native confirm dialog. Either way nimiq.kids never holds funds.
 */
export async function mintCashlink(
  provider: WalletProvider,
  valueLuna: number,
  message = "",
): Promise<MintResult> {
  const N = await Nimiq();

  // 1) generate the cashlink keypair (this keypair holds the funds in transit)
  const cashlinkKey  = N.KeyPair.generate();
  const cashlinkAddr = cashlinkKey.toAddress();

  // 2) fund it from the sender's wallet (parent). Signing happens INSIDE the provider.
  const fundingTxHash = await provider.sendTransaction({
    recipient: cashlinkAddr.toUserFriendlyAddress(),
    valueLuna,
    fee: 0,                       // Albatross: 0-fee txs accepted; bump to 138 if mempool rejects
    extraData: message,           // chore reference, e.g. "chore:42"
  });

  // 3) encode the Cashlink URL via @nimiq/utils (canonical wallet format)
  const { Cashlink } = await import("@nimiq/utils");
  const cashlink = new Cashlink(
    cashlinkKey.privateKey,
    valueLuna,
    message,
    /* theme */ 0,
  );
  const baseUrl = NETWORK === "test"
    ? "https://hub.nimiq-testnet.com/cashlink/"
    : "https://hub.nimiq.com/cashlink/";
  const url = cashlink.render(baseUrl);  // -> "...#<base64url payload>"

  return {
    cashlinkAddress: cashlinkAddr.toUserFriendlyAddress(),
    url,
    fundingTxHash,
    valueLuna,
  };
}
```

> If a given `@nimiq/utils` build does not export a ready `Cashlink` class, the fallback is a ~40-line local encoder that writes the byte layout in §3.2 and Base64URL-encodes it. This is the **single point of Nimiq-format risk** and is covered by issue **#7** (see §8) — we verify the produced URL actually opens in `wallet.nimiq-testnet.com` during build.

### 3.4 Funding tx + testnet client

```ts
// server/nimiq/client.ts  (~120 lines)
export const NETWORK = (process.env.NIMIQ_NETWORK ?? "test") as "test" | "main";

let clientPromise: Promise<any> | null = null;
export function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const N = await import("@nimiq/core");
    const config = new N.ClientConfiguration();
    if (NETWORK === "test") config.network("testalbatross"); // testnet genesis
    const client = await N.Client.create(config.build());
    await client.waitForConsensusEstablished();
    return client;
  })();
  return clientPromise;
}
```

**Testnet seeding (demo):** parent wallet funded from `https://faucet.pos.nimiq-testnet.com` (POS/Albatross faucet). We cache one funded parent key in `.env.local` (`DEV_PARENT_PRIV`) so the demo never depends on a live faucet call. Faucet rate-limits → we reuse one parent account, never mint fresh accounts per run.

### 3.5 Claim detection on testnet

We detect a claim by **polling the Cashlink address balance**. When the kid opens the link and the wallet sweeps it, the address balance drops from `valueLuna` to ~0.

```ts
// server/nimiq/claims.ts (~120 lines)
import { getClient } from "./client";

export async function isClaimed(cashlinkAddress: string, expectedLuna: number) {
  const client = await getClient();
  const N = await import("@nimiq/core");
  const account = await client.getAccount(N.Address.fromUserFriendlyAddress(cashlinkAddress));
  const balance = account?.balance ?? 0;
  return { claimed: balance < expectedLuna, balance };
}
```

```ts
// server/routes/cashlinks.ts (Hono) — poll endpoint the PWA hits every 3s
app.get("/api/cashlinks/:id/status", async (c) => {
  const row = db.query("SELECT * FROM cashlinks WHERE id = ?").get(c.req.param("id")) as Cashlink;
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status === "claimed") return c.json({ status: "claimed" });

  const { claimed, balance } = await isClaimed(row.cashlink_address, row.value_luna);
  if (claimed) {
    db.run("UPDATE cashlinks SET status='claimed', claimed_at=? WHERE id=?", [Date.now(), row.id]);
    return c.json({ status: "claimed" });
  }
  return c.json({ status: "pending", balance });
});
```

**Polling policy (mine):** client polls `GET /status` every **3s** for the first 60s, then backs off (3s→5s→10s) and gives a manual "Check again" button. Server-side we `waitForConsensusEstablished()` once at boot and reuse the singleton client. A WebSocket/`addTransactionListener` upgrade is a post-MVP nicety (issue #9) — **3s polling is more than fast enough for a < 90s demo** and far simpler/robust.

---

## 4. Wallet provider abstraction

The real Mini Apps SDK drops **June 3**. We design the seam now so the *entire app loop runs today* on a DevProvider and swaps to the real SDK with **zero app-code changes** — only the factory line changes.

```ts
// shared/wallet/provider.ts  (~90 lines)
export interface SendTxOptions {
  recipient: string;       // user-friendly NQ.. address
  valueLuna: number;       // 1 NIM = 100_000 luna
  fee?: number;            // default 0 on Albatross
  extraData?: string;      // chore ref, UTF-8
}

/**
 * The ONLY surface nimiq.kids uses to touch a wallet. Both impls satisfy it.
 * Deliberately tiny: list the sender address + send a (funding) transaction.
 * Cashlink ENCODING is ours (§3); the provider only does the on-chain MOVE + signing.
 */
export interface WalletProvider {
  readonly kind: "dev" | "nimiq-pay";
  /** parent's funding address; for NimiqPay this triggers chooseAddress() once and caches. */
  getAddress(): Promise<string>;
  /** sign + broadcast a funding tx; returns tx hash. Funds NEVER touch nimiq.kids. */
  sendTransaction(opts: SendTxOptions): Promise<string>;
  /** optional: if the real SDK exposes native cashlink minting June 3, we prefer it. */
  requestCashlink?(opts: { valueLuna: number; message?: string }):
    Promise<{ url: string; cashlinkAddress: string; fundingTxHash: string }>;
}
```

### 4.1 DevProvider — runnable end-to-end TODAY

```ts
// shared/wallet/dev-provider.ts  (~140 lines)
// Uses a funded TESTNET key. Signs + broadcasts directly via @nimiq/core.
// This is what makes the demo loop complete NOW, fully on-chain, no SDK.
export class DevProvider implements WalletProvider {
  readonly kind = "dev" as const;
  constructor(private privHex = process.env.DEV_PARENT_PRIV!) {}

  async getAddress() {
    const N = await import("@nimiq/core");
    return N.PrivateKey.fromHex(this.privHex).toAddress().toUserFriendlyAddress();
  }

  async sendTransaction({ recipient, valueLuna, fee = 0, extraData }: SendTxOptions) {
    const N = await import("@nimiq/core");
    const client = await getClient();
    const key = N.KeyPair.derive(N.PrivateKey.fromHex(this.privHex));
    const height = await client.getHeadHeight();
    // Albatross TransactionBuilder (current 2.2.2 API) — handles extraData + signing
    const tx = N.TransactionBuilder.newBasicWithData(
      key.toAddress(),
      N.Address.fromUserFriendlyAddress(recipient),
      new TextEncoder().encode(extraData ?? ""),
      BigInt(valueLuna),
      BigInt(fee),
      height,
      client.networkId,
    );
    tx.sign(key);
    await client.sendTransaction(tx);
    return tx.hash().toHex();
  }
}
```

> The DevProvider key is **testnet only**, lives in `.env.local`, is git-ignored, and is the *only* place a private key is held server-side. It is the **parent's funding wallet**, never a child key.

### 4.2 NimiqPayProvider — stub matching the likely June-3 shape

```ts
// shared/wallet/nimiqpay-provider.ts  (~120 lines)
// Mirrors the documented Nimiq Hub API (signTransaction/chooseAddress/checkout),
// which is the strongest available signal for the Pay provider surface.
export class NimiqPayProvider implements WalletProvider {
  readonly kind = "nimiq-pay" as const;
  // Injection mechanism is UNKNOWN until June 3 — we detect, don't assume.
  constructor(private injected: any /* window.nimiqPay ?? HubApi */) {}

  async getAddress() {
    const r = await this.injected.chooseAddress({ appName: "nimiq.kids" });
    return r.address ?? r;                                  // tolerate both shapes
  }

  async sendTransaction({ recipient, valueLuna, fee = 0, extraData }: SendTxOptions) {
    const client = await getClient();
    const height = await client.getHeadHeight();
    const signed = await this.injected.signTransaction({   // Hub-API-shaped
      appName: "nimiq.kids",
      sender: await this.getAddress(),
      recipient, value: valueLuna, fee,
      validityStartHeight: height,
      extraData: extraData ? new TextEncoder().encode(extraData) : undefined,
    });
    await client.sendTransaction(signed.serializedTx ?? signed.raw); // broadcast ourselves
    return signed.hash;
  }

  // If June-3 exposes native cashlink minting, we light this up and prefer it (§9).
  async requestCashlink(opts: { valueLuna: number; message?: string }) {
    if (!this.injected.requestCashlink) throw new Error("native cashlink not available");
    const r = await this.injected.requestCashlink({ appName: "nimiq.kids", value: opts.valueLuna, message: opts.message });
    return { url: r.link, cashlinkAddress: r.address, fundingTxHash: r.hash };
  }
}
```

### 4.3 The swap (one line)

```ts
// shared/wallet/index.ts
export function makeProvider(): WalletProvider {
  // June 3+: detect the real injection (window.nimiqPay) and use it.
  const w = globalThis as any;
  if (w?.nimiqPay) return new NimiqPayProvider(w.nimiqPay);
  return new DevProvider();        // today: fully runnable testnet demo
}
```

App code only ever calls `makeProvider()` + the `WalletProvider` interface. Swapping providers is **one branch in one factory** — no route, view, or DB change. If June-3 also gives native `requestCashlink`, `mintCashlink()` in §3 checks `provider.requestCashlink` first and falls back to our local mint.

---

## 5. Data model (SQLite / D1)

D1-compatible (no SQLite-only pragmas in schema). All timestamps are epoch-ms integers. **COPPA: children carry zero PII — only a label + emoji.**

```sql
-- families: one row per parent household (the wallet owner)
CREATE TABLE families (
  id            TEXT PRIMARY KEY,         -- uuid
  parent_label  TEXT NOT NULL,            -- "Mom" (display only, not legal identity)
  parent_address TEXT NOT NULL,           -- NQ.. funding address (public; from provider.getAddress)
  created_at    INTEGER NOT NULL
);

-- children: NO PII. label + emoji only (COPPA).
CREATE TABLE children (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id),
  label         TEXT NOT NULL,            -- "Sam"  (parent-entered nickname; not a legal name field)
  emoji         TEXT NOT NULL DEFAULT '🦖',
  balance_luna  INTEGER NOT NULL DEFAULT 0, -- cached/derived in-app tally for the kid UI
  streak_count  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- chores: the catalog + per-instance state
CREATE TABLE chores (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id),
  child_id      TEXT NOT NULL REFERENCES children(id),
  title         TEXT NOT NULL,            -- "Empty the dishwasher"
  emoji         TEXT NOT NULL DEFAULT '🧽',
  reward_luna   INTEGER NOT NULL,         -- payout amount
  status        TEXT NOT NULL DEFAULT 'open',
                -- open -> submitted -> approved(=paid via cashlink) -> claimed | rejected
  submitted_at  INTEGER,
  approved_at   INTEGER,
  created_at    INTEGER NOT NULL
);

-- cashlinks: every payout + every peer-send. The on-chain truth.
CREATE TABLE cashlinks (
  id               TEXT PRIMARY KEY,
  family_id        TEXT NOT NULL REFERENCES families(id),
  chore_id         TEXT REFERENCES chores(id),   -- null for peer-to-peer sends
  kind             TEXT NOT NULL DEFAULT 'payout', -- 'payout' | 'peer'
  cashlink_address TEXT NOT NULL,                -- the address we POLL for claim
  value_luna       INTEGER NOT NULL,
  message          TEXT,
  url              TEXT NOT NULL,                -- shareable (#secret in fragment)
  funding_tx_hash  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'funding', -- funding -> ready -> claimed | expired
  created_at       INTEGER NOT NULL,
  claimed_at       INTEGER
);

CREATE INDEX idx_chores_family_status ON chores(family_id, status);
CREATE INDEX idx_cashlinks_status     ON cashlinks(status);
```

**Decisions (mine):**
- `balance_luna` on `children` is a **convenience tally for the kid screen**, NOT the source of truth. Source of truth for "did the money actually move" is always the chain. We never let the cached balance diverge from a claimed sum without reconciliation.
- The Cashlink `url` (which contains the secret) is stored so the parent can re-show the QR before claim. **Post-MVP hardening (#8):** encrypt the fragment at rest / drop it after claim. For the competition build, testnet-only funds make this acceptable; we document the production fix.

---

## 6. Architecture & file layout

Single Bun process: Hono serves both the API and the static PWA. SQLite via `bun:sqlite`. WASM lazy-loaded. **Every file < 800 lines; target < 200.**

```
nimiq.kids/
├─ docs/
│  └─ SPEC.md                         (this file)
├─ package.json                       (deps pinned per §3.1)
├─ schema.sql                         (§5)
├─ .env.local                         (DEV_PARENT_PRIV, NIMIQ_NETWORK=test) — gitignored
│
├─ server/
│  ├─ index.ts                        (Hono app bootstrap, static + routes)  ~80
│  ├─ db.ts                           (bun:sqlite open + migrate from schema.sql) ~60
│  ├─ routes/
│  │  ├─ families.ts                  (POST family, GET dashboard)           ~120
│  │  ├─ children.ts                  (CRUD child labels/emoji)              ~120
│  │  ├─ chores.ts                    (create / submit / approve / reject)   ~180
│  │  └─ cashlinks.ts                 (mint on approve, GET status poll)     ~160
│  └─ nimiq/
│     ├─ client.ts                    (§3.4 singleton testnet client)        ~120
│     ├─ cashlink.ts                  (§3.3 mint + URL encode)               ~150
│     └─ claims.ts                    (§3.5 claim detection)                 ~120
│
├─ shared/
│  └─ wallet/
│     ├─ provider.ts                  (§4 interface)                         ~90
│     ├─ dev-provider.ts              (§4.1)                                 ~140
│     ├─ nimiqpay-provider.ts         (§4.2)                                 ~120
│     └─ index.ts                     (§4.3 makeProvider factory)            ~30
│
└─ public/                            (vanilla PWA — no framework)
   ├─ index.html                      (app shell, manifest link, Nimiq CDN)  ~120
   ├─ manifest.webmanifest            (PWA installable)
   ├─ sw.js                           (cache-bust: VERSION + skipWaiting + claim) ~80
   ├─ app.css                         (Nimiq tokens from §brand, kid-friendly) ~300
   └─ js/
      ├─ router.js                    (hash routes: /parent /kid)             ~120
      ├─ api.js                       (fetch wrappers)                        ~80
      ├─ parent.js                    (approvals, chores, dashboard)          ~260
      ├─ kid.js                       (balance, claim QR, send-to-friend)     ~260
      ├─ celebrate.js                 (confetti + chime on approve/claim)     ~120
      └─ qr.js                        (render Cashlink URL as QR via qr-creator) ~60
```

**Cache-busting from day one** (per prior lesson): `sw.js` bumps a `VERSION` constant on every deploy, HTML is `no-cache`, asset URLs are versioned, SW `skipWaiting()` + `clients.claim()` + a `controllerchange` reload. Non-negotiable for a PWA judges install on a phone.

---

## 7. Judging optimizations (prioritized to WIN)

Estimated rubric (from research): real-world use ~25-30%, Nimiq-edge ~20-25%, UX/onboarding ~20%, polish ~15-20%, originality ~10-15%, virality ~5-10%. We optimize in that order.

1. **Make Nimiq the hero, on-chain, live.** The balance only moves on confirmed claim; show a real testnet tx hash on a "proof" tap. Judges who know Nimiq will check — reward them. *(highest leverage: hits both "real-world" and "Nimiq-edge")*
2. **One-tap parent approval → instant confetti.** Bridge the gap every incumbent leaves (payment OR celebration, never both). This *is* the demo's emotional peak.
3. **Zero-install kid claim.** The Cashlink-opens-and-self-creates-a-wallet moment is the single most Nimiq-unique thing we can show. Rehearse it on a clean phone.
4. **Peer "Send to a friend."** Free virality story using the *same* primitive — signals platform thinking, not a one-trick app.
5. **Consumer-grade polish.** Lighthouse 90+, no console errors, mobile-first, Nimiq brand tokens exactly (§brand), sub-200ms interactions. Judges feel polish before they read code.
6. **Never say "crypto/blockchain/wallet" in the UI.** Mainstream-parent framing ("send money to a link") proves product maturity. Put the technical proof one tap away in a "🔍 Receipt" disclosure, not on the main surface.
7. **Sub-cent micro-reward proof.** Include a "0.25 NIM — feed the dog 🐕" chore to demonstrate economics impossible on card rails.
8. **90-second scripted demo video + live runnable build.** Prepare both submission formats (video + GitHub + live URL) before July; the loop in §2 is the storyboard.
9. **Graceful degradation.** Pre-minted fallback Cashlink + friendly loaders so a flaky network never produces a dead-spinner in front of a judge.
10. **COPPA story as a feature.** "We literally can't store a child's name or any PII — only an emoji and a nickname." Turns a constraint into a trust differentiator judges remember.

---

## 8. Build backlog (ordered, dependency-aware)

Maps existing issues **#2–#6** and files new issues **#7–#11**. Order respects dependencies; each ships independently runnable.

| Order | Issue | Title | Depends on | Rationale |
|---|---|---|---|---|
| 1 | **#2** | Project scaffold: Bun + Hono server, `bun:sqlite`, static PWA shell, `schema.sql` migrate | — | Nothing runs without the skeleton + DB. |
| 2 | **#7 (NEW)** | Nimiq client + Cashlink mint/encode + claim-poll, **verified against `wallet.nimiq-testnet.com`** | #2 | This is the load-bearing Nimiq edge and the one format-risk (§3.3). Prove the URL actually opens & claims on testnet before building UI on top. **Highest-risk-first.** |
| 3 | **#3** | WalletProvider abstraction + DevProvider (funded testnet key) end-to-end send | #7 | Makes the whole loop runnable *today*; unblocks every mint. |
| 4 | **#4** | Parent flow: families/children/chores routes + approvals UI + **mint-on-approve** | #3,#7 | The core product loop; produces a real Cashlink on tap. |
| 5 | **#5** | Kid flow: balance screen, claim QR, **live balance update via status poll** | #4 | Closes the settlement loop; the "money is real" beat. |
| 6 | **#8 (NEW)** | Celebration layer: confetti + chime on approve & on claim; streak badge | #5 | The emotional peak (judging #2/#3). Separable from logic so it can't break the loop. |
| 7 | **#6** | Peer "Send to a friend" Cashlink (kind='peer') + recipient claim | #5,#7 | Virality story; reuses mint+poll, so cheap once #7 is solid. |
| 8 | **#9 (NEW)** | NimiqPayProvider stub + `makeProvider` detection + June-3 swap doc | #3 | Forward-compat seam; lets us flip to real SDK without app rewrite. |
| 9 | **#10 (NEW)** | PWA hardening: manifest, service worker cache-busting, Lighthouse 90+, graceful loaders, pre-minted fallback Cashlink | #4,#5 | Polish + demo-robustness (judging #5/#9). |
| 10 | **#11 (NEW)** | Demo seed script + 90s scripted run + submission assets (video/GitHub/live URL) | all | Make the §2 loop reproducible on a clean phone for judges. |

> **Do not** file overlapping issues. #7 is split out from #3 deliberately because Cashlink format risk deserves its own verifiable deliverable. Security hardening of the stored Cashlink secret (§5) rides as a checklist item inside #7's "definition of done," promoted to its own issue only if it grows.

---

## 9. Deferred to June 3 (real SDK) + fallback

When the SDK drops, confirm in this order; each has a defined fallback so **we never block on June 3**:

| # | Must confirm | Our default assumption | Fallback if it differs |
|---|---|---|---|
| 1 | **Provider injection mechanism** (`window.nimiqPay`? iframe postMessage? Hub-style?) | `globalThis.nimiqPay` global | `makeProvider()` adds a detector branch; DevProvider stays as the dev/testnet path. Zero app-code change. |
| 2 | **Native Cashlink minting** exposed to mini-apps? | NOT exposed → we mint via §3 (our keypair + funding tx) | If exposed: prefer `provider.requestCashlink()`; our local mint is the permanent fallback. Either way the loop is identical. |
| 3 | **`signTransaction` shape** (return: `serializedTx` vs `raw`?) | Hub-API shape (both tolerated in §4.2) | Adapter normalizes in `nimiqpay-provider.ts` only. |
| 4 | **`chooseAddress` / account listing** | Hub `chooseAddress({appName})` | Cache the chosen parent address; re-prompt on miss. |
| 5 | **Min transaction value / fee floor** | 0-fee accepted; any value | If a floor exists, bump default fee to 138 luna and set a chore-reward minimum in the UI. |
| 6 | **CSP / iframe sandbox / storage limits** | localStorage usable; outbound fetch to our origin allowed | If storage is locked down, move kid balance cache server-side (already the source of truth) — UI degrades gracefully. |
| 7 | **Tx-hash timing** (sync vs async/poll) | hash returned promptly | Our claim detection already polls, so async hashes don't break the loop. |
| 8 | **Cashlink URL base** Pay expects | `hub.nimiq(-testnet).com/cashlink/#…` | If Pay uses a different base, swap the one `baseUrl` constant in §3.3. |

Single integration point for all of the above: `shared/wallet/` + the `baseUrl` constant. Nothing else in the codebase imports SDK internals.

---

## 10. Decisions split: Andjroo vs me

### Reserved for Andjroo (look & feel + domain ONLY)
- **Domain:** the production hostname (e.g. `kids.app` / `kids.internal` / other). I'll deploy on a placeholder until chosen.
- **Look & feel within the Nimiq brand system:** mascot/emoji character set for kids (the 🦖 default), confetti style/intensity, chime sound choice, app name lockup, and any illustration. Constraint I'm holding: stays inside Nimiq tokens (§brand) — navy→purple gradient bg, light-blue CTAs, green = success only, Mulish, pill buttons, 8px cards, **no glassmorphism, no neon, no pure black**.

### Decisions I'm making now (locked — not Andjroo's call)
- Stack: Bun + Hono + `bun:sqlite` + vanilla PWA. **Locked.**
- `@nimiq/core@2.2.2` + `@nimiq/utils` for Cashlinks; current `Client` API, not legacy `Consensus.nano()`. **Locked.**
- Cashlink = our keypair + funding tx + canonical `@nimiq/utils` URL; secret only in URL fragment. **Locked.**
- DevProvider's testnet key is the *parent funding wallet*, never a child key. **Locked.**
  (Superseded in part: since V2 the server also derives and holds the **kid** account keys from
  `HATCH_MASTER_SEED`. That is server custody of the kid side and is not covered by this line.)
- Claim detection by 3s balance polling with backoff (no WebSocket for MVP). **Locked.**
- Provider abstraction with DevProvider (today) + NimiqPayProvider stub (June 3), single-factory swap. **Locked.**
- COPPA: children are label+emoji only, zero PII, ever. **Locked.**
- UI never says "crypto/blockchain/wallet"; technical proof lives behind a "🔍 Receipt" disclosure. **Locked.**
- Demo loop, balance-moves-only-on-confirmed-claim, pre-minted fallback Cashlink. **Locked.**
