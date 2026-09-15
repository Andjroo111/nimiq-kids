// Proving a chore payout: what "absent" is allowed to mean, where the question may be asked,
// and what happens when the node will not answer at all.
//
// v0.47.0 made a payout's own transaction hash the only thing that can confirm it. The rule was
// right; the RPC layer under it was not. `getTransactionByHash` threw on ANY JSON-RPC error, and
// a node reporting "I have no transaction with that hash" reports it as an error — so absence
// read as our own blindness, `unresolved` was unreachable, and an unlanded payout sat pending
// and silent forever while the kid's screen said "on its way".
//
// These tests pin the three things that fix requires and the one thing it must never buy:
//
//   1. absence in words is absence — but only when the words are about a TRANSACTION. A node,
//      or a proxy in front of one, says "not found" about blocks, peers, history stores, API
//      keys and HTTP routes, and none of those are proof about a kid's money.
//   2. prolonged blindness is said out loud without writing anything off.
//   3. the question is asked on a background sweep and NOWHERE a child is waiting.

import { test, expect } from "bun:test";
import { isNotFoundRpcError, envMs, RPC_TIMEOUT_MS } from "./nimiq/client";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as budget from "./repo-budget";
import {
  earnSettleDecision, payKidEarnVia, reconcilePendingEarns, sweepPendingEarns,
  EARN_CONFIRM_TIMEOUT_MS, EARN_BLIND_TIMEOUT_MS, type EarnChain, type EarnReceipt,
} from "./wallet/kid-wallet";

const IMPOSSIBLE_TX_HASH = "0".repeat(64);

// ---- 1. absence, stated in words, is still absence ----

test("the mainnet sidecar's 'transaction not found' error is absence, not a refusal", () => {
  // Verbatim shape from the local light-client sidecar this app's mainnet instance reads via.
  expect(isNotFoundRpcError({ code: -32000, message: "transaction not found" })).toBe(true);
});

test("a public node that hides the reason in `data` is understood too", () => {
  // Verbatim shape from a public Albatross RPC: generic code, real reason in `data`.
  expect(isNotFoundRpcError({
    code: -32603, message: "Internal error",
    data: `Transaction not found: ${IMPOSSIBLE_TX_HASH}`,
  })).toBe(true);
});

test("other phrasings of transaction absence are recognised", () => {
  for (const message of [
    "no such transaction", "unknown transaction", "tx not found",
    "Transaction does not exist", `transaction ${IMPOSSIBLE_TX_HASH} not found`,
  ]) expect(isNotFoundRpcError({ code: -32000, message })).toBe(true);
});

test("a 'not found' about something OTHER than a transaction is NOT absence", () => {
  // The whole point of the discriminator: absence has to mean the TRANSACTION is absent.
  // Every string below is a real thing a node, a load balancer or an API gateway says, and
  // reading any of them as "this payout never landed" hands a broken deployment the power to
  // age a real payment into an alert — and a proxy error the power to speak for the chain.
  for (const message of [
    "Block not found",
    "history store not found",
    "peer not found",
    "api key not found",
    "upstream route not found",
    "MacroBlock not found at 12345",
  ]) expect(isNotFoundRpcError({ code: -32000, message })).toBe(false);
});

test("'transaction' as a MODIFIER is blindness, not absence", () => {
  // ops #14. The regex enforced adjacency, not subjecthood, so every string below claimed the
  // payout was absent from the chain. `no such transaction index` is the sharpest: it is the
  // natural phrasing for a NON-HISTORY NODE saying it cannot answer the by-hash question,
  // which is exactly the class this discriminator exists to treat as blindness.
  //
  // Over-claiming absence never mis-credits (the row stays pending, the budget stays spent),
  // but it does swap one parent notification for the wrong one: "has not shown up on chain
  // yet" instead of "cannot be checked right now".
  for (const message of [
    "no such transaction index",
    "unknown transaction type",
    "unknown transaction format",
    "block containing transaction not found",
    "route /transaction not found",
  ]) expect(isNotFoundRpcError({ code: -32000, message })).toBe(false);
});

test("tightening subjecthood did not cost any real absence phrasing", () => {
  // The guard rejects a trailing WORD, not a trailing hash or punctuation.
  for (const message of [
    "no such transaction",
    `no such transaction ${IMPOSSIBLE_TX_HASH}`,
    "no such transaction: 0xabcd",
    "unknown transaction",
    `Transaction not found: ${IMPOSSIBLE_TX_HASH}`,
    `transaction hash ${IMPOSSIBLE_TX_HASH} not found`,
    "tx not found",
    "Transaction does not exist",
  ]) expect(isNotFoundRpcError({ code: -32000, message })).toBe(true);
});

test("a node REFUSING the question never counts as absence", () => {
  // This is the direction that must never be guessed wrong. Reading a refusal as "no such
  // transaction" would let a broken node age a real payout into an alert — or, if the rule
  // ever loosened, write off money a kid genuinely received.
  for (const error of [
    { code: -32601, message: "Method not found" },              // contains "not found"!
    { code: -32000, message: "method not supported: getTransactionByHash" },
    { code: -32000, message: "not implemented" },
    { code: -32602, message: "invalid length 2, expected 3 elements" },
    { code: -32000, message: "unknown method" },
  ]) expect(isNotFoundRpcError(error)).toBe(false);
});

test("an error that says nothing recognisable is not absence", () => {
  expect(isNotFoundRpcError({ code: -32603, message: "Internal error" })).toBe(false);
  expect(isNotFoundRpcError({ code: -32000 })).toBe(false);
  expect(isNotFoundRpcError({})).toBe(false);
  expect(isNotFoundRpcError(null)).toBe(false);
  expect(isNotFoundRpcError("not found")).toBe(false); // a bare string is not an RPC error body
});

// ---- 2. budgets that come from the environment cannot be silently zeroed ----

test("an empty or junk env value falls back to the default instead of becoming 0", () => {
  // `Number(process.env.X ?? d)` survives an unset var and dies on an EMPTY one: Number("")
  // is 0, which aborts every read at 0 ms and makes every payout permanently unconfirmable.
  const saved = process.env.HATCH_TEST_BUDGET_MS;
  try {
    for (const junk of ["", "   ", "abc", "0", "-5", "NaN"]) {
      process.env.HATCH_TEST_BUDGET_MS = junk;
      expect(envMs("HATCH_TEST_BUDGET_MS", 9_000)).toBe(9_000);
    }
    process.env.HATCH_TEST_BUDGET_MS = "1234";
    expect(envMs("HATCH_TEST_BUDGET_MS", 9_000)).toBe(1234);
    delete process.env.HATCH_TEST_BUDGET_MS;
    expect(envMs("HATCH_TEST_BUDGET_MS", 9_000)).toBe(9_000);
  } finally {
    if (saved === undefined) delete process.env.HATCH_TEST_BUDGET_MS;
    else process.env.HATCH_TEST_BUDGET_MS = saved;
  }
});

test("the by-hash read budget is long enough for absence to actually come back", () => {
  // Measured: the light-client sidecar answers an ABSENT hash correctly, in ~42 s. The old
  // 15 s budget turned that knowable "it did not land" into blindness. Affordable only
  // because no request waits on this read any more — the sweep is its only caller.
  expect(RPC_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
});

// ---- 3. the question is never asked where a child is waiting ----

test("the kid wallet endpoint reconciles nothing: it must not read the chain for settlement", async () => {
  // THE regression this release exists to prevent. Reconciling is one by-hash lookup per
  // pending payout, serially, and an unlanded payout is exactly the one that costs a full read
  // budget — so doing it inline held GET /kids/:id/wallet for 45 s on three unlanded payouts
  // (measured), i.e. the kid's home screen broke precisely when their money was in trouble.
  //
  // Asserted at the seam rather than by timing, so it cannot pass by being fast on a good day.
  const src = await Bun.file(`${import.meta.dir}/routes/wallet.ts`).text();
  for (const forbidden of ["settlePendingEarns", "reconcilePendingEarns", "readEarnReceipt", "sweepPendingEarns"]) {
    expect(src).not.toContain(`${forbidden},`);
    expect(src).not.toContain(`${forbidden}(`);
  }
});

// ---- 4. prolonged blindness is said out loud, and still writes nothing off ----

const PAYOUT = 50_000;
let fam: repo.Family;
let kid: repo.Child;

function seedFamily() {
  initTestDb();
  fam = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  kid = repo.createChild(fam.id, "Ada", "🦖");
}

const acceptingChain: EarnChain = { send: async () => `0x${"a".repeat(64)}` };
const blind = async (): Promise<EarnReceipt> => "unavailable";

test("brief blindness still decides nothing at all", () => {
  expect(earnSettleDecision({ receipt: "unavailable", ageMs: 60_000 })).toBe("wait");
  expect(EARN_BLIND_TIMEOUT_MS).toBeGreaterThan(EARN_CONFIRM_TIMEOUT_MS);
});

test("prolonged blindness becomes 'unresolved' — never 'failed', never 'confirmed'", () => {
  expect(earnSettleDecision({ receipt: "unavailable", ageMs: EARN_BLIND_TIMEOUT_MS + 1 })).toBe("unresolved");
  // The v0.47 guarantee is untouched: a write-off still requires the node to state that the
  // transaction was included and failed. Blindness can reach an ALERT and nothing further.
  for (const ageMs of [1, 10 ** 12]) {
    expect(earnSettleDecision({ receipt: "unavailable", ageMs })).not.toBe("failed");
    expect(earnSettleDecision({ receipt: "unavailable", ageMs })).not.toBe("confirmed");
  }
});

test("an unanswerable node leaves the payout pending and counted, but tells the parent", async () => {
  seedFamily();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", acceptingChain);
  const late = ev.created_at + EARN_BLIND_TIMEOUT_MS + 1;

  expect(await reconcilePendingEarns(kid.id, blind, late)).toBe(0);
  const after = wrepo.getWalletEvent(ev.id)!;
  expect(after.status).toBe("pending");                       // nothing written off
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT);              // budget NOT refunded on a guess
  expect(wrepo.spendableFromLedger(kid.id)).toBe(0);          // and nothing credited either
  expect(wrepo.getWalletState(`earn_alert:${ev.id}`)).not.toBeNull(); // the silence is broken
});

test("the parent is told once, not on every sweep of an outage", async () => {
  seedFamily();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", acceptingChain);
  const late = ev.created_at + EARN_BLIND_TIMEOUT_MS + 1;
  await reconcilePendingEarns(kid.id, blind, late);
  const firstAlert = wrepo.getWalletState(`earn_alert:${ev.id}`);

  for (let i = 1; i <= 5; i++) await reconcilePendingEarns(kid.id, blind, late + i * 60_000);
  expect(wrepo.getWalletState(`earn_alert:${ev.id}`)).toBe(firstAlert); // not re-fired
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("pending");
});

test("a node that comes back and confirms the payout still credits it, exactly once", async () => {
  seedFamily();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", acceptingChain);
  const late = ev.created_at + EARN_BLIND_TIMEOUT_MS + 1;
  await reconcilePendingEarns(kid.id, blind, late); // outage: flagged, still pending

  const back = async (): Promise<EarnReceipt> => "executed";
  expect(await reconcilePendingEarns(kid.id, back, late + 1)).toBe(PAYOUT);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("done");
  expect(wrepo.spendableFromLedger(kid.id)).toBe(PAYOUT);
  expect(wrepo.getWalletState(`earn_alert:${ev.id}`)).toBeNull(); // stale flag cleaned up
  expect(await reconcilePendingEarns(kid.id, back, late + 2)).toBe(0);
});

// ---- 5. sweeps do not stack ----

test("a slow sweep is not joined by a second one", async () => {
  seedFamily();
  await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", acceptingChain);

  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const slow = async (): Promise<EarnReceipt> => { reads++; await gate; return "unavailable"; };

  const first = sweepPendingEarns(Date.now(), slow);
  await Promise.resolve(); // let the first sweep reach its read
  // The tick fires again while the first is still waiting on the node. With a read budget of
  // a minute and a tick of one, that is the ordinary case, not the exotic one — and without
  // this guard every tick would add another in-flight sweep and another held socket, forever.
  await sweepPendingEarns(Date.now(), slow);
  expect(reads).toBe(1);

  release();
  await first;
  // …and once it has finished, the next tick sweeps normally.
  await sweepPendingEarns(Date.now(), slow);
  expect(reads).toBe(2);
});
