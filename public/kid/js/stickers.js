// nimiq.kids kid app v3 — the sticker kit: die-cut sticker rendering, the picker
// sheet (collection grouped by pack + the camera tile for photo stickers), and
// THE placement interaction: the kid drags (or taps) the sticker into the slot;
// where and how it lands persists (x/y/tilt) — the chart is THEIR artifact.

import { celebrate } from "/js/lib/confetti.js";
import { stickerFace } from "/js/lib/box-glyphs.js";
import { saveLocalPhoto } from "/js/lib/local-photos.js";
import { api } from "./api.js";
import {
  state, $, esc, t, toast, openSheet, closeSheet, toJpeg, parentName,
  sheetHead,
  rowTitle,
} from "./util.js";
import { closeIcon, cameraIcon } from "./icons.js";

// ---------- rendering ----------
/** The round die-cut face.
 *
 *  Art stickers are generated PNGs in one house style (see src/sticker-catalog.ts);
 *  a photo sticker is the kid's own picture. The emoji is a fallback for a
 *  sticker whose art has not been generated yet.
 *
 *  Re-exported from the SHARED lib rather than defined here: the parent app's
 *  Treasure Box manager draws the same packs, and a second copy of this markup is
 *  how the two sides drifted apart in the first place (#34). */
export { stickerFace };

/** A PLACED sticker (chart cell / today slot): position + tilt from the placement. */
export function stickerNode(p, cls = "") {
  return `<span class="stk ${cls} stk-${p.state ?? "pending"}"
    style="--x:${p.xPct ?? 50}%;--y:${p.yPct ?? 50}%;--tilt:${p.tiltDeg ?? 0}deg">
    ${stickerFace(p)}<i class="stk-shine"></i></span>`;
}

// ---------- picker sheet ----------
/**
 * target: { kind: 'task'|'chore', id }  — slot element carries data-slot="task:<id>".
 * onPlaced(placement) fires after a successful drop (picker + layer torn down).
 */
export async function openStickerPicker(target, onPlaced) {
  const kid = state.child;
  if (!kid) return;
  const inv = await api.stickers(kid.id).catch(() => null);
  const stickers = inv?.stickers ?? state.chart?.stickers ?? [];
  const packTitles = new Map((inv?.packs ?? []).map((p) => [p.id, p.title]));

  // Group the collection by pack; photo stickers (packId null) live in "My photos",
  // which always exists because the camera tile lives there too.
  const groups = [];
  const groupFor = (key, title) => {
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, title, items: [] }; groups.push(g); }
    return g;
  };
  for (const s of stickers) {
    if (s.packId) groupFor(s.packId, packTitles.get(s.packId) ?? "").items.push(s);
    else groupFor("photos", t("app.kidMyPhotos")).items.push(s);
  }
  groupFor("photos", t("app.kidMyPhotos")); // camera tile home, even when empty

  // On a DEMO household the visitor approved this themselves, by tapping "Mom is here", and
  // the sticker sheet is where that approval pays off. So it is where the claim gets
  // qualified: a judge should leave knowing the grown-up step is real and that the demo let
  // them stand in for it, not thinking a kid can sign off their own allowance. `demo_at` is
  // the same gate the self-approve uses, so the note appears exactly where that shortcut does.
  openSheet(`
    ${sheetHead("app.kidPickSticker", state.family?.demo_at ? "app.kidDemoApprovedNote" : undefined)}
    <div class="stkp-groups">
      ${groups.map((g) => `
        <div class="stkp-group">
          <div class="stkp-hd">${esc(rowTitle(g))}</div>
          <div class="stkp-grid">
            ${g.items.map((s) => `
              <button class="stkp-tile" data-stk="${esc(s.id)}" aria-label="${esc(s.label)}">
                <span class="stk stk-flat">${stickerFace(s)}</span>
              </button>`).join("")}
            ${g.key === "photos" ? `
              <label class="stkp-tile stkp-camera" for="stkp-input" aria-label="${esc(t("app.kidPhotoSticker"))}">
                ${cameraIcon()}
              </label>` : ""}
          </div>
        </div>`).join("")}
    </div>
    <input type="file" accept="image/*" capture="environment" id="stkp-input" hidden />`);

  $("sheet-x").onclick = closeSheet;
  document.querySelectorAll("[data-stk]").forEach((b) => {
    b.onclick = () => {
      const sticker = stickers.find((s) => s.id === b.dataset.stk);
      if (!sticker) return;
      closeSheet();
      startPlacement(sticker, target, onPlaced);
    };
  });
  // The kid's own face, filed on the kid's own device (#282). The server is handed the
  // `local:<uuid>` handle and never the bytes, so the sticker row and its placement are all
  // it can know. A full disk throws out of saveLocalPhoto and must be SAID — a photo that
  // silently refuses to be taken is the #277 bug wearing a different hat.
  $("stkp-input").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ref = await saveLocalPhoto(kid.id, await toJpeg(file, 640)).catch(() => null);
    if (!ref) return toast(t("app.errGeneric"));
    const res = await api.photoSticker(kid.id, ref);
    if (!res.sticker) return toast(t("app.errGeneric"));
    closeSheet();
    startPlacement(res.sticker, target, onPlaced); // straight into placing their own face
  };
}

// ---------- Sticker Maker pre-pick ----------
/**
 * "What are you making?" — a quick mini-picker of the kid's collection before a
 * Sticker Maker timer starts. Resolves with the picked sticker, or null for the
 * mystery "?" tile / close / tap-outside (the machine then makes a mystery
 * sticker and the normal post-completion picker runs).
 */
export async function openStickerPrePick(onDone) {
  const kid = state.child;
  if (!kid) return onDone(null);
  const inv = await api.stickers(kid.id).catch(() => null);
  const stickers = inv?.stickers ?? state.chart?.stickers ?? [];

  let settled = false;
  const scrim = $("kid-scrim");
  const onScrim = (e) => { if (e.target === scrim) done(null); };
  const done = (sticker) => {
    if (settled) return;
    settled = true;
    scrim.removeEventListener("click", onScrim);
    closeSheet();
    onDone(sticker);
  };
  scrim.addEventListener("click", onScrim); // dismiss = mystery, never a dead promise

  openSheet(`
    ${sheetHead("app.kidMakerPick")}
    <div class="stkp-grid">
      <button class="stkp-tile stkp-mystery" id="stkp-mystery" aria-label="${esc(t("app.kidMakerMystery"))}">
        <span class="stk stk-flat"><span class="stk-fallback">?</span></span>
      </button>
      ${stickers.map((s) => `
        <button class="stkp-tile" data-stk="${esc(s.id)}" aria-label="${esc(s.label)}">
          <span class="stk stk-flat">${stickerFace(s)}</span>
        </button>`).join("")}
    </div>`);
  $("sheet-x").onclick = () => done(null);
  $("stkp-mystery").onclick = () => done(null);
  document.querySelectorAll("[data-stk]").forEach((b) => {
    b.onclick = () => done(stickers.find((s) => s.id === b.dataset.stk) ?? null);
  });
}

// ---------- placement interaction ----------
const slotFor = (target) => document.querySelector(`[data-slot="${target.kind}:${target.id}"]`);

/**
 * The sticker follows the finger (pointer events); releasing over the slot drops
 * it there — x/y within the slot and a tilt from the drag motion (fallback: a
 * small random tilt) persist. A tap on the slot places at the tap point.
 */
export function startPlacement(sticker, target, onPlaced) {
  const slot = slotFor(target);
  if (!slot) { placeAt(sticker, target, 50, 50, randTilt(), onPlaced); return; }
  slot.scrollIntoView({ block: "center" }); // instant, so the rect math below is true
  slot.classList.add("slot-target");

  const layer = document.createElement("div");
  layer.className = "place-layer";
  layer.innerHTML = `
    <div class="place-hint">${esc(t("app.kidPlaceSticker"))}</div>
    <button class="place-cancel" aria-label="close">${closeIcon()}</button>
    <span class="stk stk-ghost" id="stk-ghost">${stickerFace(sticker)}</span>`;
  document.body.appendChild(layer);
  const ghost = layer.querySelector("#stk-ghost");

  // Ghost starts hovering just above the slot so the kid sees what to move.
  const r0 = slot.getBoundingClientRect();
  let gx = r0.left + r0.width / 2;
  let gy = Math.max(60, r0.top - 60);
  let vx = 0;
  let lastX = gx;
  const paint = () => {
    ghost.style.left = `${gx}px`;
    ghost.style.top = `${gy}px`;
    ghost.style.setProperty("--tilt", `${Math.max(-12, Math.min(12, vx))}deg`);
  };
  paint();

  const cleanup = () => {
    slot.classList.remove("slot-target");
    layer.remove();
  };
  layer.querySelector(".place-cancel").onclick = cleanup;

  const move = (e) => {
    vx = vx * 0.6 + (e.clientX - lastX) * 0.8;
    lastX = e.clientX;
    gx = e.clientX; gy = e.clientY;
    paint();
  };
  layer.addEventListener("pointerdown", (e) => { layer.setPointerCapture(e.pointerId); move(e); });
  layer.addEventListener("pointermove", move); // the sticker follows finger AND mouse hover
  layer.addEventListener("pointerup", async (e) => {
    move(e);
    const r = slot.getBoundingClientRect();
    const pad = 14; // forgiving edges for small fingers
    const inside = e.clientX >= r.left - pad && e.clientX <= r.right + pad
      && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
    if (!inside) return; // keep trying — the ghost stays under the finger
    const xPct = Math.round(Math.max(12, Math.min(88, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10;
    const yPct = Math.round(Math.max(12, Math.min(88, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10;
    const tilt = Math.abs(vx) > 1.5 ? Math.max(-12, Math.min(12, vx)) : randTilt();
    cleanup();
    await placeAt(sticker, target, xPct, yPct, Math.round(tilt * 10) / 10, onPlaced);
  });
}

const randTilt = () => Math.round((Math.random() * 24 - 12) * 10) / 10;

async function placeAt(sticker, target, xPct, yPct, tiltDeg, onPlaced) {
  const body = { stickerId: sticker.id, xPct, yPct, tiltDeg };
  const place = {
    task: api.placeTaskSticker,
    practice: api.placePracticeSticker, // the subject is the SESSION, so every day of a streak can wear its own
  }[target.kind] ?? api.placeChoreSticker;
  const res = await place(target.id, body).catch(() => ({}));
  if (!res.placement) { toast(t("app.errGeneric")); return; }
  celebrate();
  toast(t("app.kidStickerDone"));
  onPlaced?.(res.placement);
}

/** Grey "try again" tap: explain in the parent's voice. */
export function explainRetry() {
  toast(t("app.kidTryAgain", { name: parentName() }));
}
