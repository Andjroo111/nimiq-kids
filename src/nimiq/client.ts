// Chain access for nimiq.kids. Crypto (keys / addresses / cashlink codec /
// TransactionBuilder) runs OFFLINE via @nimiq/core — see getNimiq(). Network ops
// (head height + broadcast) go over HTTP JSON-RPC via the shared nimiq-settlement
// package, NOT the @nimiq/core light-client (which cannot establish consensus
// under Bun — ADR 0003). See docs/NIMIQ-CASHLINK-REFERENCE.md for the verified API.

import { createRpcSender, type RpcSender } from "nimiq-settlement";
import { custodyMode } from "../custody-boot";
import { retryRead } from "./retry-read";

export const NETWORK = (process.env.NIMIQ_NETWORK ?? "test") as "test" | "main";

export const CASHLINK_BASE =
  NETWORK === "test"
    ? "https://hub.nimiq-testnet.com/cashlink/#"
    : "https://hub.nimiq.com/cashlink/#";

// SIM mode runs the full UX with no faucet/network. ON by default until a funded testnet key is
// configured, so a fresh clone is immediately demo-able. Force with NIMIQ_SIM=1.
//
// SIM MEANS "THERE IS NO CHAIN", NOT "THERE IS NO KEY HERE". The two were the same thing right
// up until parent custody, and then they stopped being.
//
// `HATCH_CUSTODY=parent` is the whole point of NONCUSTODIAL-PLAN: no signing key on this
// machine. Its boot guard REQUIRES `DEV_PARENT_PRIV` to be unset. So the old formula made the
// non-custodial instance simulated by definition — `makeProvider()` handed back a SimProvider,
// `kidBalanceLuna` returned a ledger sum instead of `getBalance(child.address)`, staking and
// cashlinks wrote fake hashes, and `HATCH_REQUIRE_REAL=1` refused to boot at all. Verified by
// probe before this line changed: HATCH_CUSTODY=parent with no key gave `SIM = true` and
// `SimProvider`.
//
// That is precisely backwards. The plan's standing promise is that a kid's balance "cannot
// lie" because it is read from the chain, and it is exactly the instance with no key that has
// to keep that promise — it has nothing else to fall back on.
//
// A keyless real instance is a coherent thing: it reads the chain and relays bytes it did not
// sign. `DevProvider` with no key already behaves correctly for it, constructing fine and
// throwing a clear error from `getAddress`/signing, which is the truth (there is no hot wallet
// here). Chain reads and broadcast go through `getClient()` and never needed a key.
//
// HATCH_CUSTODY is read here rather than imported as policy because `custody-boot` has no
// imports of its own, so this cannot introduce a cycle. src/custody-policy.test.ts pins this
// formula to `approvalPolicy().simActive` so the copy in custody.ts cannot drift from it.
export const SIM = process.env.NIMIQ_SIM === "1"
  || (!process.env.DEV_PARENT_PRIV && custodyMode() !== "parent");

// Competition guard (docs/ROADMAP.md Phase 1): a shipped build must never fall back to
// simulated settlement. Deploys set HATCH_REQUIRE_REAL=1 so a misconfig (missing key,
// stray NIMIQ_SIM) fails loudly at boot instead of quietly sliding into SIM.
if (process.env.HATCH_REQUIRE_REAL === "1" && SIM) {
  throw new Error("HATCH_REQUIRE_REAL=1 but SIM mode is active: set DEV_PARENT_PRIV (and unset NIMIQ_SIM), or drop the flag for a demo instance.");
}

// Block-explorer base for the on-chain "Receipt" tap. A tx hash is appended verbatim.
//
// The two networks do NOT share an explorer. nimiqscan.com serves mainnet; its
// `test.` sibling does not exist — the host fails to resolve (checked 2026-07-31),
// so every receipt tap on a testnet instance landed on a dead page. Testnet's live
// explorer is Nimiq's own test.nimiq.watch, which addresses a transaction by hash
// FRAGMENT rather than a path. HATCH_EXPLORER_TX overrides both if either moves.
export const EXPLORER_TX = process.env.HATCH_EXPLORER_TX
  ?? (NETWORK === "test"
    ? "https://test.nimiq.watch/#"
    : "https://nimiqscan.com/transactions/");

// JSON-RPC endpoint of a Nimiq Albatross node. Point at the self-hosted node (e.g. the
// Beelink, optionally fronted by a Cloudflare Tunnel). Never hit in SIM.
// MAINNET has NO default and requires the explicit human arm switch — real money only
// moves when someone deliberately set BOTH `NIMIQ_RPC_URL` and `MAINNET_ARMED=1`.
export const MAINNET_ARMED = process.env.MAINNET_ARMED === "1";
export const RPC_URL = (() => {
  const url = process.env.NIMIQ_RPC_URL;
  if (NETWORK === "main" && !SIM) {
    if (!url) throw new Error("NIMIQ_NETWORK=main requires an explicit NIMIQ_RPC_URL (no default on mainnet).");
    if (!MAINNET_ARMED) throw new Error("NIMIQ_NETWORK=main requires MAINNET_ARMED=1 (see docs/RUNBOOK-MINI.md).");
    return url;
  }
  return url ?? "http://127.0.0.1:8648";
})();

/**
 * A duration read from the environment, in ms.
 *
 * `Number(process.env.X ?? d)` is not enough, and the failure is silent and total: `??` only
 * falls back on null/undefined, so `X=""` (an empty value in a deploy config, a shell that
 * exported a var it could not resolve) survives it — and `Number("") === 0`, which sets the
 * budget to zero, aborts every call instantly, and makes every payout permanently
 * unconfirmable. Junk is ignored in favour of the default instead.
 */
export function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallbackMs;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

/**
 * Budget for ONE by-hash receipt lookup — the only call this knob has ever governed.
 *
 * Broadcast does NOT use it: transactions go out through the shared nimiq-settlement RPC
 * sender, which owns its own timeouts — see RPC_SENDER_TIMEOUT_MS below.
 * `getTransactionByHash` is the sole caller of THIS one, so the name is broader than the
 * reality and the docs must not claim otherwise.
 *
 * Raised from 15 s to 60 s in v0.50.0. This comment used to add "a broadcast that takes
 * 15 s has failed" — that was wrong, and a real mainnet broadcast disproved it on
 * 2026-08-01. An absent-transaction lookup has not failed either: some nodes answer "I have no such transaction" only
 * after exhausting a network request window, measured at ~42 s on the light-client sidecar
 * this app's mainnet instance reads through. Aborting at 15 s there turned a knowable "this
 * payout did not land" into our own blindness, which is the less useful of the two silences
 * to tell a parent about. Affordable only because no user-facing request waits on this read
 * any more: its one caller runs on the background sweep.
 */
export const RPC_TIMEOUT_MS = envMs("HATCH_RPC_TIMEOUT_MS", 60_000);

// Albatross network id baked into every built tx (TransactionBuilder needs it).
// @nimiq/core@2.5.1 exposes no NetworkId enum and the builder does not validate it,
// so it is configured here. Defaults: TestAlbatross=5, MainAlbatross=24 — VERIFY on
// the live testnet run (ADR 0003 empirical items) and override with NIMIQ_NETWORK_ID
// if a broadcast is rejected.
export const NETWORK_ID = Number(process.env.NIMIQ_NETWORK_ID ?? (NETWORK === "test" ? 5 : 24));

/** Lazy-import the @nimiq/core crypto namespace (offline; no worker, no WASM init dance). */
export async function getNimiq() {
  return import("@nimiq/core");
}

/**
 * The chain ops the wallet providers need — RPC-backed, no light-client.
 * `sendTransaction` accepts a built @nimiq/core Transaction (serialized via toHex())
 * or an already-serialized hex string / bytes from an injected wallet.
 */
export interface ChainClient {
  getHeadHeight(): Promise<number>;
  getNetworkId(): Promise<number>;
  sendTransaction(txOrRaw: unknown): Promise<string>;
  /** Account balance in luna (0 if the account doesn't exist) — for claim detection. */
  getBalance(address: string): Promise<number>;
}

/**
 * What the node knows about ONE transaction, keyed by its hash. The only chain read that
 * attributes an outcome to a specific transaction — a balance can be moved by anybody, so
 * it can never answer "did MY transaction execute?".
 */
export interface ChainTxReceipt {
  /** Height of the block that included it; null while it is only in a mempool. */
  blockNumber: number | null;
  /** false = included and FAILED at execution. true/null = executed (nodes omit it on success). */
  executionResult: boolean | null;
}

/**
 * `getTransactionByHash`, with the three outcomes kept apart — the distinction is the whole
 * point, so callers must not have to guess:
 *
 *   receipt   the node knows the transaction (executed, or included-and-failed)
 *   null      the node ANSWERED and has no such transaction
 *   throws    the node could not answer at all — unreachable, or it does not serve this
 *             query. `getTransactionByHash` is NOT universally available (a light-client
 *             sidecar and a non-history node both refuse it, see topUpArrived), and a
 *             refusal must never be mistaken for "no such transaction".
 *
 * A successful envelope with no data is a genuine "not found" (null) — and so is a JSON-RPC
 * ERROR that says, in words, that there is no such transaction. See isNotFoundRpcError.
 */
export async function getTransactionByHash(hash: string): Promise<ChainTxReceipt | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "getTransactionByHash", params: [hash], id: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`getTransactionByHash: HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: { data?: { blockNumber?: number; executionResult?: boolean } | null };
      error?: unknown;
    };
    if (json.error) {
      // A node with no such transaction is entitled to say so as an error rather than as an
      // empty result, and both shapes are in the wild. Reading every error as a refusal is
      // what made "this payout did not land" indistinguishable from "the node is down", which
      // in turn made the parent alert unreachable. Absence in words is still absence.
      if (isNotFoundRpcError(json.error)) return null;
      throw new Error(`getTransactionByHash: ${JSON.stringify(json.error)}`);
    }
    const tx = json.result?.data;
    if (!tx) return null;
    return {
      blockNumber: typeof tx.blockNumber === "number" ? tx.blockNumber : null,
      executionResult: typeof tx.executionResult === "boolean" ? tx.executionResult : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Protocol-level refusals: the node rejected the QUESTION, and says nothing about the hash.
 *  Checked first because "Method not found" contains the words "not found". */
const RPC_REFUSAL_RE =
  /method\s+(is\s+)?(not\s+(supported|found|implemented)|unsupported)|not\s+implemented|un(supported|known)\s+method|invalid\s+(params|request|length)/i;

/**
 * Absence of THE TRANSACTION, in the words nodes actually use for it.
 *
 * The SUBJECT is required. A bare "not found" is what nodes and the proxies in front of them
 * say about blocks, peers, history stores, API keys and HTTP routes — "Block not found",
 * "history store not found", "upstream route not found" — and not one of those means the
 * payout is absent from the chain. Matching them read a broken node, or a misrouted request,
 * as proof about a kid's money.
 */
const TX = String.raw`(?:transaction|tx)`;

/** Only a hash may sit between the subject and the absence. */
const HASH = String.raw`(?:\s+(?:hash\s+)?(?:0x)?[0-9a-f]{4,})?`;

/** The word is the SUBJECT, not a modifier of a following noun.
 *
 *  "no such transaction index" is a node saying it has no INDEX, which is the natural phrasing
 *  for a non-history node refusing the by-hash question — precisely the blindness this whole
 *  discriminator exists to separate from absence. Same for "unknown transaction type|format".
 *  A trailing word therefore disqualifies the match; a trailing hash or punctuation does not. */
const NOT_MODIFIER = String.raw`(?!\s+[a-z])`;

/** The word is the SUBJECT, not something the sentence is merely about.
 *
 *  "block containing transaction not found" is about a BLOCK, and "route /transaction not found"
 *  is about an HTTP route. Both are blindness, and both used to read as proof a kid's payout
 *  never happened. */
const NOT_GOVERNED = String.raw`(?<!/)(?<!\b(?:containing|holding|with|for|in|of|to|from)\s)`;

const RPC_NOT_FOUND_RE = new RegExp([
  // "transaction not found" / "Transaction not found: <hash>" / "tx <hash> not found"
  String.raw`${NOT_GOVERNED}\b${TX}\b${HASH}\s+not\s+found\b`,
  String.raw`\bno\s+such\s+${TX}\b${HASH}${NOT_MODIFIER}`,
  String.raw`\bunknown\s+${TX}\b${HASH}${NOT_MODIFIER}`,
  String.raw`${NOT_GOVERNED}\b${TX}\b${HASH}\s+does\s+not\s+exist\b`,
].join("|"), "i");

/**
 * Does this JSON-RPC error mean "I have no transaction with that hash"?
 *
 * This is the discriminator the whole payout state machine turns on. Without it EVERY error is
 * a refusal, so an absent payout is read as our own blindness, `unresolved` is unreachable, and
 * a payout that never landed sits pending and silent forever. Both node shapes seen in the
 * wild are covered: the message carries the text on one, `data` carries it on the other.
 *
 * It is deliberately conservative — a protocol refusal, a "not found" about something OTHER
 * than a transaction, an unrecognised message, or a bare code is NOT absence. Everything it
 * declines lands as blindness instead, which keeps the row pending and decides nothing. That
 * is the safe direction: over-claiming absence is how a broken node, or a proxy answering in
 * the node's place, would get to write off money a kid genuinely received.
 */
export function isNotFoundRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; data?: unknown };
  // -32600/-32601/-32602 are JSON-RPC's own "bad request / no such method / bad params".
  if (e.code === -32600 || e.code === -32601 || e.code === -32602) return false;
  const parts: string[] = [];
  if (typeof e.message === "string") parts.push(e.message);
  if (typeof e.data === "string") parts.push(e.data);
  else if (e.data && typeof e.data === "object") parts.push(JSON.stringify(e.data));
  const text = parts.join(" ");
  if (!text) return false;
  if (RPC_REFUSAL_RE.test(text)) return false;
  return RPC_NOT_FOUND_RE.test(text);
}

/**
 * Budget for ONE call through the shared RPC sender — head height, balance, and BROADCAST.
 *
 * nimiq-settlement's own default is 15 s (rpc-sender.ts), and passing nothing inherits it.
 * That default was measured against a full node. This app's mainnet instance broadcasts
 * through a light-client sidecar, which relays to peers before it answers, and 15 s is not
 * enough for it.
 *
 * Proven on mainnet 2026-08-01: `sendRawTransaction` aborted client-side after 15 s while
 * the transaction was accepted and executed on chain (block 57723827, executionResult
 * true). The caller saw a failure for a transfer that had already moved real money. Every
 * chore payout, kid send and Cashlink mint on the live instance ran that risk.
 *
 * A broadcast that takes 20 s has NOT necessarily failed — that is exactly the assumption
 * this replaces. Aborting early does not undo a broadcast; it only destroys our knowledge
 * of one. Wait longer and let the receipt decide.
 */
export const RPC_SENDER_TIMEOUT_MS = envMs("HATCH_RPC_SENDER_TIMEOUT_MS", 60_000);

// One RPC sender, shared (stateless HTTP; cheap to reuse).
let _sender: RpcSender | null = null;

let _clientOverride: ChainClient | null = null;

/** test seam, mirroring `_setProvider` in src/wallet. Never set outside tests: a route
 *  that reads the head height has no other way to be driven without a node. */
export function _setChainClient(c: ChainClient | null) {
  _clientOverride = c;
}

export async function getClient(): Promise<ChainClient> {
  if (_clientOverride) return _clientOverride;
  if (!_sender) _sender = createRpcSender({ url: RPC_URL, rpcTimeoutMs: RPC_SENDER_TIMEOUT_MS });
  const sender = _sender;
  return {
    // READS are retried with backoff. The public RPC rate-limits, and a 429 used to travel
    // straight out of here: `GET /api/kids/:id/wallet` answered 500 and the kid's Treasure
    // Box rendered 0 NIM for a child holding 42,000, so every shelf read as unaffordable.
    // src/nimiq/retry-read.ts carries the whole rationale.
    getHeadHeight: () => retryRead(() => sender.getHeadHeight(), { onRetry: logRetry("getHeadHeight") }),
    getNetworkId: async () => NETWORK_ID,
    // ⚠️ NOT retried, and it must stay that way: a broadcast that throws may still have been
    // accepted, so retrying a send is a possible double spend. The next cycle re-reads the
    // balance and decides from the chain.
    sendTransaction: (txOrRaw) => sender.sendRawTransaction(toRawTxHex(txOrRaw)),
    getBalance: (address) => retryRead(() => sender.getBalance(address), { onRetry: logRetry("getBalance") }),
  };
}

/** One line per retry, naming the call. Silence here is what let 22 rate-limited reads in a
 *  single evening look like an app with no chain problem at all. */
const logRetry = (label: string) => (attempt: number, delayMs: number, err: unknown) =>
  console.warn(`[rpc] ${label} attempt ${attempt} failed (${String((err as Error)?.message ?? err)}), retrying in ${delayMs}ms`);

/** Serialize whatever a provider hands us into broadcast-ready hex. */
export function toRawTxHex(txOrRaw: unknown): string {
  if (typeof txOrRaw === "string") return txOrRaw; // already a serialized hex tx
  if (txOrRaw instanceof Uint8Array) return Buffer.from(txOrRaw).toString("hex");
  const t = txOrRaw as { toHex?: () => string; serialize?: () => Uint8Array };
  if (typeof t?.toHex === "function") return t.toHex(); // @nimiq/core Transaction
  if (typeof t?.serialize === "function") return Buffer.from(t.serialize()).toString("hex");
  throw new Error("sendTransaction: cannot serialize the transaction to hex");
}

/** Reset the cached sender (tests / reconnect). */
export function _resetClient() {
  _sender = null;
}
