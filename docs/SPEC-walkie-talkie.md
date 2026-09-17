# SPEC: the family walkie talkie

**Status: research brief. Nothing built, nothing decided beyond the two calls below.** Written
2026-08-08 from Andjroo's dictation. Andjroo's own framing: "this one's gonna need a little bit more
research and development of how it could work."

## Where this came from

Andjroo's daughter, same conversation as the quest map: she and her brother are inside the same
game at the same time, and she wants to be able to **talk to each other, and see each other**,
while they do it. Andjroo's shape for it: "almost FaceTime walkie talkie", not a full split screen,
"maybe just like a little mobile view" in a corner.

His own caveat, and the part that matters most: "how to make sure that they're only communicating
with, you know, people to parent. Maybe if it's only in family or something like that."

## The two decisions already made

1. **A second tablet gets bought.** Andjroo, 2026-08-08. The plan of record was one shared Tab A11+
   (see the Hatch tablet notes), and on one device there is nobody to call. Sibling to sibling is
   therefore the **primary** pairing, which is what she actually asked for.
2. **Family only, by construction and not by a setting.** The household roster is the entire
   address book. There is no search, no directory, no username, no invite link, no code that
   crosses to a stranger. A kid can call the people their parent already put in the family, and
   nobody else can reach them at all.

## Safety model, before any of the technology

This is the part to get right first, because it is the part that decides whether the feature can
ship at all.

* **The roster is the whitelist.** `family_members` (`schema.sql:846`, roles owner / coparent /
  supporter) and `children` are the only two tables a call can address. Everything else in the app
  is already family scoped by the bearer token, and this reuses that and adds nothing.
* **Never on a public instance.** Family mode only (`families.mode='family'`). Not on
  `nimiq.kids`, not on `demo.nimiq.kids`. This is the same rule the app already holds for kid
  photos: they stay on the family's own server and never reach a public deploy.
* **Nothing is recorded, and nothing is kept.** A call has a log line (who, whom, when, how long)
  and no content. There is an existing precedent to copy exactly: the approval proof photo is
  cleared and the asset deleted the moment the approval is decided, or after 24 hours
  (`src/routes/approvals.ts:379`, issue #282).
* **A grown up can turn it off**, per kid, at any time, and the kill switch has to work from the
  parent phone without touching the tablet.
* **A kid can refuse a call.** Two siblings and a ringer is a weapon within a week. Per kid "do
  not disturb", and a hard cap on repeat rings, are not polish, they are the difference between
  this being fun and being the thing you confiscate the tablet over.
* **No PII, still.** Same COPPA stance as the rest of the app. A call is between two rows that
  hold a label and an avatar.

## What exists today, and what does not

**There is no realtime channel in this app at all.** That is the single biggest fact for planning,
and it is a deliberate decision, not an omission. `src/routes/lock.ts:271` writes it out: this
app's whole auth model is a bearer token, `EventSource` cannot carry an `Authorization` header,
and the only way to stream to a browser with one is to put the token in a query string "where it
lands in access logs and Referer headers and outlives the request that carried it." Everything
polls instead: the parent app on 20s, the tablet on 15s.

So a live call needs a signalling path that does not exist yet, and whatever gets built has to
answer that bearer question rather than ignore it.

What does exist and helps:

* **HTTPS with a real certificate on the LAN.** The family instance is `https://192.168.1.42:3950`
  under mkcert, and the kiosk build bakes and installs the CA. `getUserMedia` requires a secure
  context, so this is already satisfied. A plain `http://` LAN origin would be refused outright by
  the browser, which is worth knowing before anyone "simplifies" the setup.
* **Device identity.** `devices` (`schema.sql:302`) holds the tablet, its bearer token hash, its
  bound `child_id` and the kid currently switched in (`unlocked_child_id`, the #123 gate). The app
  already knows which kid is holding which tablet, which is exactly what a call needs to route.
* **Media storage.** `media_assets` plus the routes in `src/routes/media.ts` already accept, serve
  and delete a kid's own file on the family's own box.
* **The kiosk wrapper grants camera to the WebView**, origin checked against the chore server
  (`WebViewConfig.kt:123-140`), and pre grants it by device policy so no runtime dialog appears
  under LockTask (`DevicePolicyHelper.kt:84-91`).

⚠️ **It does NOT grant a microphone.** `RECORD_AUDIO` is absent from the manifest, absent from the
device policy pre grant, and `onPermissionRequest` filters the request down to
`RESOURCE_VIDEO_CAPTURE` and denies anything else. **A walkie talkie is exactly an audio request,
so today it is denied at the wrapper, silently, on the device.** Three legs have to change
together in `Andjroo111/kidkiosk-android`: declare the permission, pre grant it by policy (their
own comment explains why: a runtime dialog is unreachable inside lock task), and let it through
`onPermissionRequest`. Sideloading an updated APK covers it. No factory reset, since the app stays
device owner.

## Three ways to build it

### A. Push to talk voice clips, over the rails that already exist

The kid holds a button, the browser records with `MediaRecorder`, releases, and the clip is POSTed
like any other media asset. The other tablet's next poll sees it, plays it, and the server deletes
it on play with a hard TTL behind that.

* **Costs almost nothing new.** No signalling, no STUN, no TURN, no NAT traversal, no second
  server process. Bearer auth, the existing poll, the existing media table.
* **Latency does not matter**, because a walkie talkie is not a phone call. Press, talk, release,
  they hear it. That is the actual toy she described.
* **Works when the other tablet is asleep or off.** The clip waits. A live call cannot do that.
* **It briefly stores a kid's voice on the family's own box**, which is the honest cost. Mitigated
  by delete on play plus a short TTL (10 minutes, not 24 hours), the #282 pattern.
* **No video.** "See each other" is not served by this.

### B. Live WebRTC, audio plus a small video window

Peer to peer between the two tablets, with the server doing signalling only and never touching the
media.

* **This is the feature she asked for**, including the little corner view of her brother.
* **On the home LAN it needs no TURN server.** Both devices are on the same wifi, so host
  candidates connect directly, and refusing to work off the LAN is a **feature** rather than a
  limitation: a kid tablet at a friend's house should not be opening a media channel to the
  internet. STUN is not needed either for a same subnet connection.
* **Signalling is the real work**, and it runs straight into the bearer problem above. Options, in
  order of preference: a WebSocket that carries the token in its first frame (Bun and Hono both
  support this natively, and it keeps the token out of URLs); or a POST based long poll, which is
  uglier but adds no new transport. **Do not put a bearer in a query string to make `EventSource`
  work.** That decision is already written down and is right.
* **Media never touches the server**, so nothing is stored anywhere, which is a better privacy
  story than A once it works.
* Roughly a day of work for the signalling plus the call UI, plus the wrapper permission change,
  plus whatever the physical tablets teach us.

### C. A third party SDK (LiveKit, Daily, Jitsi, Twilio)

**Recommend against.** Two children's faces and voices would route through a vendor, which
contradicts the app's stated posture that kid media stays on the family's own server. It adds an
account, a key, a bill, and a dependency, to solve a problem that is one wifi hop wide.

## Recommendation

**Build A first, then B.** A is small, it is genuinely what "walkie talkie" means, and it can ship
to two real kids on two real tablets while B is still being designed. B is the version she drew,
and A does not have to be thrown away when it lands: press to talk stays useful when the other
tablet is off, which is most of the day.

Explicitly do **not** build both at once. The permission work, the roster routing, the parent
kill switch, the do not disturb and the call log are common to both and get proven once by A.

## The UI, roughly

* A walkie button in the kid app's corner control, always in the same place, never inside a menu.
* Tap it and you get **faces, not names**: the kid roster and the grown ups, drawn with the
  identicons and avatars the app already uses.
* Hold to talk. Release to send. That gesture is the whole interaction, and a five year old can do
  it without reading anything.
* Incoming: the caller's face slides in at the edge of the screen (on the quest map, at the edge
  of the trail), with accept and dismiss. Never a modal that covers what the kid is doing.
* Live video, when it exists, is a small corner window. Andjroo was explicit: not a split screen.

## Open questions

* **Does the walkie work during a locked routine window?** The lock exists to make a kid do their
  morning routine (`lock_windows`, `schema.sql:323`). Suggested answer: a grown up can always
  reach the tablet, kid to kid is off until the routine is approved. Andjroo's call.
* **Quiet hours.** Bedtime is the obvious one. `lock_windows` is the precedent for how a household
  expresses a time range, and reusing it beats inventing a second scheduler.
* **Does a call interrupt a running egg timer?** A timer is a commitment the kid made. Suggested:
  incoming calls queue, they do not ring, while a timer is running.
* **Ringing at all.** A walkie talkie that beeps in a quiet house at 6am is a problem the hardware
  cannot solve. Default to silent plus a visual, and let the parent turn sound on.
* **Grown up to grown up.** Two parents in one household could use the same channel. Out of scope
  for a first build, and the roster already supports it if it is ever wanted.
* **What happens off the LAN.** Suggested: it plainly says it only works at home, rather than
  failing in a way a kid has to interpret. This also keeps TURN out of the architecture, which is
  the piece that would otherwise drag in an external service.

## Hardware and ops, before any of this can be tested

1. Buy the second Galaxy Tab A11+ (SM-X230), **new, never used**: a used unit can carry Factory
   Reset Protection tied to a stranger's Google account, which hard blocks `dpm set-device-owner`
   with no workaround.
2. Provision device owner **before** adding any Google account, same order as the first tablet.
3. Ship the `kidkiosk-android` microphone change (manifest, policy pre grant,
   `onPermissionRequest`) and sideload it to **both** tablets.
4. Both tablets on the same wifi network and able to reach `192.168.1.42:3950`, with the mkcert
   CA installed on both.
5. Only then is any of the above testable. Everything before that point is emulator work, and the
   first tablet already taught us that the emulator is not One UI.
