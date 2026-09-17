# nimiq.kids — public competition instance (Mac Mini)

The PUBLIC, real-mainnet, multi-family nimiq.kids that competition judges and beta families
self-serve onto. It is a **separate instance** from the family install in
`docs/RUNBOOK-MINI.md` — its own checkout, DB, hot wallet, port, and tunnel hostname.
The Fly kit in `docs/DEPLOY.md` is unrelated (that is the SIM demo deploy).

**Nothing in this directory starts anything.** Copy the templates, fill them in, and
bootstrap launchd yourself from a real Terminal (launchd refuses agent shells — see
`reference_launchd_agent_shell`).

## Why this is safe to expose (the economics)

One hot wallet serves every household, so the instance enforces, per family:

| Guard | Env | Competition value |
|---|---|---|
| Cumulative payout budget | `HATCH_DEMO_GRANT_LUNA` + attributed top-ups | 500 000 (5 NIM) grant |
| No grandfathered family | `HATCH_GRANDFATHER_FIRST=0` | first family capped like all |
| Onboard brakes | `HATCH_ONBOARD_PER_IP_HOUR` / `HATCH_ONBOARD_PER_DAY` | 3 / 50 |
| No SIM path | `HATCH_REQUIRE_REAL=1` | boot fails loudly on misconfig |
| Boot scoping | `HATCH_LEGACY_BOOT=0`, `KIOSK_SETUP_CODE` unset | tablets pair by code |

**Worst-case exposure** = families onboarded × demo grant. At the values above:
50 families/day × 5 NIM = **250 NIM/day** — treat it as marketing spend. Top-ups only
ever ADD budget a family itself paid in.

**Known race, widened on 2026-07-31.** The budget is checked before an approval is
decided, but the `earn` row it is derived from is only written after the payout, so N
approvals fired concurrently can each see the same untouched budget. This race has always
existed; the per-payout ceiling used to bound one family's overshoot to `ceiling ×
concurrency` (0.5 NIM a request), and removing the ceiling raises that bound to `remaining
budget × concurrency` (5 NIM a request here). A single payout still cannot exceed the
budget, so this needs a deliberate burst of concurrent approvals against a family's own
household to exploit, and the onboard brakes still bound how many households exist. Closing
it properly means reserving the spend in the same write that decides the approval. Until
then, size `HATCH_DEMO_GRANT_LUNA` as the amount you are willing to lose per family a few
times over, not exactly once.

## Hot-wallet funding rules

- Generate a FRESH key for this instance (never reuse the family install's):
  `bun run src/scripts/generate-hot-wallet.ts ~/gdkc/secrets/hatch-competition.env`
- Fund small and refill often: **start with ~100 NIM**, never hold more than a few
  days of worst-case grants. The wallet is hot on an internet-facing box.
- Watch it: `bun run src/scripts/credit-budget.ts list` (per-family budgets) and the
  parent app's deposit-check for the balance snapshot.
- Manual deposit attribution (a parent paid the QR address from an exchange or another
  wallet): match the tx on the explorer — parents are told to put their 8-char family
  code in the tx message — then
  `bun run src/scripts/credit-budget.ts credit <familyId|code> <NIM> <txHash>`.
  In-app top-ups (wallet-connect inside Nimiq Pay or the Hub) attribute themselves.

## Bring-up

```bash
# 1. Separate checkout (never serve the public instance from the family checkout)
git clone git@github.com:Andjroo111/nimiq-kids.git ~/gdkc/projects/nimiq.kids-competition
cd ~/gdkc/projects/nimiq.kids-competition && bun install --frozen-lockfile

# 2. Data + env
mkdir -p ~/gdkc/data/hatch-competition/media
cp deploy/competition/hatch-competition.env.template ~/gdkc/secrets/hatch-competition.env
chmod 600 ~/gdkc/secrets/hatch-competition.env
#   fill: NIMIQ_RPC_URL, PARENT_URL; then generate the hot wallet:
bun run src/scripts/generate-hot-wallet.ts ~/gdkc/secrets/hatch-competition.env
#   fund the printed address with the starting budget (see funding rules)

# 3. Mainnet self-test (moves 0.1 NIM out and straight back — MUST pass)
set -a; source ~/gdkc/secrets/hatch-competition.env; set +a
bun run src/scripts/mainnet-selftest.ts --yes

# 4. launchd — FROM A REAL TERMINAL
cp deploy/competition/com.hatch.competition.plist.template \
   ~/Library/LaunchAgents/com.hatch.competition.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hatch.competition.plist
```

## Cloudflare tunnel

Same pattern as the live install (`com.hatch.quicktunnel.plist`), but the public
instance needs a **stable hostname** (it goes into `PARENT_URL`, invite links, and the
competition submission), so use the named ops tunnel rather than a quick tunnel: add
an ingress rule mapping `<public-hostname>` → `http://localhost:3960` (plain HTTP
origin — this instance runs no local TLS; the tunnel terminates HTTPS), add the DNS
route, and restart cloudflared. If a quick tunnel must do for a dry run, copy
`com.hatch.quicktunnel.plist` with the label `com.hatch.competition.tunnel` and
`--url http://localhost:3960` — but do not submit a `trycloudflare.com` URL.

## Pre-flight checklist (all green before the URL leaves this machine)

1. **Boot refuses SIM:** `NIMIQ_SIM=1 bun run src/server.ts` with the env sourced must
   THROW (`HATCH_REQUIRE_REAL=1 but SIM mode is active`). Unset and boot normally.
2. **Health:** `curl -s http://localhost:3960/health` →
   `{"ok":true,...,"network":"main","sim":false}`.
3. **Self-test passed:** step 3 above minted + swept a real mainnet cashlink.
4. **Onboard rate limits live:** 4 rapid `POST /api/onboard` from one IP → the 4th
   answers `429 too_many_requests`.
5. **Budget enforcement on:** onboard a probe family, create + approve chores past
   5 NIM total → `400 budget_exhausted`, approval stays pending; an in-app top-up
   (or `credit-budget.ts credit`) unblocks it. Delete the probe family's chores after.
6. **Boot surfaces closed:** `curl -s http://localhost:3960/api/children` →
   `401 {"error":"pairing_required"}`.
7. **Env pairing disabled:** `POST /api/devices/register` with a `setupCode` →
   `403 registration_disabled` (only parent pair codes work).
8. **First family is capped:** with `HATCH_GRANDFATHER_FIRST=0`, the probe family from
   step 5 hit the budget even though it was family #1.
9. **Hot wallet holds only the bounded budget** (funding rules above), and the key
   lives ONLY in the chmod-600 env file.
10. **Backups:** `~/gdkc/data/hatch-competition/` is on the Mini backup path.

## Day-2 operations

- Logs: `~/gdkc/logs/hatch-competition.log`.
- Budgets: `credit-budget.ts list | show | credit | exempt` (exempt is for e.g. the
  ops ops household once it is a named beta family — deliberate, logged, rare).
- Refill the hot wallet in small amounts; reconcile unmatched deposits weekly.
- Kill switch: `launchctl bootout gui/$(id -u)/com.hatch.competition` (real Terminal).
