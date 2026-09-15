// nimiq.kids kid app — SCAN. The wallet's third bottom-bar control: point the
// camera at a code.
//
// A code resolves to one of exactly two things, and the difference matters:
//
//   a Cashlink  -> money IN. Claimed on the spot, because claiming a link that
//                  was handed to you takes nothing out of the kid's wallet.
//   an address  -> money OUT. Goes to the amount pad and then into the SAME
//                  parent approval queue a Cashlink send uses. Never a
//                  straight-to-send path. Send's typed address grid takes this
//                  exact road for the same reason: a destination outside the
//                  family always waits for a grown-up, however it arrived.
//
// Decoding prefers the platform's own BarcodeDetector (Chrome/Android, zero
// bytes) and only pulls the vendored jsQR down when there isn't one, so the
// 130KB never loads on a device that doesn't need it.

import { state, $, esc, t, setScreen, bgFor, toast } from "./util.js";
import { api } from "./api.js";
import { arrowIcon } from "./icons.js";
import { refreshWallet } from "./data.js";
import { showMoney } from "./money.js";
import { showAmountScreen } from "./pad.js";

let stream = null;
let raf = 0;
let detector = null;
let jsQR = null;

/** A NIM address is 'NQ' + 34 base32. Mirrors the server's guard, so a bad code
 *  is rejected at the camera rather than travelling to a parent. */
export function readCode(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/cashlink/i.test(text) || text.includes("#")) return { kind: "cashlink", value: text };
  const bare = text.replace(/^nimiq:/i, "").replace(/\s+/g, "").toUpperCase();
  if (/^NQ[0-9A-Z]{34}$/.test(bare)) {
    return { kind: "address", value: bare.replace(/(.{4})(?=.)/g, "$1 ") };
  }
  return null;
}

export function stopScan() {
  cancelAnimationFrame(raf); raf = 0;
  if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; }
}

async function decoderFor(canvas) {
  if ("BarcodeDetector" in window) {
    detector ??= new window.BarcodeDetector({ formats: ["qr_code"] });
    return async () => (await detector.detect(canvas))[0]?.rawValue ?? null;
  }
  jsQR ??= (await import("/vendor/jsqr.min.js")).default;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async () => {
    const { width, height } = canvas;
    if (!width || !height) return null;
    const img = ctx.getImageData(0, 0, width, height);
    return jsQR(img.data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

export async function showScan() {
  const bg = bgFor();
  // This screen keeps the kid's scene on purpose (Andjroo, 2026-07-31): the
  // wallet's scanner is a full-screen dark room, and going that way lost the
  // background the kid chose, which is the thing they own on every other screen.
  //
  // The legibility complaint that came with it is fixed differently. The stage
  // used to be rgba(31,35,72,0.9), so the candy artwork read straight THROUGH
  // the camera area and there was nothing solid to aim at. It is opaque now, and
  // the aiming marks are the wallet's four corner brackets rather than a big
  // faint QR glyph -- brackets frame where the code goes instead of competing
  // with it. Reference: shots/wallet-ref/scanner.png.
  setScreen(`
    <div class="k-scan">
      <button class="back-btn" id="scan-back">${arrowIcon("left")}</button>
      <h1 class="k-page-title">${esc(t("app.kidScanTitle"))}</h1>
      <div class="k-scan-stage">
        <video id="scan-video" playsinline muted></video>
        <div class="k-scan-frame" aria-hidden="true">
          <i class="k-scan-corner tl"></i><i class="k-scan-corner tr"></i>
          <i class="k-scan-corner bl"></i><i class="k-scan-corner br"></i>
        </div>
      </div>
      <p class="k-scan-hint" id="scan-hint">${esc(t("app.kidScanHint"))}</p>
    </div>`, "k-screen scan-screen", bg);

  $("scan-back").onclick = () => { stopScan(); showMoney(); };

  const video = $("scan-video");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
  } catch {
    // No camera, or the kid said no. Say so plainly rather than leaving a dead screen.
    $("scan-hint").textContent = t("app.kidScanNoCamera");
    return;
  }

  const read = await decoderFor(canvas);
  const tick = async () => {
    if (!stream || !document.querySelector(".k-scan")) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let raw = null;
      try { raw = await read(); } catch { /* a bad frame is not an error */ }
      const code = raw ? readCode(raw) : null;
      if (code) { stopScan(); return resolve(code); }
    }
    raf = requestAnimationFrame(() => { void tick(); });
  };
  void tick();
}

/** What a decoded code does. Money in settles now; money out asks a grown-up. */
async function resolve(code) {
  if (code.kind === "cashlink") {
    const res = await api.claimCashlink(code.value).catch(() => ({ error: "network" }));
    if (res?.error) { toast(t("app.kidScanNoLuck")); return showScan(); }
    await refreshWallet();
    toast(t("app.kidScanClaimed"));
    return showMoney();
  }

  showAmountScreen({
    title: t("app.kidSend"),
    cta: t("app.kidSendIt"),
    maxLuna: state.wallet?.balanceLuna ?? 0,
    onBack: showMoney,
    onConfirm: async (valueLuna) => {
      const res = await api.sendScanned(state.child.id, code.value, valueLuna)
        .catch(() => ({ error: "network" }));
      if (res?.error) {
        toast(res.error === "insufficient_funds" ? t("app.kidNotEnough") : t("app.errGeneric"));
        return showMoney();
      }
      await refreshWallet();
      toast(t("app.kidScanAsked"));
      showMoney();
    },
  });
}
