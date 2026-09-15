// Turning a parent's phone on, in one tap (#124).
//
// The only way to get notifications was to find Settings and paste an ntfy topic URL into a
// bare `type="url"` box. Nothing in onboarding did it, so for most families every
// notifyParent() call on the server was a no-op: a kid finished a chore, the server built a
// good message with a deep link to that exact approval, and dropped it. The loop's latency
// became "whenever the parent next remembers to open the app", which by week two is not
// daily.
//
// Two rules shaped this module:
//
// 1. THE PARENT NEVER TYPES A TOPIC. The server mints one with 192 bits of entropy. A topic
//    URL is a bearer secret on a public server, and a parent asked to invent one writes
//    "smith-family-chores".
// 2. THE RAW FIELD STAYS, demoted. A webhook that is not ntfy is a real use (the GHL sidecar
//    in notify.ts's own header is one), and removing the escape hatch to simplify the happy
//    path would take that away.
//
// Shared by Settings and by the last step of onboarding so the two cannot drift; the offer a
// parent sees on day one is the same one they come back to.

import { t, call, toast } from "./core.js";
import { esc, renderQr } from "./fmt.js";

/** The phone app's own scheme. ntfy registers `ntfy://<host>/<topic>`, which opens the app
 *  straight onto the subscribe sheet — one tap on the phone that is already reading this
 *  page, so the QR is for the OTHER phone rather than the only way in. */
export const ntfyDeepLink = (url) => url.replace(/^https?:\/\//, "ntfy://");

/**
 * The card, in whichever of its two states applies.
 *
 * `notifyUrl` null is the off state and gets one button. Anything else is on, and shows the
 * QR, the deep link and a test, because "is it actually working" is the only question a
 * parent has once they have tapped.
 */
export function notifySetupHtml(notifyUrl, { compact = false } = {}) {
  if (!notifyUrl) {
    return `<div class="set-hint">${t("papp.pingsOffSub")}</div>
      <button class="pill-btn blue ${compact ? "wide" : ""}" id="nt-on">${t("papp.pingsTurnOn")}</button>`;
  }
  return `<div class="set-hint">${t("papp.pingsOnSub")}</div>
    <div class="nt-qr"><canvas id="nt-qr" width="200" height="200"></canvas></div>
    <div class="btn-row">
      <a class="pill-btn blue" id="nt-open" href="${esc(ntfyDeepLink(notifyUrl))}">${t("papp.pingsOpenApp")}</a>
      <button class="pill-btn ghost" id="nt-test">${t("papp.sendTest")}</button>
    </div>`;
}

/** Draw the QR and wire the two buttons. `onArmed` is called with the new URL after the
 *  server mints one, so the host view can re-render itself however it re-renders. */
export function wireNotifySetup(root, notifyUrl, { onArmed } = {}) {
  const canvas = root.querySelector("#nt-qr");
  // The QR encodes the https URL, not the ntfy:// one: a camera app that does not know the
  // scheme shows a dead link, and the https form opens ntfy's web subscribe page instead,
  // which is a working answer on any phone.
  if (canvas && notifyUrl) renderQr(canvas, notifyUrl, 200);

  root.querySelector("#nt-on")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    // EVERY GROWN-UP GETS THEIR OWN TOPIC, not the household's. A household holds more than
    // one phone now, and `/api/parent/notify-topic` mints the household's single topic — which
    // is the owner's, and which only the owner may mint. Pointing this button at it left a
    // grandparent tapping "Turn on pings" and getting a 403 for the one thing the whole
    // feature depends on: that she hears about a job without anyone handing her a tablet.
    //
    // The household topic is not retired. `notifyParent` still sends to it for an owner who
    // has no topic of their own, so a family running since before members existed keeps the
    // subscription already on their phone.
    const r = await call("POST", "/api/family/members/me/notify-topic", {}).catch(() => null);
    if (!r || (r.status !== 201 && r.status !== 200)) {
      toast(t("papp.didntGoThrough"), "error");
      e.target.disabled = false;
      return;
    }
    onArmed?.(r.data.notifyUrl);
  });

  // Straight from the phone to ntfy, no server hop: it proves the path the notifications
  // will actually take, which a server-side send would not.
  root.querySelector("#nt-test")?.addEventListener("click", async () => {
    try {
      const r = await fetch(notifyUrl, {
        method: "POST", body: t("papp.pingsTestBody"), headers: { "X-Title": "NIMIQ.kids" },
      });
      toast(r.ok ? t("papp.testSent") : t("papp.badLink"), r.ok ? "success" : "error");
    } catch { toast(t("papp.didntGoThrough"), "error"); }
  });
}
