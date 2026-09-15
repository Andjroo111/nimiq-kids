# nimiq.kids — Autonomous Build Charter

> Read this, then build the project to a **competition-ready** state autonomously. You are the full engineering + product team. Andjroo's only two roles are **(1) testing** and **(2) look & feel** — UI/UX, branding, color, typography. Everything else is yours to decide and execute. Don't wait for approval on anything outside look & feel.

## Your authority — decide these yourself, never ask
- Architecture, tech choices, data model, libraries, file/folder structure, infra & deploy.
- Product scope: which features to build, cut, or defer; what the MVP and the demo loop are.
- **New & better features:** proactively invent, evaluate, and pick the ones that best serve Nimiq adoption + the competition. Don't wait to be asked — keep raising the bar.
- Naming, microcopy, issue grooming, PR sequencing, refactors.
- Critical product/technical trade-offs: make the call, record it in a short ADR (docs/adr/), keep moving.

## Reserved for Andjroo — surface these (batched), don't decide
- Visual design / UI layout, branding, color palette, typography, overall "look & feel."
- Final acceptance testing. Hand him a runnable build + a short "what to test" script each milestone.
- When you need a look-and-feel call, present **2-3 concrete options** (screenshots/mockups via the webapp-testing + nimiq-ui tooling) and let him pick. Batch them; never one-at-a-time blocking.
- **Domain choice** — pick from the "Domain options" GitHub issue (don't auto-decide or register anything).
- **A dedicated branding / UI-UX / typography review session with Andjroo** — collect these decisions under the `needs:andjroo` label, present 2-3 options each, never finalize visual identity without him.

## How to work — use workflows, self-discover, loop
**Every non-trivial phase MUST be run as a dynamic Workflow** (the Workflow tool / multi-agent orchestration) — fan out research, design, build, and verify across parallel agents; solo edits are reserved only for trivial one-liners. Run this as repeated **multi-agent workflows**, not solo edits. Each phase is its own workflow:
1. **Understand** — research the Nimiq ecosystem (Albatross PoS, staking, HTLC, Cashlinks, the Nimiq Pay Mini Apps SDK, nimiq-ui) + the competition (miniappscompetition.com, June-3 rules) + 3-5 best-in-class analogues. Output: a crisp spec + the winning single demo loop.
2. **Design** — generate several architecture/feature approaches, score them on (Nimiq-edge-is-load-bearing × adoption × demo-wow × buildability), pick the best, write ADRs.
3. **Build** — fan out the backlog across parallel agents, each in its own git worktree; one issue → one PR. Every PR bumps version + CHANGELOG. Files < 800 lines.
4. **Verify** — adversarially test each feature: does it actually run in Nimiq Pay? does the demo loop complete on a phone? edge cases, HTLC timeout-grace, error paths. Fix what fails.
5. **Improve** — a completeness/quality critic asks "what's missing, what would make this WIN the competition?" Feed findings back. Repeat until competition-ready.
Between loops: keep the GitHub board current (open issues for new ideas), maintain a running CHANGELOG, and leave Andjroo a short "what to test" + "look & feel choices I need" note. Issues are labeled overnight:safe so the overnight coder routine can also advance them.

## This project
- **What it is:** Kids' allowance & chores paid instantly in NIM via Cashlinks.
- **The demo loop (what a judge completes on a phone):** Parent marks a chore done -> mints a Cashlink to the kid -> kid claims into their wallet in seconds.
- **Nimiq edge — must be load-bearing, never bolted on:** Cashlinks (claim with no account) + instant settle.
- **Reuse:** Nimiq Cashlinks / Hub cashlink flow.
- **Stack:** Bun + Hono + SQLite/D1 + vanilla PWA, Nimiq Pay mini-app, nimiq-ui design system.
- **Competition:** Nimiq Mini Apps Competition 2026 ($50K USDT, rules June 3, kickoff July 6, runs inside Nimiq Pay). Optimize EVERY decision for: runs cleanly in-wallet, genuinely uses Nimiq's edge, onboards new users, and has a live "wow" moment.

## Domain
Domain: TBD — see the "Domain options — nimiq.kids" issue (label needs:andjroo). Andjroo picks; do not register.

## Guardrails
- The parent's wallet is self-custodied. **Kid accounts are not**: the server derives them from `HATCH_MASTER_SEED` and can sign for them (`docs/WALLET-CONTRACT.md`). Do not repeat the old "standard non-custodial mini-app" framing — the legal posture has to be assessed against server custody of the kid side.
- Keep it wallet-only (no stored minor PII — COPPA); parent wallet -> child wallet via Cashlink.
- Never mark work "done" without proving it runs (build + a real run, not just tests passing). Don't regress existing functionality.
- The house rules in CLAUDE.md apply (PR = version bump + CHANGELOG entry; agents work in git worktrees; CI file-size guard).
- When you genuinely need a non-look-and-feel decision from Andjroo (rare), make a recommendation and proceed with the reasonable default rather than blocking.
