// nimiq.kids — browser entry for the shared nimiq-app-shell.
//
// This bundles (bun build --target browser) to public/dist/app-shell.js and runs
// BEFORE public/js/app.js. Its three jobs mirror the nimiq.life reference:
//
//   1. Boot the shell i18n (shell strings + our app.* strings), resolving the
//      visitor's language once (?lang= / Nimiq Pay / storage / browser). This is
//      the nimiq.life handoff: open ?lang=es and the app boots in Spanish.
//   2. Boot the dual-mode wallet. Inside Nimiq Pay (window.nimiqPay present)
//      the user is already IN their wallet, so there is no connect button —
//      the account resolves eagerly and flows read wallet.account. On
//      standalone web the fleet-standard wallet pill (outline connect →
//      compact connected pill) owns both states.
//   3. Mount the fleet-standard language pill (flag + dropdown) and re-render
//      on language change.
//
// It exposes a tiny `window.nimiqKidsShell` bridge so the existing, separately
// loaded public/js/app.js (a plain ES module, not part of this bundle) can call
// t() for its user-visible strings and re-render when the language flips —
// without app.js having to import TS.
//
// SETTLEMENT / PAYMENT BEHAVIOUR IS UNCHANGED. The parent funding wallet and
// cashlink minting stay server-side (DevProvider/SimProvider + /api/*). The
// shell wallet here is additive: it satisfies "every app runs as a Nimiq Pay
// mini-app" by giving the parent a real in-wallet connect + profile, and it does
// NOT route any chore/gift payout. Reads (balance) are intentionally not wired —
// the profile shows the connected address only (shell does no chain reads).

import {
  createWallet,
  createI18n,
  shellLocales,
  mergeLocales,
  mountCornerControl,
  fmtFiat,
  SHELL_LANGUAGES,
  type I18n,
  type Wallet,
} from "nimiq-app-shell";
import { appLocales } from "./locales";

// ---- reference currency -----------------------------------------------------
//
// The corner's "Show amounts in" grid, offering exactly the tickers /api/rates
// returns. app-shell v0.6.0 decoupled that grid from having a connected wallet,
// which is what makes it reachable here at all: the kid app authenticates by
// device pairing and mounts the corner with no wallet.
//
// The kid app prices its own screens off this, so the ticker and the price feed
// both go over the bridge. Formatting is the shell's fmtFiat, not a local dollar
// formatter — symbol, placement and decimal separator all differ per currency
// and per language, and 14 of them is not something to hand-roll.
const CURRENCIES = ["USD", "EUR", "GBP", "MXN", "BRL", "CNY", "INR",
  "JPY", "CHF", "CAD", "AUD", "KRW", "TRY", "VND"];

let rateCache: Record<string, number> | null = null;
async function nimRates(): Promise<Record<string, number>> {
  if (rateCache) return rateCache;
  try {
    const r = await fetch("/api/rates").then((res) => res.json()) as { nim?: Record<string, number> };
    rateCache = r.nim ?? {};
  } catch { rateCache = {}; }
  return rateCache;
}

let currency = "USD";
const currencyListeners = new Set<(ticker: string) => void>();

const i18n: I18n = createI18n({
  locales: mergeLocales(shellLocales, appLocales),
  fallback: "en",
});

const wallet: Wallet = createWallet({ appName: "nimiq.kids" });

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

// ---- header corner ----------------------------------------------------------
//
// EVERY page gets the fleet's one-button corner control, so no surface visibly
// lags the others (that mismatch is what #84 was). What differs is whether a
// wallet is passed:
//
//   • #wallet-slot pages (the demo page) pass the wallet → wallet state on the
//     face, everything else one click away in the menu. Inside Nimiq Pay the
//     face collapses to the flag (the host wallet IS the context) and the
//     account resolves eagerly so views can read wallet.account.
//   • #lang pages (the kid app, the portal chooser) have no wallet concept at
//     all — they authenticate by device pairing — so they pass NO wallet and
//     get the corner's language-only presentation (app-shell v0.5.0). This
//     replaces the old language pill, which did NOT match the corner face
//     despite a comment here claiming it did.
//
// Languages pinned to the 5 this app actually translates (the fleet default is
// 11 — the extra 6 would fall back to English for every app.* string here).

if (wallet.mode === "miniapp") {
  wallet.connect().catch(() => {});
}
const cornerSlot = $("#wallet-slot");
const langSlot = $("#lang");
const slot = cornerSlot ?? langSlot;

// ---- what the bug reporter says about this page ----------------------------
//
// Which surface a report came from is the single most useful field in it, and
// this bundle serves three of them. Read it off the path rather than off which
// slot was found: the slot says whether there is a wallet, not what screen a
// person is looking at, and a kid-app report filed as "demo" sends triage to
// the wrong instance.
//
// The object is MUTATED when /health answers below, and the sheet reads it at
// send time, so a report carries the running version rather than "unknown".
//
// Nothing in THIS object identifies a child: no name, no address, no family id.
// That was once written here as though it described the whole payload, and it
// does not — see the `diagnostics` note below, which is what that claim was
// actually missing. Keep it true of this object, and keep it distinct from the
// question of what the sheet attaches around it.
const reportContext = {
  surface: location.pathname.startsWith("/kid") ? "kid"
    : location.pathname.startsWith("/portal") ? "portal"
    : "demo",
  version: "unknown",
};

if (slot) {
  const corner = mountCornerControl(slot, {
    // wallet-less pages get the language-only corner
    ...(cornerSlot ? { wallet } : {}),
    i18n,
    languages: SHELL_LANGUAGES,
    reportBug: {
      bot: { repo: "nimiq.kids", labels: [`surface:${reportContext.surface}`] },
      context: reportContext,
      // DIAGNOSTICS BACK ON, because the shell now scrubs (#140, shell v0.9.2).
      //
      // They were off for exactly one reason. Nearly every call this app makes is
      // addressed by CHILD UUID (/api/kids/<id>/chart, /api/kids/<id>/buy,
      // /api/media?childId=<id>), the kiosk wrapper can put one in the page URL itself,
      // and this path has no server of ours in it: browser -> bot.nimiq.tech -> an
      // LLM-written issue on the PUBLIC repo. A kid tapping Buy on a pack she already
      // owned (400 already_owned) put her UUID where anyone can read it.
      //
      // The shell's only redaction was one regex for NQ-address shapes. v0.9.2 added the
      // other two clauses: `scrubAddresses` now also redacts any 8-4-4-4-12 hex UUID as
      // "[id redacted]", and `pageContext` cuts `url` and `referrer` at the first ? or #,
      // so `?childId=` never gets as far as the scrubber. Both run client-side, which is
      // the only place they can run when there is no server of ours in the path.
      //
      // The pin is what makes this safe, so the pin is what is tested:
      // bug-report-privacy.test.ts pushes a realistic payload — child UUID in the path,
      // in the query, in a console.error line, plus an NQ address — through the shell's
      // real submitToBot with fetch stubbed, and reads the body that would have been
      // POSTed. A pin that silently resolved to an older build fails there, not in
      // production.
      //
      // Still NOT redacted, and it is the reporting parent's own text: a child's name
      // typed into the description, or one echoed through console.error by our own code.
      // Nothing here can catch a name. Do not log child labels to console.error.
      diagnostics: true,
    },
    fiat: {
      currencies: CURRENCIES,
      default: "USD",
      rate: async (ticker) => (await nimRates())[ticker.toLowerCase()] ?? null,
      onChange: (ticker) => {
        currency = ticker;
        for (const cb of currencyListeners) cb(ticker);
      },
    },
  });
  // testnet badge from the server's truth (mainnet stays silent), and the
  // running version for anything the visitor reports from this page
  void fetch("/health")
    .then((r) => r.json())
    .then((h: { network?: string; v?: string }) => {
      if (h.network === "test") corner.el.dataset.testnet = "";
      if (h.v) reportContext.version = h.v;
    })
    .catch(() => { /* mainnet default: no badge, version stays unknown */ });
}

// ---- bridge for the separately-loaded app.js --------------------------------
//
// app.js is its own ES module; it reads window.nimiqKidsShell.t for every
// user-visible string and registers an onLang callback to re-render.

declare global {
  interface Window {
    nimiqKidsShell?: {
      t: (key: string, params?: Record<string, string | number>) => string;
      getLanguage: () => string;
      setLanguage: (id: string) => void;
      onLang: (cb: (id: string) => void) => () => void;
      /** Reference currency the visitor picked in the corner (ISO ticker). */
      getCurrency: () => string;
      /** Price of 1 NIM in the current currency, or 0 before rates land. */
      getRate: () => number;
      onCurrency: (cb: (ticker: string) => void) => () => void;
      /** Fleet fiat formatter, already bound to the chosen currency + language. */
      fmtFiat: (value: number) => string;
      wallet: Wallet;
    };
  }
}

window.nimiqKidsShell = {
  t: (key, params) => i18n.t(key, params),
  getLanguage: () => i18n.getLanguage(),
  setLanguage: (id) => i18n.setLanguage(id),
  onLang: (cb) => i18n.onChange(cb),
  getCurrency: () => currency,
  getRate: () => rateCache?.[currency.toLowerCase()] ?? 0,
  onCurrency: (cb) => { currencyListeners.add(cb); return () => currencyListeners.delete(cb); },
  fmtFiat: (value) => fmtFiat(value, currency, i18n.getLanguage()),
  wallet,
};

// Warm the rate table so the first paint prices in the restored currency rather
// than falling back to the USD the wallet payload carries.
void nimRates().then(() => { for (const cb of currencyListeners) cb(currency); });

// Signal readiness so app.js (which may load first) can boot off i18n. If app.js
// already ran, this re-renders it in the resolved language.
window.dispatchEvent(new CustomEvent("nimiq-shell-ready"));
