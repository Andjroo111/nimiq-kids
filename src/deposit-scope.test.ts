// Per-family deposit attribution. One shared hot wallet serves every household, so a
// raw on-chain balance delta carries no attribution — it must NEVER become a family's
// 'deposit', and the raw number must never reach a household either. A deposit only
// becomes visible through the broadcast path, where the bearer's family is known and
// THAT TRANSACTION is verified to have executed. These tests pin the confidentiality
// invariant end to end: household B can never see, be credited with, or infer the
// amount of household A's top-up — by polling first, last, repeatedly, or by
// broadcasting a transaction of its own while A's money is in flight.
//
// Hermetic: in-memory DB + app.request(), mirroring src/multifamily.test.ts. The chain
// is injected — `readBalance` for depositCheckCore, and a scripted ChainClient +
// WalletProvider for the topup-broadcast route — so the real non-SIM logic runs.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "node:fs";
import { Hono } from "hono";
import { getDb, initDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import * as budget from "./repo-budget";
import { newToken, sha256Hex } from "./auth";
import { walletRoutes, depositCheckCore, recordAttributedTopUp, HOT_BALANCE_KEY } from "./routes/wallet";

const app = new Hono().route("/api", walletRoutes);

type House = { fam: repo.Family; bearer: string };
let A: House;
let B: House;
let C: House;

async function makeHouse(label: string): Promise<House> {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const bearer = newToken();
  lockRepo.createParentToken(f.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam: repo.getFamily(f.id)!, bearer };
}

// A PUBLIC instance is the setting the whole leak lives in: many self-serve households,
// nobody grandfathered, one shared wallet. Grandfathering the first family would make A
// budget-exempt and quietly exempt it from the very rules under test.
const ENV_KEYS = ["HATCH_DEMO_GRANT_LUNA", "HATCH_GRANDFATHER_FIRST"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  process.env.HATCH_DEMO_GRANT_LUNA = "500000"; // 5 NIM per household
  initTestDb();
  A = await makeHouse("Mom A");
  B = await makeHouse("Dad B");
  C = await makeHouse("Pat C");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const check = (bearer: string) =>
  app.request("http://hatch.test/api/family/deposit-check", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
  });

/** depositCheckCore, narrowed to its delta — throws on the error branch. */
async function delta(fam: repo.Family, readBalance: (() => Promise<number>) | null): Promise<number> {
  const r = await depositCheckCore(fam, readBalance);
  if ("error" in r) throw new Error(r.error);
  return r.deltaLuna;
}

/** Family-level deposit rows (child_id NULL) for one family — the leak surface. */
const familyDeposits = (familyId: string) =>
  getDb().query(
    "SELECT * FROM wallet_events WHERE family_id=? AND child_id IS NULL AND kind='deposit'",
  ).all(familyId) as wrepo.WalletEvent[];

// ---- the confidentiality invariant, at the route ----

test("deposit-check reports only the bearer's own attributed deposits, never another household's", async () => {
  // A's top-up landed and was attributed at broadcast time.
  recordAttributedTopUp(A.fam.id, 555_000, "tx-a-1");

  // B polls FIRST — polling order must buy B nothing.
  const b1 = await (await check(B.bearer)).json();
  expect(b1.deltaLuna).toBe(0);
  expect(familyDeposits(B.fam.id)).toHaveLength(0);
  expect(budget.creditsLuna(B.fam.id)).toBe(0);

  // A sees exactly A's own money…
  const a1 = await (await check(A.bearer)).json();
  expect(a1.deltaLuna).toBe(555_000);
  // …exactly once.
  expect(((await (await check(A.bearer)).json()) as { deltaLuna: number }).deltaLuna).toBe(0);
  // And B still sees nothing, no matter how often it polls.
  expect(((await (await check(B.bearer)).json()) as { deltaLuna: number }).deltaLuna).toBe(0);
});

// ---- the same invariant through the non-SIM compare (the pre-fix leak path) ----

test("a shared-wallet balance rise is never booked to whichever family polls first", async () => {
  wrepo.setWalletState(HOT_BALANCE_KEY, "1000000");
  const readBalance = async () => 1_555_000; // A's 0.555 NIM top-up just landed on chain

  // B polls first. The global funds snapshot refreshes, but B's delta is 0 and no
  // 'deposit' row appears under B — the balance rise is not B's money.
  const b = await depositCheckCore(B.fam, readBalance);
  expect(b).toEqual({ familyWalletLuna: 500_000, deltaLuna: 0 });
  expect(familyDeposits(B.fam.id)).toHaveLength(0);
  expect(wrepo.getWalletState(HOT_BALANCE_KEY)).toBe("1555000");

  // The broadcast path attributes the landed top-up to A; A's next check reports it.
  expect(recordAttributedTopUp(A.fam.id, 555_000, "tx-a-2")).toBe(555_000);
  const a = await depositCheckCore(A.fam, readBalance);
  expect(a).toEqual({ familyWalletLuna: 1_055_000, deltaLuna: 555_000 });

  // The delta was NOT double-booked: A saw it, B never does.
  const b2 = await depositCheckCore(B.fam, readBalance);
  expect(b2).toEqual({ familyWalletLuna: 500_000, deltaLuna: 0 });
});

// ---- the amount itself, not just the delta ----
//
// deposit-check used to answer with HOT_BALANCE_KEY verbatim — one shared account,
// handed to every parent-authed caller. deltaLuna was correctly 0 for a bystander while
// the number they wanted sat in the same JSON: two polls around somebody else's top-up
// differenced to its exact amount, timed to the poll interval. The response is now a
// family-scoped figure, so a bystander's polls do not move at all.

test("deposit-check never returns the shared hot wallet's balance to a household", async () => {
  wrepo.setWalletState(HOT_BALANCE_KEY, "5000000");
  const before = await depositCheckCore(B.fam, async () => 5_000_000);
  expect(before).toEqual({ familyWalletLuna: 500_000, deltaLuna: 0 });

  // Household A tops up 0.555 NIM. B polls again, twice, and learns nothing: no field in
  // the response carries A's amount, and nothing moved between the two polls.
  const after = await depositCheckCore(B.fam, async () => 5_555_000);
  expect(after).toEqual({ familyWalletLuna: 500_000, deltaLuna: 0 });
  const again = await depositCheckCore(C.fam, async () => 5_555_000);
  expect(again).toEqual({ familyWalletLuna: 500_000, deltaLuna: 0 });

  // The instance-global snapshot still refreshed — it is the affordability bound, it
  // just stays server-side now.
  expect(wrepo.getWalletState(HOT_BALANCE_KEY)).toBe("5555000");

  // The one household whose figure DOES move is the one that was actually credited.
  recordAttributedTopUp(A.fam.id, 555_000, "tx-visible-1");
  expect(await depositCheckCore(A.fam, async () => 5_555_000))
    .toEqual({ familyWalletLuna: 1_055_000, deltaLuna: 555_000 });
});

test("a budget-exempt household still sees its own wallet — that account IS its own", async () => {
  repo.setBudgetExempt(A.fam.id, true);
  const a = await depositCheckCore(repo.getFamily(A.fam.id)!, async () => 5_555_000);
  expect(a).toEqual({ familyWalletLuna: 5_555_000, deltaLuna: 0 });
});

test("replaying the same top-up tx credits and reports nothing twice", async () => {
  expect(recordAttributedTopUp(A.fam.id, 555_000, "tx-a-3")).toBe(555_000);
  expect(recordAttributedTopUp(A.fam.id, 555_000, "tx-a-3")).toBe(0);
  expect(familyDeposits(A.fam.id)).toHaveLength(1);
  expect(budget.creditsLuna(A.fam.id)).toBe(555_000);
  expect(await delta(A.fam, null)).toBe(555_000);
  expect(await delta(A.fam, null)).toBe(0);
});

test("a failed balance read reports the error and loses nothing: the delta survives for the next poll", async () => {
  recordAttributedTopUp(A.fam.id, 42_000, "tx-a-4");
  const down = await depositCheckCore(A.fam, async () => { throw new Error("rpc down"); });
  expect("error" in down && down.error).toBe("balance_check_failed");
  // The unseen delta was not consumed by the failed poll.
  expect(await delta(A.fam, async () => 42_000)).toBe(42_000);
});

// ---- migration from the old single-row shape ----

test("upgrading a DB with old unattributed deposit rows never fabricates a first-poll delta", async () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/hatch-deposit-migration-${crypto.randomUUID()}.db`;
  try {
    initDb(path);
    const legacy = repo.createFamily("Legacy", "NQ00");
    // The old shape: ONE global wallet_state balance row + family-level 'deposit'
    // rows written from raw balance deltas (no attribution), and NO watermark.
    wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, "5000000");
    const past = Date.now() - 60_000;
    getDb().run(
      `INSERT INTO wallet_events (id, family_id, child_id, kind, status, value_luna, created_at)
       VALUES ('legacy-dep-1', ?, NULL, 'deposit', 'done', 555000, ?)`,
      [legacy.id, past],
    );
    getDb().run("DELETE FROM wallet_state WHERE key LIKE 'family_deposit_seen%'");

    // Boot the upgraded build against that DB — migrate() runs here.
    initDb(path);
    expect(wrepo.getWalletState(wrepo.DEPOSIT_SEEN_FLOOR_KEY)).toBe(String(past));
    // The single global balance row migrated forward untouched.
    expect(wrepo.getWalletState(wrepo.HOT_BALANCE_KEY)).toBe("5000000");

    // First poll after the upgrade: NO phantom delta from the historic rows.
    const fam = repo.getFamily(legacy.id)!;
    expect(await delta(fam, async () => 5_000_000)).toBe(0);

    // Life after the upgrade: a newly attributed top-up reports normally, once.
    recordAttributedTopUp(fam.id, 77_000, "tx-post-upgrade");
    expect(await delta(fam, async () => 5_077_000)).toBe(77_000);

    // A later boot must not move the watermark (one-shot), nor resurface anything.
    initDb(path);
    expect(wrepo.getWalletState(wrepo.DEPOSIT_SEEN_FLOOR_KEY)).toBe(String(past));
    expect(await delta(repo.getFamily(legacy.id)!, async () => 5_077_000)).toBe(0);
  } finally {
    initTestDb(); // hand the module DB back to the in-memory harness
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(path + suffix); } catch { /* already gone */ }
    }
  }
});

// ---- the route where attribution actually happens ----
//
// Everything above exercises depositCheckCore and recordAttributedTopUp directly. That
// proves the cursor arithmetic and proves NOTHING about attribution, because the only
// production caller of recordAttributedTopUp is POST /family/topup-broadcast — which is
// where the cross-household credit lived. These tests drive that route.
//
// It has to run in a subprocess: SIM is a module-level constant computed at import
// (`!process.env.DEV_PARENT_PRIV`), so a non-SIM route test needs its own env — the same
// reason src/mainnet-guards.test.ts spawns. The chain is a local fake node that behaves
// like a real one in the one way that matters: it ACCEPTS any well-formed transaction
// into its mempool and returns a hash, but only EXECUTES (moves balances) one whose
// sender can actually cover value + fee.

/** Run the broadcast scenario in a non-SIM subprocess and return what it observed. */
async function runBroadcastScenario(): Promise<Record<string, unknown>> {
  const port = 4000 + Math.floor(Math.random() * 900);
  const program = `
const Nimiq = await import("@nimiq/core");
const HOT_PRIV = process.env.DEV_PARENT_PRIV;
const hotAddr = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(HOT_PRIV)).toAddress().toUserFriendlyAddress();

// ---- fake node: mempool acceptance is unconditional, execution is not ----
const bal = new Map();
const norm = (a) => a.replace(/\\s/g, "").toUpperCase();
const get = (a) => bal.get(norm(a)) ?? 0;
const set = (a, v) => bal.set(norm(a), Math.max(0, Math.round(v)));
set(hotAddr, 5_000_000);
const server = Bun.serve({
  port: ${port},
  async fetch(req) {
    const body = await req.json().catch(() => ({}));
    const ok = (data) => Response.json({ jsonrpc: "2.0", id: 1, result: { data } });
    if (body.method === "getBlockNumber") return ok(1000);
    if (body.method === "getAccountByAddress") return ok({ balance: get(String(body.params[0])) });
    if (body.method === "sendRawTransaction") {
      const tx = Nimiq.Transaction.fromAny(String(body.params[0]));
      const from = tx.sender.toUserFriendlyAddress(), to = tx.recipient.toUserFriendlyAddress();
      const v = Number(tx.value), fee = Number(tx.fee);
      if (get(from) >= v + fee) { set(from, get(from) - v - fee); set(to, get(to) + v); }
      return ok(tx.hash());
    }
    return Response.json({ jsonrpc: "2.0", id: 1, error: { message: "?" } });
  },
});

const { initTestDb, getDb } = await import("./src/db.ts");
const repo = await import("./src/repo.ts");
const lockRepo = await import("./src/repo-lock.ts");
const budget = await import("./src/repo-budget.ts");
const { newToken, sha256Hex } = await import("./src/auth.ts");
const { walletRoutes } = await import("./src/routes/wallet.ts");
const { Hono } = await import("hono");
const app = new Hono().route("/api", walletRoutes);

initTestDb();
const house = async (label) => {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const bearer = newToken();
  lockRepo.createParentToken(f.id, label + " phone", await sha256Hex(bearer));
  return { fam: repo.getFamily(f.id), bearer };
};
const A = await house("Mom A"), B = await house("Dad B");

const signed = (privHex, valueLuna, height) => {
  const kp = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(privHex));
  const tx = Nimiq.TransactionBuilder.newBasic(
    kp.toAddress(), Nimiq.Address.fromUserFriendlyAddress(hotAddr),
    BigInt(valueLuna), 0n, height, 5);
  tx.sign(kp, undefined);
  return { hex: tx.toHex(), hash: tx.hash(), from: kp.toAddress().toUserFriendlyAddress() };
};
const broadcast = (bearer, hex) => app.request("http://h.test/api/family/topup-broadcast", {
  method: "POST",
  headers: { Authorization: "Bearer " + bearer, "content-type": "application/json" },
  body: JSON.stringify({ serializedTx: hex }),
}).then((r) => r.json());

const out = {};

// ---- THE ATTACK ----
// B signs 555000 luna from an EMPTY account and posts it. While B's never-executing tx
// is in flight, household A's genuine 0.555 NIM lands in the shared hot wallet. The old
// gate ("did the shared balance rise by >= my tx value?") was satisfied by A's money and
// credited B. Nothing about B's own account ever changed, so nothing may be credited.
const attack = signed("22".repeat(32), 555_000, 1000);
const startedAt = Date.now();
const inflight = broadcast(B.bearer, attack.hex);
setTimeout(() => set(hotAddr, get(hotAddr) + 555_000), 150); // A's real money lands
out.attack = await inflight;
out.attackMs = Date.now() - startedAt;
// Let A's money land no matter how fast the route bailed out, then look again: the
// inflow the old gate fed on really did happen, and it still credits nobody.
await Bun.sleep(500);
out.hotAfterAttack = get(hotAddr);
out.attackerBudgetCredits = budget.creditsLuna(B.fam.id);
out.attackerDepositRows = getDb()
  .query("SELECT COUNT(*) c FROM wallet_events WHERE family_id=? AND child_id IS NULL AND kind='deposit'")
  .get(B.fam.id).c;

// ---- THE HARVESTING LOOP ----
// Fresh validityStartHeight per round, so every tx has a distinct hash and the tx-hash
// dedupe is not what stops it.
out.harvest = [];
for (const h of [1001, 1002]) {
  const t = signed("33".repeat(32), 1_000, h);
  const p = broadcast(B.bearer, t.hex);
  setTimeout(() => set(hotAddr, get(hotAddr) + 2_000_000), 150); // a big inflow to feed on
  out.harvest.push(await p);
}
out.harvestBudgetCredits = budget.creditsLuna(B.fam.id);

// ---- THE HONEST PATH still works ----
// A funded sender: its balance really falls, the hot wallet really receives, credit lands.
const payerPriv = "44".repeat(32);
set(Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(payerPriv)).toAddress().toUserFriendlyAddress(), 1_000_000);
const good = signed(payerPriv, 300_000, 1003);
out.honest = await broadcast(A.bearer, good.hex);
out.honestBudgetCredits = budget.creditsLuna(A.fam.id);
out.honestDepositRows = getDb()
  .query("SELECT value_luna v, tx_hash t FROM wallet_events WHERE family_id=? AND child_id IS NULL AND kind='deposit'")
  .all(A.fam.id);
// …and a replay of the very same tx credits nothing a second time.
out.honestReplay = await broadcast(A.bearer, good.hex);
out.honestCreditsAfterReplay = budget.creditsLuna(A.fam.id);

server.stop(true);
console.log("RESULT:" + JSON.stringify(out));
`;
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", program],
    env: {
      ...process.env,
      DEV_PARENT_PRIV: "11".repeat(32),
      NIMIQ_SIM: "",
      NIMIQ_NETWORK: "test",
      NIMIQ_NETWORK_ID: "5",
      NIMIQ_RPC_URL: `http://127.0.0.1:${port}`,
      HATCH_GRANDFATHER_FIRST: "0",
      HATCH_DEMO_GRANT_LUNA: "500000",
      HATCH_TOPUP_CONFIRM_MS: "1200",
      HATCH_TOPUP_POLL_MS: "40",
    },
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const line = out.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`scenario did not report a result:\n${out}\n${err}`);
  return JSON.parse(line.slice("RESULT:".length));
}

let scenario: Record<string, any>;

test("topup-broadcast: the scenario runs", async () => {
  scenario = await runBroadcastScenario();
  expect(scenario).toBeTruthy();
}, 30_000);

test("topup-broadcast credits NOTHING for a tx the caller's own account never paid for", () => {
  // The broadcast still happens — it is the parent's own signed money — but it did not land.
  expect(scenario.attack.creditedLuna).toBe(0);
  expect(scenario.attack.landed).toBe(false);
  // And the other household's 0.555 NIM really did arrive, so this is not a vacuous
  // pass: the old gate had everything it needed to fire.
  expect(scenario.hotAfterAttack).toBe(5_555_000);
  // The refusal comes from the CONFIRMATION, not from an up-front affordability check —
  // that pre-check was deleted because a read that understates the sender turned it into
  // a silent skip of an honest credit. So B waits out the full HATCH_TOPUP_CONFIRM_MS
  // and is credited nothing anyway: paying for the guard in latency, never in money.
  expect(scenario.attackMs).toBeGreaterThanOrEqual(1_200);
});

test("topup-broadcast writes no budget credit and no feed event to the wrong household", () => {
  expect(scenario.attackerBudgetCredits).toBe(0);
  expect(scenario.attackerDepositRows).toBe(0);
});

test("the harvesting loop yields nothing, however many distinct tx hashes it burns", () => {
  for (const round of scenario.harvest) {
    expect(round.creditedLuna).toBe(0);
    expect(round.landed).toBe(false);
  }
  expect(scenario.harvestBudgetCredits).toBe(0);
});

test("a genuinely funded top-up is still credited, once, to the family that paid it", () => {
  expect(scenario.honest.creditedLuna).toBe(300_000);
  expect(scenario.honest.landed).toBe(true);
  expect(scenario.honestBudgetCredits).toBe(300_000);
  expect(scenario.honestDepositRows).toHaveLength(1);
  expect(scenario.honestDepositRows[0].v).toBe(300_000);
  // The receipt link points at a transaction that actually executed.
  expect(scenario.honestDepositRows[0].t).toBe(scenario.honest.txHash);
  // Replay is idempotent: no second credit, no second row.
  expect(scenario.honestReplay.creditedLuna).toBe(0);
  expect(scenario.honestCreditsAfterReplay).toBe(300_000);
});
