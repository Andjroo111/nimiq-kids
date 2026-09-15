// POST /api/kids/:id/fund — a parent giving a kid NIM with no chore behind it.
//
// This is hot-wallet outflow on a shared instance, so the tests that matter are the ones
// about the money: it must be charged to the family budget, it must be refused when the
// budget is gone, it must not cross households, and a double tap must pay once.
//
// The budget assertions are the point. `spentLuna` derives what a family has spent from
// `kind='earn'` rows, so a gift written under any OTHER row kind would move real NIM and
// leave the budget untouched — an open tap, where one visitor drains the wallet for every
// other household. `charges the family budget` below is what pins that.
//
// Hermetic: in-memory DB + app.request(), mirroring src/budget.test.ts.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as budget from "./repo-budget";
import * as wrepo from "./repo-wallet";
import { newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { walletRoutes, MAX_FUND_LUNA } from "./routes/wallet";

const app = new Hono()
  .route("/api", families)
  .route("/api", children)
  .route("/api", walletRoutes);

type House = { fam: repo.Family; kid: repo.Child; bearer: string };
let A: House; // grandfathered (exempt) by default
let B: House; // budgeted

async function makeHouse(label: string, kidLabel: string): Promise<House> {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, bearer };
}

const ENV_KEYS = ["HATCH_DEMO_GRANT_LUNA", "HATCH_GRANDFATHER_FIRST"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  initTestDb();
  A = await makeHouse("Mom A", "Ada");
  B = await makeHouse("Dad B", "Ben");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const fund = (h: House, body: Record<string, unknown>, kidId?: string) =>
  app.request(`http://hatch.test/api/kids/${kidId ?? h.kid.id}/fund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${h.bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ---- the happy path ----

test("a gift pays the kid and is written as an earn row so the budget sees it", async () => {
  const res = await fund(A, { valueLuna: 50_000, message: "Happy birthday" });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.paidLuna).toBe(50_000);
  // `earn` is what spentLuna counts. A different kind here would be the open tap.
  expect(body.event.kind).toBe("earn");
  expect(body.event.message).toBe("Happy birthday");
  expect(budget.spentLuna(A.fam.id)).toBe(50_000);
});

test("a gift with no note still carries a message a kid can read", async () => {
  const body = await (await fund(A, { valueLuna: 1_000 })).json();
  expect(body.event.message).toBe("A present from your family");
});

// ---- the budget ----

test("charges the family budget and refuses once it is gone", async () => {
  // B is budgeted: the default demo grant is 5 NIM (500,000 luna).
  const available = budget.budgetView(B.fam).availableLuna!;
  expect(available).toBe(500_000);

  expect((await fund(B, { valueLuna: 300_000 })).status).toBe(201);
  expect(budget.spentLuna(B.fam.id)).toBe(300_000);
  expect(budget.budgetView(B.fam).availableLuna).toBe(200_000);

  const over = await fund(B, { valueLuna: 300_000 });
  expect(over.status).toBe(400);
  const err = await over.json();
  expect(err.error).toBe("budget_exhausted");
  expect(err.neededLuna).toBe(300_000);
  // Nothing half-applied: the refusal moved no money.
  expect(budget.spentLuna(B.fam.id)).toBe(300_000);

  // A credit unblocks the same gift.
  budget.addBudgetCredit(B.fam.id, 200_000, "manual", null, "test top-up");
  expect((await fund(B, { valueLuna: 300_000 })).status).toBe(201);
  expect(budget.spentLuna(B.fam.id)).toBe(600_000);
});

// ---- the per-gift cap ----

test("refuses more than the per-gift cap even when the budget could cover it", async () => {
  // A is exempt, so the budget would allow this; the cap is what stops it. Without a
  // ceiling a single caller could empty the shared hot wallet in one request.
  const res = await fund(A, { valueLuna: MAX_FUND_LUNA + 1 });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("above_max_fund");
  expect(budget.spentLuna(A.fam.id)).toBe(0);
});

test("the cap itself is allowed", async () => {
  expect((await fund(A, { valueLuna: MAX_FUND_LUNA })).status).toBe(201);
});

// ---- bad input ----

test("refuses zero, negative and fractional amounts", async () => {
  for (const valueLuna of [0, -1, 1.5, "abc", null]) {
    const res = await fund(A, { valueLuna });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_value");
  }
  // A fractional amount must not be silently rounded into a real payment: luna is the
  // indivisible unit, so 1.5 is a caller bug, not a 2 luna gift.
  expect(budget.spentLuna(A.fam.id)).toBe(0);
});

// ---- scope ----

test("a parent cannot fund another household's kid", async () => {
  const res = await fund(A, { valueLuna: 1_000 }, B.kid.id);
  expect(res.status).toBe(404);
  expect(budget.spentLuna(A.fam.id)).toBe(0);
  expect(budget.spentLuna(B.fam.id)).toBe(0);
});

test("an unauthenticated caller cannot fund anyone", async () => {
  const res = await app.request(`http://hatch.test/api/kids/${A.kid.id}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ valueLuna: 1_000 }),
  });
  expect(res.status).toBe(401);
  expect(budget.spentLuna(A.fam.id)).toBe(0);
});

// ---- replay ----

test("the same requestId pays exactly once", async () => {
  const first = await (await fund(A, { valueLuna: 20_000, requestId: "gift-1" })).json();
  const again = await (await fund(A, { valueLuna: 20_000, requestId: "gift-1" })).json();
  expect(again.event.id).toBe(first.event.id);
  expect(budget.spentLuna(A.fam.id)).toBe(20_000);
});

test("a different requestId is a different gift", async () => {
  await fund(A, { valueLuna: 20_000, requestId: "gift-1" });
  await fund(A, { valueLuna: 20_000, requestId: "gift-2" });
  expect(budget.spentLuna(A.fam.id)).toBe(40_000);
});

// ---- a kid with no address yet, on a parent-custody instance (#245) ----
//
// Under `HATCH_CUSTODY=parent` the server holds no key and cannot mint an account, so a kid
// whose parent has not registered an address is a NORMAL, EXPECTED state — not a failure.
// The route used to answer 502 pay_failed, which says the chain or the node let us down and
// invites a retry that can never succeed. #237 gave every other path the honest answer;
// this is the one it deliberately left out to keep that diff to the reported break.
//
// NOT routed through `kidOutflowRefusal`. That helper also refuses `parent_signature_required`
// when `address_source === 'parent'`, which is a rule about money LEAVING the kid's account.
// Funding pays money IN, and refusing a gift because the kid cannot spend unaided would be a
// new bug wearing a shared helper's name.
test("a kid with no address is refused in words, not as a payment failure (#245)", async () => {
  process.env.HATCH_CUSTODY = "parent";
  try {
    expect(repo.getChild(A.kid.id)!.address).toBeFalsy(); // the state under test
    const r = await fund(A, { valueLuna: 1_000 });
    expect(r.status).toBe(409);
    expect((await r.json() as { error: string }).error).toBe("kid_address_not_registered");
    // Refused IN FRONT of the queue: nothing spent, nothing written, no wallet event.
    expect(budget.spentLuna(A.fam.id)).toBe(0);
  } finally {
    delete process.env.HATCH_CUSTODY;
  }
});

test("...and the same kid WITH an address funds normally", async () => {
  process.env.HATCH_CUSTODY = "parent";
  try {
    wrepo.setChildAddress(A.kid.id, "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T");
    const r = await fund(A, { valueLuna: 1_000 });
    // The refusal must be about the ADDRESS and nothing else — if this 409s too, the guard
    // is refusing parent custody itself rather than the missing address.
    expect(r.status).not.toBe(409);
  } finally {
    delete process.env.HATCH_CUSTODY;
  }
});
