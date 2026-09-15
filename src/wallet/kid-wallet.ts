// V2 kid wallet service: account provisioning, NIM earning, family transfers, and the
// parent-approved cashlink send. Routes and the approvals queue call THESE functions;
// repo-wallet.ts is the raw data layer underneath.
//
// SIM vs REAL, one rule: SIM writes ledger rows with 'sim:<uuid>' hashes and never touches the
// network; REAL signs with the hot-wallet key (earn) or the kid's derived key (send) and records
// the on-chain tx hash on the same ledger row. The kid app renders from the ledger either way.

import { getClient, SIM } from "../nimiq/client";
import { custodyMode } from "../custody-boot";
import { debtSettledByPayout, outstandingDebtLuna } from "../kid-netting";
import { deriveKidKey, type KidHdAccount } from "../nimiq/hd";
import { mintCashlink } from "../nimiq/cashlink";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import * as budget from "../repo-budget";
import { makeProvider, providerForKey, type PreparedTx } from "./index";
import { payoutExtraData } from "./payout-intent";
import { childSpendKey, withSpendLock } from "./spend-lock";

/**
 * THERE IS NO PER-PAYOUT CEILING (Andjroo, 2026-07-31: "there should be no payout ceiling,
 * the parent should be able to pick that"). A parent prices a chore at whatever a chore is
 * worth in their household, and approving it pays that. Every fixed ceiling we tried was
 * wrong for somebody: 10 NIM was worth half a cent, the dollar-denominated one still told a
 * parent their own $20 job was "too large", and the deployed 50,000 luna cap refused the
 * app's own seeded 100,000 luna sample chore on the first approval a judge ever tried.
 *
 * The only thing that may refuse a payout is the money not being there. That check is
 * `checkPayable` below; the per-family budget it consults still protects the shared hot
 * wallet on the public instance (see repo-budget.ts) and is a different mechanism entirely.
 */

export const simTxHash = () => `sim:${crypto.randomUUID()}`;

/** Compare NQ addresses by their letters alone: the same address is written with and without
 *  the display spacing depending on where it came from, and a spacing difference is not a
 *  different account. Used by the signing guard and by family-transfer routing. */
const bareAddr = (a: string | null | undefined) => (a ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Can this family fund `valueLuna` from the hot wallet right now?
 *
 * Callers gate BEFORE deciding an approval, so a refusal leaves the approval PENDING: the
 * parent tops up and approves the same chore again, with nothing half-applied and nothing
 * silently dropped.
 *
 * "Verify before refusing": the cheap snapshot answers first, and only when it says NO do
 * we spend an RPC round trip re-reading the chain. A stale snapshot must never be the
 * reason a parent is told they cannot afford a payout they can. If that read fails we let
 * the payout through on the snapshot's word rather than inventing a refusal; an unfunded
 * transaction is refused loudly by the network itself.
 */
export async function checkPayable(
  fam: repo.Family, valueLuna: number,
): Promise<budget.SpendCheck> {
  const first = budget.checkSpend(fam, valueLuna);
  if (first.ok || SIM) return first;
  try {
    const address = await makeProvider().getAddress();
    const onChain = await (await getClient()).getBalance(address);
    wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, String(onChain));
  } catch {
    return first; // chain unreachable: the snapshot's answer stands
  }
  return budget.checkSpend(fam, valueLuna);
}

/** Where an already-provisioned kid's key lives. Read straight off the row so a legacy account
 *  (hd_family_index NULL) keeps deriving on the legacy path — never inferred, never upgraded. */
export function kidHdAccount(child: repo.Child): KidHdAccount | null {
  return child.account_index === null
    ? null
    : { index: child.account_index, familyIndex: child.hd_family_index };
}

/**
 * Give the kid a real derived account if this instance can: assign the next HD coordinates
 * within the family on first touch and cache the NQ address. Idempotent; works in SIM
 * (crypto is offline). A child that already has an address is returned untouched — no
 * re-derivation, ever.
 *
 * `null` means NO ACCOUNT CAN BE MADE FOR THIS CHILD HERE. It is a fact about the instance,
 * never a failure, and only the caller knows what to do with it — which is the whole reason
 * it is a return value rather than a throw. See the two entry points below.
 *
 * TWO CASES, both about not quietly re-taking custody of an account we do not hold:
 *
 *  - a kid whose address came from a PARENT has no server key and must never be given one.
 *    Deriving here would overwrite `children.address` with a server-custodied address, and
 *    every payout afterwards would land in an account the parent does not control — while
 *    the app reported each one as a success, because the chain really did move the money.
 *    Nothing is wrong here: there is simply nothing to provision, so the row comes back.
 *  - under HATCH_CUSTODY=parent a kid with NO address yet does not get a derived one either.
 *    That instance's answer is "a parent registers one", and silently minting a server-held
 *    account instead is exactly the outcome the mode exists to prevent. This is the `null`.
 */
async function provisionKidWallet(childId: string): Promise<repo.Child | null> {
  const child = repo.getChild(childId);
  if (!child) throw new Error(`child not found: ${childId}`);
  if (child.address_source === "parent") return child;
  if (child.address && child.account_index !== null) return child;
  if (custodyMode() === "parent") return null;
  const account = wrepo.assignKidAccount(childId);
  const key = await deriveKidKey(account);
  wrepo.setChildAddress(childId, key.address);
  return repo.getChild(childId)!;
}

/**
 * The kid's row WITH an account behind it, for a caller that is about to use one.
 *
 * Throws where no account can be provisioned, and that refusal is load-bearing: handing back
 * an address-less row would push the failure downstream to a send that has no sender, or to a
 * payout addressed to nothing. A caller asking to provision an account on a parent-custody
 * instance is asking for something that cannot happen, and the honest answer is to stop.
 *
 * EVERY CALLER OF THIS IS ON A MONEY PATH — a payout, a spend, a transfer, a cashlink mint, a
 * stake precheck. A caller that only wants to draw a screen wants `readKidWallet` instead.
 */
export async function ensureKidWallet(childId: string): Promise<repo.Child> {
  const child = await provisionKidWallet(childId);
  if (!child) throw new Error("kid_address_not_registered");
  return child;
}

/**
 * The kid's row AS IT IS, for a caller that only wants to render it.
 *
 * THIS DOES NOT PROVISION, which is what the name and this comment always claimed and what the
 * body finally does (#381). It used to, and that quietly decided every kid's character before
 * they could: `GET /kids/:id/wallet` is what BOTH clients call just to draw a screen, so the
 * account was minted by the act of looking at it. The parent app did it on its roster refresh
 * (public/parent/core.js) and the kid app did it on its login screen, which is how a household
 * created at 04:38 one evening had both kids provisioned by 04:38.
 *
 * A picker behind a screen that has already answered the question is not a picker.
 *
 * Two callers were fixed one at a time before this, and that was the wrong shape: the endpoint is
 * the seam, and every future screen that wants to render a balance would have had to remember not
 * to mint an account on the way. Nothing on a money path relies on this. Every caller that is
 * about to MOVE NIM already uses `ensureKidWallet`, which still mints on demand, so a chore that
 * pays out before a kid ever logs in still works and simply takes the next index rather than a
 * chosen one. Money moving beats a choice about artwork.
 *
 * A kid with no address yet is the NORMAL first state of every kid on a parent-custody
 * instance: the parent has added them and not yet been through the registration flow. Asking
 * `ensureKidWallet` for that row made `GET /kids/:id/wallet` — the endpoint both apps' home
 * screens render from — answer 500 on a plain page load, which is a broken screen describing
 * a household that is working exactly as designed.
 *
 * So a read asks for what it needs and no more. It still provisions where provisioning is
 * what a read means (server custody has always minted the account on first GET, and
 * public/kid/js/data.js says so out loud); it simply stops demanding an account on the one
 * instance that cannot make one. `address` comes back null, and every screen that draws this
 * row has to say so in words.
 */
export async function readKidWallet(childId: string): Promise<repo.Child> {
  const child = repo.getChild(childId);
  // Still throws for a child that does not exist. Only the PROVISIONING was dropped, never the
  // existence check: a caller handed an unknown id is holding a bug, and returning `undefined`
  // typed as `Child` just moves the crash somewhere with less context.
  if (!child) throw new Error(`child not found: ${childId}`);
  return child;
}

/**
 * The kid's derived signing key — transient, for signing only. Never store or log privHex.
 *
 * REFUSES TO SIGN FOR AN ADDRESS IT DOES NOT DERIVE. `child.address` is the account the app
 * shows a balance for and the account the money is actually at; the key derived here is what
 * a send would be signed with. Those are two different facts, and every path that moves a
 * kid's NIM assumes they agree. When they do not, signing anyway spends from an account other
 * than the one the balance was read from — the transaction is signed by a key for an empty
 * address while the funded one sits untouched, and nothing in the send path notices.
 *
 * They can only disagree if something outside this code changed: a database restored against
 * a different `HATCH_MASTER_SEED` or from another instance, a rotated seed, a downgrade that
 * derives the row's coordinates on a different path (see the rollback note in
 * docs/WALLET-CONTRACT.md), or a hand-edited row. All of those are operator-visible events,
 * and all of them are better as one loud refusal on one kid than as a silent wrong-account
 * spend, so this throws.
 */
export async function kidKey(child: repo.Child): Promise<{ privHex: string; address: string }> {
  // A PARENT-OWNED ADDRESS HAS NO KEY HERE, and asking for one is a bug in the caller, not a
  // provisioning gap. The mismatch guard below would eventually catch it — but only after
  // `assignKidAccount` had handed this child fresh HD coordinates as a side effect, which
  // permanently pollutes a row whose whole point is that no server key belongs to it. Refuse
  // first, in the caller's words, before anything is written.
  if (child.address_source === "parent") {
    throw new Error(
      `kid_address_is_parent_owned: refusing to sign for child ${child.id}, whose address ` +
        `${child.address} was registered from a parent's own wallet. No key for it exists here.`,
    );
  }
  const derived = await deriveKidKey(kidHdAccount(child) ?? wrepo.assignKidAccount(child.id));
  if (child.address && bareAddr(child.address) !== bareAddr(derived.address)) {
    throw new Error(
      `kid_key_address_mismatch: refusing to sign for child ${child.id}, which holds ` +
        `${child.address} while its stored derivation coordinates produce ${derived.address}`,
    );
  }
  return derived;
}

/**
 * May anything leave this kid's account right now? Null if yes, an error code if not.
 *
 * A parent-owned address has no key on this server, so nothing here can move money out of
 * it. Phase 3/4 of NONCUSTODIAL-PLAN is where the PARENT signs those outflows; until that
 * exists, the honest answer is that a kid-initiated outflow cannot happen at all.
 *
 * CALLED AT REQUEST TIME, NOT AT EXECUTION TIME, and that is the whole point of it.
 * `kidKey` also refuses, but it refuses at the moment of signing — which is AFTER a parent
 * has already tapped Approve and the approval has been decided. That leaves a burned
 * approval (409 on retry) and a send request orphaned in 'pending' forever; this project has
 * already been bitten by exactly that shape once, with an address that failed its checksum
 * only at signing time. Worse, on a SIM instance nothing signs at all, so the whole flow
 * would have SUCCEEDED against an account we cannot spend from, writing a ledger row the
 * chain will never agree with.
 *
 * So the refusal belongs in front of the queue: a parent must never be shown a request they
 * cannot honour. `kidKey` stays as the backstop for anything that ever reaches it by
 * another route.
 *
 * Money coming IN is untouched. `payKidEarn` pays the family wallet's own key to the kid's
 * address, and it does not care who holds the other end — earning, gifts and chore payouts
 * keep working exactly as they do today.
 *
 * SECOND REFUSAL, same argument one step earlier: a kid with no address at all on an instance
 * that cannot make them one has no account for money to leave FROM. `ensureKidWallet` already
 * refuses that, but it refuses at provisioning time — which on `/send` was inside the handler
 * with nothing catching it, so the app answered 500 to a kid tapping Send. Refusing here says
 * the same thing in front of the queue, with a code a client can act on, and writes nothing.
 * The custody check is what keeps it off every other instance: under server custody an
 * address-less kid is simply one whose account has not been minted yet, and it is about to be.
 */
export function kidOutflowRefusal(
  child: repo.Child,
): "parent_signature_required" | "kid_address_not_registered" | null {
  if (!child.address && custodyMode() === "parent") return "kid_address_not_registered";
  return child.address_source === "parent" ? "parent_signature_required" : null;
}

/**
 * What is actually AT the kid's address: SIM = ledger sum; REAL = on-chain truth via RPC
 * getBalance. NOT what the kid may spend — a deferred purchase is money they have already
 * committed and it is still sitting here. Use `kidBalanceLuna` unless you specifically need
 * the raw figure, which is really only rule 3 in src/kid-netting.ts.
 */
export async function kidChainBalanceLuna(child: repo.Child): Promise<number> {
  if (SIM) return wrepo.spendableFromLedger(child.id);
  if (!child.address) return 0;
  const client = await getClient();
  return client.getBalance(child.address);
}

/**
 * The kid's balance: what is at their address, minus what they have already spent and not yet
 * moved (src/kid-netting.ts).
 *
 * THE SUBTRACTION LIVES HERE, not at each screen, and that is the point. Every caller of this
 * function — the home screen, the Treasure Box, the staking precheck, `availableKidLuna` —
 * wants the same answer, and a debt subtracted at four call sites is a rule written four times
 * and eventually only three. On an instance with no deferred spending this is the identical
 * number it always returned.
 */
export async function kidBalanceLuna(child: repo.Child): Promise<number> {
  return (await kidChainBalanceLuna(child)) - outstandingDebtLuna(child.id);
}

/**
 * Value the balance still shows but that is already spoken for, and must therefore be
 * subtracted before anything else is allowed to spend:
 *   - stakes broadcast but not yet proven executed (the chain has not shown the debit yet)
 *   - approved-but-unsettled requests (see wrepo.approvedUnsettledOutflowLuna)
 * Everything ELSE that leaves the account — a minted Cashlink (claimed or not), a family
 * transfer, a Treasure Box buy — is already out of the balance the moment it exists: the
 * ledger row is written at execution (SIM truth) and the mint path waits for the funding
 * to land on chain before it returns (REAL truth). Reserving those again would count them
 * twice.
 */
export function reservedOutflowLuna(childId: string, excludeRequestId: string | null = null): number {
  return wrepo.pendingStakeFromLedger(childId) + wrepo.approvedUnsettledOutflowLuna(childId, excludeRequestId);
}

/** What a spend may actually use: the balance minus everything in flight. EVERY
 *  affordability check on a kid's own money goes through this, never kidBalanceLuna raw. */
export async function availableKidLuna(child: repo.Child, excludeRequestId: string | null = null): Promise<number> {
  return (await kidBalanceLuna(child)) - reservedOutflowLuna(child.id, excludeRequestId);
}

// Settling a broadcast payout against the chain — the receipt read, the rule, the sweep,
// and the parent alert — lives in earn-settlement.ts. Re-exported here because that is the
// module every caller already imports from, and this split is a move, not a new seam.
export * from "./earn-settlement";

/**
 * Thrown when a payout reached a node and we cannot tell whether it landed: the bytes were
 * broadcast by a wallet that will not hand them back, so they cannot be replayed and the
 * outcome cannot be established. The ONLY safe response is to stop. Retrying would build a
 * second, byte-different transaction and pay the kid twice; the approval is therefore left
 * decided rather than put back in front of a parent as something to try again.
 */
export const PAYOUT_UNRESOLVED = "payout_unresolved";

/**
 * The idempotency key for a payout, derived from the WORK it pays for — never from the
 * approval row that authorised it.
 *
 * A single chore or routine run collects several approval rows over its life: a failed payout
 * puts one back in the queue, the direct chore-approve route opens its own when none is
 * pending, and a reject sends the kid back to redo the work, which mints a fresh one on
 * re-submit. Keyed on the approval id, each of those is a different key, so the same chore
 * could be paid once per row — through nothing but ordinary taps, no RPC failure required.
 * Keyed on the subject there is exactly one key for the work, and the second payment simply
 * cannot be built.
 */
export const payoutRefFor = (subjectKind: string, subjectId: string) => `${subjectKind}:${subjectId}`;

/**
 * Has this payout already moved money, or might it have?
 *
 * True in two cases, and both must block the same things: a ledger row exists for the key, or
 * a claim is still in flight (it may have paid and we cannot prove otherwise). Callers use
 * this to refuse the two actions that are only safe when nothing has moved — charging the
 * family's budget for it a second time, and rejecting the chore it paid for.
 */
export function payoutMayHaveLanded(ref: string): boolean {
  if (wrepo.walletEventForPayoutRef(ref)) return true;
  // A payout the kid's deferred spending ate WHOLE moved no NIM and wrote no ledger row, but
  // it did pay for the work — the debt it cleared is the payment. Rejecting that chore
  // afterwards would strip it while the kid keeps what they bought with it, which is the same
  // loss the ledger check above exists to prevent. See src/kid-netting.ts.
  if (debtSettledByPayout(ref)) return true;
  return wrepo.getPayoutAttempt(ref)?.status === "in_flight";
}

/**
 * May this payout be put in front of a parent again?
 *
 * The answer is a property of the RECORDED ATTEMPT, not of whichever error came back — a lost
 * response and a flat refusal raise the same exception, so the exception cannot be the thing
 * that decides. Retrying is safe when nothing was ever broadcast, when the payment is already
 * recorded (the retry short-circuits), or when we hold the exact bytes and can put that same
 * one transaction back on the wire. It is unsafe in precisely one case: bytes crossed the wire
 * and we cannot reproduce them, so a retry would build a second, different transaction against
 * an unknown outcome.
 */
export function payoutRetryIsSafe(ref: string): boolean {
  const attempt = wrepo.getPayoutAttempt(ref);
  if (!attempt || attempt.status !== "in_flight") return true;
  return !!attempt.raw_tx_hex;
}

/**
 * The chain a REAL payout rides on. Exported so a test can drive the exact production path
 * off-SIM, the way topUpArrived takes `readBalance` as its seam.
 */
export interface EarnChain {
  send(child: repo.Child, valueLuna: number, message: string): Promise<string>;
  /**
   * Build + sign WITHOUT broadcasting, or null when the wallet will not surrender the bytes.
   * Splitting the two halves is what makes a retriable payout safe: a failure in here is
   * PROVABLY pre-broadcast, and the bytes it returns can be replayed instead of rebuilt.
   */
  prepare?(child: repo.Child, valueLuna: number, message: string): Promise<PreparedTx | null>;
  /** Put already-signed bytes on the wire. Broadcasting the same bytes twice is safe. */
  broadcast?(rawTxHex: string): Promise<string>;
}

const earnTx = (child: repo.Child, valueLuna: number, message: string) => ({
  // Same truncation the parent-signed path mints into its intent. Written twice, the two
  // would eventually disagree by a character and the relay would refuse a correct payout.
  recipient: child.address!, valueLuna, extraData: payoutExtraData(message),
});

export const realEarnChain: EarnChain = {
  send: (child, valueLuna, message) => makeProvider().sendTransaction(earnTx(child, valueLuna, message)),
  prepare: async (child, valueLuna, message) => {
    const p = makeProvider();
    // null, not a throw: an opaque provider is a fact about the wallet, not a failure.
    return p.prepareTransaction ? p.prepareTransaction(earnTx(child, valueLuna, message)) : null;
  },
  broadcast: async (rawTxHex) => {
    const p = makeProvider();
    if (!p.broadcastRaw) throw new Error(PAYOUT_UNRESOLVED);
    return p.broadcastRaw(rawTxHex);
  },
};

/**
 * Pay a kid for an approved chore/routine: REAL tx hot wallet -> kid.address, plus the 'earn'
 * ledger row. No ceiling: the amount is whatever the parent priced the chore at. Caller runs
 * checkPayable() BEFORE deciding the approval, so a payout the family cannot fund leaves the
 * approval pending rather than half-applied.
 */
export function payKidEarn(
  fam: repo.Family, childId: string, valueLuna: number, message: string,
  opts: { ref?: string | null } = {},
): Promise<wrepo.WalletEvent> {
  return payKidEarnVia(fam, childId, valueLuna, message, _earnChain ?? (SIM ? null : realEarnChain), opts);
}

let _earnChain: EarnChain | null = null;

/** Test seam, the sibling of wallet/_setProvider: drive the REAL route path — approve a chore,
 *  fail the broadcast, retry — against a chain a test controls. Without it the routes take the
 *  SIM branch, which has no network and therefore no failure to exercise. */
export function _setEarnChain(chain: EarnChain | null): void {
  _earnChain = chain;
}

/**
 * The body of payKidEarn. `chain` null is SIM: no network, nothing to fail, the row is
 * written 'done' exactly as it always was.
 *
 * Off-SIM the row is written PENDING against its own transaction hash. A node returning a
 * hash means "accepted into the mempool", never "executed" — the same gap already closed for
 * staking, unstaking, top-up crediting and Cashlink minting. A REJECTED transaction throws
 * out of `send` and writes no row at all (that case was always safe); an ACCEPTED-THEN-FAILED
 * one used to credit the kid for NIM that never arrived. sweepPendingEarns promotes the row
 * once the chain reports that transaction executed.
 *
 * NOTHING is read from the chain before the broadcast. The old baseline read was both
 * useless (a balance cannot attribute) and harmful: a single RPC hiccup at approval time
 * left the row with no baseline and deterministically wrote the payout off, even when the
 * NIM landed.
 *
 * The chore still visibly pays the instant the parent approves it — the row appears
 * immediately and the kid app already renders a pending row as on-its-way. What the row does
 * NOT do until it is proven is count as ledger balance.
 *
 * `ref` makes the payout EXACTLY-ONCE, not merely idempotent-on-success — see payoutRefFor
 * for what the key is and broadcastPayoutExactlyOnce for how one transaction is guaranteed.
 * The row above is still written AFTER the broadcast returns, so its absence proves nothing;
 * the write-ahead claim is what survives a response that never came back.
 */
export async function payKidEarnVia(
  fam: repo.Family, childId: string, valueLuna: number, message: string, chain: EarnChain | null,
  opts: { ref?: string | null } = {},
): Promise<wrepo.WalletEvent> {
  if (valueLuna <= 0) throw new Error("earn value must be positive");
  const ref = opts.ref ?? null;
  if (ref) {
    // A row for this key means the payment was made. A row PROVEN failed is not a payment,
    // and markWalletEventFailed retires the key precisely so this cannot find one.
    const already = wrepo.walletEventForPayoutRef(ref);
    if (already) return already;
  }
  const child = await ensureKidWallet(childId);
  const row = {
    familyId: fam.id, childId: child.id, kind: "earn" as const, valueLuna,
    counterpartyAddress: fam.parent_address || null, counterpartyLabel: "Family wallet",
    message, payoutRef: ref,
  };
  if (!chain) return wrepo.addWalletEvent({ ...row, txHash: simTxHash(), status: "done" });
  const txHash = ref
    ? await broadcastPayoutExactlyOnce(chain, ref, fam, child, valueLuna, message)
    : await chain.send(child, valueLuna, message);
  const event = wrepo.addWalletEvent({ ...row, txHash, status: "pending" });
  if (ref) wrepo.settlePayoutAttempt(ref, txHash);
  return event;
}

/**
 * At most ONE transaction is ever put on the wire for a given ref, so at most one payment can
 * ever land. Three failure shapes, three answers:
 *
 *   prepare threw     nothing was built, so nothing was sent. Release the claim; the retry
 *                     starts clean and builds fresh. (The common real case — an unreachable
 *                     node fails at the head-height read inside prepare.)
 *   broadcast threw   the bytes are held. The retry REPLAYS them: identical bytes hash
 *                     identically, and a chain cannot apply one transaction twice. Rebuilding
 *                     instead is what paid a kid twice — validityStartHeight has advanced, so
 *                     the rebuilt transaction is byte-different and dedupes against nothing.
 *   opaque wallet     no bytes to replay, so the outcome is unknowable: throw
 *                     PAYOUT_UNRESOLVED and never send anything again for this ref.
 */
async function broadcastPayoutExactlyOnce(
  chain: EarnChain, ref: string, fam: repo.Family, child: repo.Child,
  valueLuna: number, message: string,
): Promise<string> {
  const prior = wrepo.getPayoutAttempt(ref);
  if (prior?.status === "in_flight") {
    if (!prior.raw_tx_hex || !chain.broadcast) throw new Error(PAYOUT_UNRESOLVED);
    await chain.broadcast(prior.raw_tx_hex);
    return prior.tx_hash ?? "";
  }

  wrepo.claimPayoutAttempt({
    ref, familyId: fam.id, childId: child.id,
    valueLuna, recipient: child.address!, message,
  });

  if (chain.prepare && chain.broadcast) {
    let prepared: PreparedTx | null;
    try {
      prepared = await chain.prepare(child, valueLuna, message);
    } catch (err) {
      wrepo.releasePayoutAttempt(ref); // provably pre-broadcast: nothing can be in flight
      throw err;
    }
    if (prepared) {
      // The bytes are durable BEFORE they are broadcast. This ordering is the fix.
      wrepo.armPayoutAttempt(ref, prepared.rawTxHex, prepared.txHash);
      await chain.broadcast(prepared.rawTxHex);
      return prepared.txHash;
    }
  }

  // Opaque wallet: a second call could never be proven to be the same transaction. Mark the
  // crossing BEFORE it happens, so a failure from here is unresolved — the safe answer —
  // rather than silently retried into a second payment.
  wrepo.armPayoutAttempt(ref, null, null);
  return chain.send(child, valueLuna, message);
}

/**
 * Pay a PROVEN-FAILED payout again. The parent was already told the chore was paid and the
 * chore itself is already 'approved', so without this a refused payout was unrecoverable:
 * re-approving returns 409 and there was no other way to move the money.
 *
 * Only a row the chain PROVED did not execute is repayable — a pending row may yet land, and
 * paying it again would double-pay. One repay per failed row (the marker), and the caller
 * holds the family spend lock so two clicks cannot both pass that check.
 *
 * THE REPAY RIDES THE SAME KEY THE WORK ALWAYS RODE. This is the one route whose whole job
 * is sending money a second time, and it used to be the one route that sent it with no key
 * at all — outside the claim, the arming and the replay, i.e. outside every guarantee the
 * rest of the module is built from. Two ways that paid a kid twice:
 *
 *   the response is lost   nothing is written (the row and the marker both come after the
 *                          broadcast returns), so the next tap saw an untouched failed row
 *                          and rebuilt a byte-different transaction beside the one the node
 *                          had already taken. With the key, that tap replays the same bytes.
 *   the chore is re-handed-in  the marker is keyed on the ROW; the chore's guard is keyed on
 *                          the WORK. A replacement carrying no key left
 *                          `payoutMayHaveLanded("chore:<id>")` false forever, so an ordinary
 *                          re-submit + approve — no RPC failure anywhere — paid it again.
 *
 * Taking the retired key back closes both, and closes the reject route with them: rejecting
 * a chore whose repay landed would strip the chore while the kid keeps the NIM. The fallback
 * key is for a payout that never had one (a gift, an old row); it still buys the claim.
 */
export async function repayFailedEarn(
  fam: repo.Family, ev: wrepo.WalletEvent,
): Promise<wrepo.WalletEvent> {
  if (ev.kind !== "earn" || ev.status !== "failed") throw new Error("not_repayable");
  if (wrepo.getWalletState(earnRepayKey(ev.id))) throw new Error("already_repaid");
  const ref = wrepo.getWalletState(wrepo.retiredPayoutRefKey(ev.id)) || payoutRefFor("repay", ev.id);
  const replacement = await payKidEarn(
    fam, ev.child_id!, ev.value_luna, ev.message ?? "Chore payout", { ref },
  );
  wrepo.setWalletState(earnRepayKey(ev.id), replacement.id);
  return replacement;
}

/** wallet_state key linking a written-off payout to the row that replaced it. */
export const earnRepayKey = (eventId: string) => `earn_repay:${eventId}`;

/**
 * V3 Treasure Box: the kid SPENDS real NIM back to the family hot wallet ('spend' ledger
 * row, reserved since W1). REAL mode signs with the kid's derived key; SIM is ledger-only.
 * Throws Error('insufficient_funds') / Error('invalid_value') like kidTransfer.
 */
export async function kidSpend(
  fam: repo.Family, childId: string, valueLuna: number, message: string,
): Promise<wrepo.WalletEvent> {
  return withSpendLock(childSpendKey(childId), () => kidSpendHeld(fam, childId, valueLuna, message));
}

/**
 * The body of kidSpend, for a caller ALREADY HOLDING `childSpendKey(childId)`.
 *
 * `withSpendLock` is not re-entrant, so a route that has to hold the lock across more than
 * the charge — because the thing it is buying can only be bought once — calls this instead
 * of kidSpend. The Treasure Box is that case: serialising the two debits perfectly does not
 * stop either of them when each is individually affordable, so the ownership test has to be
 * inside the same critical section as the charge and the grant. See routes/store.ts.
 */
export async function kidSpendHeld(
  fam: repo.Family, childId: string, valueLuna: number, message: string,
): Promise<wrepo.WalletEvent> {
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_value");
  const child = await ensureKidWallet(childId);
  const balance = await availableKidLuna(child);
  if (balance < valueLuna) throw new Error("insufficient_funds");
  let txHash: string;
  if (SIM) {
    txHash = simTxHash();
  } else {
    const key = await kidKey(child);
    txHash = await providerForKey(key.privHex).sendTransaction({
      recipient: fam.parent_address, valueLuna, extraData: message.slice(0, 64) || undefined,
    });
  }
  return wrepo.addWalletEvent({
    familyId: fam.id, childId: child.id, kind: "spend", valueLuna: -valueLuna,
    counterpartyAddress: fam.parent_address || null, counterpartyLabel: "Treasure Box",
    txHash, message,
  });
}

/** Coupon rejected after the kid already paid: the hot wallet gives the NIM back
 *  ('deposit' row; REAL tx hot wallet -> kid, same path as earns). */
export async function refundKidSpend(
  fam: repo.Family, childId: string, valueLuna: number, message: string,
): Promise<wrepo.WalletEvent> {
  if (valueLuna <= 0) throw new Error("invalid_value");
  const child = await ensureKidWallet(childId);
  const txHash = SIM
    ? simTxHash()
    : await makeProvider().sendTransaction({
        recipient: child.address!, valueLuna, extraData: message.slice(0, 64),
      });
  return wrepo.addWalletEvent({
    familyId: fam.id, childId: child.id, kind: "deposit", valueLuna,
    counterpartyAddress: fam.parent_address || null, counterpartyLabel: "Treasure Box",
    txHash, message,
  });
}

export type TransferTarget =
  | { toChildId: string }
  | { toParent: true }
  /** An address the kid scanned. Only ever reached through an APPROVED send
   *  request — never straight off the camera. */
  | { toAddress: string; toLabel: string };

/**
 * Is this address somewhere INSIDE the family, and if so which target is it?
 *
 * A queued family transfer stores only the resolved destination address (send_requests has
 * no richer column), so execution has to find its way back to the original intent — or the
 * sibling on the receiving end never gets their 'deposit' row and the sender's feed reads
 * the raw address instead of a name. Returns null for anything outside the household, which
 * is the scanned-code case and keeps its existing behaviour.
 */
export function familyTransferTarget(fam: repo.Family, toAddress: string): TransferTarget | null {
  const want = bareAddr(toAddress);
  if (!want) return null;
  const sibling = repo.listChildren(fam.id).find((k) => bareAddr(k.address) === want);
  if (sibling) return { toChildId: sibling.id };
  if (bareAddr(fam.parent_address) === want) return { toParent: true };
  return null;
}

/**
 * Immediate family transfer (kid -> sibling, kid -> parent). Double-entry in the ledger:
 * sender 'send' (−v) and, for a sibling, receiver 'deposit' (+v). REAL mode signs with the
 * KID's derived key. Throws Error('insufficient_funds') when the spendable balance is short.
 */
export async function kidTransfer(
  fam: repo.Family, fromChildId: string, target: TransferTarget, valueLuna: number, message: string | null,
): Promise<{ sent: wrepo.WalletEvent; received: wrepo.WalletEvent | null }> {
  return withSpendLock(childSpendKey(fromChildId), () =>
    kidTransferLocked(fam, fromChildId, target, valueLuna, message, null));
}

/** The body of kidTransfer — caller holds the SENDER's spend lock (executeSendRequest
 *  already does, so it calls this directly rather than deadlocking on its own key). */
async function kidTransferLocked(
  fam: repo.Family, fromChildId: string, target: TransferTarget, valueLuna: number,
  message: string | null, excludeRequestId: string | null,
): Promise<{ sent: wrepo.WalletEvent; received: wrepo.WalletEvent | null }> {
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_value");
  const sender = await ensureKidWallet(fromChildId);

  let toAddress: string; let toLabel: string; let toChild: repo.Child | null = null;
  if ("toChildId" in target) {
    if (target.toChildId === fromChildId) throw new Error("self_transfer");
    toChild = await ensureKidWallet(target.toChildId);
    if (toChild.family_id !== fam.id) throw new Error("not_family");
    toAddress = toChild.address!;
    toLabel = toChild.label;
  } else if ("toAddress" in target) {
    toAddress = target.toAddress;
    toLabel = target.toLabel;
  } else {
    toAddress = fam.parent_address;
    toLabel = "Family wallet";
  }

  const balance = await availableKidLuna(sender, excludeRequestId);
  if (balance < valueLuna) throw new Error("insufficient_funds");

  let txHash: string;
  if (SIM) {
    txHash = simTxHash();
  } else {
    const key = await kidKey(sender);
    txHash = await providerForKey(key.privHex).sendTransaction({
      recipient: toAddress, valueLuna, extraData: (message ?? "").slice(0, 64) || undefined,
    });
  }

  const sent = wrepo.addWalletEvent({
    familyId: fam.id, childId: sender.id, kind: "send", valueLuna: -valueLuna,
    counterpartyAddress: toAddress, counterpartyLabel: toLabel, txHash, message,
  });
  const received = toChild
    ? wrepo.addWalletEvent({
        familyId: fam.id, childId: toChild.id, kind: "deposit", valueLuna,
        counterpartyAddress: sender.address, counterpartyLabel: sender.label, txHash, message,
      })
    : null;
  return { sent, received };
}

/**
 * Execute an APPROVED send request. Called by the approvals queue after the parent wins the
 * race-safe decide, and only then — nothing here moves money without that.
 *
 * Two shapes, one queue. A request with `to_address` is a scanned send: the kid pointed the
 * camera at somebody's code, so there IS a destination and it settles as a direct transfer. A
 * request without one is the Cashlink path: no address exists yet, so it mints a claimable link.
 * The parent approves the same way for both; what differs is only where the money lands.
 */
export function executeSendRequest(
  fam: repo.Family, req: wrepo.SendRequest,
): Promise<{ cashlink: repo.Cashlink | null; event: wrepo.WalletEvent }> {
  // SERIALIZED per child: two concurrent executions against the same kid's balance used to
  // both read the pre-spend balance across their await points and both proceed (observed:
  // two 200s, two Cashlink URLs, one address funded and one empty). The whole
  // [re-check -> move money -> record it] is one critical section per balance owner now.
  return withSpendLock(childSpendKey(req.child_id), () => executeSendRequestLocked(fam, req));
}

async function executeSendRequestLocked(
  fam: repo.Family, req: wrepo.SendRequest,
): Promise<{ cashlink: repo.Cashlink | null; event: wrepo.WalletEvent }> {
  // Re-read under the lock: the caller's snapshot may predate a settlement that won the lock.
  const fresh = wrepo.getSendRequest(req.id);
  if (!fresh || fresh.status !== "pending") throw new Error("request_not_pending");
  const child = await ensureKidWallet(req.child_id);

  if (req.to_address) {
    // A destination inside the household is a queued FAMILY transfer (v0.43): resolve it back
    // to the target the kid actually picked so approving it lands exactly where the instant
    // path used to — sibling deposit row, "Family wallet" label, everything.
    const target = familyTransferTarget(fam, req.to_address)
      ?? { toAddress: req.to_address, toLabel: req.message ?? "Scanned code" };
    const { sent } = await kidTransferLocked(fam, child.id, target, req.value_luna, req.message, req.id);
    wrepo.settleSendRequest(req.id, "executed", null);
    return { cashlink: null, event: sent };
  }

  // Affordability is re-checked HERE, not just when the request was queued. Two requests
  // that were each affordable when the kid made them are not necessarily both affordable by
  // the time a parent works through the queue. Verified overdraft: balance 75,000, two
  // 50,000 cashlink requests, both approved, final balance -25,000 with two spendable
  // cashlinks minted. The scanned-address branch above is already safe because the transfer
  // does its own check; the mint path had none. In-flight value is subtracted too — this
  // request's own approved-but-unsettled row is excluded so it never blocks itself.
  const balance = await availableKidLuna(child, req.id);
  if (balance < req.value_luna) throw new Error("insufficient_funds");
  const key = await kidKey(child);
  const mint = await mintCashlink(providerForKey(key.privHex), req.value_luna, req.message ?? `From ${child.label}`);
  const cashlink = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: null, child_id: child.id,
    kind: "peer", cashlink_address: mint.cashlinkAddress, value_luna: mint.valueLuna,
    message: req.message, url: mint.url, funding_tx_hash: mint.fundingTxHash, status: "ready",
  });
  const event = wrepo.addWalletEvent({
    familyId: fam.id, childId: child.id, kind: "send", valueLuna: -req.value_luna,
    counterpartyAddress: mint.cashlinkAddress, counterpartyLabel: "Cashlink",
    txHash: SIM ? simTxHash() : mint.fundingTxHash, message: req.message,
  });
  wrepo.settleSendRequest(req.id, "executed", cashlink.id);
  return { cashlink, event };
}
