// `pendingStakeLuna`: the one window where a kid's NIM is neither spendable-looking nor
// staked-looking, and the screen that has to explain it (ops #13).
//
// A stake off SIM is written PENDING — broadcasting proves only that a node took the
// transaction, never that it executed — and `stakedFromLedger` counts done rows only. So for
// the whole confirmation window `stakedLuna` is 0. The API has always published the pending
// figure beside it and the Grow screen used to ignore it, which meant a kid who had just
// staked was answered with a plant, "0 NIM", and "Put some NIM here and watch it grow". That
// reads as a stake that did not happen; it is what made a live verification look like a
// failure.
//
// Nothing here is hand-written in the middle. A real pending row goes into a real DB, is read
// back through the real Hono route, over `fetch` into the real api.js + data.js refreshers,
// and into the real showGrow() render. The field name has to survive all four hops or the
// sentence never appears — which is exactly the failure these pin, since the server half was
// correct the entire time the screen was wrong.

import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { walletRoutes } from "./routes/wallet";
import { kidIconsMock } from "./kid-icons-mock";
import en from "./locales/en";

const app = new Hono().route("/api", walletRoutes);
const NIM = 100_000;

// icons.js reaches for a browser-absolute import (/js/lib/box-glyphs.js), so it can never be
// loaded here. The stub is shared with every other kid-app test on purpose — see
// src/kid-icons-mock.ts.
mock.module("../public/kid/js/icons.js", kidIconsMock);
// The screens Grow can navigate to. Not under test, and each drags in the whole screen graph.
mock.module("../public/kid/js/money.js", () => ({ showMoney: () => {} }));
mock.module("../public/kid/js/pad.js", () => ({ showAmountScreen: () => {} }));
mock.module("../public/kid/js/send.js", () => ({ showResult: () => {} }));

const { state } = await import("../public/kid/js/util.js");
const { refreshStaking, refreshWallet } = await import("../public/kid/js/data.js");
const { showGrow } = await import("../public/kid/js/grow.js");

// ---- the smallest DOM setScreen can paint into -------------------------------------------

interface FakeEl {
  className: string;
  style: Record<string, string>;
  innerHTML: string;
  scrollTop: number;
  offsetWidth: number;
  classList: { add: () => void; remove: () => void };
  onclick?: () => void;
}
const newEl = (): FakeEl => ({
  className: "", style: {}, innerHTML: "", scrollTop: 0, offsetWidth: 0,
  classList: { add: () => {}, remove: () => {} },
});

let root: FakeEl;
let handles: Map<string, FakeEl>;
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

let fam: repo.Family;
let kid: repo.Child;

/** The English the shell serves. Using the real catalogue means a key that is missing from
 *  src/locales/en.ts renders as "app.kidStakeOnItsWay" and fails here. */
const EN = en as Record<string, string>;
const translate = (key: string, params?: Record<string, unknown>) =>
  (EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => String(params?.[k] ?? m));

beforeEach(() => {
  initTestDb();
  fam = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  kid = repo.createChild(fam.id, "Ada", "🦖");

  root = newEl();
  handles = new Map();
  for (const k of ["document", "window", "localStorage", "fetch"]) saved[k] = g[k];
  g.document = {
    // The 5 s cooldown tick is not what is under test; `document.hidden` makes it a no-op.
    hidden: true,
    getElementById: (id: string) => {
      if (id === "kid-app") return root;
      // A button that was not painted must read as absent, so grow.js's own
      // `$("grow-take") && …` guard is exercised rather than papered over.
      if (!root.innerHTML.includes(`id="${id}"`)) return null;
      if (!handles.has(id)) handles.set(id, newEl());
      return handles.get(id)!;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  g.window = { nimiqKidsShell: { t: translate } };
  g.localStorage = { getItem: () => null, setItem: () => {} };
  // The kid app's own fetch wrappers, pointed at the real routes.
  g.fetch = (input: unknown, init?: RequestInit) => app.request(String(input), init);

  state.child = { id: kid.id, label: kid.label, emoji: kid.emoji };
  state.staking = null;
  state.wallet = null;
});

afterEach(() => {
  // Stop the cooldown interval showGrow started: this is the real back button's handler.
  handles.get("grow-back")?.onclick?.();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

/** Money the kid already holds, as a settled ledger row. */
function fund(valueLuna: number) {
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna,
    counterpartyLabel: "Test deposit", txHash: `sim:${crypto.randomUUID()}`,
  });
}

/** A stake that has been broadcast and NOT yet proven — the exact row `stake()` writes off
 *  SIM (src/wallet/kid-staking.ts stakeLocked: status pending, value negative). */
function stakeInFlight(valueLuna: number) {
  return wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "stake", valueLuna: -valueLuna,
    status: "pending", counterpartyLabel: "Staking", txHash: `sim:${crypto.randomUUID()}`,
    message: "Started growing",
  });
}

/** A stake the chain has agreed to. */
function stakeSettled(valueLuna: number) {
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "stake", valueLuna: -valueLuna,
    status: "done", counterpartyLabel: "Staking", txHash: `sim:${crypto.randomUUID()}`,
  });
}

/** Boot the Grow screen the way the app does and hand back what it painted. */
async function paintGrow(): Promise<string> {
  await refreshWallet();
  await refreshStaking();
  await showGrow();
  return root.innerHTML;
}

const onItsWay = (nim: number) => translate("app.kidStakeOnItsWay", { amount: String(nim) });
const EMPTY_HINT = translate("app.kidGrowEmpty");

// ---- the server half: is the figure even published? ---------------------------------------

test("GET /kids/:id/staking publishes pendingStakeLuna off a real pending row", async () => {
  fund(1_000 * NIM);
  stakeInFlight(300 * NIM);

  const res = await app.request(`/api/kids/${kid.id}/staking`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.pendingStakeLuna).toBe(300 * NIM);
  // And it is NOT double-counted as staked. An unproven stake is money still sitting in the
  // kid's account; calling it staked invents a lock that does not exist.
  expect(body.stakedLuna).toBe(0);
});

test("GET /kids/:id/wallet publishes it too — the Money screen reads that one", async () => {
  fund(1_000 * NIM);
  stakeInFlight(300 * NIM);

  const res = await app.request(`/api/kids/${kid.id}/wallet`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.pendingStakeLuna).toBe(300 * NIM);
  expect(body.stakedLuna).toBe(0);
});

test("pending is a status, not a kind: proving the row moves the figure across", async () => {
  fund(1_000 * NIM);
  const ev = stakeInFlight(300 * NIM);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(300 * NIM);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);

  wrepo.markWalletEventDone(ev.id);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(0);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(300 * NIM);
});

test("a stake the chain refused is neither pending nor staked", async () => {
  fund(1_000 * NIM);
  const ev = stakeInFlight(300 * NIM);
  wrepo.markWalletEventFailed(ev.id);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(0);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
});

// ---- the screen half: the gap this issue was actually about --------------------------------

test("a stake in flight is ON the Grow screen, with its amount, in the kid's words", async () => {
  fund(1_000 * NIM);
  stakeInFlight(300 * NIM);

  const html = await paintGrow();
  expect(html).toContain(onItsWay(300));
  expect(html).toContain("k-grow-pending");
});

test("and the empty-state hint is gone while it is in flight — this WAS the bug", async () => {
  // stakedLuna is 0 for the whole confirmation window, so the old `stakedLuna > 0` test put
  // "Put some NIM here and watch it grow" under a stake the kid had just made.
  fund(1_000 * NIM);
  stakeInFlight(300 * NIM);

  const html = await paintGrow();
  expect(html).not.toContain(EMPTY_HINT);
  expect(html).not.toContain("k-grow-hint");
});

test("the hero still reads 0 — an unproven stake is not staked NIM", async () => {
  // The honesty rule underneath all of this. The pending line explains the gap; it must not
  // close it by quietly adding the unproven amount to the headline figure.
  fund(1_000 * NIM);
  stakeInFlight(300 * NIM);

  const html = await paintGrow();
  expect(html).toMatch(/k-grow-amount">0 <span>NIM<\/span>/);
  // And with nothing staked there is nothing to take back.
  expect(html).not.toContain(`id="grow-take"`);
});

test("the amount on the line is the PENDING one, not the staked one", async () => {
  // Both figures are in scope at the call site and both are NIM amounts, so a swap renders
  // a perfectly plausible sentence about the wrong money.
  fund(1_000 * NIM);
  stakeSettled(500 * NIM);
  stakeInFlight(300 * NIM);

  const html = await paintGrow();
  expect(html).toContain(onItsWay(300));
  expect(html).not.toContain(onItsWay(500));
  expect(html).toMatch(/k-grow-amount">500 <span>NIM<\/span>/);
});

test("nothing in flight: no line, and the hint is back", async () => {
  // The other side of the same clause — a kid with an empty Grow screen must still be told
  // what it is for.
  fund(1_000 * NIM);

  const html = await paintGrow();
  expect(html).not.toContain("k-grow-pending");
  expect(html).toContain(EMPTY_HINT);
});

test("staked and settled: no pending line, and no hint either", async () => {
  fund(1_000 * NIM);
  stakeSettled(500 * NIM);

  const html = await paintGrow();
  expect(html).not.toContain("k-grow-pending");
  expect(html).not.toContain(EMPTY_HINT);
  expect(html).toContain(`id="grow-take"`);
});
