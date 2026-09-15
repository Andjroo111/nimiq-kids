// nimiq.kids parent app — browser entry for the shared nimiq-app-shell (the fleet chrome).
//
// Bundles (bun build --target browser) to public/dist/parent-shell.js and runs BEFORE
// public/parent/parent.js. Mirrors src/app-shell.ts (the kid/demo entry) with the
// parent-side differences:
//
//   1. i18n boots from shellLocales + the lean parent set (papp.* — src/locales/parent.ts).
//   2. The dual-mode wallet connects ANDJROO'S wallet for PAYMENTS (topping up the
//      family hot wallet), never for auth — auth stays the bearer magic link (#t=...).
//      Inside Nimiq Pay the user is already IN their wallet: the corner control
//      collapses to the flag-only face (language) and the account resolves eagerly
//      (views read wallet.account). On standalone web the corner control owns
//      connect/connected, language, Receive, and the Nimiq Pay handoff — the
//      fleet's ONE header button (mountCornerControl, shell v0.3+).
//   3. Exposes window.hatchParentShell so parent.js (a plain ES module) can t() its
//      strings, re-render on language change, and drive wallet.signAndSend for top-ups.

import {
  createWallet,
  createI18n,
  shellLocales,
  mergeLocales,
  mountCornerControl,
  SHELL_LANGUAGES,
  isMiniAppHost,
  type I18n,
  type MiniAppProvider,
  type Wallet,
} from "nimiq-app-shell";
import { parentLocales } from "./locales/parent";
import { MINIAPP_INIT_TIMEOUT_MS, isUserCancel, miniAppDeeplink, parentAppUrl } from "./miniapp";

// Host-language hook: createI18n's resolution chain already prefers the Nimiq
// Pay host language — the same seeded window.nimiqPay context the SDK's
// getHostLanguage() reads — and falls back to the visitor's stored choice,
// then navigator.language. Inside the WebView the app boots in the wallet's
// language with zero extra wiring; the corner control still lets the parent switch.
const i18n: I18n = createI18n({
  locales: mergeLocales(shellLocales, parentLocales),
  fallback: "en",
});

// Inside Nimiq Pay, resolve the injected provider eagerly via the official
// @nimiq/mini-app-sdk (init() polls for window.nimiq; ~10s timeout) so the
// first top-up doesn't pay the bootstrap cost. A failed init clears the
// cached promise so the next use retries instead of staying wedged.
let providerPromise: Promise<MiniAppProvider> | null = null;
function resolveMiniAppProvider(): Promise<MiniAppProvider> {
  if (!providerPromise) {
    providerPromise = import("@nimiq/mini-app-sdk")
      .then((sdk) => sdk.init({ timeout: MINIAPP_INIT_TIMEOUT_MS }))
      .then((p) => p as unknown as MiniAppProvider);
    providerPromise.catch(() => { providerPromise = null; });
  }
  return providerPromise;
}

const wallet: Wallet = createWallet(
  { appName: "nimiq.kids" },
  isMiniAppHost() ? { miniApp: { getProvider: resolveMiniAppProvider } } : {},
);

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

// ---- "Connect wallet" on the seeded demo -----------------------------------
//
// On demo.nimiq.kids the household's own wallet IS the instance hot wallet: it is already
// funded, every payout signs server-side, and `families.parent_address` names it. So the
// header's most prominent control invited a judge to connect or create a Nimiq wallet they do
// not have, to solve a problem the screen underneath had already solved, and the Hub it opened
// was a detour straight out of the demo. Andjroo, walking it: "it shows that the wallet needs to
// be connected in the demo."
//
// It is NOT hidden, deliberately (his call): connecting a wallet is a real and central part of
// the product, and a judge should see that the app has that step rather than find the corner
// quietly emptier here than in the screenshots. So the button stays and the tap ANSWERS,
// telling them what it would do on mainnet.
//
// Read at CALL time, not at mount: /health resolves after the corner control is mounted, and a
// tap always happens later than either. False until proven true, so a mainnet or family
// instance is never affected by a /health that has not landed.
let demoInstance = false;

/**
 * The wallet the CORNER CONTROL sees. Everything is the real wallet except `connect`, which on
 * a demo household explains instead of opening the Hub.
 *
 * A Proxy rather than a copied object because the control reads live state through this
 * reference (`wallet.account`, `wallet.mode`) and a snapshot would freeze it at boot. Methods
 * are bound to the TARGET rather than the proxy: `Wallet` is a class instance, and forwarding
 * a private-field access through a proxy receiver throws.
 *
 * It also covers the menu's "New to Nimiq? Create a wallet", which routes through connect() for
 * its own reasons (Hub `onboard` is privileged and rejects third-party origins) — so both ways
 * into wallet creation land on the same sentence, without a second check to keep in sync.
 */
const cornerWallet: Wallet = new Proxy(wallet, {
  get(target, prop, _recv) {
    if (prop === "connect") {
      return async () => {
        if (!demoInstance) return target.connect();
        window.dispatchEvent(new CustomEvent("nimiq-kids-toast", { detail: { key: "papp.demoConnectNote" } }));
        // Resolves rather than rejects: the control reads a throw as a failed connection and
        // offers "Retry", which is the wrong story for a deliberate answer.
      };
    }
    const v = Reflect.get(target, prop, target);
    return typeof v === "function" ? v.bind(target) : v;
  },
});

// ---- identicon (the page's vendored @nimiq/iqons, lazy, placeholder-first) --
// Same loader as public/parent/fmt.js — a URL variable keeps bun's bundler from
// trying to resolve the runtime-served vendor path at build time.
const IQONS_URL = "/vendor/nqp/iqons.min.js";
const IQONS_SVG = "/vendor/nqp/nimiq/assets/img/iqons.min.svg";
const IDENTICON_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg viewBox="0 -4 64 64" xmlns="http://www.w3.org/2000/svg"><path opacity=".25" d="M62.3 25.4L49.2 2.6A5.3 5.3 0 0 0 44.6 0H18.4c-1.9 0-3.6 1-4.6 2.6L.7 25.4c-1 1.6-1 3.6 0 5.2l13.1 22.8c1 1.6 2.7 2.6 4.6 2.6h26.2c1.9 0 3.6-1 4.6-2.6l13-22.8c1-1.6 1-3.6.1-5.2z" fill="#1f2348"/></svg>',
  );
let iqonsP: Promise<{ toDataUrl(address: string): Promise<string> }> | null = null;
function loadIqons(): Promise<{ toDataUrl(address: string): Promise<string> }> {
  if (!iqonsP) {
    iqonsP = import(/* webpackIgnore: true */ IQONS_URL).then((mod) => {
      const Iqons = mod.default;
      Iqons.svgPath = IQONS_SVG;
      return Iqons;
    });
    iqonsP.catch(() => { iqonsP = null; });
  }
  return iqonsP;
}
function identicon(address: string, sizePx: number): HTMLElement {
  const img = document.createElement("img");
  img.width = sizePx;
  img.height = sizePx;
  img.alt = "";
  img.src = IDENTICON_PLACEHOLDER;
  void loadIqons()
    .then((Iqons) => Iqons.toDataUrl(address))
    .then((url) => { img.src = url; })
    .catch(() => { /* placeholder hexagon remains */ });
  return img;
}

// ---- receive QR (qr-creator is already on the page for the top-up screen) ---
function qr(text: string, sizePx: number): HTMLElement {
  const canvas = document.createElement("canvas");
  const creator = (window as unknown as { QrCreator?: { render(cfg: object, el: HTMLElement): void } }).QrCreator;
  if (creator) {
    creator.render(
      { text, radius: 0.5, ecLevel: "M", fill: "#1f2348", background: null, size: sizePx * 2 },
      canvas,
    );
  }
  return canvas;
}

// ---- corner-control data seams ----------------------------------------------

// Balance of the CONNECTED wallet, via our server's RPC. Public endpoint (an
// address balance is public chain data) — the corner renders for any connected
// visitor, including one not signed into a family yet.
async function getBalanceLuna(address: string): Promise<number> {
  const res = await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`balance ${res.status}`);
  const json = (await res.json()) as { balanceLuna: number };
  return json.balanceLuna;
}

// NIM prices from /api/rates (CoinGecko server-side, 10-min cache there; a
// short client cache avoids a fetch per menu open).
let ratesCache: { at: number; nim: Record<string, number> } | null = null;
async function nimRate(ticker: string): Promise<number | null> {
  if (!ratesCache || Date.now() - ratesCache.at > 5 * 60_000) {
    const res = await fetch("/api/rates");
    if (!res.ok) return ratesCache?.nim[ticker.toLowerCase()] ?? null;
    const json = (await res.json()) as { nim?: Record<string, number> };
    ratesCache = { at: Date.now(), nim: json.nim ?? {} };
  }
  return ratesCache.nim[ticker.toLowerCase()] ?? null;
}

// ---- the corner control (the fleet's one header button) ---------------------
//
// Inside Nimiq Pay: flag-only face, language-only menu — being in the wallet IS
// the connection, so the account resolves eagerly and views read wallet.account.
// On web: connect/connected face; Send routes to the app's own Top-Up screen
// (that IS this app's send flow); onboard opens Hub wallet creation for parents
// without a wallet yet; Create a Cashlink opens the wallet's own Cashlink
// creator (kids is exactly the opt-in case the spec names); Open in Nimiq Pay
// deeplinks with the magic token so the in-wallet session lands signed in
// (computed at CLICK time — the token is captured by core.js after this shell
// boots).
if (wallet.mode === "miniapp") {
  wallet.connect().catch(() => {});
}
const cornerSlot = $("#wallet-slot");

// Filled in when /health answers below; the report sheet reads it at send time.
// Carries nothing about the household: not the family, not a kid, not an
// address. That is a claim about THIS OBJECT and it stops there — what the sheet
// attaches around it is a separate question, and the answer used to be worse
// than this comment implied. See the `diagnostics` note below.
const reportContext = { surface: "parent", version: "unknown" };

if (cornerSlot) {
  const corner = mountCornerControl(cornerSlot, {
    // The intercepting wallet, so a demo household explains instead of opening the Hub.
    wallet: cornerWallet,
    i18n,
    languages: SHELL_LANGUAGES,
    identicon,
    qr,
    // The bug reporter, in the fleet's one menu rather than as a second control
    // parked on top of the parent's screens.
    reportBug: {
      bot: { repo: "nimiq.kids", labels: [`surface:${reportContext.surface}`] },
      context: reportContext,
      // DIAGNOSTICS BACK ON, because the shell now scrubs (#140, shell v0.9.2).
      //
      // The parent app is the one that carries child UUIDs most: every board, chart,
      // approval and payout screen is addressed by one (/api/kids/<id>/…), and this path
      // has no server of ours in it — browser -> bot.nimiq.tech -> an LLM-written issue
      // on the PUBLIC repo. That is why they went off in the first place.
      //
      // Shell v0.9.2 closed it client-side, which is the only place it can be closed
      // here: `scrubAddresses` redacts any 8-4-4-4-12 hex UUID as "[id redacted]"
      // alongside the NQ-address shapes, and `pageContext` cuts `url` and `referrer` at
      // the first ? or # so a `?childId=` never reaches the scrubber at all.
      //
      // The pin is the guarantee, so the pin is what bug-report-privacy.test.ts tests:
      // a realistic payload goes through the shell's real submitToBot with fetch stubbed
      // and the POSTed body is read back. A stale resolve fails there, not in public.
      //
      // Still NOT redacted: a child's name, whether typed into the description by the
      // parent or echoed through console.error by our own code. Do not log child labels.
      diagnostics: true,
    },
    // Send = the shell's built-in mini-wallet view (recipient + amount in the
    // menu; the Hub checkout popup approves AND broadcasts — Andjroo's
    // ecosystem-wide "mini wallet in every app"). No app override: family
    // top-ups keep their own Top-Up tab; this Send is generic crypto send.
    // "New to Nimiq? Create a wallet": HubApi.onboard is PRIVILEGED — the Hub
    // rejects it from any non-Nimiq origin ("unauthorized to call onboard",
    // verified live + in hub src RpcApi._3rdPartyRequestWhitelist). The
    // sanctioned third-party path is chooseAddress: the Hub's ChooseAddress
    // view auto-routes a zero-wallet visitor into onboarding (created() hook).
    onboard: () => { void cornerWallet.connect().catch(() => {}); },
    createCashlink: () => {
      void import("@nimiq/hub-api").then(({ default: HubApi }) => {
        new HubApi("https://hub.nimiq.com")
          .createCashlink({ appName: "nimiq.kids", ...(wallet.account ? { senderAddress: wallet.account.address } : {}) })
          .catch((err: unknown) => {
            if (!isUserCancel(err)) console.error(err);
          });
      });
    },
    getBalanceLuna,
    fiat: {
      currencies: ["USD", "EUR", "GBP", "MXN", "BRL", "CNY", "INR", "JPY", "CHF", "CAD", "AUD", "KRW", "TRY", "VND"],
      default: "USD",
      rate: nimRate,
    },
    openInPay: () => miniAppDeeplink(parentAppUrl(location.origin, localStorage.getItem("kidsParentToken"))),
  });
  // The menu's network row renders ONLY on testnet ([data-testnet], CSS-gated),
  // and which network we're on is the server's truth — stamp it when /health
  // answers (mainnet stays silent, per the locked spec).
  void fetch("/health")
    .then((r) => r.json())
    .then((h: { network?: string; v?: string; demo?: boolean }) => {
      if (h.network === "test") corner.el.dataset.testnet = "";
      if (h.v) reportContext.version = h.v;
      // Same read that stamps the testnet badge, so the flag cannot cost a second request.
      demoInstance = !!h.demo;
    })
    .catch(() => { /* mainnet default: no badge, version stays unknown */ });
}

// ---- registering a kid's address out of the parent's own wallet -------------
//
// This drops to @nimiq/hub-api DIRECTLY rather than going through the shell, and that is a
// decision, not a shortcut. `Wallet` (nimiq-app-shell v0.6.1) exposes connect / signAndSend /
// pay, and signAndSend PINS the sender to the connected account — correct for every flow the
// shell was built for, and useless for this one, where the whole point is to learn about an
// address that is NOT the connected one. `signMessage` is not on the shell's surface at all.
// Teaching the shell both would be a fleet-wide dependency bump for one app's registration
// screen. NONCUSTODIAL-PLAN already anticipates this drop for kid outflows in Phase 4; doing
// it here keeps the change inside this repo.
//
// MINI-APP MODE CANNOT DO THIS AT ALL. @nimiq/mini-app-sdk@0.1.0 has no chooseAddress and no
// signMessage, and inside Nimiq Pay there is no Hub to open. So this refuses with a typed
// error rather than opening a popup that will never appear, and the UI turns that into
// "open this in a browser". Ugly and honest beats a spinner that never resolves.

const HUB_ENDPOINT = "https://hub.nimiq.com";

class MiniAppUnsupportedError extends Error {
  constructor() {
    super("miniapp_unsupported");
    this.name = "MiniAppUnsupportedError";
  }
}

const bytesToHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hubApi() {
  if (wallet.mode === "miniapp") throw new MiniAppUnsupportedError();
  const { default: HubApi } = await import("@nimiq/hub-api");
  return new HubApi(HUB_ENDPOINT);
}

/** Open the wallet's address picker. Resolves the chosen address, or null on the mobile
 *  full-page redirect (the result comes back through the Hub's own return trip). */
async function chooseAddress(): Promise<{ address: string; label: string } | null> {
  const hub = await hubApi();
  const res = await hub.chooseAddress({ appName: "nimiq.kids" });
  return res ? { address: res.address, label: res.label ?? "" } : null;
}

/** Sign the server's challenge with a SPECIFIC address's key.
 *
 *  `signer` is the address we are proving, which is exactly what the Hub resolves against
 *  all of the user's wallets (hub src/views/SignMessage.vue: findWalletByAddress). The
 *  Keyguard hands back raw bytes; hex is what our verifier deserialises. */
async function signMessage(signer: string, message: string): Promise<{ publicKeyHex: string; signatureHex: string }> {
  const hub = await hubApi();
  const res = await hub.signMessage({ appName: "nimiq.kids", signer, message });
  return { publicKeyHex: bytesToHex(res.signerPublicKey), signatureHex: bytesToHex(res.signature) };
}

export interface ConnectSignature {
  /** The address the Keyguard derived for the key path at this index. */
  signer: string;
  publicKeyHex: string;
  signatureHex: string;
}

/**
 * One popup, one signature per requested derivation path, all over the same challenge.
 *
 * `connectAccount` IS on the Hub's third-party whitelist (`_3rdPartyRequestWhitelist`) where
 * `addAddress` and `onboard` are not, and the Keyguard derives each requested path on the
 * spot — so this is the one call that can give a whole family parent-owned addresses without
 * the parent creating any of them by hand first. Paths are validated for syntax only; there is
 * no cap and no restriction on which ones may be asked for.
 *
 * `permissions: []` on purpose. The parameter grants the app the right to make FURTHER
 * requests without a fresh consent, and this flow wants exactly one thing once. The Keyguard's
 * own consent screen then reads "nimiq.kids is requesting access to N addresses. The connection
 * is for approving only. Your funds remain unaffected." — which is why the copy in front of it
 * names the same N.
 *
 * `appLogoUrl` must be on THIS origin; the Hub's RequestParser refuses a logo from anywhere
 * else and the whole request fails before a popup opens.
 *
 * Returns the signatures IN REQUEST ORDER, which is the only thing that maps an address to a
 * child. Nothing here re-derives an address or checks a signature: `public/parent/
 * connect-batch.js` owns the mapping and the server owns the proof.
 */
async function connectAccount(challenge: string, keyPaths: string[]): Promise<ConnectSignature[]> {
  const hub = await hubApi();
  const res = await hub.connectAccount({
    appName: "nimiq.kids",
    appLogoUrl: `${location.origin}/icon.svg`,
    permissions: [],
    requestedKeyPaths: keyPaths,
    challenge,
  });
  return (res?.signatures ?? []).map((s) => ({
    signer: s.signer,
    publicKeyHex: bytesToHex(s.signerPublicKey),
    signatureHex: bytesToHex(s.signature),
  }));
}

// ---- bridge for the separately-loaded parent.js -----------------------------

declare global {
  interface Window {
    hatchParentShell?: {
      t: (key: string, params?: Record<string, string | number>) => string;
      getLanguage: () => string;
      setLanguage: (id: string) => void;
      onLang: (cb: (id: string) => void) => () => void;
      wallet: Wallet;
      /** Hub-only capabilities the shell's Wallet does not carry. Both throw
       *  MiniAppUnsupportedError inside Nimiq Pay; `isMiniAppUnsupported` tells them apart
       *  from a real failure so the UI can offer the browser handoff instead of an error. */
      hub: {
        chooseAddress: () => Promise<{ address: string; label: string } | null>;
        signMessage: (signer: string, message: string) => Promise<{ publicKeyHex: string; signatureHex: string }>;
        /** One popup for the whole family: a signature per key path, in request order. */
        connectAccount: (challenge: string, keyPaths: string[]) => Promise<ConnectSignature[]>;
        isMiniAppUnsupported: (err: unknown) => boolean;
      };
      miniApp: {
        /** true when running inside Nimiq Pay's WebView */
        active: boolean;
        deeplink: (url: string) => string;
        /** this parent app's URL for a deeplink (magic-link token rides along) */
        appUrl: (token?: string | null) => string;
        isUserCancel: (err: unknown) => boolean;
      };
    };
  }
}

window.hatchParentShell = {
  t: (key, params) => i18n.t(key, params),
  getLanguage: () => i18n.getLanguage(),
  setLanguage: (id) => i18n.setLanguage(id),
  onLang: (cb) => i18n.onChange(cb),
  wallet,
  hub: {
    chooseAddress,
    signMessage,
    connectAccount,
    isMiniAppUnsupported: (err) => err instanceof MiniAppUnsupportedError,
  },
  miniApp: {
    active: wallet.mode === "miniapp",
    deeplink: miniAppDeeplink,
    appUrl: (token) => parentAppUrl(location.origin, token),
    isUserCancel,
  },
};

window.dispatchEvent(new CustomEvent("hatch-parent-shell-ready"));
