// The battery, in the kid's own corner (2026-09-02).
//
// The kiosk kills the status bar (DevicePolicyHelper.setStatusBarDisabled), which is right --
// a kid has no business in the notification shade -- but it took the battery icon with it,
// and "is it about to die" is a thing a kid, and a parent walking past, both need to see
// without switching to the parent app. So the app draws its own, in the fixed corner slot
// the language pill left empty (css/chrome.css), on every screen including the lock screen.
//
// Read straight off the tablet with the Battery Status API: no server, no wrapper, no poll.
// The wrapper's own report (KIOSK-CONTRACT §11) is for the PARENT's phone; this is the tablet
// looking at itself. A browser without the API (desktop Safari, Firefox) never shows the
// pill: the mount is removed, not left as an empty white box.

import { $, t } from "./util.js";

/** What the face draws, from what the API said. Pure, so it is testable without a battery. */
export function batteryFace(level, charging) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(level) || 0) * 100)));
  return {
    pct,
    charging: !!charging,
    // Under 15% and not on the charger, the whole pill turns red: a number alone is easy to
    // not-read, and this is the one state where being noticed is the point.
    low: pct <= 15 && !charging,
    label: t(charging ? "app.kidBatteryCharging" : "app.kidBattery", { pct }),
  };
}

const BOLT = `<path class="kb-bolt" d="M13 3.4 7.6 12.8h3.8L10.4 20.6l5.6-9.6h-3.8z"/>`;

/** The glyph: a horizontal cell whose fill IS the level, and a bolt while charging. Drawn
 *  here rather than added to the icon set for the lock screen's reason: it is not a thing a
 *  parent should be able to pick for a Treasure Box shelf. */
export function batteryHtml(face) {
  const inner = Math.round((16 * face.pct) / 100); // fill width inside the 16-wide cell
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect class="kb-cell" x="2" y="7" width="18" height="10" rx="2.4"/>
    <rect class="kb-cap" x="20.6" y="10" width="1.8" height="4" rx="0.8"/>
    <rect class="kb-fill" x="3" y="8" width="${inner}" height="8" rx="1.6"/>
    ${face.charging ? BOLT : ""}
  </svg><span class="kb-pct">${face.pct}%</span>`;
}

function paint(mount, battery) {
  const face = batteryFace(battery.level, battery.charging);
  mount.innerHTML = batteryHtml(face);
  mount.setAttribute("aria-label", face.label);
  mount.title = face.label;
  mount.classList.toggle("is-low", face.low);
  mount.classList.toggle("is-charging", face.charging);
  mount.hidden = false;
}

let repaint = null;

/** Mount once at boot. `nav` is injectable so the tests can hand it a battery. Resolves to
 *  whether a pill is on screen. */
export async function mountBattery(nav = navigator) {
  const mount = $("kid-batt");
  if (!mount) return false;
  let battery;
  try {
    if (typeof nav.getBattery !== "function") throw new Error("no Battery API");
    battery = await nav.getBattery();
  } catch {
    mount.remove();
    return false;
  }
  repaint = () => paint(mount, battery);
  repaint();
  battery.addEventListener("levelchange", repaint);
  battery.addEventListener("chargingchange", repaint);
  return true;
}

/** The label is translated, so a language change repaints it (main.js onLangReady). */
export function repaintBattery() { repaint?.(); }
