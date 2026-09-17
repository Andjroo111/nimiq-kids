# nimiq.kids — public TESTNET demo instance (Mac Mini)

The link a competition judge opens. Real Nimiq **testnet** settlement, a **private
seeded family per visitor**, and no way for one visitor's actions to reach the next.

Three instances now exist and none of them share anything:

| | family install | competition | **testnet demo** |
|---|---|---|---|
| runbook | `docs/RUNBOOK-MINI.md` | `deploy/competition/` | **this file** |
| launchd | `com.hatch.app` | `com.hatch.competition` | `com.hatch.testnet` |
| port | 3950 | 3960 | **3963** |
| network | test (SIM) | **main** | **test** |
| hostname | LAN | `nimiq.kids` (shared tunnel) | `kids-demo.internal` (kids-dev tunnel) |
| DB | `~/gdkc/data/hatch/` | `~/gdkc/data/hatch-competition/` | `~/gdkc/data/hatch-testnet/` |
| env | `hatch.env` | `hatch-competition.env` | `hatch-testnet.env` |

## Why the demo is on testnet and not on mainnet

Read `src/custody.ts` first. `DEMO_UNLOCKED` defaults to true because the
parent-approval gate is **not built**: verified on the live testnet 2026-07-31, an
unauthenticated HTTP POST carrying no token, no PIN and no approval moved a kid's real
on-chain NIM. That is fine in a demo that says so, and it means a **funded mainnet hot
wallet behind a public demo URL could be drained with curl**. Testnet removes the loss
entirely while keeping real signing, real broadcast, real confirmation and a real
block-explorer receipt. Do not "upgrade" this instance to mainnet.

## Why every visitor gets their own family

A single shared demo family cannot work: the first judge approves the pending chore and
every judge after them finds an empty board and someone else's spent budget. So
`GET /demo` mints one household per visitor (`src/demo-family.ts`).

It reuses the plumbing that already exists rather than inventing a second one:

- `HATCH_LEGACY_BOOT=0` already makes every unauthenticated boot surface answer
  `401 pairing_required` (`src/routes/families.ts` → `requestFamily`).
- A **parent bearer** (`kidsParentToken`) resolves to its own family, and a **device
  bearer** (`kid.deviceToken`) resolves to its own family. The demo mints one of each
  and the landing page stores them under exactly those keys.
- So the isolation is the same isolation self-serve onboarding already had, and it is
  enforced server-side — a bearer from household A gets 404 on household B's rows.

Demo households are stamped `families.demo_at` and swept hourly once they pass
`HATCH_DEMO_TTL_MS` (24h default), so the table cannot grow forever.

## Bring-up

```bash
# 1. Its own checkout / worktree
git worktree add -b feat/testnet-demo ~/gdkc/worktrees/nimiq-kids-testnet-demo origin/main
cd ~/gdkc/worktrees/nimiq-kids-testnet-demo && bun install --frozen-lockfile

# 2. Data + env
mkdir -p ~/gdkc/data/hatch-testnet/media
cp deploy/testnet-demo/hatch-testnet.env.template ~/gdkc/secrets/hatch-testnet.env
chmod 600 ~/gdkc/secrets/hatch-testnet.env

# 3. Keys (both are required — a missing master seed throws on every kid-wallet call)
bun run src/scripts/generate-hot-wallet.ts  ~/gdkc/secrets/hatch-testnet.env
bun run src/scripts/generate-family-seed.ts ~/gdkc/secrets/hatch-testnet.env
#    then QUOTE the address line, or `set -a; source` tries to run its second word:
#    HATCH_HOT_WALLET_ADDRESS="NQ.. .... ...."

# 4. Fund it from the public testnet faucet (no rate limit, ~110k NIM a tap)
curl -X POST https://faucet.pos.nimiq-testnet.com/tapit \
  --data-urlencode "address=<the printed NQ address>"

# 5. launchd — FROM A REAL TERMINAL (launchd refuses agent shells)
cp deploy/testnet-demo/com.hatch.testnet.plist.template \
   ~/Library/LaunchAgents/com.hatch.testnet.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hatch.testnet.plist
```

## Tunnel

The demo needs a whole hostname, not a path: it serves `/demo`, `/kid/`, `/parent/`,
`/portal/`, `/api/*` and the static PWA. It rides the **kids-dev** tunnel
(`~/.cloudflared/kids-dev.yml`), which may be restarted freely — **never** the shared
ops tunnel (`~/.cloudflared/config.yml`), which fronts live business ingress and also
fronts the mainnet `nimiq.kids`.

```yaml
  - hostname: kids-demo.internal
    service: http://localhost:3963
```

`cloudflared tunnel route dns kids-dev kids-demo.internal` created the CNAME. The
local `cert.pem` is authorized for the **internal zone only** — asking it for a
`nimiq.kids` hostname silently appends the authorized zone. A nicer
`demo.nimiq.kids` needs one CNAME added by hand in the Cloudflare dashboard:
`demo.nimiq.kids` → `<tunnel-id>.cfargotunnel.com` (proxied),
then add the hostname to `kids-dev.yml` and restart that tunnel.

## Pre-flight checklist (all green before the URL leaves this machine)

1. **Boot refuses SIM:** `NIMIQ_SIM=1 bun run src/server.ts` with the env sourced must
   THROW (`HATCH_REQUIRE_REAL=1 but SIM mode is active`).
2. **Health:** `curl -s localhost:3963/health` → `"network":"test"`, `"sim":false`, and
   `"explorerTx":"https://test.nimiq.watch/#"` (testnet's explorer — `test.nimiqscan.com`
   does not resolve, so a wrong value here means every receipt tap lands on a dead page).
3. **Both keys are set:** `POST /api/demo/family` answers `201` with `paidHistory: 4`.
   A `0` means the payouts are failing — check `HATCH_MASTER_SEED` and the RPC.
4. **The budget clears the board:** there is no per-payout ceiling any more, so the only
   thing a seeded chore has to fit inside is `HATCH_DEMO_GRANT_LUNA` minus the seeded
   history. Approve the priciest seeded chore once and confirm it answers `200`.

   The boot log now answers this before a visitor does. It prints either
   `[demo] budget ok · grant N NIM covers the M NIM seeded history` or a `warn` naming
   the shortfall. **Read it after any deploy that changes pricing.** The seed is priced
   against the Treasure Box (v0.53.0, issue #29), so its cost is set by the shelves and
   the NIM rate, not by a constant in the source:

   | | per demo family |
   |---|---|
   | seeded history, paid on chain at mint | **~4,800 - 6,500 NIM** |
   | every seeded chore, if a judge approves all of them | ~16,000 NIM |
   | `HATCH_DEMO_GRANT_LUNA` in use | `3000000000` (30,000 NIM) |

   The grant has to clear the history *and* leave room to approve, because
   `payKidEarn` pays the history without consulting the budget while its rows still
   count as SPENT. A grant under the history is the nastiest failure this instance
   has: the mint still reports `paidHistory: 4`, and only the judge's first approval
   fails, with `budget_exhausted`.
5. **Isolation, from two fresh browser contexts:** each lands on `/demo`, gets a
   different `kids.demoFamilyId`, and approving in one leaves the other's queue at 2.
   Cross-bearer must 404.
6. **Boot surfaces closed:** `curl -s localhost:3963/api/children` → `401 pairing_required`.
7. **Sweeper armed:** the boot log prints `[demo] seeded per-visitor demo families ON`.
8. **Hot wallet:** testnet-only key, in the chmod-600 env file and nowhere else. Refill
   from the faucet; it is worth nothing, but a drained wallet is a dead demo.

   **This is now watched automatically** (v0.89.0). `nimiq-kids-faucet-topup.sh` runs
   hourly from cron, and tops the wallet up from the faucet when runway falls below 5
   visitors, refilling to 15. It pages Andjroo if it cannot get back over the floor, or if
   it cannot read the balance at all. You should not need to think about this; the manual
   faucet call in step 4 still works any time you want to get ahead of a judging window.

   **A swept family's NIM now comes back** (v0.86.0, issue #44): the sweeper reclaims each
   abandoned household's kid balances to the hot wallet before forgetting it, so the wallet
   is a float rather than a budget. What is left is the money in flight — see the TTL note
   below, which is the real dial.

## Day-2

- Logs: `~/gdkc/logs/hatch-testnet.log`.
- Refill: the faucet call in step 4, any time.

### The hot wallet is a consumable, not a fixture

**Each demo family costs about 72 000 NIM** (v0.87.0), paid on-chain the moment it is
minted. That is the seeded history, floored so each kid can afford **one of every item in
the catalogue** plus change — a tester has to reach every outcome the Box produces, not
just one per shelf. The floor is read from the live catalogue in `src/demo-family.ts`, so
repricing or adding a shelf moves it automatically.

**DO NOT WRITE THIS NUMBER DOWN ANYWHERE ELSE.** It moved 6 400 -> 24 000 -> 72 000 in a
single day as the floor was raised twice, and every copy of it went stale within hours:
`HATCH_DEMO_GRANT_LUNA` went underwater twice, and this file itself quoted a balance that
was a third wrong. Ask the code (`seedHistoryLunaAt`) or read the boot line.

| hot wallet | demo families it funds |
|---|---|
| 110 000 NIM (one faucet tap) | ~1.5 |
| 500 000 NIM | ~7 |
| 1 500 000 NIM (~14 taps) | ~20 |

**The TTL is the real dial, not the balance.** Reclaim returns a household's NIM when it is
swept, so the wallet only has to cover the visitors alive AT ONCE. At the default 24h TTL a
day's visitors are all in flight together; at `HATCH_DEMO_TTL_MS=14400000` (4h) the same
wallet funds roughly six times as many visitors per day. Nobody has made that call yet.

**Check it before any judging window** and tap until it clears the traffic you expect:

```bash
ADDR=$(grep '^HATCH_HOT_WALLET_ADDRESS' ~/gdkc/secrets/hatch-testnet.env | cut -d= -f2- | tr -d '"')
curl -s -X POST https://rpc.testnet.nimiqwatch.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountByAddress\",\"params\":[\"$ADDR\"]}"
```

A drained wallet does **not** announce itself: `payDemoHistory` is best-effort, so the mint
still answers `201` and the visitor gets a family whose kids hold nothing — which looks
exactly like the bug the seeding exists to prevent. `paidHistory` in the response is the
tell; it should equal 4.

Money paid to a kid is not recovered by the sweeper (`purgeFamily` forgets the household
but does not claw back on-chain NIM), though Treasure Box spending does return to the hot
wallet. Reclaiming abandoned kid balances is issue #44.

**`HATCH_DEMO_GRANT_LUNA` has to clear the seeded history**, or every family mints with no
budget and the judge's first approval dies with `budget_exhausted` while the mint still
reports a cheerful `paidHistory: 4`. Boot says which way it went — either
`[demo] budget ok · grant N covers the M seeded history` or a `BELOW` warning naming the
minimum. **Read that line after any change to the seed or the shelves.** Budget ~6,500 NIM per demo visitor.
- Balance: `curl -s https://test-api.nimiqwatch.com/api/v1/account/$ADDR | jq .balance`
- Families on the box: `sqlite3 ~/gdkc/data/hatch-testnet/hatch.db "select count(*) from families where demo_at is not null;"`
- Kill switch: `launchctl bootout gui/$(id -u)/com.hatch.testnet` (real Terminal).
