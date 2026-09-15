#!/bin/sh
# Keep the nimiq.kids TESTNET DEMO hot wallet funded (cron, hourly).
#
# The policy lives in the repo (src/topup.ts) so it is versioned and tested; this wrapper is
# only scheduling, logging and paging. It runs out of the TESTNET DEPLOY CHECKOUT, which
# com.nimiqkids.autodeploy keeps at origin/main, so the policy this runs is the policy that
# shipped.
#
# WHY THIS EXISTS. A drained hot wallet does not fail loudly: payDemoHistory is best-effort, so
# a visitor still gets a 201 and a household whose kids hold nothing. The demo looks alive and
# is dead. Nothing else on this box watches that.
#
# The threshold is in VISITORS, not NIM, because what a visitor costs moved 6,400 -> 24,000 ->
# 72,000 in a single day. See src/topup.ts.
#
# Exit codes from the inner script are the alert contract:
#   0  fine (either nothing needed, or topped up past the floor)   -> quiet
#   1  still below the floor after tapping                          -> page (budget problem)
#   2  could not decide (no address / unreadable balance / no rate) -> page (BLIND, worse)

set -u

REPO="$HOME/apps/nimiq.kids-testnet"
ENV_FILE="$HOME/secrets/hatch-testnet.env"
BUN="$HOME/.bun/bin/bun"
LOG="$HOME/logs/nimiq-kids-faucet-topup.log"
STATE_DIR="$HOME/data/automation/nimiq-kids-topup"
REALERT_SECS="${REALERT_SECS:-21600}"   # at most one page per 6h while still broken

MIN_INTERVAL="${MIN_INTERVAL:-3600}"    # do real work at most hourly

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# This rides poller-watchdog.sh, which cron runs every 10 minutes, so the interval gate lives
# HERE rather than in the schedule. Two reasons it is not a cron line of its own: `crontab`
# cannot be written from an agent shell on this box (it fails "Interrupted system call" on its
# temp file), and every other nimiq.kids watchdog already rides the same poller. Pass
# MIN_INTERVAL=0 to force a run.
should_run() {
  [ "$MIN_INTERVAL" -le 0 ] && return 0
  stamp="$STATE_DIR/last-run"
  [ -f "$stamp" ] || return 0
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - last )) -ge "$MIN_INTERVAL" ]
}

alert() {
  helper="$HOME/scripts/owner-alert.sh"
  [ -x "$helper" ] || { log "ALERT-SEND: helper missing"; return 1; }
  mkdir -p "$STATE_DIR" 2>/dev/null || { log "ALERT: state dir unwritable"; return 1; }
  stamp="$STATE_DIR/last-alert"
  now=$(date +%s)
  last=0
  [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$REALERT_SECS" ]; then
    log "ALERT suppressed (last sent $((now - last))s ago)"
    return 0
  fi
  "$helper" "$1" >/dev/null 2>&1 && { echo "$now" > "$stamp"; log "ALERT SENT"; } || log "ALERT FAILED to send"
}

[ -x "$BUN" ] || { log "bun missing at $BUN"; exit 1; }
[ -f "$ENV_FILE" ] || { log "env missing at $ENV_FILE"; exit 1; }
[ -d "$REPO" ] || { log "repo missing at $REPO"; exit 1; }

should_run || exit 0
mkdir -p "$STATE_DIR" 2>/dev/null
date +%s > "$STATE_DIR/last-run" 2>/dev/null

cd "$REPO" || { log "cannot cd $REPO"; exit 1; }

# The script is only on main from v0.89.0. An older checkout should say so once, not page.
[ -f "src/scripts/topup-hot-wallet.ts" ] || { log "topup script not in this checkout yet — skipping"; exit 0; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

OUT=$("$BUN" run src/scripts/topup-hot-wallet.ts 2>&1)
CODE=$?
echo "$OUT" | while IFS= read -r line; do log "$line"; done

case "$CODE" in
  0) # Clear the failure stamp so the next real failure pages immediately.
     rm -f "$STATE_DIR/last-alert" 2>/dev/null
     ;;
  1) alert "nimiq.kids demo wallet still BELOW the floor after topping up. The faucet is
refusing or is not keeping up. Demo visitors will get empty kid wallets, silently.
$(echo "$OUT" | head -2)" ;;
  2) alert "nimiq.kids demo wallet top-up CANNOT DECIDE (blind). Balance or NIM rate unreadable,
so nothing is watching the demo's funding right now.
$(echo "$OUT" | head -2)" ;;
  *) alert "nimiq.kids demo wallet top-up exited $CODE (unexpected). $(echo "$OUT" | head -1)" ;;
esac

exit 0
