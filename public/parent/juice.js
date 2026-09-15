// nimiq.kids parent — the juice layer: tiny synthesized chimes + a haptic tap on
// the moments that matter (approve & pay, invite sent). Gesture-gated by
// construction: every call site is a click handler, so the AudioContext is
// always created or resumed inside a user gesture. Degrades to silence
// wherever Web Audio or vibration is missing (iOS WebViews have no
// navigator.vibrate). The mute switch lives in Settings and only on this
// phone (localStorage) — it is taste, not family state.

const STORE_KEY = "hatchParentJuice";

export function juiceEnabled() {
  try { return localStorage.getItem(STORE_KEY) !== "off"; } catch { return true; }
}

export function setJuiceEnabled(on) {
  try { on ? localStorage.removeItem(STORE_KEY) : localStorage.setItem(STORE_KEY, "off"); } catch { /* private mode */ }
}

let ctx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** One soft sine blip at `freq` Hz, `at` seconds from now. */
function blip(ac, freq, at, dur = 0.12) {
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// cue -> synth notes [freq, at, dur?] + vibration pattern (ms)
const CUES = {
  choreApproved: { notes: [[659.25, 0], [880, 0.09]], buzz: [15] }, // E5 -> A5, a nod
  payday: { notes: [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27, 0.22]], buzz: [10, 40, 20] }, // C major sweep up
  inviteSent: { notes: [[587.33, 0], [739.99, 0.1]], buzz: [10] }, // D5 -> F#5, a little wave
};

/** Fire-and-forget: play a cue if juice is on. Never throws. */
export function juice(name) {
  if (!juiceEnabled()) return;
  const cue = CUES[name];
  if (!cue) return;
  try {
    const ac = audio();
    if (ac) for (const [freq, at, dur] of cue.notes) blip(ac, freq, at, dur);
  } catch { /* no audio here — that's fine */ }
  try { navigator.vibrate?.(cue.buzz); } catch { /* no haptics here — that's fine */ }
}
