// The switch gate on the kid surface (#123): what a kid taps to become themselves.
//
// The rule this screen exists for is in src/kid-switch.ts. What matters HERE is that the
// client holds no copy of it: `selectChild` always calls unlock, and the server answers
// whether that cost anything. A kid with no secret is enrolled by this screen; a kid with
// one proves it; a kid who forgot gets a grown up, who has the family PIN.
//
// Nothing here is readable. A four-year-old is the user, so the instruction is a picture
// count and the feedback is the pictures lighting up. The only text that must be understood
// is on the grown-up escape hatch, and by then a grown up is holding the tablet.

import { api } from "./api.js";
import { esc, t, setScreen, toast } from "./util.js";

let cache = null;

async function pictures() {
  if (!cache) cache = await api.switchPictures().catch(() => ({ pictures: [], taps: 2 }));
  return cache;
}

// Drawn art, with the emoji carried alongside it as the fallback (`data-emoji`). A picture
// that fails to load costs a picture, not a login. The emoji is also what a grown up says out
// loud ("the rocket, then the frog"), which is why it stays in the markup either way.
//
// The swap is bound in JS, NOT an inline `onerror`. script-src still carries 'unsafe-inline'
// for the server-rendered pages, but security-headers.ts states removing it as the intent, and
// a new inline handler here would be one more thing to migrate first.
const grid = (pics) => `
  <div class="k-secret-grid">
    ${pics.map((p, i) => `
      <button type="button" class="k-secret-pic" data-i="${i}" aria-label="${esc(String(i + 1))}">
        <span class="k-secret-face" aria-hidden="true" data-emoji="${esc(p.emoji)}">${p.url
          ? `<img src="${esc(p.url)}" alt="" draggable="false">`
          : esc(p.emoji)}</span>
      </button>`).join("")}
  </div>`;

/** Fall a face back to its emoji. Also covers the image that failed BEFORE this ran:
 *  a decoded-but-broken img reports complete with naturalWidth 0. */
function bindFaceFallback() {
  document.querySelectorAll(".k-secret-face img").forEach((img) => {
    const toEmoji = () => { img.closest(".k-secret-face").textContent = img.closest(".k-secret-face").dataset.emoji; };
    img.addEventListener("error", toEmoji, { once: true });
    if (img.complete && img.naturalWidth === 0) toEmoji();
  });
}

const dots = (taps, filled) => `
  <div class="k-secret-dots" aria-hidden="true">
    ${Array.from({ length: taps }, (_, i) => `<i class="${i < filled ? "on" : ""}"></i>`).join("")}
  </div>`;

/**
 * Ask this kid for their pictures (or set them up), then hand back control.
 *
 * `onDone` runs only after the SERVER has said this tablet may act as this kid, never on
 * the strength of the taps alone — the gate is the 403 in childMoneyGate, and this screen
 * is its front door, not its lock.
 */
export function showSwitchGate(child, onDone, onCancel) {
  let picked = [];
  let first = null;       // enrolment: the first pass, waiting to be confirmed
  const enrolling = !child.hasSecret;

  /**
   * ⚠️ THE KID'S NAME IS THE HEADING, AND THE INSTRUCTION IS ONE LINE (Andjroo, 2026-09-01:
   * "'Tap the same 2 pictures again, Sam' is way too confusing for a little kid. It should
   * just say the kid's name, Sam. Tap 2 pictures.").
   *
   * What was here read as three competing sentences to a four-year-old: a title that was
   * itself an instruction, the name under it as a subtitle, and then a SECOND instruction
   * that said the same thing plus an explanation ("You will tap the same ones to open your
   * app") that a four-year-old cannot act on. Now it is: who this is for, then what to do.
   */
  const render = async (message = "") => {
    const { pictures: pics, taps } = await pictures();
    const sub = enrolling
      ? (first ? t("app.switchConfirmSub", { taps }) : t("app.switchPickSub", { taps }))
      : t("app.switchAskSub", { taps });
    setScreen(`
      <div class="k-connect k-secret">
        <div class="small-page nq-card k-connect-card">
          <div class="page-header nq-card-header">
            <h1 class="nq-h1">${esc(child.label)}</h1>
          </div>
          <div class="page-body nq-card-body">
            <p class="k-secret-sub">${esc(sub)}</p>
            ${dots(taps, picked.length)}
            ${grid(pics)}
            ${message ? `<p class="k-secret-msg" role="alert">${esc(message)}</p>` : ""}
            <!-- ⚠️ TWO DIFFERENT ESCAPES, because the two screens are two different problems.
                 Setting up, the kid IS the grown-up's job here, so "Ask a grown up" is a
                 sentence that does not apply (Andjroo: "I don't understand why it says ask a
                 grown up because the kid's doing the setup"). What CAN go wrong on that screen
                 is landing on the wrong name, so the way out is back to the roster. Signing in,
                 the failure is a forgotten picture, and the family PIN is the answer to that. -->
            <button type="button" class="nq-button-s k-secret-grown" id="sg-grown">
              ${esc(enrolling ? t("app.switchNotMe") : t("app.switchGrownUp"))}
            </button>
          </div>
        </div>
      </div>`, "k-screen k-connect-screen");

    bindFaceFallback();
    document.querySelectorAll(".k-secret-pic").forEach((b) => {
      b.onclick = () => tap(Number(b.dataset.i), taps);
    });
    document.getElementById("sg-grown").onclick = () => (enrolling ? onCancel?.() : askGrownUp());
    const back = document.getElementById("sg-back");
    if (back) back.onclick = () => onCancel?.();
  };

  const tap = async (i, taps) => {
    picked.push(i);
    if (picked.length < taps) return render();
    const secret = picked.join("-");
    picked = [];

    if (enrolling) {
      if (!first) { first = secret; return render(); }
      if (first !== secret) { first = null; return render(t("app.switchMismatch")); }
      const saved = await api.setSwitchSecret(child.id, { secret })
        .catch(() => ({ status: 0, body: {} }));
      if (saved.body?.ok) return onDone();
      first = null;
      // "Not those ones. Try again." is a lie for anything that is not about the pictures, and
      // the child cannot act on it: they tapped the same two, and they will tap them again,
      // forever. 401 is an unpaired tablet, 429 is the guessing brake, and both are a grown-up's
      // problem. Only a real refusal from the server gets the pictures blamed.
      if (saved.status === 401) return render(t("app.switchNotPaired"));
      if (saved.status === 429) return render(t("app.switchTooMany"));
      return render(t("app.switchWrong"));
    }

    const { status, body } = await api.unlockKid(child.id, { secret });
    if (status === 200 && body.ok) return onDone();
    return render(t(status === 429 ? "app.switchTooMany" : "app.switchWrong"));
  };

  // The grown-up route is the family PIN, which is the same override the rest of the
  // tablet already uses. A kid who forgot their pictures is not locked out of their money,
  // they are one adult away from it.
  const askGrownUp = async () => {
    const pin = window.prompt(t("app.switchPinPrompt"));
    if (pin === null) return;
    const { status, body } = await api.unlockKid(child.id, { pin });
    if (status === 200 && body.ok) return onDone();
    toast(t("app.switchPinBad"));
    if (status === 423) return;
  };

  render();
}

/** True when tapping this face should cost something. */
export const isGated = (child) => !!child?.hasSecret;
