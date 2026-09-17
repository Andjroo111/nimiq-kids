import { appendFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import { checkClaim } from "../nimiq/claims";
import { SIM } from "../nimiq/client";
import { CashlinkMintError, mintCashlink } from "../nimiq/cashlink";
import * as repo from "../repo";
import * as budget from "../repo-budget";
import { requiresApproval } from "../custody";
import { checkPayable } from "../wallet/kid-wallet";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import { makeProvider, type WalletProvider } from "../wallet";
import { childMoneyGate, familyForSubject } from "./families";

export const cashlinks = new Hono();

// Streak bonus mechanics (#17). Defaults are env-overridable placeholders for the
// parent-configurable values Andjroo will surface; "every Nth claimed payout earns a bonus".
export const STREAK_MILESTONE_EVERY = Number(process.env.STREAK_MILESTONE_EVERY ?? 7);
export const STREAK_BONUS_LUNA = Number(process.env.STREAK_BONUS_LUNA ?? 100_000); // 1 NIM

/** True when `streakCount` lands exactly on a milestone (7, 14, 21, ...). */
export function isStreakMilestone(streakCount: number, every: number = STREAK_MILESTONE_EVERY): boolean {
  return every > 0 && streakCount > 0 && streakCount % every === 0;
}

/** If a just-incremented streak landed on a milestone, mint an extra bonus Cashlink through the
 *  same hot-wallet payout path. Provider is injectable for tests. Best-effort: a bonus that
 *  fails to mint must never break the chore claim that triggered it. Returns the bonus cashlink
 *  id if one was minted, else null. */
export async function maybeMintStreakBonus(
  familyId: string,
  childId: string,
  provider: WalletProvider = makeProvider(),
): Promise<string | null> {
  if (STREAK_BONUS_LUNA <= 0) return null;
  const child = repo.getChild(childId);
  if (!child || !isStreakMilestone(child.streak_count)) return null;
  // Hot-wallet spend: check + mint serialize per family like every other payout
  // (src/wallet/spend-lock.ts), so a bonus cannot race a chore approval past the budget.
  return withSpendLock(familySpendKey(familyId), async () => {
    // Bonuses are hot-wallet funded: silently skip when the family's payout budget is
    // exhausted (best-effort semantics already apply — a missing bonus never breaks a claim).
    const fam = repo.getFamily(familyId);
    if (fam && !budget.checkSpend(fam, STREAK_BONUS_LUNA).ok) return null;
    const message = `nimiq.kids: ${child.streak_count}-streak bonus`;
    try {
      const mint = await mintCashlink(provider, STREAK_BONUS_LUNA, message);
      const cl = repo.createCashlink({
        id: crypto.randomUUID(), family_id: familyId, chore_id: null, child_id: childId,
        kind: "bonus", cashlink_address: mint.cashlinkAddress, value_luna: mint.valueLuna,
        message, url: mint.url, funding_tx_hash: mint.fundingTxHash, status: "ready",
      });
      return cl.id;
    } catch (e) {
      // The bonus is best-effort and a failure must never break the claim that earned it.
      // But "best effort" applied to a bare `catch {}` meant a mint that had ALREADY moved
      // real NIM left no row, no key and no log — the money simply vanished. Record the
      // recovery material first; only the bonus is optional, never the audit trail.
      logRecoverableMint(e);
      return null;
    }
  });
}

/**
 * Where the private-key-bearing recovery URLs go. Beside the database, because that is the
 * directory an operator already treats as instance state; `HATCH_RECOVERY_LOG` overrides it.
 */
export const recoveryLogPath = (): string =>
  process.env.HATCH_RECOVERY_LOG
  ?? join(dirname(resolve(process.env.DB_PATH ?? "kids.db")), "cashlink-recovery.jsonl");

/**
 * Emit the recovery material for a mint that may have moved money.
 *
 * Deliberately a log and NOT a database row. `funding` is a declared CashlinkStatus that
 * nothing in this codebase ever writes or reconciles, so a row in that state would be a
 * dead end that no sweep clears — inventing unreconciled money state is worse than the
 * problem. A log is enough to make the funds recoverable by hand, which is the whole
 * requirement, and it is the strictly smaller change.
 *
 * THE URL CARRIES THE PRIVATE KEY, so it does not go to stdout.
 *
 * That is the point of keeping it at all: without it the funds are gone forever, and it is
 * the SOLE copy, so it cannot simply be dropped. But stdout on these deploys is a plaintext
 * file under ~/gdkc/logs that nothing redacts, and the URL is a live bearer instrument for
 * however much NIM the mint may have moved, spendable by anyone who ever reads that file —
 * a backup, a log shipper, a screen-share, a support bundle. The trigger is not exotic:
 * `waitForFunding` throws after 20s, which happened on mainnet on 2026-08-01.
 *
 * So the key goes to its own 0600 append-only file and stdout gets the address, the value
 * and a pointer to it. Same recoverability, same permissions as the env file holding the
 * seed. If the file cannot be written the URL is still printed — losing a child's NIM
 * outright is worse than writing it somewhere too readable, and the line says which
 * happened so an operator knows to go and clean it up.
 */
function logRecoverableMint(e: unknown): void {
  if (!(e instanceof CashlinkMintError)) return;
  const head = { address: e.cashlinkAddress, valueLuna: e.valueLuna, fundingTxHash: e.fundingTxHash };
  const path = recoveryLogPath();
  try {
    // `mode` is only honoured when the file is CREATED, so an existing file is chmod'ed
    // explicitly — the same trap #139 is about, one directory over.
    appendFileSync(path, `${JSON.stringify({ ...head, url: e.url, at: Date.now(), cause: String(e.cause) })}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    console.error("[cashlink] MINT FAILED AFTER A POSSIBLE TRANSFER: check this address on " +
      `chain; if it holds funds, the claim URL is the ONLY way to spend them and is in ${path}:`,
      JSON.stringify({ ...head, cause: String(e.cause) }));
  } catch (writeErr) {
    console.error("[cashlink] MINT FAILED AFTER A POSSIBLE TRANSFER, AND THE RECOVERY FILE " +
      `COULD NOT BE WRITTEN (${String(writeErr)}). The claim URL below is a SPENDABLE KEY ` +
      "now sitting in this log. Move it somewhere safe and scrub the log:",
      JSON.stringify({ ...head, url: e.url, cause: String(e.cause) }));
  }
}

/** When a cashlink first becomes claimed: chore/lesson payouts credit the kid, advance the chore,
 *  and may trigger a streak-milestone bonus. A bonus credits the tally but must NOT advance the
 *  streak (that would cascade milestones). Peer gifts were debited at send time, so claiming only
 *  marks them done. */
export async function settleClaim(cl: repo.Cashlink): Promise<void> {
  repo.markCashlinkClaimed(cl.id);
  if (cl.kind === "payout") {
    if (cl.child_id) {
      repo.addBalanceAndStreak(cl.child_id, cl.value_luna);
      await maybeMintStreakBonus(cl.family_id, cl.child_id);
    }
    if (cl.chore_id) repo.setChoreStatus(cl.chore_id, "claimed");
  } else if (cl.kind === "bonus") {
    if (cl.child_id) repo.adjustBalance(cl.child_id, cl.value_luna);
  } else if (cl.kind === "stars") {
    // Allowance-day payout (family mode): credit the NIM tally only. The star ledger was
    // debited at mint time, and stars must never advance the demo streak mechanic.
    if (cl.child_id) repo.adjustBalance(cl.child_id, cl.value_luna);
  }
}

/**
 * Poll endpoint the PWA hits every ~3s. Real mode: check the cashlink address balance on-chain.
 * SIM mode: reflect the stored status (claimed by /claim-sim).
 */
cashlinks.get("/cashlinks/:id/status", async (c) => {
  const cl = repo.getCashlink(c.req.param("id"));
  if (!cl) return c.json({ error: "not_found" }, 404);
  if (cl.status === "claimed") return c.json({ status: "claimed", valueLuna: cl.value_luna });

  if (SIM) return c.json({ status: "pending", sim: true });

  try {
    const { claimed, balanceLuna } = await checkClaim(cl.cashlink_address, cl.value_luna);
    if (claimed) {
      await settleClaim(cl);
      return c.json({ status: "claimed", valueLuna: cl.value_luna });
    }
    return c.json({ status: "pending", balanceLuna });
  } catch (err) {
    // Degrade gracefully — never a dead spinner in front of a judge.
    return c.json({ status: "checking", detail: String((err as Error)?.message ?? err) });
  }
});

/**
 * Claim a Cashlink the kid SCANNED. Money in, so there is nothing for a parent to
 * approve — a link only pays out to whoever holds it, and holding it is what
 * scanning proves.
 *
 * The link is matched to a cashlink this family already knows about; an unknown
 * one is refused rather than guessed at. In SIM that settles it directly. In REAL
 * the claim is the wallet sweeping the URL (see /claim-sim's note), so the URL is
 * handed back for the wallet to open rather than pretended to be settled here.
 */
cashlinks.post("/cashlinks/claim", async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const url = String(body.url ?? "").trim();
  if (!url) return c.json({ error: "invalid_url" }, 400);
  const cl = repo.getCashlinkByUrl(url);
  if (!cl) return c.json({ error: "unknown_cashlink" }, 404);
  if (cl.status === "claimed") return c.json({ status: "claimed", valueLuna: cl.value_luna });
  if (!SIM) return c.json({ status: "open_in_wallet", url: cl.url, valueLuna: cl.value_luna });
  await settleClaim(cl);
  return c.json({ status: "claimed", valueLuna: cl.value_luna });
});

/** SIM-only: simulate the kid claiming (the real flow is the wallet sweeping the cashlink URL).
 *  Family-scoped like /link: it credits `balance_luna`, which is real spending power on the
 *  legacy V1 path, so it is not a free-for-all even in SIM. */
cashlinks.post("/cashlinks/:id/claim-sim", async (c) => {
  if (!SIM) return c.json({ error: "sim_disabled" }, 400);
  const cl = repo.getCashlink(c.req.param("id"));
  if (!cl || !(await familyForSubject(c, cl.family_id))) return c.json({ error: "not_found" }, 404);
  if (cl.status !== "claimed") await settleClaim(cl);
  return c.json({ status: "claimed", valueLuna: cl.value_luna });
});

/** Kid "Send to a friend" — mint a peer cashlink (same primitive, virality story).
 *  V1 legacy path: it spends the demo `balance_luna` tally but mints from the HOT WALLET,
 *  so it is a hot-wallet outflow wearing a kid-funded costume. Money-gated for auth, and
 *  from v0.43 also closed wherever approval is required and bounded by the payout budget. */
cashlinks.post("/children/:id/send", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  // Where a parent has to say yes, this route has no way to ask them: it predates the
  // approval queue and mints straight from the shared wallet. The V2 path
  // (POST /kids/:id/send) is the one that queues, spends the kid's OWN key, and is what
  // every current client calls. So this one simply stops existing for those households
  // rather than staying as an unqueued back door into the hot wallet.
  if (requiresApproval(fam)) return c.json({ error: "parent_approval_required" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const valueLuna = Math.round(Number(body.valueLuna ?? 0));
  if (!Number.isFinite(valueLuna) || valueLuna <= 0) return c.json({ error: "amount_required" }, 400);
  // Hot-wallet outflow: the budget check + mint serialize per family like every other
  // payout (src/wallet/spend-lock.ts). The tryDebit reserve below already made the KID
  // tally race-safe; this closes the same race against the family budget.
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
  // repo-budget excludes kind='peer' on the stated assumption that peer cashlinks "never
  // touch the hot wallet". They do, here — makeProvider() IS the hot wallet — so this
  // path was invisible to the cap that protects the shared instance. Checked before the
  // reserve so a refused send debits nothing.
  {
    const b = await checkPayable(fam, valueLuna);
    if (!b.ok) {
      return c.json({ error: "budget_exhausted", neededLuna: valueLuna, availableLuna: b.availableLuna }, 400);
    }
  }
  // Atomic reserve — prevents a double-send race from over-spending or going negative.
  if (!repo.tryDebit(child.id, valueLuna)) return c.json({ error: "insufficient_balance" }, 400);
  try {
    const mint = await mintCashlink(makeProvider(), valueLuna, "A gift from a friend");
    const cl = repo.createCashlink({
      id: crypto.randomUUID(),
      family_id: fam.id,
      chore_id: null,
      child_id: child.id,
      kind: "peer",
      cashlink_address: mint.cashlinkAddress,
      value_luna: mint.valueLuna,
      message: "gift",
      url: mint.url,
      funding_tx_hash: mint.fundingTxHash,
      status: "ready",
    });
    return c.json({ cashlink: { id: cl.id, url: cl.url, valueLuna: cl.value_luna } });
  } catch (err) {
    // The refund below is only correct when the mint failed BEFORE broadcasting. If the node
    // accepted the funding and merely lost the response, the Cashlink is live on chain AND
    // the kid's balance is handed back — the opposite of a rollback, with the hot wallet
    // short the difference.
    //
    // Refund ONLY when the transaction provably never reached the wire.
    //
    // This used to refund on every failure, which is wrong in exactly the case that costs
    // money: if the node accepted the funding and merely lost the response, the Cashlink is
    // live on chain AND the kid's balance is handed back — they are paid twice and the hot
    // wallet is short. mintCashlink now splits build from broadcast (WalletProvider's own
    // documented pair), so a build failure is provable rather than assumed.
    //
    // A build failure is also the COMMON one — an unreachable node fails at the head-height
    // read — so the ordinary retry path is unchanged and still refunds.
    logRecoverableMint(err);
    if (err instanceof CashlinkMintError && !err.provablyUnsent) {
      // The funding may be on chain. Keep the reservation: a stuck balance is recoverable
      // by hand, a double payout is not. The key is in the log above.
      return c.json({ error: "mint_unconfirmed", detail: err.message }, 502);
    }
    repo.adjustBalance(child.id, valueLuna); // refund the reserve — the gift never minted
    return c.json({ error: "mint_failed", detail: String((err as Error)?.message ?? err) }, 502);
  }
  }); // withSpendLock
});

/** The bearer link (contains the claim secret) — fetched only when actively showing a claim QR,
 *  never bulk-dumped in list payloads.
 *
 *  The URL fragment IS the instrument: whoever reads it can sweep the funds. So the route is
 *  scoped to the owning household through the same resolver every other subject-id route uses
 *  — on an instance that demands auth, holding the cashlink id is no longer enough. */
cashlinks.get("/cashlinks/:id/link", async (c) => {
  const cl = repo.getCashlink(c.req.param("id"));
  if (!cl || !(await familyForSubject(c, cl.family_id))) return c.json({ error: "not_found" }, 404);
  return c.json({ id: cl.id, url: cl.url, cashlinkAddress: cl.cashlink_address, valueLuna: cl.value_luna });
});
