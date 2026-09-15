// nimiq.kids parent — formatting + registry-component builders (identicon, tx rows,
// address grid, QR). Amount/date formats follow the real wallet: NIM thin-space
// grouped, fiat via Intl, addresses uppercase Fira Mono.

export const LUNA = 100_000;

// One definition for both apps: /js/lib/esc.js. Re-exported so the ~40 call sites in
// this app keep importing `esc` from where they always have.
// Imported AND re-exported: a bare `export ... from` re-exports without binding the name
// in this module, and this file calls esc() itself. That mistake booted the parent app
// into a blank screen with a ReferenceError, so it is spelled out rather than shortened.
import { esc } from "../js/lib/esc.js";
export { esc };

/** NIM from luna: thin-space grouped integer part, up to 5 trimmed decimals. */
export function fmtNim(luna) {
  const n = Math.abs(luna) / LUNA;
  const [int, frac = ""] = n.toFixed(5).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** `12.3 NIM` with the wallet's small currency suffix markup. */
export const nimHtml = (luna) => `${fmtNim(luna)} <span class="currency nim">NIM</span>`;

/** Fiat like the real wallet: always 2 decimals; sub-cent non-zero shows "< $0.01". */
export function fmtFiat(luna, nimUsd, lang = "en") {
  const v = (Math.abs(luna) / LUNA) * nimUsd;
  const nf = new Intl.NumberFormat(lang, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  if (v > 0 && v < 0.005) return `< ${nf.format(0.01)}`;
  return nf.format(v);
}

export function timeAgo(ts, lang = "en") {
  const s = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(s) < 60) return rtf.format(Math.trunc(s / 10) * 10 || -0, "second");
  if (Math.abs(s) < 3600) return rtf.format(Math.trunc(s / 60), "minute");
  if (Math.abs(s) < 86400) return rtf.format(Math.trunc(s / 3600), "hour");
  return rtf.format(Math.trunc(s / 86400), "day");
}

export const timeHM = (ts, lang = "en") =>
  new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(ts);

export const monthName = (ts, lang = "en") =>
  new Intl.DateTimeFormat(lang, { month: "long" }).format(ts);

export const fmtElapsed = (s) => (s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`);

/** Space a raw NQ address into its 9 four-char blocks. */
export const spacedAddress = (addr) => addr.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();

// ---- identicons (registry recipe: pinned @nimiq/iqons + team-shipped sprite) ----

const PLACEHOLDER = `data:image/svg+xml,<svg width="64" height="64" viewBox="0 -4 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity=".1" d="M62.3 25.4L49.2 2.6A5.3 5.3 0 0 0 44.6 0H18.4c-1.9 0-3.6 1-4.6 2.6L.7 25.4c-1 1.6-1 3.6 0 5.2l13.1 22.8c1 1.6 2.7 2.6 4.6 2.6h26.2c1.9 0 3.6-1 4.6-2.6l13-22.8c1-1.6 1-3.6.1-5.2z" fill="url(%23identicon_radial)"/><defs><radialGradient id="identicon_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(-63.0033 0 0 -56 63 56)"><stop stop-color="%23260133"/><stop offset="1" stop-color="%231F2348"/></radialGradient></defs></svg>`;

/** Identicon markup (hexagon placeholder until hydrateIdenticons swaps it). */
export function identicon(address, cls = "") {
  const attr = address ? ` data-address="${esc(spacedAddress(address))}"` : "";
  return `<div class="identicon ${cls}"${attr}><img src='${PLACEHOLDER}' alt=""></div>`;
}

let iqonsP = null;
function loadIqons() {
  if (!iqonsP) {
    iqonsP = import("/vendor/nqp/iqons.min.js").then(({ default: Iqons }) => {
      Iqons.svgPath = "/vendor/nqp/nimiq/assets/img/iqons.min.svg";
      return Iqons;
    });
  }
  return iqonsP;
}

/** Swap every placeholder under `root` for the real generated iqon. */
export async function hydrateIdenticons(root) {
  const els = root.querySelectorAll(".identicon[data-address]");
  if (els.length === 0) return;
  try {
    const Iqons = await loadIqons();
    for (const el of els) {
      const img = el.querySelector("img");
      if (img && !img.dataset.iqon) {
        img.dataset.iqon = "1";
        img.src = await Iqons.toDataUrl(el.dataset.address);
      }
    }
  } catch { /* placeholder hexagons remain — acceptable offline state */ }
}

// ---- address display (registry 3x3 grid markup) ----

export function addressGrid(addr) {
  const chunks = spacedAddress(addr).split(" ");
  return `<div class="address-display format-nimiq">${chunks
    .map((c) => `<span class="chunk">${esc(c)}<span class="space">&nbsp;</span></span>`)
    .join("")}</div>`;
}

// ---- QR (registry recipe: qr-creator pinned 1.0.0 + the Nimiq gradient fill) ----

const NIMIQ_QR_FILL = {
  type: "radial-gradient",
  position: [1, 1, 0, 1, 1, Math.sqrt(2)],
  colorStops: [[0, "#265DD7"], [1, "#0582CA"]],
};

export function renderQr(canvas, text, size = 400) {
  if (typeof QrCreator === "undefined") return;
  QrCreator.render({ text, radius: 0.5, ecLevel: "M", fill: NIMIQ_QR_FILL, background: null, size }, canvas);
}

// ---- transaction rows (registry transaction-list markup) ----

/** One wallet event -> a registry transaction-list row. Chrome icons for the
 *  counterparties that have no address (staking, cashlinks, deposits). */
export function txRow(e, { nimUsd, lang, icon, explorerTx }) {
  const d = new Date(e.createdAt);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = new Intl.DateTimeFormat(lang, { month: "short" }).format(d);
  const incoming = e.valueLuna > 0;
  const pending = e.status === "pending";
  let lead;
  if (e.counterpartyAddress) {
    lead = identicon(e.counterpartyAddress);
  } else if (e.kind === "stake" || e.kind === "unstake" || e.kind === "reward") {
    lead = `<div class="icon-tile green">${STAKING_ICON}</div>`;
  } else if (e.kind === "earn") {
    lead = `<div class="icon-tile gold">${FAMILY_HEX(`tx-hex-${e.id ?? Math.abs(e.createdAt)}`)}</div>`;
  } else if (e.kind === "deposit") {
    lead = `<div class="icon-tile">${icon("arrow-to-bottom", 18)}</div>`;
  } else {
    lead = `<div class="icon-tile">${icon("arrow-from-bottom", 18)}</div>`;
  }
  const msg = e.message && e.message !== e.counterpartyLabel
    ? `<span class="dot">&middot;</span><span class="message">${esc(e.message)}</span>` : "";
  // A row links to its own transaction on the public block explorer — the receipt for
  // money that moved. PENDING rows link too, deliberately: a payout is written pending
  // until the chain is seen to agree, but the hash is already broadcast and the explorer
  // is the authority on what became of it. Excluding them would mean a freshly minted
  // family shows no receipts at all, which is exactly when someone wants to check.
  // `failed` is the one state with nothing to show, and SIM hashes are invented.
  const receipt = e.status !== "failed" && e.txHash && explorerTx ? e.txHash : "";
  return `<button class="transaction ${pending ? "pending" : "confirmed"}${receipt ? " has-receipt" : ""}"
    tabindex="${receipt ? "0" : "-1"}"${receipt ? ` data-tx="${esc(receipt)}"` : ""}>
    <div class="date"><span class="day">${day}</span><br><span class="month">${esc(mon)}</span></div>
    ${lead}
    <div class="data">
      <div class="label">${esc(e.counterpartyLabel ?? "")}</div>
      <div class="time-and-message"><span>${timeHM(e.createdAt, lang)}</span>${msg}</div>
    </div>
    <div class="amounts${incoming ? " isIncoming" : ""}">
      <span class="amount">${nimHtml(e.valueLuna)}</span>
      <span class="fiat-amount">${fmtFiat(e.valueLuna, nimUsd, lang)}</span>
    </div>
  </button>`;
}

/** Events -> month-labelled registry list. The current month reads "This month"
 *  (opts.thisMonth, localized), exactly like the real wallet. */
export function txList(events, opts) {
  if (events.length === 0) return "";
  const currentMonth = monthName(Date.now(), opts.lang);
  let lastMonth = "";
  const parts = ['<div class="transaction-list">'];
  for (const e of events) {
    const m = monthName(e.createdAt, opts.lang);
    if (m !== lastMonth) {
      lastMonth = m;
      const label = m === currentMonth && opts.thisMonth ? opts.thisMonth : m;
      parts.push(`<div class="month-label"><label>${esc(label)}</label></div>`);
    }
    parts.push(txRow(e, opts));
  }
  parts.push("</div>");
  return parts.join("");
}

/** The gold brand hexagon as a tx-lead tile (payouts from the family wallet).
 *  Gradient id must be unique per use (rule: never reuse gradient ids on a page). */
export const FAMILY_HEX = (gid) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18" role="img" aria-hidden="true"><g fill="none"><path fill="url(#${gid})" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688"/><defs><radialGradient id="${gid}" cx="0" cy="0" r="1" gradientTransform="matrix(20.1956 0 0 20.2552 15.188 17.766)" gradientUnits="userSpaceOnUse"><stop stop-color="#ec991c"/><stop offset="1" stop-color="#e9b213"/></radialGradient></defs></g></svg>`;

/** The wallet's staking icon — VERBATIM from the registry account-header
 *  (StakingIcon.vue, gradients=false pill mode). */
export const STAKING_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" class="nq-icon staking-icon">
  <path opacity=".6" fill="none" stroke="currentColor" stroke-width="3.02" d="M70 22h0a48 48 0 0148 48v0a48 48 0 01-48 48h0a48 48 0 01-48-48v0a48 48 0 0148-48z"/>
  <path opacity=".4" fill="none" stroke="currentColor" stroke-width="3.02" d="M70 12h0a58 58 0 0158 58h0a58 58 0 01-58 58h0a58 58 0 01-58-58h0a58 58 0 0158-58z" />
  <path d="M70 28.23a41.76 41.76 0 110 83.52 41.76 41.76 0 110-83.52z" fill="none"/>
  <path d="M70.71 69.1v21.56m18.71-26.11c0 12.4-6.31 18.89-18.71 18.89 0-17.56 5.28-18.89 18.71-18.89zM54.18 53.98c0 13.33 4.13 20.07 16.53 20.07 0-13.43-1.03-20.07-16.53-20.07z" fill="none" stroke="currentColor" stroke-width="4.0316" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
