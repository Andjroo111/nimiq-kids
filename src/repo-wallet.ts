// V2 wallet core data layer: kid account assignment, the wallet_events kid-facing ledger,
// send_requests (parent-approved cashlink sends), and tiny key/value wallet_state.
//
// wallet_events semantics — value_luna is SIGNED from the kid's SPENDABLE balance perspective:
//   'earn'    +v  chore/routine approval paid out
//   'deposit' +v  incoming transfer (sibling gift, opening migration, hot-wallet top-up when child_id null)
//   'send'    -v  outgoing transfer (sibling, parent, cashlink)
//   'spend'   -v  future treasure-store purchases (economy-compatible now, unused in V2)
//   'stake'   -v  spendable -> staked
//   'unstake' +v  staked -> spendable; status 'pending' while in cooldown (NOT yet spendable)
//   'reward'  +v  staking reward, auto-restaked (counts toward STAKED, never spendable directly)
//
// SIM: this ledger IS the balance. REAL: the chain is truth for spendable (RPC getBalance);
// the ledger stays the instant-UX activity feed + the staked/pending bookkeeping (all staking
// flows go through this server, so its staking ledger is authoritative for principal).

import type { ProofKind } from "./nimiq/address-proof";
import { getDb } from "./db";

export type WalletEventKind = "earn" | "send" | "deposit" | "stake" | "unstake" | "reward" | "spend";
/**
 * 'pending' — broadcast but not yet proven to have EXECUTED on chain.
 * 'failed'  — proven not to have executed; excluded from every balance. A staking
 *             transaction can be accepted by the mempool, included in a block and
 *             still fail execution (verified on testnet 2026-07-31: a create-staker
 *             delegating to an unregistered validator lands in a block, reports
 *             state "confirmed", and never debits the account). Broadcast success is
 *             therefore NOT execution success, and the ledger must be able to say so.
 */
export type WalletEventStatus = "done" | "pending" | "failed";

export interface WalletEvent {
  id: string; family_id: string; child_id: string | null;
  kind: WalletEventKind; status: WalletEventStatus;
  counterparty_address: string | null; counterparty_label: string | null;
  value_luna: number; tx_hash: string | null; message: string | null;
  available_at: number | null;
  /** Idempotency key for a RETRIABLE payout (see walletEventForPayoutRef). */
  payout_ref: string | null;
  created_at: number;
}

export interface SendRequest {
  id: string; family_id: string; child_id: string;
  /** 'cashlink' | 'address' = outbound sends; 'stake' | 'unstake' = queued staking intents
   *  riding the same table (column is untyped TEXT — additive, zero migration). */
  kind: "cashlink" | "address" | "stake" | "unstake";
  value_luna: number; message: string | null;
  /** Destination for a scanned send; NULL for a Cashlink (no address exists yet). */
  to_address: string | null;
  status: "pending" | "executed" | "rejected";
  cashlink_id: string | null; created_at: number; decided_at: number | null;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- kid account assignment ----
//
// Every new kid account is scoped to its household: the family gets a branch (families.hd_index)
// and the kid gets an index inside THAT branch, so index 0 of one family and index 0 of another
// are different keys. Accounts created before this keep their old flat path untouched — see
// src/nimiq/hd.ts. Nothing here ever rewrites an index that already exists.

/** Highest family branch index ever handed out on this instance (survives row deletion). */
const FAMILY_HD_HIGH_WATER_KEY = "hd_family_index_high_water";
/** Per-family: highest kid index ever handed out inside that family (survives row deletion). */
const kidHighWaterKey = (familyId: string) => `hd_account_index_high_water:${familyId}`;

/**
 * A high-water mark exists because MAX() over live rows is not enough on its own: deleting rows
 * (the demo sweeper purges whole households) lowers the max and would hand the NEXT account an
 * index that already derives a funded on-chain address. These marks only ever rise, so an index
 * is never handed out twice for the life of the seed.
 */
function nextFromHighWater(liveNext: number, key: string): { next: number; highWater: number } {
  const highWater = Number(getWalletState(key) ?? -1);
  return { next: Math.max(liveNext, highWater + 1), highWater };
}

/** Assign (or read) this household's HD branch index. Globally unique, never reused, never
 *  reassigned once set. Race-safe via idx_families_hd_index. */
export function assignFamilyHdIndex(familyId: string): number {
  const db = getDb();
  const existing = db.query("SELECT hd_index FROM families WHERE id=?").get(familyId) as { hd_index: number | null } | null;
  if (!existing) throw new Error(`family not found: ${familyId}`);
  if (existing.hd_index !== null) return existing.hd_index;
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = db.query("SELECT COALESCE(MAX(hd_index), -1) + 1 AS next FROM families").get() as { next: number };
    const { next, highWater } = nextFromHighWater(row.next, FAMILY_HD_HIGH_WATER_KEY);
    try {
      db.run("UPDATE families SET hd_index=? WHERE id=? AND hd_index IS NULL", [next, familyId]);
    } catch {
      continue; // another writer took `next` — recompute
    }
    const after = db.query("SELECT hd_index FROM families WHERE id=?").get(familyId) as { hd_index: number | null };
    if (after.hd_index !== null) {
      if (after.hd_index > highWater) setWalletState(FAMILY_HD_HIGH_WATER_KEY, String(after.hd_index));
      return after.hd_index;
    }
  }
  throw new Error("could not assign a family HD index");
}

/**
 * Assign the next free account index to a child WITHIN ITS FAMILY, returning the full path
 * coordinates. An existing assignment always wins and is returned as-is — including a legacy
 * row, whose `familyIndex` stays null so it keeps deriving the address it already has.
 *
 * Concurrency: two children of the same family provisioned at the same time both compute the
 * same `next`; idx_children_family_account_index makes the loser's UPDATE fail rather than
 * silently share an address, and the loop recomputes. (Different problem from the spend lock:
 * that serializes money leaving one balance, this serializes handing out a coordinate.)
 */
export function assignKidAccount(childId: string): { index: number; familyIndex: number | null } {
  const db = getDb();
  const child = db.query("SELECT family_id, account_index, hd_family_index FROM children WHERE id=?").get(childId) as
    | { family_id: string; account_index: number | null; hd_family_index: number | null }
    | null;
  if (!child) throw new Error(`child not found: ${childId}`);
  if (child.account_index !== null) return { index: child.account_index, familyIndex: child.hd_family_index };

  const familyIndex = assignFamilyHdIndex(child.family_id);
  const hwKey = kidHighWaterKey(child.family_id);
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = db
      .query("SELECT COALESCE(MAX(account_index), -1) + 1 AS next FROM children WHERE family_id=?")
      .get(child.family_id) as { next: number };
    const { next, highWater } = nextFromHighWater(row.next, hwKey);
    try {
      db.run(
        "UPDATE children SET account_index=?, hd_family_index=? WHERE id=? AND account_index IS NULL",
        [next, familyIndex, childId],
      );
    } catch {
      continue; // unique collision with a parallel assignment — recompute
    }
    const after = db.query("SELECT account_index, hd_family_index FROM children WHERE id=?").get(childId) as {
      account_index: number | null; hd_family_index: number | null;
    };
    if (after.account_index !== null) {
      if (after.account_index > highWater) setWalletState(hwKey, String(after.account_index));
      return { index: after.account_index, familyIndex: after.hd_family_index };
    }
  }
  throw new Error("could not assign a kid account index");
}

/**
 * The next account index this family would hand out, WITHOUT handing it out.
 *
 * Read-only on purpose: the character picker needs somewhere to start counting from, and it
 * must not consume a coordinate to find out. Bounded by the same high-water mark
 * `assignKidAccount` uses, so an index freed by `clearDerivationCoordinates` is not re-offered
 * to a second kid after the first one's account was cleared.
 */
export function nextFreeKidIndex(familyId: string): number {
  const row = getDb()
    .query("SELECT COALESCE(MAX(account_index), -1) + 1 AS next FROM children WHERE family_id=?")
    .get(familyId) as { next: number };
  return nextFromHighWater(row.next, kidHighWaterKey(familyId)).next;
}

/**
 * Claim ONE specific account index for a child, the picker's counterpart to `assignKidAccount`.
 *
 * The difference is who chose, and it is the only difference: the write is the same conditional
 * UPDATE, so a child that already holds coordinates keeps them and a caller cannot move a funded
 * kid by asking twice. `null` means the claim did not happen, and the two ways it can fail are
 * deliberately not distinguished here — `idx_children_family_account_index` rejecting a sibling's
 * index and the row already being assigned are the same answer to the caller: pick again.
 *
 * NOTHING here validates that `index` was ever offered. That check belongs to the module that
 * minted the offer (src/kid-character.ts), because this function is also the seam a parent-side
 * repair would use.
 */
export function claimKidAccountIndex(
  childId: string,
  index: number,
): { index: number; familyIndex: number | null } | null {
  const db = getDb();
  const child = db.query("SELECT family_id, account_index FROM children WHERE id=?").get(childId) as
    | { family_id: string; account_index: number | null }
    | null;
  if (!child) throw new Error(`child not found: ${childId}`);
  if (child.account_index !== null) return null;
  if (!Number.isInteger(index) || index < 0) return null;

  const familyIndex = assignFamilyHdIndex(child.family_id);
  try {
    db.run(
      "UPDATE children SET account_index=?, hd_family_index=? WHERE id=? AND account_index IS NULL",
      [index, familyIndex, childId],
    );
  } catch {
    return null; // a sibling holds this index
  }
  const after = db.query("SELECT account_index, hd_family_index FROM children WHERE id=?").get(childId) as {
    account_index: number | null; hd_family_index: number | null;
  };
  if (after.account_index === null) return null;
  const hwKey = kidHighWaterKey(child.family_id);
  if (after.account_index > Number(getWalletState(hwKey) ?? -1)) {
    setWalletState(hwKey, String(after.account_index));
  }
  return { index: after.account_index, familyIndex: after.hd_family_index };
}

/** Cache the derived NQ address on the child row (public data; the key is re-derived on demand).
 *  Stamps the provenance in the SAME statement: a row carrying an address with no
 *  `address_source` is one the boot guard and the migration script cannot classify, and the
 *  only way to guarantee they never see one is to never write one. `derived_address` keeps
 *  its own copy so it survives the row later moving to a parent-owned address. */
export function setChildAddress(childId: string, address: string): void {
  getDb().run(
    "UPDATE children SET address=?, address_source='derived', derived_address=? WHERE id=?",
    [address, address, childId],
  );
}

/** Every child a server-derived key exists for, with the address that key controls.
 *  `derived_address` wins over `address` because a re-registered kid's `address` is now
 *  the parent-owned one, and the account this asks about is the OTHER one. */
export function listDerivedKidAccounts(): {
  id: string; label: string; familyId: string; address: string | null; accountIndex: number;
}[] {
  return getDb()
    .query(
      `SELECT id, label, family_id AS familyId,
              COALESCE(derived_address, address) AS address,
              account_index AS accountIndex
         FROM children
        WHERE account_index IS NOT NULL
        ORDER BY family_id, account_index`,
    )
    .all() as { id: string; label: string; familyId: string; address: string | null; accountIndex: number }[];
}

/** Is this address already registered to a DIFFERENT child anywhere on this instance?
 *  Compared without spacing, because the same address is written both ways. */
export function childHoldingAddress(address: string, exceptChildId: string): { id: string; label: string } | null {
  const bare = address.replace(/\s+/g, "").toUpperCase();
  return (getDb()
    .query(
      `SELECT id, label FROM children
        WHERE id != ? AND address IS NOT NULL
          AND UPPER(REPLACE(address, ' ', '')) = ?
        LIMIT 1`,
    )
    .get(exceptChildId, bare) as { id: string; label: string }) ?? null;
}

/** Write a parent-owned address and its proof onto the child row.
 *
 *  The derivation coordinates are LEFT ALONE. They are the only remaining record of which
 *  server-custodied account this kid used to have, and a sweep that has not happened yet
 *  needs them. src/scripts/migrate-to-parent-custody.ts is what clears them, after it has
 *  proved that account is empty. */
export function setParentOwnedAddress(
  childId: string,
  address: string,
  proof: { message: string; publicKeyHex: string; signatureHex: string; kind?: ProofKind },
): void {
  getDb().run(
    `UPDATE children
        SET address=?, address_source='parent',
            address_proof_message=?, address_proof_pubkey=?, address_proof_sig=?,
            address_proof_kind=?, address_registered_at=?
      WHERE id=?`,
    [address, proof.message, proof.publicKeyHex, proof.signatureHex,
     proof.kind ?? "signed_message", Date.now(), childId],
  );
}

/** Forget a kid's derivation coordinates once its server-custodied account is proved empty.
 *  `derived_address` is kept: it is history, and history is what tells someone reading this
 *  row in a year which account the money used to be in. */
export function clearDerivationCoordinates(childId: string): void {
  getDb().run("UPDATE children SET account_index=NULL, hd_family_index=NULL WHERE id=?", [childId]);
}

/**
 * Put a kid back to "has never had an account", so the character picker will offer to them.
 *
 * Strictly more than `clearDerivationCoordinates`, and the difference is the whole point.
 * That one forgets WHERE the key was and deliberately leaves `address` standing, because on
 * the parent-custody path the row is about to gain a parent-owned address and the derived one
 * is history. Here there is no replacement coming: the row has to reach the state a brand-new
 * child is in, which is `address` NULL and `address_source` NULL together. `issueCharacterSet`
 * refuses on `address` alone, so clearing only the coordinates leaves the picker still shut.
 *
 * `address_source` goes with it rather than staying `derived`. A row carrying a source with no
 * address is one the boot guard and the migration script cannot classify, which is the same
 * reason `setChildAddress` writes the two in a single statement.
 *
 * `derived_address` is KEPT, same as next door: it is the only record of which account this
 * kid used to be, and a year from now that is the question someone will have.
 *
 * CALLERS MUST PROVE THE OLD ACCOUNT IS EMPTY FIRST (`derivedAccountEmptiness`). Nothing here
 * checks, because this is also the seam a hand repair would use, and a guard on the write is
 * not a guard on the decision.
 */
export function resetKidForCharacterPick(childId: string): void {
  getDb().run(
    `UPDATE children
        SET account_index=NULL, hd_family_index=NULL, address=NULL, address_source=NULL
      WHERE id=?`,
    [childId],
  );
}

// ---- wallet events (the kid-facing feed) ----
export interface WalletEventInput {
  familyId: string; childId: string | null; kind: WalletEventKind;
  valueLuna: number; // signed — see header comment
  status?: WalletEventStatus;
  counterpartyAddress?: string | null; counterpartyLabel?: string | null;
  txHash?: string | null; message?: string | null; availableAt?: number | null;
  /** Idempotency key — set it and this payout can only ever be recorded once. */
  payoutRef?: string | null;
}

export function addWalletEvent(e: WalletEventInput): WalletEvent {
  const row: WalletEvent = {
    id: uid(), family_id: e.familyId, child_id: e.childId, kind: e.kind,
    status: e.status ?? "done",
    counterparty_address: e.counterpartyAddress ?? null,
    counterparty_label: e.counterpartyLabel ?? null,
    value_luna: e.valueLuna, tx_hash: e.txHash ?? null, message: e.message ?? null,
    available_at: e.availableAt ?? null, payout_ref: e.payoutRef ?? null, created_at: now(),
  };
  getDb().run(
    `INSERT INTO wallet_events (id, family_id, child_id, kind, status, counterparty_address, counterparty_label,
       value_luna, tx_hash, message, available_at, payout_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.family_id, row.child_id, row.kind, row.status, row.counterparty_address,
     row.counterparty_label, row.value_luna, row.tx_hash, row.message, row.available_at,
     row.payout_ref, row.created_at],
  );
  return row;
}

/**
 * The ledger row a retriable payout already wrote, if it wrote one.
 *
 * This answers "did this payment DEFINITELY happen?" — and only that. It does NOT answer
 * "did this payment definitely not happen": the row is written after the broadcast returns,
 * so a transaction the node accepted and then failed to acknowledge leaves no row behind.
 * Treating the absence of a row as proof that nothing was sent is exactly what paid a kid
 * twice; `payoutAttempt` below is the record that survives that case.
 */
export function walletEventForPayoutRef(ref: string): WalletEvent | null {
  return (getDb().query("SELECT * FROM wallet_events WHERE payout_ref=?").get(ref) as WalletEvent) ?? null;
}

// ---- payout attempts (the write-ahead claim; see schema.sql) ----

export type PayoutAttemptStatus = "preparing" | "in_flight" | "settled";

export interface PayoutAttempt {
  payout_ref: string; family_id: string; child_id: string;
  value_luna: number; recipient: string; message: string | null;
  raw_tx_hex: string | null; tx_hash: string | null;
  status: PayoutAttemptStatus; created_at: number; updated_at: number;
  /** Set together, or all NULL. NULL `sender` = a server-signed attempt (the old shape);
   *  a non-NULL one is a parent signing intent, and the four fields are what the parent's
   *  wallet has to reproduce byte for byte. See src/wallet/payout-intent.ts. */
  sender: string | null;
  intent_data: string | null;
  validity_start_height: number | null;
  expires_at: number | null;
  /** Deferred spending this payout carries instead of moving (src/kid-netting.ts). Pinned at
   *  mint: `value_luna` is the gross MINUS this, and it is what the parent signs. NULL on
   *  every attempt written before netting existed, which is the same as 0 to every reader. */
  netted_luna: number | null;
}

export interface PayoutAttemptInput {
  ref: string; familyId: string; childId: string;
  valueLuna: number; recipient: string; message?: string | null;
  /** Present only for a parent signing intent; omitted for a server-signed payout. */
  intent?: {
    sender: string;
    data: string;
    validityStartHeight: number;
    expiresAt: number;
  };
  /** Deferred spending netted out of this payout's gross. See PayoutAttempt.netted_luna. */
  nettedLuna?: number;
}

export function getPayoutAttempt(ref: string): PayoutAttempt | null {
  return (getDb().query("SELECT * FROM payout_attempts WHERE payout_ref=?").get(ref) as PayoutAttempt) ?? null;
}

/** Stake a claim on this payout BEFORE anything touches the network. The primary key is
 *  what makes it a claim: a concurrent caller cannot open a second attempt for the same
 *  payout, it can only find this one. Returns the row that now owns the ref. */
export function claimPayoutAttempt(a: PayoutAttemptInput): PayoutAttempt {
  const t = now();
  getDb().run(
    `INSERT OR IGNORE INTO payout_attempts
       (payout_ref, family_id, child_id, value_luna, recipient, message, raw_tx_hex, tx_hash, status, created_at, updated_at,
        sender, intent_data, validity_start_height, expires_at, netted_luna)
     VALUES (?,?,?,?,?,?,NULL,NULL,'preparing',?,?,?,?,?,?,?)`,
    [
      a.ref, a.familyId, a.childId, a.valueLuna, a.recipient, a.message ?? null, t, t,
      a.intent?.sender ?? null, a.intent?.data ?? null,
      a.intent?.validityStartHeight ?? null, a.intent?.expiresAt ?? null,
      a.nettedLuna ?? null,
    ],
  );
  return getPayoutAttempt(a.ref)!;
}

/** Record the exact signed bytes and move the claim to 'in_flight'. Called BEFORE the
 *  broadcast — everything after this line is replayable, nothing before it ever left. */
export function armPayoutAttempt(ref: string, rawTxHex: string | null, txHash: string | null): void {
  getDb().run(
    "UPDATE payout_attempts SET raw_tx_hex=?, tx_hash=?, status='in_flight', updated_at=? WHERE payout_ref=?",
    [rawTxHex, txHash, now(), ref],
  );
}

export function settlePayoutAttempt(ref: string, txHash: string | null): void {
  getDb().run(
    "UPDATE payout_attempts SET status='settled', tx_hash=COALESCE(?, tx_hash), updated_at=? WHERE payout_ref=?",
    [txHash, now(), ref],
  );
}

/** Drop a claim that provably never reached a node, so the retry starts clean and builds a
 *  fresh transaction. Only ever called on a 'preparing' row: an 'in_flight' claim is the
 *  one thing standing between a lost response and a second payment. */
export function releasePayoutAttempt(ref: string): void {
  getDb().run("DELETE FROM payout_attempts WHERE payout_ref=? AND status='preparing'", [ref]);
}

export function getWalletEvent(id: string): WalletEvent | null {
  return (getDb().query("SELECT * FROM wallet_events WHERE id=?").get(id) as WalletEvent) ?? null;
}

/** The kid-facing feed. Rows proven NOT to have executed are left out: the row survives in
 *  the table for reconciliation and audit, but a transfer that never happened must never
 *  stand in a kid's history looking like money they were given. */
export function listWalletEvents(childId: string, limit = 50): WalletEvent[] {
  return getDb().query(
    "SELECT * FROM wallet_events WHERE child_id=? AND status<>'failed' ORDER BY created_at DESC, rowid DESC LIMIT ?",
  ).all(childId, limit) as WalletEvent[];
}

/** Ledger spendable balance (SIM truth; REAL uses RPC getBalance and this is the feed only).
 *  Pending unstakes are excluded — the value is still in cooldown. So are pending EARNS: a
 *  payout that has only been broadcast has not arrived, and counting it would credit a kid
 *  for NIM the chain may never deliver (see sweepPendingEarns). */
export function spendableFromLedger(childId: string): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(value_luna), 0) AS bal FROM wallet_events
      WHERE child_id=? AND status<>'failed'
        AND (kind IN ('deposit','send','spend')
             OR (kind='earn'    AND status='done')
             OR (kind='stake'   AND status='done')
             OR (kind='unstake' AND status='done'))`,
  ).get(childId) as { bal: number };
  return row.bal;
}

/**
 * Staked principal = CONFIRMED stakes + auto-restaked rewards − every unstake (deactivation
 * removes the value from the stake immediately, even while the release is pending).
 *
 * Only status='done' stake rows count. An unconfirmed stake is money that is still sitting
 * spendable in the kid's account, and claiming it as staked is precisely the lie this
 * function used to tell: the app would show "100 NIM growing" against a transaction that
 * never executed, while the kid could still spend every luna of it.
 */
export function stakedFromLedger(childId: string): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(CASE
        WHEN kind='stake' AND status='done' THEN -value_luna  -- stake rows are negative (leave spendable)
        WHEN kind='reward'                  THEN  value_luna
        WHEN kind='unstake'                 THEN -value_luna  -- unstake rows are positive (return to spendable)
        ELSE 0 END), 0) AS staked
       FROM wallet_events WHERE child_id=? AND status<>'failed'`,
  ).get(childId) as { staked: number };
  return row.staked;
}

/** Stakes broadcast but not yet proven to have executed — shown to the kid as "starting…",
 *  never as staked and never as locked. */
export function pendingStakeFromLedger(childId: string): number {
  const row = getDb().query(
    "SELECT COALESCE(SUM(-value_luna), 0) AS v FROM wallet_events WHERE child_id=? AND kind='stake' AND status='pending'",
  ).get(childId) as { v: number };
  return row.v;
}

/** Payouts broadcast but not yet proven to have executed — shown to the kid as an
 *  on-its-way row, never as spendable balance. */
export function pendingEarnFromLedger(childId: string): number {
  const row = getDb().query(
    "SELECT COALESCE(SUM(value_luna), 0) AS v FROM wallet_events WHERE child_id=? AND kind='earn' AND status='pending'",
  ).get(childId) as { v: number };
  return row.v;
}

export function listPendingEarns(childId: string): WalletEvent[] {
  return getDb().query(
    "SELECT * FROM wallet_events WHERE child_id=? AND kind='earn' AND status='pending' ORDER BY created_at",
  ).all(childId) as WalletEvent[];
}

/** Every child holding an in-flight payout, across ALL households — the sweeper's work list,
 *  so reconciliation no longer depends on a kid opening the app. */
export function childIdsWithPendingEarns(): string[] {
  const rows = getDb().query(
    "SELECT DISTINCT child_id AS id FROM wallet_events WHERE kind='earn' AND status='pending' AND child_id IS NOT NULL",
  ).all() as { id: string }[];
  return rows.map((r) => r.id);
}

export function listPendingStakes(childId: string): WalletEvent[] {
  return getDb().query(
    "SELECT * FROM wallet_events WHERE child_id=? AND kind='stake' AND status='pending' ORDER BY created_at",
  ).all(childId) as WalletEvent[];
}

/** Record the latest broadcast hash WITHOUT changing status — a retire+remove that was
 *  accepted but not yet proven to have executed stays pending with its hash visible. */
export function setWalletEventTxHash(id: string, txHash: string | null): void {
  getDb().run("UPDATE wallet_events SET tx_hash=? WHERE id=?", [txHash, id]);
}

/**
 * wallet_state key remembering the payout key a written-off row gave up.
 *
 * The column has to be cleared — `idx_wallet_events_payout_ref` is UNIQUE, so the key cannot
 * be held by a dead row and taken by the row that replaces it at the same time. But the key
 * names the WORK ("chore:<id>"), not the row, and the work still has to be paid exactly once
 * across the whole retry. Written here so the repay can take it back.
 */
export const retiredPayoutRefKey = (eventId: string) => `retired_payout_ref:${eventId}`;

/**
 * Write off a payout the chain PROVED did not execute — and retire its payout key with it.
 *
 * The key exists to stop a second payment for work already paid for. A transaction the node
 * says was included and failed moved no money, so there is nothing left to protect, and
 * holding the key would instead make the work permanently unpayable: the retry would find
 * this row and return it as though the kid had been paid. Releasing the key (and the claim
 * behind it) is what lets the same chore be paid again — by re-approving it, or by
 * repayFailedEarn — while every UNPROVEN payout keeps its key and stays protected.
 */
export function markWalletEventFailed(id: string): void {
  const db = getDb();
  const row = db.query("SELECT payout_ref FROM wallet_events WHERE id=?").get(id) as { payout_ref: string | null } | null;
  db.run("UPDATE wallet_events SET status='failed', payout_ref=NULL WHERE id=?", [id]);
  if (row?.payout_ref) {
    setWalletState(retiredPayoutRefKey(id), row.payout_ref);
    db.run("DELETE FROM payout_attempts WHERE payout_ref=?", [row.payout_ref]);
  }
}

export function pendingUnstakeFromLedger(childId: string): number {
  const row = getDb().query(
    "SELECT COALESCE(SUM(value_luna), 0) AS v FROM wallet_events WHERE child_id=? AND kind='unstake' AND status='pending'",
  ).get(childId) as { v: number };
  return row.v;
}

/** Total staking rewards ever accrued (REAL mode falls back to this too — nimiq-settlement
 *  exposes no getStaker RPC, so the ledger is the rewards record either way). */
export function rewardsFromLedger(childId: string): number {
  const row = getDb().query(
    "SELECT COALESCE(SUM(value_luna), 0) AS v FROM wallet_events WHERE child_id=? AND kind='reward'",
  ).get(childId) as { v: number };
  return row.v;
}

export function listPendingUnstakes(childId: string): WalletEvent[] {
  return getDb().query(
    "SELECT * FROM wallet_events WHERE child_id=? AND kind='unstake' AND status='pending' ORDER BY available_at",
  ).all(childId) as WalletEvent[];
}

export function markWalletEventDone(id: string, txHash?: string | null): void {
  if (txHash !== undefined) {
    getDb().run("UPDATE wallet_events SET status='done', tx_hash=? WHERE id=?", [txHash, id]);
  } else {
    getDb().run("UPDATE wallet_events SET status='done' WHERE id=?", [id]);
  }
}

// ---- send requests (cashlink-to-outside needs parent approval) ----
export function createSendRequest(
  familyId: string, childId: string, valueLuna: number, message: string | null,
  toAddress: string | null = null,
): SendRequest {
  const r: SendRequest = {
    id: uid(), family_id: familyId, child_id: childId,
    kind: toAddress ? "address" : "cashlink",
    value_luna: valueLuna, message, to_address: toAddress, status: "pending", cashlink_id: null,
    created_at: now(), decided_at: null,
  };
  getDb().run(
    "INSERT INTO send_requests (id, family_id, child_id, kind, value_luna, message, to_address, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [r.id, r.family_id, r.child_id, r.kind, r.value_luna, r.message, r.to_address, r.status, r.created_at],
  );
  return r;
}

/** A queued staking intent rides the send_requests table (same lifecycle — pending ->
 *  executed | rejected — no new table). No destination, no message: the "recipient" is
 *  the staking contract and the amount is the whole story. */
export function createStakeRequest(
  familyId: string, childId: string, kind: "stake" | "unstake", valueLuna: number,
): SendRequest {
  const r: SendRequest = {
    id: uid(), family_id: familyId, child_id: childId, kind,
    value_luna: valueLuna, message: null, to_address: null, status: "pending", cashlink_id: null,
    created_at: now(), decided_at: null,
  };
  getDb().run(
    "INSERT INTO send_requests (id, family_id, child_id, kind, value_luna, message, to_address, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [r.id, r.family_id, r.child_id, r.kind, r.value_luna, r.message, r.to_address, r.status, r.created_at],
  );
  return r;
}

export function getSendRequest(id: string): SendRequest | null {
  return (getDb().query("SELECT * FROM send_requests WHERE id=?").get(id) as SendRequest) ?? null;
}

/**
 * Outflow the parent has said YES to that has not yet settled: the request is still
 * 'pending' while its approval is already 'approved'. In normal operation that state only
 * exists inside the spend lock (decide -> execute -> settle is one critical section), but
 * it survives a crash between deciding and settling — and then the money may or may not
 * have moved, so the honest reading is "spoken for" until someone reconciles it.
 * Outbound kinds only: an approved 'unstake' ADDS money later and reserves nothing.
 * `excludeRequestId` lets the execution of a request not count itself.
 */
export function approvedUnsettledOutflowLuna(childId: string, excludeRequestId: string | null = null): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(r.value_luna), 0) AS v
       FROM send_requests r
      WHERE r.child_id = ?1 AND r.status = 'pending'
        AND r.kind IN ('cashlink','address','stake')
        AND r.id <> COALESCE(?2, '')
        AND EXISTS (SELECT 1 FROM approvals a
                     WHERE a.subject_id = r.id
                       AND a.subject_kind IN ('send','stake')
                       AND a.status = 'approved')`,
  ).get(childId, excludeRequestId) as { v: number };
  return row.v;
}

export function settleSendRequest(id: string, status: "executed" | "rejected", cashlinkId: string | null): void {
  getDb().run("UPDATE send_requests SET status=?, cashlink_id=?, decided_at=? WHERE id=?", [status, cashlinkId, now(), id]);
}

// ---- wallet_state (key/value) ----
export function getWalletState(key: string): string | null {
  const row = getDb().query("SELECT value FROM wallet_state WHERE key=?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setWalletState(key: string, value: string): void {
  getDb().run(
    "INSERT INTO wallet_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value],
  );
}

/** Drop a key once it has served its purpose. Blanking the value instead leaves one dead row
 *  per settled transaction on the same table the HD high-water mark lives in — it only ever
 *  grows, and "" reads back indistinguishably from a key that was never written. */
export function deleteWalletState(key: string): void {
  getDb().run("DELETE FROM wallet_state WHERE key=?", [key]);
}

/** Last known on-chain balance of the shared hot wallet. Primed at boot and refreshed by
 *  deposit-check and by the payout affordability check. Lives here, not in the route, so
 *  the budget and wallet layers can read it without importing a route module. */
export const HOT_BALANCE_KEY = "hot_wallet_last_balance";

/** The snapshot in luna, or null when it has never been taken (SIM, fresh dev DB, tests).
 *  null means UNKNOWN, never zero: callers must not treat "no snapshot" as "no money". */
export function hotWalletSnapshotLuna(): number | null {
  const raw = getWalletState(HOT_BALANCE_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---- per-family deposit attribution ----

/** Watermark over the family-level deposit feed, set once at migrate time (src/db.ts).
 *  Family-level 'deposit' rows older than the watermark were derived from a raw balance
 *  compare and carry no attribution, so no family's per-family delta may include them —
 *  a first poll after an upgrade must never report a delta out of history. */
export const DEPOSIT_SEEN_FLOOR_KEY = "family_deposit_seen_floor";

const depositSeenKey = (familyId: string) => `family_deposit_seen:${familyId}`;

/**
 * The cursor is a POSITION, not a timestamp: `<created_at>:<rowid>`.
 *
 * A bare millisecond cannot be a cursor. Two deposits written inside the same
 * millisecond both carry the same `created_at`, and a `created_at > cursor` scan that
 * advances to MAX(created_at) steps straight over the second one — the family is never
 * told about a deposit it was really credited for, and no later poll recovers it. The
 * rowid breaks the tie, so the scan resumes exactly where it stopped.
 *
 * Legacy values (a bare number: every cursor written before this shipped, and the
 * migrate-time floor in src/db.ts) parse with rowid = +infinity, which reduces the
 * predicate back to `created_at > ts`. That is precisely the old meaning — "everything
 * at that millisecond has been seen" — so an upgrade never resurfaces old rows.
 */
interface DepositCursor { ts: number; rid: number }

const parseCursor = (raw: string | null): DepositCursor => {
  if (raw === null || raw === "") return { ts: 0, rid: 0 };
  const [tsRaw, ridRaw] = raw.split(":");
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return { ts: 0, rid: 0 };
  if (ridRaw === undefined) return { ts, rid: Number.MAX_SAFE_INTEGER }; // legacy bare ms
  const rid = Number(ridRaw);
  return { ts, rid: Number.isFinite(rid) ? rid : Number.MAX_SAFE_INTEGER };
};

const laterCursor = (a: DepositCursor, b: DepositCursor): DepositCursor =>
  (b.ts > a.ts || (b.ts === a.ts && b.rid > a.rid)) ? b : a;

/** Sum this family's OWN family-level deposit events (child_id NULL) that it has not
 *  been shown yet, and advance the family's cursor past them. Family-scoped by
 *  construction: the query never reads another household's rows, so one family's
 *  top-up can never surface in another family's delta — regardless of who polls first. */
export function takeUnseenFamilyDepositLuna(familyId: string): number {
  const since = laterCursor(
    parseCursor(getWalletState(DEPOSIT_SEEN_FLOOR_KEY)),
    parseCursor(getWalletState(depositSeenKey(familyId))),
  );
  const where =
    `FROM wallet_events
      WHERE family_id=? AND child_id IS NULL AND kind='deposit' AND status!='failed'
        AND (created_at>? OR (created_at=? AND rowid>?))`;
  const args = [familyId, since.ts, since.ts, since.rid] as const;
  const sum = getDb().query(
    `SELECT COALESCE(SUM(value_luna), 0) AS v ${where}`,
  ).get(...args) as { v: number };
  // The new cursor is the LAST row in (created_at, rowid) order — not MAX(created_at),
  // which says nothing about which row inside that millisecond was the last one read.
  const last = getDb().query(
    `SELECT created_at AS ts, rowid AS rid ${where} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(...args) as { ts: number; rid: number } | null;
  if (last) setWalletState(depositSeenKey(familyId), `${last.ts}:${last.rid}`);
  return sum.v;
}

// ---- per-family wallet_state lifecycle ----

/**
 * Every `wallet_state` key that belongs to ONE household, in one list.
 *
 * `wallet_state` started as a handful of instance-wide keys and now also carries per-family
 * rows, which means it grows with the number of households rather than staying constant.
 * Listing them here is what lets `purgeFamily` forget all of them without knowing their
 * spellings — add a per-family key and it gets cleaned up by construction.
 */
const familyScopedStateKeys = (familyId: string): string[] => [
  kidHighWaterKey(familyId),
  depositSeenKey(familyId),
];

/**
 * Forget a purged household's wallet_state rows.
 *
 * Without this the throwaway judge-demo households the sweeper exists to erase each left a
 * permanent row behind — carrying the id of a household that was supposed to be gone, one
 * per household ever provisioned.
 *
 * SAFE TO DELETE, and the reason matters: these keys are scoped by family id, and a family
 * id is a fresh UUID that is never reissued, so no future household can inherit a purged
 * one's bookkeeping. The mark that must survive a purge is the INSTANCE-wide
 * `hd_family_index_high_water` — that is what stops a new household from being handed a
 * branch a deleted household's funded addresses were derived on, and it is deliberately
 * not touched here.
 */
export function forgetFamilyWalletState(familyId: string): void {
  const db = getDb();
  for (const key of familyScopedStateKeys(familyId)) db.run("DELETE FROM wallet_state WHERE key=?", [key]);
}
