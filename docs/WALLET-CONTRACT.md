# WALLET-CONTRACT — V2 kid wallet API (W1)

The server contract the kid app and parent app rebuilds render from. Family mode V2: every kid
has a REAL on-chain Nimiq account and earns NIM directly into it.

**Custody, stated plainly, and it is now TWO answers.** Which one applies to a given kid is
`children.address_source`, and nothing may assume it from an address alone.

| `address_source` | Who can sign for the kid |
|---|---|
| `derived` | **The server.** The account comes from a master seed held here (`HATCH_MASTER_SEED`). The private key is never written to the database, but the derivation coordinates are, so anything holding the seed can re-derive it. Server-custodied: not self-custodied, and not a sub-wallet of the parent's wallet. |
| `parent` | **Nobody here.** The address was chosen by a parent out of their own Nimiq wallet and proved with a signature over a server-issued challenge (`src/nimiq/address-proof.ts`). No key for it exists on this server and none can be derived. |
| `NULL` | No address yet. A third state, and not the same as either of the others. |

The parent's own funding wallet (`families.parent_address`) is separate under both and is never
derived from the seed.

**What a `parent` row changes.** Money coming IN is unaffected: earns, chore payouts and gifts
are signed by the family wallet and land at the kid's address exactly as before. Money going OUT
is decided per route by `kidOutflowRefusal` (`src/wallet/kid-wallet.ts`), and the four routes
that consult it do NOT all behave the same way:

| Route | Under parent custody | Where |
|---|---|---|
| `POST /api/kids/:id/buy` (Treasure Box) | **Works**, deferred. The buy records a debit and the next parent-signed payout is minted smaller. Refused only for a kid with no registered address, because a debit with no address has nothing that can ever settle it. | `src/routes/store.ts`; `deferKidSpends()` in `src/kid-netting.ts` is `parentSignedPayouts()`, so deferral is on exactly when custody is parent |
| chores, routines, practices, approve, parent-signed payout, netting, settle | **Works**, proven on mainnet | `docs/FIRST-PAYOUT.md` |
| `POST /api/kids/:id/send` | refused **409 `parent_signature_required`** | `src/routes/wallet.ts` |
| `POST /api/kids/:id/stake` | refused 409 | `src/routes/wallet.ts` |
| `POST /api/kids/:id/unstake` | refused 409 | `src/routes/wallet.ts` |

The refusals happen at REQUEST time so no approval is ever opened against a spend this instance
cannot perform. `kidKey()` also refuses for such a row, as a backstop. Kid-initiated outflows
signed by a parent (sibling and parent transfers, client-side cashlink minting) are Phase 4 of
the non-custodial plan and do not exist yet; the epic is #456. An E2E plan on a parent-custody
instance can cover onboarding, address registration by proof, chores, parent-signed payouts,
netting and Treasure Box deferral, and should assert that `send`, `stake` and `unstake` refuse
cleanly rather than trying to exercise them.

**Money coming in is where the parent's signature now lives.** On an instance running
`HATCH_CUSTODY=parent` a chore approval no longer pays; it issues a **signing intent** and the
parent's own wallet signs the transaction. See "Parent-signed payouts" below.

**Which kind a NEW kid gets** is `HATCH_CUSTODY` (see Env). Existing rows keep whatever they
already had until a parent re-registers them, so an instance can run mixed and the switch changes
nothing retroactively.

**`children.derived_address`** holds the server-custodied address a kid used to have, kept when
`address` moves to a parent-owned one. Without it the derivation coordinates would still exist
with no record of which account they produced, and the boot guard below would be reading the
wrong account.

### Registering a parent-owned address

Two round trips, because the Hub is a full-page redirect on mobile and nothing may live in page
memory across it.

```
POST /api/kids/:id/address-challenge   { address }
  -> 201 { challengeId, address, message, expiresAt, ttlMs }
  -> 400 invalid_address
  -> 409 address_is_the_family_wallet | address_taken { byLabel }

POST /api/kids/:id/address             { challengeId, publicKeyHex, signatureHex }
  -> 201 { child: { id, label, emoji, address, addressSource, registeredAt } }
  -> 400 proof_invalid { reason } | challenge_expired | challenge_used | proof_required
  -> 404 challenge_not_found          (also: not your child, not your challenge)
  -> 409 address_taken { byLabel } | funds_at_old_address { address, balanceLuna }
  -> 502 balance_check_failed { detail }
```

Both are **parent-authed** (never kid, never device). `message` must be signed **verbatim** — the
server owns the nonce and the binding, and a client-composed message would bind nothing. The
whole proof is stored on the row (`address_proof_message` / `_pubkey` / `_sig`) so it can be
re-verified from the row alone, years later, by anything that can check an ed25519 signature.

The digest is the Nimiq Keyguard's, not ours: `SHA256(utf8("\x16Nimiq Signed Message:\n") ||
utf8(String(byteLength)) || messageBytes)`, signed over the HASH (nimiq/keyguard
`src/lib/Key.js` `signMessage`, `client/src/SignMessagePrefix.ts`).

`funds_at_old_address` is the refusal that matters: moving a kid off a derived address that still
holds NIM would erase the app's own record of where that money is while the money is still there.
An UNREADABLE balance refuses too — a read that failed is not a zero.

### Parent-signed payouts

On `HATCH_CUSTODY=parent` there is no key here, so a payout cannot be signed here either. The
approval becomes a transaction waiting for a human rather than a boolean the server checks
before signing for itself.

```
POST /api/chores/:id/approve            (parent-authed, as before)
  -> 202 { chore, signingIntent: { intentId, sender, recipient, valueLuna, feeLuna,
                                   data, validityStartHeight, expiresAt } }
  -> 409 already_claimed { signingIntent }   the SAME intent, so a second tap resumes it
  -> 400 no_kid_address | no_parent_address | pays_self
  -> 502 chain_unreachable { detail }

POST /api/payouts/broadcast   { intentId, serializedTx }
  -> 200 { event, txHash, replayed }
  -> 400 intent_required | invalid_tx
  -> 404 not_found                    (unknown intent, or another family's)
  -> 409 sim_no_broadcast | different_bytes_already_broadcast { txHash }
  -> 422 tx_mismatch { reason, expected, got }
```

The chore is **not** marked approved at 202. It is approved when money moves, and money moves
in the parent's wallet, which is a full-page redirect away on mobile. Intents therefore live
server-side and are resumable by id; nothing may live in page memory across the redirect.

`validityStartHeight` is pinned by the server, not chosen by the client. That makes the bytes
deterministic, and because a transaction hash covers content and not the proof, the chain
itself refuses a duplicate for the whole validity window. The `payout_attempts` claim is still
the primary guard, because it is what stops a second wallet popup from ever opening.

The relay decodes the bytes and compares **every** field against the claimed intent before
broadcasting: sender, recipient, value, fee, validity height, extraData bytes, network and both
account types. Whole-field equality, never a range. A compromised server can delete this check
and still cannot forge the signature, so the check is a correctness guard for an honest server,
not the thing standing between an attacker and the money. That is the absence of a key.

The earn row is written **pending** and settled by `sweepPendingEarns` reading the receipt for
that exact hash, unchanged from the server-signed path. A node accepting a transaction is not
proof it executed.

**Budgets do not apply.** `checkPayable` bounds spending out of the instance's shared hot
wallet; a parent-custody instance has none, and the money is this parent's own. Affordability
is answered by their wallet at the confirmation screen.

### The boot guard

With `HATCH_CUSTODY=parent` the server refuses to start unless **both** `HATCH_MASTER_SEED` and
`DEV_PARENT_PRIV` are unset **and** every child with a non-null `account_index` reads a zero
balance at its derived address. A non-zero balance, or one that cannot be read, prints a sweep
worklist and exits non-zero. This is what turns "every kid balance is zero" from an assumption
into a checked precondition. `src/custody-boot.ts`; `bun run src/scripts/migrate-to-parent-custody.ts`
reports the same thing without booting (dry run by default, `--apply` to drop cleared coordinates).

**Where a kid's key lives.** New accounts are scoped to their household:
`m/44'/242'/7'/f'/i'`, where `f` is `families.hd_index` (assigned once per household, globally
unique, never reused) and `i` is `children.account_index` (unique **within that family**, not
across the instance). Accounts provisioned before per-family scoping keep the flat legacy path
`m/44'/242'/7'/i'` and are marked by `children.hd_family_index IS NULL`; they are never
re-derived, because re-deriving one would change its address and strand its funds.

**What that scoping does and does not bound.** It separates PATHS inside one instance's tree. It
does not hand households separate secrets: `HATCH_MASTER_SEED` is one seed for the whole instance
(see Env below), so a household is bounded against the other households sharing its instance and
nothing more. Two deployments configured with the SAME seed derive the same keys at the same
coordinates — branch 0 / kid 0 on one is branch 0 / kid 0 on the other, exactly as index 0 used to
mean the same account on both under the flat path. Keeping deployments separate from each other is
a matter of giving them separate seeds, and per-family scoping neither achieves nor replaces that.

**Rolling back past this is a money event.** The migration to scoped derivation is one-way for any
kid provisioned after it. Such a kid has `hd_family_index` set and is funded at its scoped address;
an older build ignores that column, re-derives the same `account_index` on the flat legacy path,
and signs with a key belonging to a different, empty account — while `kidBalanceLuna` keeps reading
the funded address, so the app shows the balance and the send goes nowhere it should. Kids
provisioned BEFORE the upgrade are unaffected in either direction.

Before rolling the deploy back, check whether any kid has been provisioned since the upgrade:

```sql
SELECT COUNT(*) FROM children WHERE hd_family_index IS NOT NULL;
```

Zero means the rollback is safe. Anything else means roll forward instead — those kids' NIM is
only spendable by a build that reads `hd_family_index`. Rolling forward again restores them; the
funds were never moved, only unreachable in the meantime. On the current build the divergence
itself cannot go unnoticed: `kidKey()` compares the address it derives against the address the row
holds and throws `kid_key_address_mismatch` rather than signing (`src/wallet/kid-wallet.ts`).

**No stars in family mode** (demo mode is untouched and stays the regression gate).

All amounts are **luna** (1 NIM = 100 000 luna). All timestamps are epoch-ms.

## SIM vs REAL, one paragraph

`SIM` (default until `DEV_PARENT_PRIV` is set, force with `NIMIQ_SIM=1`): key derivation is real
(offline crypto — addresses are real-format and stable), but no transaction touches a chain.
Balances come from the `wallet_events` ledger; tx hashes look like `sim:<uuid>`; staking accrues
visibly at `HATCH_EST_APY` and unstakes release after ~60 s. REAL: earns are signed by the hot
wallet, sends/stakes are signed by the kid's derived key, spendable balance is on-chain truth via
RPC `getBalance(kid.address)`, and `wallet_events` is the instant-UX activity feed (reconciled by
`tx_hash`). The API shapes are IDENTICAL in both modes — the apps never branch.

## Env

| Var | Default | Meaning |
|---|---|---|
| `HATCH_MASTER_SEED` | — (SIM falls back to a fixed dev seed) | HD master seed (hex). Written by `src/scripts/generate-family-seed.ts`. **One seed per instance, not per household** — every `derived` kid account on the instance comes from it. Must be UNSET under `HATCH_CUSTODY=parent`. |
| `HATCH_CUSTODY` | `server` | `parent` makes NEW kids parent-owned: nothing here derives a kid address, `POST /api/onboard` requires a real `address` (no hot-wallet fallback), and the boot guard above runs before the server listens. Anything other than the exact string `parent`, including unset, is the existing behaviour — this one defaults to the OLD path on purpose, because a flag that silently rewrote custody on a typo is a worse accident than one that leaves it alone. |
| `HATCH_VALIDATOR_ADDRESS` | — | Andjroo's validator (the Beelink). REQUIRED off-SIM for staking. |
| ~~`HATCH_MAX_EARN_LUNA`~~ | removed 2026-07-31 | There is no per-payout ceiling. The parent sets the price; only the family's available balance can refuse it. Setting this var does nothing. |
| `HATCH_EST_APY` | `12` | Estimated APY (%) shown to kids + SIM accrual rate. |
| `HATCH_NIM_USD` | `0.002` | Static fiat rate served by `/api/rates`. |
| `HATCH_UNSTAKE_COOLDOWN_MS` | SIM `60000`, real `86400000` | Unstake release estimate (the node is the real gate off-SIM). |

## Wallet event (the feed row)

```json
{
  "id": "…", "kind": "earn|send|deposit|stake|unstake|reward|spend",
  "status": "done|pending",
  "valueLuna": -30000,
  "counterpartyAddress": "NQ…|null", "counterpartyLabel": "Family wallet|Ada|Cashlink|Staking|…",
  "txHash": "hex | sim:<uuid> | null", "message": "for you!|null",
  "availableAt": 1789000000000, "createdAt": 1789000000000
}
```

`valueLuna` is SIGNED from the kid's spendable-balance perspective. `status:"pending"` only occurs
on `unstake` (cooldown; `availableAt` says when). `reward` rows are staking rewards, auto-restaked
— part of the STAKED balance, never spendable directly.

## Auth + custody policy (v0.43)

Kid money endpoints (`/kids/:id/wallet|staking|send|stake|unstake|buy`, `/children/:id/send`)
resolve through a money gate. Where the instance demands auth (`HATCH_LEGACY_BOOT=0`,
`HATCH_REQUIRE_PARENT_APPROVAL=1`, or mainnet off-SIM), a request without a valid parent or
paired-device bearer answers `401 { "error": "kid_auth_required" }` BEFORE any child lookup;
a valid bearer from another household answers 404. Legacy single-household boots keep the
open-tablet trust model unchanged.

Whether a kid-initiated stake/unstake (and outbound send) needs a parent:

| Instance state | Approval |
|---|---|
| `NIMIQ_NETWORK=main` and not SIM | FORCED for every family (never demo-unlocked) |
| `HATCH_REQUIRE_PARENT_APPROVAL=1` | FORCED for every family |
| family `mode: "family"` | required for that household |
| family `mode: "demo"` on sim/testnet | instant, with the honest demo warning |

The `custody` block in wallet/staking payloads is per-family:
`{ "demoUnlocked": bool, "requiresParentApproval": bool, "warning": string|null,
"kidAuthRequired": bool, "kidCustody": "server"|"parent" }`. `kidCustody` is instance-level (it
says which kind a NEW kid gets here); a given kid's own answer is `addressSource` on
`GET /parent/overview`. `/health` carries the instance-level FLOOR (no family context) plus
`demoModeFamilies`, the number of households actually in demo mode — `0` means nothing on that
instance is unlocked, however the floor reads.

Buying from the Treasure Box (`POST /kids/:id/buy`) stays instant by design and is NOT queued: the
parent owns the catalogue and sets every price (`/api/parent/store`), so the approval happened when
the item was listed, the goods are granted on the spot, and the price returns to the family's own
wallet. The `coupon` kind still opens a parent approval for fulfilment.

`POST /children/:id/send` is the V1 legacy peer-cashlink path. It debits the demo `balance_luna`
tally but mints from the HOT WALLET, so it now answers to the payout budget, and where approval is
required it answers `403 { "error": "parent_approval_required" }` instead: it predates the queue and
has no way to ask a parent. Use `POST /kids/:id/send`.

## Endpoints

### `GET /api/kids/:id/wallet` — THE kid-app home payload
Provisions the kid's account on first call (idempotent). Runs the lazy staking ticks and the
lazy payout reconcile.

**`address` is `null` for a kid who has none yet**, which under `HATCH_CUSTODY=parent` is the
state every kid starts in — the parent registers one out of their own wallet (`POST
/kids/:id/address`). Reading the wallet does NOT provision an account on such an instance, and
must not: only a parent can give that kid an address. It is not an error and it is not a
loading state, so a client renders it as a fact ("no address yet") and must not read the
accompanying `balanceLuna: 0` as an empty account. Under server custody this endpoint mints
the account on first call exactly as it always has, and `address` is never null.

Everything that MOVES a kid's NIM refuses for such a kid before anything is written:
`POST /kids/:id/send|stake|unstake|buy` all answer `409 { "error":
"kid_address_not_registered" }`, and a family transfer TO one answers `409 { "error":
"recipient_address_not_registered" }`.
```json
{
  "address": "NQ…",
  "balanceLuna": 300000,
  "stakedLuna": 200066,
  "pendingUnstakeLuna": 0,
  "pendingStakeLuna": 0,
  "pendingEarnLuna": 0,
  "events": [ …last 50 wallet events, newest first… ],
  "serverTime": 1789000000000
}
```
`pendingEarnLuna` is chore/routine payouts that have been broadcast but not yet proven to have
executed on chain. They appear in `events` as `kind: "earn"` with `status: "pending"` (the
existing on-its-way row treatment) and are deliberately NOT part of `balanceLuna`. Off-SIM
`balanceLuna` is the chain's own answer, so it only ever moves when the money really lands.
Events proven not to have executed (`status: "failed"`) are left out of `events` entirely.

A payout is proven by ITS OWN transaction hash (`getTransactionByHash`), never by a balance —
a balance rises whoever sent the money, so it cannot attribute an arrival to one payout. That
gives three outcomes, and only the first two are verdicts:

| node says | row becomes | budget |
|---|---|---|
| the transaction is in a block | `done` | counted as spent |
| in a block, execution failed | `failed` (dropped from `events`) | refunded — the NIM never left |
| no such transaction / cannot answer | stays `pending` | still counted as spent |

Nothing is ever written off on a timer. `HATCH_EARN_CONFIRM_TIMEOUT_MS` (default 5 min) only
decides when the parent is told a payout is still unconfirmed. A payout the chain refused is
recoverable with `POST /api/family/earns/:id/repay` (parent-only, once per row) — the chore is
already `approved` by then, so re-approving it answers `409`.

Reconciliation also runs on a server-side sweeper (`HATCH_EARN_SWEEP_MS`, default 60s, off in
SIM), so a payout settles whether or not a kid opens the app.

### `POST /api/kids/:id/send` — kid-initiated (money gate; open only on legacy boots)
Three bodies:
- `{ "toChildId": "…", "valueLuna": 30000, "message": "…" }` — a sibling.
- `{ "toParent": true, "valueLuna": 20000 }` — the family wallet (`families.parent_address`,
  which is the INSTANCE HOT WALLET for any household that onboarded without connecting one).
- `{ "cashlink": { "valueLuna": 50000, "message": "grandma" } }` or
  `{ "scanned": { "toAddress": "NQ…", "valueLuna": … } }` — out of the family.

All three move the kid's own NIM out of their account, so all three answer to the same policy
table. Where approval is required they are prechecked and then queued:
`202 { "status": "pending_approval", "approvalId": "…", "sendRequestId": "…", "requestId": "…" }`
(the two id fields are the same value; `requestId` matches what stake/unstake answer). No funds
move until the parent approves (approvals queue, `subjectKind: "send"`). On approve a Cashlink is
minted FROM THE KID'S account and the response carries `cashlinkUrl`; a family transfer settles as
the same double-entry the instant path writes, sibling `deposit` row included. Reject leaves the
money untouched.

Where approval is NOT required (a demo-mode household on sim/testnet), a family transfer still
executes immediately: `200 { "status": "sent", "event": {…}, "balanceLuna": 70000 }`. An outbound
Cashlink or address always queues.

Errors: `400 insufficient_funds | invalid_value | self_transfer | target_required | invalid_address`,
`404 not_family`, `401 kid_auth_required` on strict instances.

### `GET /api/kids/:id/staking`
```json
{ "stakedLuna": 200066, "pendingLuna": 0, "estApyPct": 12, "rewardsEarnedLuna": 66, "serverTime": … }
```
`rewardsEarnedLuna` comes from the ledger in BOTH modes (nimiq-settlement exposes no `getStaker`
RPC — see Staking notes).

### `POST /api/kids/:id/stake` — `{ "valueLuna": 200000 }`
Where approval is required (see policy table): the intent is prechecked, then queued —
`202 { "status": "pending_approval", "approvalId": "…", "requestId": "…", "sendRequestId": "…" }`
(both id fields carry the same value). No ledger row is
written until the parent approves (approvals queue, `subjectKind: "stake"`); reject leaves the
money untouched. Otherwise instant: first stake creates the staker delegated to
`HATCH_VALIDATOR_ADDRESS`; later stakes top up.
`200 { "event": {…}, "stakedLuna": …, "pendingLuna": …, "estApyPct": …, "rewardsEarnedLuna": … }`
`400 insufficient_funds | invalid_value`, `401 kid_auth_required` on strict instances.

### `POST /api/kids/:id/unstake` — `{ "valueLuna": 80000 }`
Same queue-or-instant split as stake (`subjectKind: "unstake"` when queued). Instant path,
honest Albatross model: the value leaves `stakedLuna` NOW, sits in `pendingLuna` through the
cooldown, then lands in `balanceLuna` (settled lazily on the next wallet/staking read — no cron).
`400 insufficient_stake | invalid_value`, `401 kid_auth_required` on strict instances.

### `GET /api/family/deposit-info` — parent bearer required
`{ "address": "NQ…", "qr": "nimiq:NQ…", "sim": true }` — the top-up screen payload.

### `POST /api/family/deposit-check` — parent bearer required
Manual refresh: compares the hot wallet's on-chain balance to the last snapshot; positive delta is
recorded as a family-level `deposit` event. `{ "balanceLuna": …, "deltaLuna": …, "sim": … }`.
SIM: snapshot-only, delta always 0. v1 is deliberately webhook-free.

### `GET /api/rates`
`{ "nimUsd": 0.002 }` — static (env), refreshable later without an API change. The UI shows fiat
everywhere like the real wallet: `fiat = valueLuna / 1e5 * nimUsd`.

## Earning (family mode V2)

- Chores: `POST /api/chores` now REQUIRES `rewardLuna > 0` in family mode too (`rewardStars` is
  accepted-but-ignored legacy). Approval (PIN or bearer, chore route or approvals queue) pays
  `reward_luna` hot wallet → kid account and writes the `earn` event. Response: `paidLuna`.
- Routines: `routine_tasks.reward_luna` (via `rewardLuna` on task create/patch). Run approval pays
  the sum over DONE tasks (skips pay nothing).
- Practices: `practices.reward_luna`, paid PER DAY. `POST /api/practices/:id/session` opens an
  approval whose subject is the SESSION (`subjectKind: "practice_session"`, subject_id =
  `practice_sessions.id`), so the payout ref is unique per day and a second tap on the same day
  is the same idempotent nothing. Family mode and `reward_luna > 0` only. Approving pays exactly
  like a chore, including the parent-signed branch above; declining pays nothing and leaves the
  day logged, because the week count and the streak are the kid's record and only the money is
  the parent's. `PUT /api/practices/:id` needs a parent (PIN or bearer) to change the reward at
  all, and answers `409 day_awaiting_approval` while a day of that practice is pending.
- No ceiling: a payout is whatever the parent priced the chore at. The one thing that can refuse
  it is the money not being there → `400 budget_exhausted` with `{ neededLuna, availableLuna }`,
  and the approval STAYS pending (nothing half-applied), so it goes through on the next try after
  a top up. `availableLuna` is the family's budget on a shared instance and the hot wallet's real
  balance always, whichever is tighter. That is the same figure `GET /parent/overview` shows as
  `hotWalletLuna`, so a parent is never refused a payout their own screen says they can afford.
  Before refusing, the server re-reads the chain balance, so a stale snapshot never blocks a
  payout the wallet can actually cover.
- Approvals `enrichApproval` now carries `rewardLuna` (was `starsAwarded`) and a `send` summary
  variant `{ title, emoji, valueLuna, message }`.

## nq registry component mapping

- **account-header** wants `{ label, address, balance, fiatValue }` →
  `label` = child.label, `address`/`balanceLuna` from `GET /kids/:id/wallet`,
  `fiatValue = balanceLuna / 1e5 * nimUsd` (from `/api/rates`).
- **transaction-list** wants `TxDisplay[] { value, isIncoming, timestamp, fiatValue }` →
  map each wallet event: `value = Math.abs(valueLuna)` (luna), `isIncoming = valueLuna > 0`,
  `timestamp = createdAt` (ms), `fiatValue` via the same rate. `counterpartyLabel` is the
  kid-friendly display name; `status:"pending"` unstakes should render as in-flight.

## Staking notes (what @nimiq/core@2.5.1 actually supports)

`TransactionBuilder` statics used: `newCreateStaker`, `newAddStake`, `newSetActiveStake`
(deactivate), `newRetireStake`, `newRemoveStake` (plus `newUpdateStaker`, unused). Unstaking is
genuinely multi-step on Albatross — deactivate → cooldown → retire → remove — hence the pending
model. Real-mode caveats:
- Albatross enforces a minimum stake per staker (100 NIM on current policy). Kid-sized stakes
  below that will be REJECTED on the real chain; SIM has no minimum. If the family economy wants
  small real stakes, a pooled-staking design is needed (future work — not in W1).
- `nimiq-settlement` has no `getStaker` RPC, so cooldown completion is attempted on a timer
  estimate and simply retried if the node refuses; rewards tracking is ledger-derived.

## Migration

`src/scripts/migrate-stars-to-nim.ts` (manual, on the instance): per kid, star_balance ×
star_rate_luna → an opening `deposit` wallet event, then the star ledger is zeroed with a
negative `adjust` row (both invariants hold). Idempotent — zero-star kids are skipped.
