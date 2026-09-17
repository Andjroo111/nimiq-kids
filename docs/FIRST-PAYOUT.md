# The first real payout — Andjroo, do this one thing

`https://nimiq.kids` is on **parent custody** as of 2026-08-03. No key on the Mac Mini can
sign for a child any more. What has never happened is a human signing a real payout in a real
wallet on a flipped instance, and it needs you because the Nimiq Hub cannot open in headless
Chromium.

Everything below was rehearsed end to end against a `sqlite3 .backup` copy of the live
mainnet database, under parent custody, on a spare port. It stops exactly where you start:
at the signature. `tools/flip-morning-rehearsal.py` is that rehearsal and it passes.

> ✅ **The SERVER half of this is now proven on mainnet with real NIM (2026-08-03).** A
> 1 NIM payout went out of a wallet the app cannot sign for, through the relay, and landed:
> tx `d193c1dd0b9fc53c2a4e37793caf63dd05e260611058f0593cfad1848c9256db`, block 57901146,
> `executionResult: true`. See "What the mainnet run proved" at the bottom for what that
> does and does not cover. **It does NOT cover the wallet step below**, which is still
> yours, because that run signed with a raw key instead of opening the Hub.

## Before you start

You need **NIM in your own Nimiq wallet**. The payout is a real mainnet transaction from
your address to your kid's, so the money leaves your wallet, not the app's. Three NIM is
plenty for the first one. The instance hot wallet is empty and no longer matters.

## 1. Sign in

Your old parent link was minted 2026-07-20 and answers **401** against the live database. A
fresh one is in `~/gdkc/secrets/hatch-parent-link.txt`, minted and verified against the live
box on 2026-08-03. Open it on your phone once and the page keeps the token.

## 2. Connect your wallet

Tap the **Connect wallet** chip at the top right and pick your account. Nothing moves yet.
Step 3's control reads the connected account, so skipping this leaves it with nothing to
offer you.

## 3. Point YOUR grown-up record at your wallet

> ⚠️ **This step moved in #291 and the old instructions are actively wrong.** They sent you to
> **Top up → "Pick my address"**. That card is still there, but since #291 it sets the
> **household till** (where Treasure Box spending comes back to), *not* who pays. Setting it
> does nothing for a payout, and it looks like it worked.

A household can hold more than one grown-up and **each pays from their own wallet**, so who
pays now lives on the member, not the family. Go to **Settings**, scroll to **Grown-ups**, and
find the card headed *"The wallet you pay from"*.

It shows `NQ49 UB2X R3UJ RLDT GG80 KMGE 4K7V 0JSK 4QJK`, the app's own hot wallet, which is
what every household created under server custody got and what the #291 migration copied onto
the owner member. **Your wallet cannot sign from it**, so a payout comes back "Address not
found" and tells you nothing useful.

Tap **Use a different wallet**, choose an address out of your own wallet, and the card repaints
with it. That is the whole fix. Picking the address it already uses is harmless, so there is
nothing to get wrong here.

⚠️ **#297 is what makes this possible for you specifically.** Before it, the control only
rendered for a grown-up with *no* address, and the migration had already put the dead hot
wallet on yours, so the screen showed an address you cannot sign from and no button. Live from
v0.107.3. Verified by rendered content against your own household on 2026-08-10: the card reads
`The wallet you pay from / NQ49 UB2X… / Use a different wallet`.

## 4. Make something to pay for

Add a chore for the one kid on that instance, price it, and hand it in. Anything works.

⚠️ **One is already queued for you.** "Water the plants · +1 NIM" has been pending on your
household since 2026-08-02, so you can skip straight to step 5. Confirmed still pending on
2026-08-10.

## 5. Approve it, and sign

Tap **Approvals**, tap the card.

- If the kid has spent nothing, the wallet opens straight away.
- If they have, a sheet explains the split first (*"For the job N NIM / Already spent −M NIM /
  To send now N−M"*) and the wallet opens after it. That order is deliberate: you should never
  be asked to authorise a number before being shown why it is that number.

**The card stays in the queue until the money moves.** That is not a bug. A mobile wallet is a
full-page navigation away and the Hub's answer does not survive the trip, so the approval waits
for the broadcast rather than for the tap. If you get lost, come back and tap **Finish paying**:
you are handed the identical transaction, not a second one. Verified in the rehearsal — a
second tap answers `409 already_claimed` carrying the same sender, recipient, amount, message
and `validityStartHeight`.

Check the wallet's confirmation screen against the card before you sign. The **identicon** is
derived from the address and is the thing worth looking at; the name beside it is supplied by
the server and is not evidence of anything.

## 6. Tell me it landed

That closes ops #3, which is deliberately still open because closing a security issue about
signatures on the strength of a stubbed signature would be closing it on the wrong evidence.

## If it goes wrong

Nothing here can lose money. The worst cases are:

| What you see | What it means |
|---|---|
| "Address not found" in the wallet | Step 3 was skipped, picked an address that wallet does not hold, or was done on the Top-up card instead of Settings → Grown-ups |
| "That did not match what was asked for, so nothing was sent" | The relay refused the signed bytes. Nothing was broadcast. Tap Finish paying again |
| The card will not leave the queue | The broadcast has not been seen. The kid has not been paid twice; the claim makes it exactly-once |

**Full rollback**, if you want the old behaviour back for any reason:

```bash
cp ~/gdkc/secrets/hatch-competition.env.bak-20260803-precustodyflip \
   ~/gdkc/secrets/hatch-competition.env
launchctl kickstart -k gui/$(id -u)/com.hatch.competition
```

That restores both keys and unsets `HATCH_CUSTODY`. Nothing in the database blocks going
back — the seed fingerprint is still stamped on it and a rollback boot is covered by a test.

## What is deliberately NOT done

- **The testnet demo (`demo.nimiq.kids`) was not flipped.** It is the competition judge path
  and flipping it today would break it outright: `src/routes/onboard.ts:118` refuses onboarding
  without an address under parent custody, and a visitor who has not connected a wallet sends
  none. NONCUSTODIAL-PLAN §4 covers this (demo families run SIM-only against a labelled fake
  ledger) and that is not built.
- **The mainnet E2E test instance (`hatch-mainnet-test.env`, port 3975) was not flipped.** Its
  hot wallet holds real NIM, the boot guard correctly refuses a flip while it does, and
  sweeping it is off limits.
- **Staking stays off on mainnet.** This is NOT sequencing any more, and it is worth knowing
  why. Every stake path signs with `kidKey`, which under parent custody refuses twice over:
  `kid_address_is_parent_owned` for a parent-registered address, and `kid_key_address_mismatch`
  for the one legacy derived kid, because with the seed gone it derives a different address.
  Re-enabling `HATCH_VALIDATOR_ADDRESS` today would put a Grow button in front of a kid that
  always fails at signing time, **after** you had already approved the stake. It unblocks with
  Phase 4 (kid outflows signed by the parent), not with the flip.

## What the mainnet run proved, 2026-08-03, and what it did not

An agent drove the whole payout path on `https://nimiq.kids` with real NIM, on its OWN
family, signing with a raw key instead of the Hub. Andjroo's household was not touched.

**The transaction.** `d193c1dd0b9fc53c2a4e37793caf63dd05e260611058f0593cfad1848c9256db`,
block 57901146, 1 NIM, fee 0, `executionResult: true`. Confirmed on a second, independent
node (`rpc.nimiqwatch.com`), not only on the Mini sidecar.

**Proven, against real money on a keyless instance:**

- `POST /api/onboard` under parent custody with a caller-supplied address.
- Kid address registration by signature proof: `address-challenge` then `address`, the
  Keyguard digest computed the way `src/nimiq/address-proof.ts` says, accepted first try.
- Approve answers **202** with `signingIntent` and leaves the approval `pending`.
- A second tap answers **409 `already_claimed`** with all twelve intent fields byte-identical.
- The relay's field-by-field verification, then the broadcast. The hash the relay returned
  is the hash computed locally from the signed bytes, so it broadcast exactly what it was
  handed and nothing else.
- `settlePayoutSubject` on the far side: chore `approved`, approval `decidedAt` set with
  `method: "remote"`, pending queue back to 0, kid wallet event `done`.
- Every pinned field survived to the chain unchanged: sender, recipient, value 100000,
  fee 0, `validityStartHeight` 57901045, data `57617465722074686520706c616e7473`,
  `networkId` 24, `flags` 0, `fromType` 0, `toType` 0.

**NOT proven, and this is the part that still needs a human.** The signature came from
`Nimiq.KeyPair` in a script, not from the Nimiq Hub. `public/parent/payout-sign.js`, the
`chooseAddress` and `signAndSend` calls, the full-page redirect on mobile, and the "Finish
paying" resume in a real browser are all still unexercised on mainnet. **Do not close ops #3
on the run above**, for the same reason it was left open in the first place: the evidence
would be about the wrong half.

**Two details worth knowing before you write an assertion against this file.**

1. The 409 body names the intent **`signingIntent`**, not `intent`. Both the 202 and the 409
   use that key. A test that reads `body.intent` sees `undefined` and reports a passing
   system as broken.
2. `toPlain()` on `@nimiq/core` 2.5.1 reproduced its trap exactly: `senderType` came back as
   the string `"basic"` and `networkId` was absent. Read the Transaction object.

**The money is accounted for.** The 1 NIM came from the funded mainnet E2E estate
(`NQ73 5TCY...NF09`) and was swept back to it after verification
(`0bc1b977cf5d034e4b914b528e4844977dbe71537e23e9a781bb80727d26464f`, block 57901720). The
estate reads 99,890 NIM, its pre-run figure to the luna. The agent's throwaway family and its
kid address remain in the live database, spent out and harmless.
