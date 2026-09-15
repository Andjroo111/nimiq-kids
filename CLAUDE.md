# nimiq.kids — Claude Code Context

## What this is

nimiq.kids is a Nimiq Pay mini-app for the **Nimiq Mini Apps Competition 2026**. A parent assigns chores/allowance to their kids; marking a chore done pays the child instantly in **NIM via a Cashlink** — a soft, parent-controlled crypto on-ramp for a whole household.

One-liner: **Kids' allowance & chores paid instantly in NIM via Cashlinks.**

Nimiq edge: **Cashlinks + Speed**. Cashlinks make payouts claimable with no account; instant + sub-cent makes even $1 chores economical. Family-scale onboarding wedge.

## Stack

- **Runtime:** Bun + Hono
- **Data:** SQLite (local) / Cloudflare D1 (deployed)
- **Frontend:** vanilla PWA
- **Wallet:** Nimiq Pay mini-app provider (in-wallet)

## The demo loop

1. Parent marks a chore done.
2. App mints a Cashlink to the kid for the chore's NIM amount (sign/send from parent wallet).
3. Kid claims the Cashlink into their wallet in seconds.

## House rules

- **Be exact about custody.** The parent's wallet is theirs; the app only asks it to move funds. **Kid accounts are different: the server derives them from `HATCH_MASTER_SEED` and can sign for them, so they are server-custodied.** They are not self-custodied and they are not sub-wallets of the parent's wallet. Never describe the kid side as non-custodial in code, docs, or copy — see `docs/WALLET-CONTRACT.md`.
- **Wallet-only data.** End users include minors — minimize stored data, no PII for kids (COPPA). Child records are labels/avatars only.
- **Every PR adds a release note — as `changelog.d/<branch-name>.md`, never by editing `CHANGELOG.md` or the `version` in `package.json`.** Those two files are the only ones every PR touches, so they are the only two that parallel sessions are guaranteed to conflict on. A bot folds the fragments in on `main` after the merge and bumps the version. See `changelog.d/README.md`.
- **Agents work in git worktrees** — never edit the main checkout directly for parallel work.
- **CI file-size guard** flags files **800+ lines** — split before they get there.
- **One primary action per screen.** Minimal, non-technical UX — this is for parents and kids, not crypto natives. Hide jargon (Cashlink mechanics, addresses, tx) behind plain language.
- Do not write app/feature code in the kickoff phase. Build against issues in milestone **M1 — Competition demo MVP**.
