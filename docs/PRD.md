# nimiq.kids — PRD

> Kids' allowance & chores paid instantly in NIM via Cashlinks.

## Problem

Allowance apps (Greenlight, GoHenry, BusyKid) are subscription-priced and bank-rail bound — a payout is slow, costs cents-to-dollars in fees, and the money sits inside the provider's ledger rather than on rails the family can see. Parents who want to teach kids about money on real, instant, publicly verifiable rails have no soft option that works for the whole household.

## Target user

- **Primary:** a parent who already uses Nimiq Pay and wants to pay their kids' allowance/chores on instant rails they control.
- **Secondary:** the child, who receives a payout and claims it — with **no account setup** required, just a wallet.

## The demo loop (step by step)

1. Parent opens nimiq.kids inside Nimiq Pay; the app reads the parent's account via `listAccounts`.
2. Parent adds a child and assigns a chore with a NIM reward (e.g. "make bed — 2 NIM").
3. Child completes the chore; parent taps **Mark done**.
4. App mints a **Cashlink** for the chore amount, signed/sent from the parent's wallet.
5. Child receives the Cashlink (link / QR) and **claims** it into their wallet in seconds.
6. Demo "wow" screen shows the instant payout landing — sub-second, sub-cent.

## MVP scope

### In

- Parent reads their Nimiq Pay account (`listAccounts`).
- Create a child (label/avatar only — no PII).
- Assign a chore with a NIM reward amount.
- **Mark done** → mint a Cashlink for the reward (sign/send from parent wallet).
- Hand the Cashlink to the kid (link/QR) for claim.
- Demo "wow" payout-landed screen.

### Out (post-MVP)

- Recurring/scheduled allowance.
- Chore approval workflows, photos-as-proof.
- Multi-parent / co-guardian accounts.
- Savings goals, interest, spend tracking.
- Push notifications.
- Bank-style custody of family money (never — the parent's wallet stays the parent's).

## Success metric

A parent can go from **Mark done → kid's wallet credited** in **under 10 seconds**, with zero account creation for the kid, demoed live in Nimiq Pay.

## Open questions

- **June-3 SDK (Cashlinks):** does the competition SDK expose **Cashlink minting** from inside a mini-app, or must we build the Cashlink (key + funding tx) ourselves and surface the claim link? Confirm the exact capability and API surface on June 3.
- **Signing UX:** does minting a Cashlink require a per-chore signature popup, or can the parent pre-authorize a batch? Affects the "instant" feel.
- **Claim hand-off:** in-wallet, is the cleanest hand-off a deep link, a QR, or a share sheet? Depends on what the mini-app shell allows.
- **Amounts:** minimum economical chore reward in NIM; how to display fiat-equivalent for parents.

## Compliance notes

**NOT LEGAL ADVICE. A legal opinion is required before any non-demo launch.**

- **Custody, precisely:** the **parent's** wallet is self-custodied — the app only asks it to sign. The **kid's** account is derived from a server-held master seed, so the server can sign for it: the kid side is **server-custodied**, and the compliance posture must be assessed on that basis, not on a non-custodial one. Whether kid keys should stay server-derived at all is an open design decision.
- **Minors / COPPA:** end users include children. Any stored data tied to a minor triggers **COPPA** (and state-equivalent) considerations.
- **Stance:** **wallet-only.** Store the minimum; no PII for minors; kids never create an account beyond their wallet. Child records are labels/avatars only.
- Obtain a **written US legal opinion** before any non-demo launch.

---

## Offshoot — Learn-to-Earn (Brilliant.org)

> Added 2026-05-30. An extension of the same **complete-a-task → get-paid** mechanic, not a separate app.

nimiq.kids's core loop is "kid does the thing → parent pays NIM." The most valuable "thing"
isn't always a household chore — it can be **learning**. [Brilliant.org](https://brilliant.org)
teaches kids **coding and math** through interactive lessons. The offshoot: let a parent set up
a chore whose completion condition is **"finish a Brilliant math/coding lesson (or streak/level)"**
→ on completion, nimiq.kids pays the kid NIM, same as any other chore.

### Why it fits nimiq.kids (not a new repo)

- Identical payout primitive: parent wallet → kid wallet via Cashlink on task completion.
- Just a new **chore type** with a learning-based completion condition.
- Strengthens the product's "teach kids real money on real rails" thesis — now you also pay
  them to learn the skills.

### What's new vs a normal chore

- **Completion signal:** a normal chore is parent-attested ("Mark done"). A Brilliant chore
  wants proof the lesson was actually completed. MVP = parent-attested (parent confirms the
  kid finished); later = verify via Brilliant (account link / completion export / screenshot)
  if/when an integration path exists.
- **Reward shape:** could be per-lesson, per-streak-day, or per-level/milestone.

### Open questions (capture, don't block)

- Does Brilliant expose any **completion data** (API / export / parent dashboard) we could read,
  or is this parent-attested only for the foreseeable future?
- Reward calibration: per-lesson vs streak vs level — what keeps kids learning without
  gaming it.
- Same COPPA/minor stance as the rest of nimiq.kids applies; no extra PII for the learning link.
