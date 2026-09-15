// Timer-style prefs: the equipped rig roundtrips through kid_prefs, and the two
// purchasable styles (Sticker Maker / Polaroid) are EARNED via the Treasure Box —
// equip is ownership-gated server-side. Hermetic: in-memory DB + app.request().

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as stickersRepo from "./repo-stickers";
import * as wrepo from "./repo-wallet";
import { hashPin } from "./auth";
import { prefsRoutes } from "./routes/prefs";
import { storeRoutes } from "./routes/store";

const app = new Hono().route("/api", prefsRoutes).route("/api", storeRoutes);

const get = (path: string) => app.request(path);
const put = (path: string, body: Record<string, unknown>) =>
  app.request(path, {
    method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
const post = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  // The Timers SHELF is retired (Andjroo, 2026-07-31) but the timer_style buy
  // path is not — a kid who owns one keeps it, and re-listing is one flag. So
  // these tests put the two rows back on sale, which is exactly what that flag
  // does, and keep covering the path. See stickers.test.ts for the retirement.
  stickersRepo.updateCategory("cat-timers", { active: 1 });
  for (const id of ["item-timer-maker", "item-timer-pola"]) {
    stickersRepo.updateStoreItem(id, { active: 1 });
  }
});

const fund = (luna: number) =>
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: luna });

test("timer_style_id defaults to egg; egg is always equippable", async () => {
  const body = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(body.prefs.timer_style_id).toBe("egg");
  expect(body.timerStyles).toEqual(["egg"]);
  const res = await put(`/api/children/${kid.id}/prefs`, { timerStyleId: "egg" });
  expect(res.status).toBe(200);
  expect((await res.json()).prefs.timer_style_id).toBe("egg");
});

test("unowned style cannot be equipped; unknown style is invalid", async () => {
  const denied = await put(`/api/children/${kid.id}/prefs`, { timerStyleId: "maker" });
  expect(denied.status).toBe(403);
  expect((await denied.json()).error).toBe("style_not_owned");
  const junk = await put(`/api/children/${kid.id}/prefs`, { timerStyleId: "disco" });
  expect(junk.status).toBe(400);
  expect((await junk.json()).error).toBe("invalid_timer_style");
  expect((await (await get(`/api/children/${kid.id}/prefs`)).json()).prefs.timer_style_id).toBe("egg");
});

test("buy timer style: spend event, unlock granted, equip roundtrips and persists", async () => {
  // Prices come from the catalog: they were repriced when rewards became
  // dollar-sized, and a literal here just re-breaks on the next repricing.
  const maker = stickersRepo.getStoreItem("item-timer-maker")!.price_luna;
  fund(maker + 1_000_000);
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-timer-maker" });
  expect(res.status).toBe(200);
  const bought = await res.json();
  expect(bought.kind).toBe("timer_style");
  expect(bought.styleId).toBe("maker");
  expect(bought.balanceLuna).toBe(1_000_000);
  expect(stickersRepo.ownsUnlock(kid.id, "timer_style", "maker")).toBe(true);

  // Owned list grows; equip now succeeds and roundtrips through GET.
  const prefs1 = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(prefs1.timerStyles).toEqual(["egg", "maker"]);
  const putRes = await put(`/api/children/${kid.id}/prefs`, { timerStyleId: "maker" });
  expect(putRes.status).toBe(200);
  expect((await putRes.json()).prefs.timer_style_id).toBe("maker");
  const prefs2 = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(prefs2.prefs.timer_style_id).toBe("maker");

  // Unrelated pref patches leave the equipped style alone.
  await put(`/api/children/${kid.id}/prefs`, { backgroundId: "space" });
  const prefs3 = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(prefs3.prefs.timer_style_id).toBe("maker");
  expect(prefs3.prefs.background_id).toBe("space");
});

test("buy timer style: insufficient balance refused, nothing granted", async () => {
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-timer-pola" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(stickersRepo.ownsUnlock(kid.id, "timer_style", "polaroid")).toBe(false);
  expect((await put(`/api/children/${kid.id}/prefs`, { timerStyleId: "polaroid" })).status).toBe(403);
});

test("timer style cannot be bought twice; store marks it owned", async () => {
  fund(stickersRepo.getStoreItem("item-timer-pola")!.price_luna * 2);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-timer-pola" })).status).toBe(200);
  const again = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-timer-pola" });
  expect(again.status).toBe(400);
  expect((await again.json()).error).toBe("already_owned");

  const store = await (await get(`/api/kids/${kid.id}/store`)).json();
  const pola = store.items.find((i: { id: string }) => i.id === "item-timer-pola");
  const maker = store.items.find((i: { id: string }) => i.id === "item-timer-maker");
  expect(pola.owned).toBe(true);
  expect(pola.payload.styleId).toBe("polaroid");
  expect(maker.owned).toBe(false);
  expect(store.categories.some((c: { id: string }) => c.id === "cat-timers")).toBe(true);
});

// The app's scene and the TIMER's scene are independent. The timer's is
// nullable on purpose: null means "same as the app", which is what every kid
// had before the split, so nothing changes appearance until they choose.
test("timer background is independent of the app background, and null means inherit", async () => {
  const start = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(start.prefs.timer_background_id).toBeNull();

  // Setting the APP scene must not touch the timer's.
  await put(`/api/children/${kid.id}/prefs`, { backgroundId: "space" });
  const afterApp = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(afterApp.prefs.background_id).toBe("space");
  expect(afterApp.prefs.timer_background_id).toBeNull();

  // Setting the TIMER scene must not touch the app's.
  await put(`/api/children/${kid.id}/prefs`, { timerBackgroundId: "ocean" });
  const afterTimer = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(afterTimer.prefs.background_id).toBe("space");
  expect(afterTimer.prefs.timer_background_id).toBe("ocean");

  // The two do not mirror: change the app again, timer stays put.
  await put(`/api/children/${kid.id}/prefs`, { backgroundId: "city" });
  const afterBoth = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(afterBoth.prefs.background_id).toBe("city");
  expect(afterBoth.prefs.timer_background_id).toBe("ocean");

  // An explicit null puts the timer back on the app's scene. String(null) would
  // have written the literal "null" and the timer would hunt for a scene by
  // that name, so this asserts the value, not just that the request succeeded.
  await put(`/api/children/${kid.id}/prefs`, { timerBackgroundId: null });
  const reset = await (await get(`/api/children/${kid.id}/prefs`)).json();
  expect(reset.prefs.timer_background_id).toBeNull();
  expect(reset.prefs.background_id).toBe("city");
});
