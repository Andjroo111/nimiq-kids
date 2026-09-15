// Keep the testnet demo's hot wallet funded. Cron runs this; see src/topup.ts for the policy.
//
//   set -a; . ~/secrets/hatch-testnet.env; set +a
//   bun run src/scripts/topup-hot-wallet.ts --dry-run   # decide, tap nothing
//   bun run src/scripts/topup-hot-wallet.ts             # decide and tap
//
// EXIT CODES ARE THE ALERT CONTRACT, because the wrapper script pages Andjroo off them:
//   0  nothing needed, or the top-up reached the floor
//   1  still below the floor after tapping (the faucet is refusing, or it is not enough)
//   2  could not decide at all (no address, unreadable balance, unpriceable visitor)
//
// Exit 1 and exit 2 are deliberately different. "The faucet did not give me enough" is a
// budget problem that resolves itself next run; "I could not read the balance" means the
// monitoring is blind, which is worse than being broke and must not look the same.

const DRY = process.argv.includes("--dry-run");
const L = 100_000;
const nim = (luna: number) => (luna / L).toLocaleString(undefined, { maximumFractionDigits: 0 });

// THE GUARDS READ RAW ENV AND THE IMPORTS ARE DYNAMIC, BOTH ON PURPOSE.
//
// These were static imports and a `NETWORK !== "test"` check below them, and the check never
// ran: pointing this at mainnet made `../nimiq/client` throw at IMPORT time, which exits 1.
// Exit 1 means "the faucet is not keeping up", so a misconfigured operator would have been
// paged as a budget problem instead of as a broken setup. An exit code that is the alerting
// contract cannot depend on modules that can refuse to load.
const NETWORK = process.env.NIMIQ_NETWORK ?? "test";
const SIM = process.env.NIMIQ_SIM === "1";

const address = (process.env.HATCH_HOT_WALLET_ADDRESS ?? "").trim();
if (!address) {
  console.error("no HATCH_HOT_WALLET_ADDRESS — source the instance env first");
  process.exit(2);
}
// A mainnet top-up would be asking a testnet faucet for real money, which it will not give,
// and the attempt alone says the operator has the wrong env sourced.
if (NETWORK !== "test" || SIM) {
  console.error(`refusing: network=${NETWORK} sim=${SIM} — this tops up the TESTNET demo only`);
  process.exit(2);
}

// Anything below here may touch the chain, so a failure to load is itself "cannot decide".
let getClient, costPerVisitorLuna, planTopUp, tapFaucet, FLOOR_VISITORS, TARGET_VISITORS, FAUCET_URL;
try {
  ({ getClient } = await import("../nimiq/client"));
  ({ costPerVisitorLuna, planTopUp, tapFaucet, FLOOR_VISITORS, TARGET_VISITORS, FAUCET_URL } =
    await import("../topup"));
} catch (err) {
  console.error(`cannot decide: modules failed to load — ${String((err as Error)?.message ?? err)}`);
  process.exit(2);
}

const client = await getClient();

async function balance(): Promise<number> {
  // Same backoff rule as the reclaim path: the public RPC rate-limits, and a 429 read here
  // would look like an empty wallet and trigger a pointless run of taps.
  let last: unknown;
  for (let i = 0; i < 4; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 2 ** (i - 1)));
    try { return await client.getBalance(address); } catch (err) { last = err; }
  }
  throw last;
}

let balanceLuna: number;
let costLuna: number;
try {
  balanceLuna = await balance();
  costLuna = await costPerVisitorLuna();
} catch (err) {
  console.error(`cannot decide: ${String((err as Error)?.message ?? err)}`);
  process.exit(2);
}

const plan = planTopUp(balanceLuna, costLuna);
console.log(
  `hot wallet ${nim(balanceLuna)} NIM · a visitor costs ${nim(costLuna)} NIM · ` +
  `runway ${plan.visitors.toFixed(1)} visitors (floor ${FLOOR_VISITORS}, target ${TARGET_VISITORS})`,
);

if (!plan.needed) {
  if (!(costLuna > 0)) { console.error("visitor cost priced at 0 — cannot decide"); process.exit(2); }
  console.log("above the floor, nothing to do");
  process.exit(0);
}

console.log(`BELOW FLOOR · wants ${plan.tapsWanted} tap(s), taking ${plan.taps} this run`);
if (DRY) { console.log("--dry-run: tapped nothing"); process.exit(0); }

let accepted = 0;
for (let i = 0; i < plan.taps; i += 1) {
  const ok = await tapFaucet(address, FAUCET_URL).catch(() => false);
  console.log(`  tap ${i + 1}/${plan.taps}: ${ok ? "accepted" : "REFUSED"}`);
  if (ok) accepted += 1;
  await new Promise((r) => setTimeout(r, 2_000)); // be a good citizen on a shared faucet
}

// Prove it by the balance, never by the faucet's word — the rule the reclaim and the
// hot-wallet sweeper both follow. An accepted tap is a promise, not a payment.
await new Promise((r) => setTimeout(r, 15_000));
let after = balanceLuna;
try { after = await balance(); } catch { /* fall through to the check below */ }
const visitorsAfter = costLuna > 0 ? after / costLuna : 0;
console.log(
  `after: ${nim(after)} NIM (${visitorsAfter.toFixed(1)} visitors), ` +
  `${accepted}/${plan.taps} taps accepted, +${nim(after - balanceLuna)} NIM`,
);

if (visitorsAfter < FLOOR_VISITORS) {
  console.error(`STILL BELOW FLOOR: ${visitorsAfter.toFixed(1)} < ${FLOOR_VISITORS} visitors`);
  process.exit(1);
}
process.exit(0);
