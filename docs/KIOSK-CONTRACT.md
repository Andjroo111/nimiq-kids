# Kiosk Contract — Android wrapper ↔ nimiq.kids server (Phase B)

The handoff document for the native Android kiosk build. The wrapper is a **device-owner
app running LockTask** that hosts the kid PWA in a WebView. It keeps the tablet locked to
the app until the parent approves the routine, then expands an app allowlist so the kids'
games launch. The server (this repo) is the single source of truth for lock state; the
wrapper is a dumb enforcer with one offline rule (below).

Server code: `src/routes/lock.ts` (routes), `src/lock-machine.ts` (state rules),
`public/kid/js/bridge.js` (the JS shim the PWA already ships).

---

## 1. Pairing (device registration)

One-time, during tablet setup. Two ways to prove which household the device joins:

```
POST /api/devices/register
Content-Type: application/json

{ "label": "Sam's tablet", "childId": "<optional child id>", "setupCode": "<KIOSK_SETUP_CODE>" }
{ "label": "Sam's tablet", "childId": "<optional child id>", "pairCode": "<6 digits>" }
```

- **`pairCode` (multi-family instances):** the 6-digit code the parent mints in their
  app (Settings → Pair a device). Family-scoped — the device joins the code's own
  household. Single use, ~5 min TTL. Invalid/expired → `403 bad_pair_code`. When
  `pairCode` is present, `setupCode` is ignored.
- **`setupCode` (legacy single-household):** must equal the server's
  `KIOSK_SETUP_CODE` env var; the device joins the instance's FIRST household. Wrong
  code → `403 bad_setup_code`; missing → `400 setup_code_required`. If the env var is
  unset, this path is **disabled entirely** (`403 registration_disabled`) — which is
  how public instances run (pair codes only).
- The kid PWA also sends the device token as `Authorization: Bearer` on its boot
  surfaces (`GET /api/family`, `GET /api/children`), which scope to the device's own
  household. On instances running `HATCH_LEGACY_BOOT=0` those surfaces answer
  `401 pairing_required` without a token, and the PWA shows its own pair-code screen.
- `childId` binds the device to one kid. Omit it for a shared tablet — the server then
  follows the family's **first** child (per-kid avatar login arrives later).
- Response (`201`): `{ "deviceId": "...", "token": "<64-hex>" }`.

**The token is shown exactly once.** The server stores only its sha-256. Persist it in
the wrapper's private storage (device-owner app data; EncryptedSharedPreferences is fine)
and send it on every request as `Authorization: Bearer <token>`. Lost token = re-register
(a new device row; the parent can ignore/delete the old one later).

## 2. Lock state — `GET /api/device/state`

```
GET /api/device/state
Authorization: Bearer <device token>
```

Response:

```json
{
  "state": "LOCKED_ROUTINE" | "LOCKED_HOURS" | "LOCKED_BUDGET" | "LOCKED_BREAK" | "PENDING_APPROVAL" | "UNLOCKED",
  "reason": "routine_due" | "awaiting_approval" | "routine_approved" | "outside_windows"
          | "no_windows" | "no_children" | "override_lock" | "override_unlock"
          | "outside_hours" | "budget_spent" | "break_time",
  "childId": "<the kid this device follows>",
  "routineId": "<present when a routine demands work / awaits approval>",
  "approvalId": "<present in PENDING_APPROVAL: the open approval>",
  "until": 1789000000000,
  "allowedApps": ["org.example.blocks"],
  "serverTime": 1788999900000,
  "budgetSec": 3600,
  "usedSec": 900
}
```

Field semantics:

| Field | Meaning |
|---|---|
| `state` | The only field LockTask logic may branch on. **Native rule: LOCKED unless `state === "UNLOCKED"`.** `PENDING_APPROVAL` stays locked (show the "waiting for a grown-up" screen). `LOCKED_HOURS` and `LOCKED_BUDGET` (§10) are new names for the same locked answer, and a wrapper that has never heard of them is already correct: they are not `"UNLOCKED"`. |
| `reason` | Diagnostic/UI hint only. New values may appear — never branch enforcement on it. |
| `until` | Epoch **ms**. On `UNLOCKED`: when the free time ends (next lock-window start, or the unlock-override expiry). Absent = indefinite (no upcoming windows). On an override state: the override's expiry, if any. |
| `allowedApps` | Android package names the parent has allowlisted. This is the LockTask package allowlist to apply while `UNLOCKED` (plus the wrapper itself). While locked, the allowlist is the wrapper alone. |
| `serverTime` | Server clock at computation, for client-skew correction against `until`. |
| `budgetSec` | §10. Today's whole screen-time allowance in seconds, base plus anything bought. **0 means UNMETERED**, and an older server omits both fields, which decodes to the same 0 — the compatibility story fails in the safe direction. |
| `usedSec` | §10. What the server has accepted so far today. `budgetSec - usedSec` is what is left, before whatever the wrapper has burned but not yet reported. |
| `approvalId` | Lets the PWA deep-link/attach a proof photo; the wrapper can ignore it. |

State machine precedence (server-side, `src/lock-machine.ts`), most-authoritative first:

1. **Override.** See the author rule below.
2. **The curfew** (§10) — outside every allow window → `LOCKED_HOURS`. Above the routine and
   the budget because it is the only rule a kid can neither work off nor buy out of: there is
   no chore that makes it 7am and no price that does either.
3. **Lock windows**, evaluated by weekday + hh:mm **in the family timezone** (a run that is
   absent/in-progress → `LOCKED_ROUTINE`; finished-awaiting-parent → `PENDING_APPROVAL`;
   approved → falls through), most-restrictive wins across overlapping windows.
4. **The budget** (§10) — spent → `LOCKED_BUDGET`. Below the routine deliberately: a kid who
   has burned their hour AND owes the morning routine should be told about the routine, which
   is the one they can still do something about.
   4b. **Sittings** (§10) — a sitting is full and its rest not yet served → `LOCKED_BREAK`,
   `until` = when the rest is up. Below the budget: a spent day is the more permanent fact.
5. Otherwise `UNLOCKED`.

`until` is the **soonest** of the curfew closing, the budget running out and the next lock
window starting. It is what the tablet counts down to on its lock screen and what
`RelockAlarmReceiver` sets an exact alarm for, so a value that names only one of the three
is a tablet that stays open past bedtime.

WHICH override is in charge is decided one layer down, in `repo-lock.activeOverride`, by
AUTHOR and not by recency: the newest live **parent** row wins, and only if there is none
does a **purchase** row — minutes a kid bought in the Treasure Box — apply. A kid can
therefore never end a grounding by spending NIM, and the Box refuses the sale outright
(`409 locked_by_parent`) while a parent lock is live (#301). The wrapper needs no change
for this: it still reads one `state`.

The same rule read from the other end: `DELETE /api/family/override/:id` clears a **parent**
row only, and answers `409 purchased_minutes` on a purchase (#304). Deleting one would take
back minutes a kid paid real NIM for with nothing on their screen to say why, and no parent
needs it to: a `mode: "lock"` override outranks a purchase outright, and leaves it intact
underneath for when they lift it.

## 3. Live updates — SSE stream

```
GET /api/device/state/stream
Authorization: Bearer <device token>
Accept: text/event-stream
```

- On connect the server immediately sends one `state` event (same JSON payload as §2),
  then a fresh `state` event after **every relevant mutation** (task done/skip, run
  submit, approval approve/reject, override set/clear, allowlist change).
- Heartbeat: an `event: ping` every **25 s**. If neither a `state` nor a `ping` arrives
  for ~60 s, treat the pipe as dead and reconnect.
- Reconnect guidance: exponential backoff 1 s → 2 s → 5 s → 15 s (cap). On every
  (re)connect you always get the current state first, so no events are ever "missed".
- Events are not deduplicated: consecutive identical payloads are possible. Apply
  idempotently.
- **Polling fallback:** if SSE won't hold (broken proxy, WebView background limits), poll
  `GET /api/device/state` every **15 s**. The endpoint currently sends no ETag — if
  polling becomes the primary transport, ask for `ETag`/`If-None-Match` support on the
  server rather than diffing client-side (note for a later PR; harmless to send
  `If-None-Match` today, it is ignored).

## 4. Offline policy

- **Keep the last known state** while the server is unreachable — do not unlock on error.
- If the last state was `UNLOCKED` with an `until` and that instant passes while offline,
  **hard re-lock locally** and stay locked until the server confirms otherwise.
- If the last state was locked, stay locked.
- PIN verification is **server-side only** (`POST /api/parent/verify-pin`); the wrapper
  must not implement or cache the family PIN. A native **recovery PIN** for "server
  unreachable, parent needs the tablet out of kiosk" is the wrapper's own affair (its own
  secret, stored natively, never sent to the server).

## 5. Installed-apps report — `POST /api/device/apps`

So the parent page can build the allowlist picker from real data:

```
POST /api/device/apps
Authorization: Bearer <device token>

{ "apps": [ { "pkg": "org.example.blocks", "label": "Blocks" }, ... ] }
```

- Send launcher-visible apps (PackageManager `queryIntentActivities` on MAIN/LAUNCHER).
- Entries without a `pkg` are dropped; `label` defaults to the pkg; capped at 500.
- Report on boot and whenever a package is added/removed. Fully replaces the prior list.

## 6. Allowlist delivery

The parent edits the allowlist from the phone page (`PATCH /api/devices/:id/allowed-apps`,
parent-authed — not the wrapper's concern). The wrapper only ever **receives** it as
`allowedApps` in the state payload (§2/§3) and must re-apply LockTask packages whenever it
changes — including while already `UNLOCKED` (an allowlist edit triggers a fresh SSE
`state` event).

## 7. `window.KioskBridge` — the JS interface the wrapper must inject

Inject (via `addJavascriptInterface`) an object named exactly `KioskBridge` with:

```ts
interface KioskBridge {
  /** The PWA pushes every fresh server state here, pre-mapped:
   *  json = {"mode":"locked"|"unlocked","reason":string|null,"until":number|null,
   *          "remainingSec":number|null,"allowedApps":string[]} */
  setLockState(json: string): void;
  /** Launcher-visible apps: JSON string of [{"pkg":string,"label":string}] */
  getInstalledApps(): string;
  /** Launch an allowlisted package; true when the launch started */
  launchApp(pkg: string): boolean;
  /** Last native state as JSON (same shape setLockState receives) — lets the PWA
   *  re-sync after a WebView reload */
  getState(): string;
}
```

The PWA side (`public/kid/js/bridge.js`, already shipped) is the only caller:

- `applyKioskState(serverState)` maps the §2 payload to the native shape — `mode` is
  `"unlocked"` **iff** `state === "UNLOCKED"`, and `reason`, `until` (epoch ms),
  `remainingSec` and `allowedApps` pass through — and calls
  `KioskBridge.setLockState(JSON.stringify(mapped))`.
- `reason` and `remainingSec` exist for the kid app's lock screen (§10). `mode` alone cannot
  tell bedtime from a spent budget from a grounding, and those are three different sentences
  to a child. Both are `null` when there is nothing to say, never `0` or `""` — an empty
  meter and no meter are opposite things to put on a screen.
- `listInstalledApps()` / `launchApp(pkg)` wrap the other two calls and return
  `null`/`false` when `window.KioskBridge` is undefined (plain browsers), so the wrapper
  must tolerate nothing else: every call is optional-safe on the JS side.
- The wrapper should still enforce §4 natively from the last `setLockState` + its own
  clock — the WebView can crash; the lock must not.

## 8. Camera & TLS expectations

- The kid app uses `getUserMedia` for proof photos/hatch pictures. The WebView must grant
  `PermissionRequest` for camera in `WebChromeClient.onPermissionRequest` (after holding
  the Android CAMERA runtime permission as device owner).
- `getUserMedia` requires a **secure context**: the family server runs HTTPS with a
  self-signed/mkcert CA. Install the family's CA into the Android user (or device-owner
  managed) trust store so the WebView trusts it — do **not** override
  `onReceivedSslError` to bypass; grant real trust to the mkcert root instead.

## 9. Error handling

- `401` on any device route → token lost/revoked: show the pairing screen (setup code
  entry), stay locked.
- `5xx`/network → offline policy (§4).
- All error bodies are `{ "error": "<snake_case_code>" }`.

## 10. Screen-time meter — `POST /api/device/usage`

The tablet is the only thing that can measure screen time. The server knows a tablet is
unlocked; it cannot know whether a kid is playing Minecraft, doing chores in the kid app, or
has walked away with the screen on — and those are three different answers, only one of
which should cost them anything. So the wrapper meters and reports.

```
POST /api/device/usage
Authorization: Bearer <device token>
{ "deltaSec": 45 }
```

**THE RULE the wrapper implements** (`ScreenMeter.burning`):

```
burning  =  screen on  AND  unlocked  AND  the kiosk is NOT the foreground task
            AND no override is in charge
```

Each clause earns its place:

- **Screen on**, not "an allowlisted app is in the foreground". Foreground-app usage needs
  the `PACKAGE_USAGE_STATS` special access — a Settings toggle a factory reset wipes — and it
  still cannot see a kid sitting on a paused game. Screen-on is a stock broadcast that cannot
  be revoked, and it is the rule a seven-year-old can understand: if the picture is on, the
  clock is running.
- **Unlocked.** A locked tablet is showing a lock screen. Charging a kid for looking at the
  reason they cannot play would be absurd.
- **Not the kiosk.** Doing chores is not screen time.
- **No override.** This is the parent-unlock promise — "leave it open while I do something,
  and it doesn't count." The server refuses ticks during an override as well
  (`{ "ok": true, "skipped": "override_active" }`); the wrapper's clause is what keeps it
  from sending them at all.

**It is a DELTA, never a total.** A tablet that went offline for an hour and came back with
an absolute total would either lose the offline hour or double it. A successful report
subtracts exactly what it sent rather than zeroing, so seconds burned during the round trip
survive it; a failed one leaves them pending for the next attempt.

Server-side guards, all three of which assume the client is hostile:

| Guard | What it closes |
|---|---|
| `deltaSec` clamped to 300 (one sync interval) | A single request cannot rewrite a whole day. |
| The local day is computed from the family timezone, never taken from the body | A client-chosen day is a client-chosen budget: send yesterday's date and today's meter stays at zero forever. |
| Refused outright while an override is live | "Leave it open and it doesn't count" is a lie the moment this route accepts a tick during one. |

**Local enforcement (extends §4).** The wrapper knows `budgetSec` and `usedSec` from the last
state payload and adds its own unreported seconds, so it locks itself the moment the budget
runs out whether or not the network is there to be asked. An offline tablet that ran free
until it could get permission to stop would have the rule exactly backwards.

**Warnings.** At 10 minutes and 2 minutes left the wrapper shows a native toast over whatever
is running. It has to be native: the kid is inside a game, so the kid app is not on screen to
say it. A toast rather than an overlay, because a persistent window on top of a game a child
is concentrating on is a worse intrusion than the lock it is warning about. Each threshold
fires once and re-arms when the allowance grows (bought minutes, or a new day).

**The curfew** (`allow_windows`) is server-side only and needs nothing from the wrapper: it
arrives as `LOCKED_HOURS`, which is already not `"UNLOCKED"`.

**Sittings** (`children.play_min` / `rest_min`) are server-side only in the same way. "Play
for 30 minutes, then rest for 30" is enforced off the ticks this route already receives: the
seconds since the kid last rested are the sitting, and when it reaches `play_min` the state
turns `LOCKED_BREAK` with `until` = the end of the rest. A rest is served by SILENCE -- the
wrapper reports only while burning, so `rest_min` of no reports is the rest, whether it began
with the lock or with the kid walking away -- and a pause shorter than that does not restart
the sitting. The wrapper needs nothing new: `LOCKED_BREAK` is not `"UNLOCKED"`, and `until`
is what the re-lock alarm already counts down to. The kid app draws it full-screen with a
countdown, off `reason: "break_time"`.

## 11. Battery — `POST /api/device/battery`

```
POST /api/device/battery
Authorization: Bearer <device token>
{ "pct": 80, "charging": false }
```

The charge as the tablet reads it (`BatteryManager`, the sticky `ACTION_BATTERY_CHANGED`).
Sent from the 15s tick when the percentage or the plug changed, and at least every ten
minutes otherwise; never every tick. The server clamps `pct` to 0..100, writes the latest to
the device row (the parent's screen-state carries it as `batteryPct` / `batteryCharging` /
`batteryAt`) and appends every accepted report to `device_battery`, kept 30 days, readable as
`GET /api/parent/devices/:id/battery?days=1`. A server too old to know the route answers 404;
the wrapper logs it and carries on. Nothing on `GET /api/device/state` changes.

Why it exists: the meter (§10) bills screen-on time, and the wrapper's own policy now puts
the screen to sleep after three minutes on or off the charger (`DevicePolicyHelper`,
`screen_off_timeout` + `stay_on_while_plugged_in`). This is how a parent sees whether that
held, without picking the tablet up.
