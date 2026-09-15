// The judge demo: one PRIVATE, fully-populated family per visitor.
//
// The competition needs a link a stranger can open and immediately see a working
// household — a parent, two kids (Sam and Ava), a board with jobs on it, and money
// that has already moved. A single shared demo family cannot do that job: the first
// visitor approves the pending chore and every visitor after them sees an empty
// board and someone else's spent budget.
//
// So every visitor mints their OWN seeded family and is pinned to it by the two
// credentials the app already speaks — the parent bearer (kidsParentToken) and a
// kiosk device bearer (kid.deviceToken). Nothing new is invented: `HATCH_LEGACY_BOOT=0`
// already makes every unauthenticated boot surface answer 401, and both bearers already
// resolve to their own family (src/routes/families.ts requestFamily). Isolation is
// therefore the SAME isolation self-serve onboarding gets, not a parallel path.
//
// The history is real. In family mode a kid's balance is read from the chain, not from
// the ledger, so seeding "3 NIM earned last week" as a row would render as a feed full
// of earnings above a balance of zero. Every seeded earn is an actual on-chain payout
// from the instance hot wallet — which is why this belongs on TESTNET (see
// deploy/testnet-demo/README-TESTNET.md and src/custody.ts for why a public,
// approval-free demo must never sit on funded mainnet).
//
// Demo families are throwaway: `demo_at` stamps them, and sweepDemoFamilies() purges
// the abandoned ones so the DB does not grow forever.

import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import * as goalsRepo from "./repo-goals";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "./db";
import { hashPin, newToken, sha256Hex } from "./auth";
import { forgetFamilyWalletState } from "./repo-wallet";
import { payKidEarn } from "./wallet/kid-wallet";
import { withChildSpendLocks } from "./wallet/spend-lock";
import * as stickersRepo from "./repo-stickers";
import { mondayOf, weekDays } from "./days";
import { nimUsd, usdToWholeNimLuna } from "./rates";
import { OTHER_STORE_ITEMS, packStoreItems } from "./sticker-catalog";
import { job, jobKey, ROUTINE_CATALOG, routineKey } from "./title-catalog";
import { reclaimDemoFamily, reclaimEnabled, type ReclaimChain } from "./demo-reclaim";
import { seedPastWeeks } from "./demo-past";
import { mediaDir } from "./routes/media";
import * as memberRepo from "./repo-members";

/** The PIN a demo household is created with — and it is deliberately never shown, because
 *  nothing on the demo ever asks for it.
 *
 *  A demo family has no second person to fetch, so both approval surfaces skip the pad
 *  outright: the kid tablet checks `state.family?.demo_at` before opening it
 *  (public/kid/js/waiting.js), and `parentAuth` authorizes a demo household directly. It
 *  is still SET so a demo family is a well-formed family rather than a special case with
 *  a hole in it, and so that a household which somehow left demo mode is not left open.
 *
 *  This comment used to claim the value was "shown on the demo landing so a visitor can
 *  use the on-tablet parent PIN pad too". It was not shown, and the pad does not open —
 *  which is what issue #15 was filed about, from the other direction. Printing it would
 *  add a second place to keep in step for a prompt that no longer appears. */
export const DEMO_PIN = "1234";

/**
 * EVERY seeded amount below is in DOLLARS, and is converted to whole NIM at today's
 * rate when the family is minted.
 *
 * It used to be flat NIM — a chore paid 1 or 2 NIM. The Treasure Box is priced in real
 * money (src/sticker-catalog.ts: a sticker pack is ~$0.93, which is ~2,000 NIM), so a
 * kid earning 5 NIM a day needed about two hundred days of chores to afford the cheapest
 * thing on the shelves. Every visitor to the public demo met the Treasure Box as a wall
 * of unaffordable items and the buy sheet only ever said "Go earn some", which meant the
 * spend-it-back half of the circle — the half the README, the marketing page and the
 * roadmap all describe — could not be reached by anyone. That was issue #29.
 *
 * Dollars are the fix rather than bigger NIM numbers: the shelves are priced in dollars
 * too, so pricing the seed the same way keeps the two in step by construction and neither
 * goes stale when NIM moves. `POST /chores` has always taken `rewardUsd` and this is the
 * same conversion (see ./rates), so the seeder is no longer a second pricing scheme.
 */
export interface SeedChore {
  /** src/title-catalog.ts job id. The words and the emoji come from there, so
   *  the demo board is in the visitor's language rather than in ours. */
  job: string;
  /** Dollars. Converted to whole NIM at mint time and FIXED there, like every reward. */
  usd: number;
  /** 'open' = on the board, 'submitted' = waiting for the parent's yes. */
  status?: "open" | "submitted";
  kind?: "lesson";
  subject?: "math" | "coding";
  /**
   * Seconds. A chore with one offers "use timer" on its done sheet and opens the egg
   * timer; without one the sheet is yes/not-yet only (`done.js`: the button renders on
   * `durationS > 0`).
   *
   * ⚠️ A CHORE'S TIMER IS LOCAL. Unlike a routine task there is no `started_at` column
   * and no `/start` verb, so it cannot be resumed — leaving the screen abandons the
   * count. That is fine for a demo and is why only ONE chore carries this: the point is
   * that a judge can reach the timer from a chore at all, not that every card offers a
   * clock the app cannot resume.
   */
  durationS?: number;
}

/**
 * A job already done and paid: one REAL on-chain payout, and one sticker on the
 * week grid.
 *
 * `sticker` is a starter-pack id (src/sticker-catalog.ts). Without it the chart
 * home -- which is the kid app's front door, and whose whole premise is "the
 * current week's sticker grid" -- opens completely blank on a fresh demo, since
 * a seeded payout writes a ledger row and an approved chore but never a
 * PLACEMENT. `x`/`y`/`tilt` are the hand-placed look: a kid drops these by
 * finger and they are never centred or square, so seeding them at dead centre
 * reads as a machine's work rather than a child's.
 */
export interface SeedHistory {
  /** src/title-catalog.ts job id. The words and the emoji come from there. */
  job: string; usd: number;
  sticker: string; x: number; y: number; tilt: number;
}

export interface SeedKid {
  label: string;
  emoji: string;
  chores: SeedChore[];
  /** Jobs already done and paid — one REAL on-chain payout each. */
  history: SeedHistory[];
  routine: {
    /** src/title-catalog.ts routine id ('morning' | 'bedtime'). */
    routine: string; slot: "morning" | "evening"; emoji: string;
    /** Dollars per task, same conversion as a chore. */
    taskUsd: number;
    tasks: { job: string; seconds: number }[];
  };
}

/**
 * What every demo visitor wakes up to. Two kids so the family/leaderboard views have
 * something to compare, one submitted chore EACH so the very first thing a judge can do
 * is approve a payout and watch NIM land, and a lesson chore so Learn-to-Earn is visible
 * without hunting for it.
 */
export const DEMO_KIDS: readonly SeedKid[] = [
  {
    label: "Sam",
    emoji: "🦖",
    chores: [
      { job: "dishwasher", usd: 1.0, status: "submitted" },
      // ⚠️ ONE timed chore per kid, deliberately. A judge opens whichever kid they land
      // on, so both need a way into the egg timer from a CHORE — but a board where every
      // card carries a clock implies chores are timed by nature, and they are not.
      { job: "bed", usd: 0.5, durationS: 3 * 60 },
      { job: "dogfeed", usd: 0.25 }, // the sub-cent-fee beat: the smallest job on the board still pays
      { job: "mathlesson", usd: 2.0, kind: "lesson", subject: "math" },
    ],
    // Paid for real, on chain, at mint. Sized so the kid lands ABOVE the cheapest
    // sticker pack (~$0.93) with change left over, because a demo that opens on a
    // Treasure Box it cannot afford is the bug this seed exists to avoid.
    history: [
      { job: "trash", usd: 1.0, sticker: "stk-dino", x: 46, y: 41, tilt: -8 },
      { job: "dogwalk", usd: 0.75, sticker: "stk-paw", x: 55, y: 57, tilt: 6 },
    ],
    routine: {
      routine: "morning",
      slot: "morning",
      emoji: "🌅",
      taskUsd: 0.1,
      tasks: [
        { job: "dressed", seconds: 5 * 60 },
        { job: "teeth", seconds: 2 * 60 },
        { job: "bag", seconds: 3 * 60 },
      ],
    },
  },
  {
    label: "Ava",
    emoji: "🦄",
    chores: [
      { job: "laundry", usd: 1.0, status: "submitted" },
      { job: "plants", usd: 0.5, durationS: 2 * 60 },
      { job: "table", usd: 0.25 },
      { job: "codinglesson", usd: 2.0, kind: "lesson", subject: "coding" },
    ],
    history: [
      { job: "piano", usd: 0.75, sticker: "stk-star", x: 52, y: 44, tilt: 9 },
      { job: "read20", usd: 0.5, sticker: "stk-rainbow", x: 44, y: 59, tilt: -5 },
    ],
    routine: {
      routine: "bedtime",
      slot: "evening",
      emoji: "🌙",
      taskUsd: 0.1,
      tasks: [
        { job: "room", seconds: 5 * 60 },
        { job: "pajamas", seconds: 3 * 60 },
        { job: "teeth", seconds: 2 * 60 },
      ],
    },
  },
];

/** Dollars the seeded history pays out per demo family, before any floor is applied.
 *  Rate-free, so ops can reason about the authored intent without asking what NIM is
 *  worth this minute. */
export function seedHistoryUsd(): number {
  return DEMO_KIDS.reduce((sum, k) => sum + k.history.reduce((s, h) => s + h.usd, 0), 0);
}

/** Every item currently offered, as `[shelf, priceLuna]`. Read from the catalogue rather
 *  than restated here, so repricing the shelves moves the seed with them. */
function offeredItems(): { shelf: string; priceLuna: number }[] {
  return [
    ...packStoreItems().map((i) => ({ shelf: i.categoryId, priceLuna: i.priceLuna })),
    ...Object.entries(OTHER_STORE_ITEMS)
      .filter(([, def]) => !def.retired)
      .map(([id, def]) => ({
        shelf: id.startsWith("item-screen") ? "cat-screen" : "cat-coupons",
        priceLuna: def.priceLuna,
      })),
  ];
}

/** Cheapest thing on the shelves right now, in luna. Being able to buy it is the demo's
 *  entire job, so it is read from the catalogue rather than restated here. */
function cheapestShelfLuna(): number {
  return Math.min(...offeredItems().map((i) => i.priceLuna));
}

/**
 * One of EVERY item in the catalogue, plus the cheapest again as change.
 *
 * The floor has climbed twice, and each step was the same lesson learned at a finer grain.
 * It began as twice the cheapest shelf, which cleared a sticker pack and nothing else. Then
 * it became one of the cheapest item on every SHELF (Andjroo, 2026-08-01: "they should be
 * able to purchase things and try everything"), which unlocked all three categories but still
 * left a tester one purchase deep: buy the dinner coupon and the 6 000 is gone, with the other
 * coupon and two thirds of the packs still out of reach.
 *
 * A tester is not a visitor sampling the idea, they are someone who has to reach every OUTCOME
 * the Box can produce — a pack that grants stickers, a screen-time unlock that opens a lock
 * window, a coupon that queues a parent approval — and to see a balance that goes down without
 * hitting zero. That is one of everything, not one of each kind.
 *
 * Computed from the live catalogue rather than authored, which is the property that has made
 * this survive two repricings: add a shelf, retire an item or change a price and the floor
 * moves with it, so the seed can never drift back under the shelves the way it did before.
 * The spare cheapest-again is kept for the original reason — a kid who spends to exactly zero
 * photographs as a kid who cannot afford anything, which is the impression this floor exists
 * to prevent.
 *
 * THE COST IS REAL AND IT IS THE POINT OF THE TRADE. Against the catalogue as of 2026-08-01
 * this is 30 000 NIM per kid, so a demo family costs about three times what it did. See
 * `docs/NEXT-SESSION.md` for the runway arithmetic; reclaim (#44) is what makes it affordable,
 * because the money now comes back when the household is swept.
 */
const SHOPPING_FLOOR = () => {
  const oneOfEverything = offeredItems().reduce((sum, i) => sum + i.priceLuna, 0);
  return oneOfEverything + cheapestShelfLuna();
};

/**
 * The factor every seeded history payout is multiplied by, so the POOREST seeded kid
 * still clears the shopping floor. 1 whenever the authored dollars already do, which is
 * the normal case.
 *
 * Dollars alone do not close #29, and the issue's premise that they would is the one
 * thing in it that does not hold. The shelves are NOT dollar-priced: sticker-catalog.ts
 * fixes a pack at 2,000 NIM whatever NIM is worth, and only records `aboutUsd` for the
 * record. So a dollar-priced history buys LESS as NIM appreciates, not the same amount —
 * it drifts away from the shelves rather than tracking them. Two ways that bites:
 *
 *   - NIM rises far enough and the demo silently returns to "you cannot afford anything".
 *   - More immediately: when CoinGecko is unreachable, `nimUsd()` falls back to the
 *     static $0.002, which is about four times the rate the shelves were priced against.
 *     Every family minted during that window would wake up too poor to shop, so an
 *     outage at the wrong moment reintroduces the exact bug on the live demo.
 *
 * Scaling keeps the authored dollars meaningful (they set the RELATIVE worth of the jobs,
 * which is what a parent is really expressing) while making the product promise hold at
 * any rate.
 */
export function historyScale(rate: number): number {
  const poorest = Math.min(
    ...DEMO_KIDS.map((k) => k.history.reduce((s, h) => s + usdToWholeNimLuna(h.usd, rate), 0)),
  );
  if (poorest <= 0) return 1;
  return Math.max(1, SHOPPING_FLOOR() / poorest);
}

/** What one seeded past job actually pays, in luna, at `rate` USD per NIM. */
export function seedEarnLuna(usd: number, rate: number): number {
  return usdToWholeNimLuna(usd * historyScale(rate), rate);
}

/**
 * What the seeded history costs one demo family, in luna, at `rate` USD per NIM.
 *
 * This is the number `HATCH_DEMO_GRANT_LUNA` has to clear. The history is paid by
 * `payKidEarn`, which does NOT consult the budget — but its rows are counted as SPENT by
 * repo-budget, so a grant smaller than this leaves the family at zero available and the
 * first thing a judge tries to approve fails with `budget_exhausted`. Priced against the
 * shelves, the history moved by three orders of magnitude, so the old 25 NIM grant no
 * longer covers it. See deploy/testnet-demo/README-TESTNET.md.
 */
export function seedHistoryLunaAt(rate: number): number {
  return DEMO_KIDS.reduce(
    (sum, k) => sum + k.history.reduce((s, h) => s + seedEarnLuna(h.usd, rate), 0),
    0,
  );
}

export interface MintedDemo {
  familyId: string;
  parentToken: string;
  deviceToken: string;
  children: { id: string; label: string; emoji: string }[];
}

/**
 * Create one visitor's private demo family, WITHOUT touching the network.
 *
 * Split from the payouts on purpose: this half is pure DB work and is what the tests
 * exercise, while payDemoHistory() is the half that needs a chain. A caller that cannot
 * reach the RPC still gets a usable family — one with an empty wallet feed, which is
 * honest, rather than a feed of earnings that never happened.
 */
export async function mintDemoFamily(hotWalletAddress: string): Promise<MintedDemo> {
  // One rate read for the whole household, so every price in it was struck at the same
  // moment. Prices are FIXED in NIM from here on, exactly like a parent-authored chore.
  const rate = await nimUsd();

  const fam = repo.createFamily("Mom", hotWalletAddress);
  repo.updateFamilySettings(fam.id, { mode: "family" });
  repo.setFamilyPin(fam.id, await hashPin(DEMO_PIN));
  stampDemo(fam.id);

  const children: MintedDemo["children"] = [];
  for (const kid of DEMO_KIDS) {
    const child = repo.createChild(fam.id, kid.label, kid.emoji);
    children.push({ id: child.id, label: child.label, emoji: child.emoji });
    // The chart read grants this lazily; the seeded placements in payDemoHistory
    // need the kid to own the stickers BEFORE anyone opens the app.
    stickersRepo.ensureStarterGrant(child.id);

    for (const ch of kid.chores) {
      const j = job(ch.job);
      const row = repo.createChore(fam.id, child.id, j.en, seedEarnLuna(ch.usd, rate), j.emoji,
        {
          titleKey: jobKey(j.id),
          ...(ch.kind === "lesson" ? { kind: "lesson" as const, subject: ch.subject ?? "math" } : {}),
          ...(ch.durationS ? { durationS: ch.durationS } : {}),
        });
      // A submitted chore is only half the state the app expects: POST /chores/:id/submit
      // also opens the parent's approval row, and without it the parent app's queue is
      // empty while the kid's board says "waiting". Seed both, exactly like the route.
      if (ch.status === "submitted") {
        repo.setChoreStatus(row.id, "submitted");
        approvalsRepo.openApproval(fam.id, child.id, "chore", row.id);
      }
    }

    // The slot is DATA now. It used to be `title.startsWith("Morning")`, which
    // is a decision made by reading English out of a title — exactly the coupling
    // that keying these titles removes, and it would have silently filed every
    // translated routine under 'evening'.
    const rt = ROUTINE_CATALOG.find((r) => r.id === kid.routine.routine)!;
    const routine = routines.createRoutine(
      fam.id, child.id, rt.en, kid.routine.slot, kid.routine.emoji, routineKey(rt.id),
    );
    for (const t of kid.routine.tasks) {
      // Dollars, like everything else here. A routine task is the smallest earn in the
      // app and used to be a flat 1 NIM, which next to a dollar-priced chore read as
      // free work.
      const j = job(t.job);
      routines.addTask(routine.id, j.en, t.seconds, {
        emoji: j.emoji, titleKey: jobKey(j.id), rewardLuna: seedEarnLuna(kid.routine.taskUsd, rate),
      });
    }
    // No lock window: a real household locks the tablet outside the routine's hours,
    // and a judge opening the demo at 3pm must not meet a locked screen.

    // ONE LADDER, on the first kid, fresh: rung one open, nothing claimed. A goal is the
    // third axis the board has (a job is today, a practice is this week, a goal is how far
    // have I got) and the climb path is the one screen a judge cannot reach without a
    // parent building a ladder first. Fresh rather than half-climbed because a climbed rung
    // is money moved, and the demo's history is real: the judge taps rung one, says yes in
    // the parent app, and the payout lands the same way a chore's does.
    if (kid === DEMO_KIDS[0]) {
      const g = goalsRepo.createGoal(fam.id, child.id, "Ride the bike",
        { emoji: "🚲", ordered: true, packId: "pack-dragons", titleKey: "cat.goal.bike" });
      const rungs: [string, number][] = [
        ["Sit on it, feet on the ground", 0.25], ["Roll along with your feet up", 0.5],
        ["Pedal with a hand on your back", 0.75], ["Ride it on your own", 1.5],
      ];
      rungs.forEach(([title, usd], i) => goalsRepo.addRung(g.id, title, {
        emoji: "🚲", rewardLuna: seedEarnLuna(usd, rate), titleKey: `cat.goal.bike.${i + 1}`,
      }));
    }
  }

  // The weeks behind this one. Here rather than in payDemoHistory because the trail is
  // free: it is work done, not money moved, so it costs no transaction and no NIM. See
  // src/demo-past.ts for why those are separable at all. The reward it takes is what a
  // future session pays, priced like a routine task, and is the only part of the trail
  // that money ever touches.
  seedPastWeeks(fam.id, children, routines.localDay(fam.tz),
    seedEarnLuna(DEMO_KIDS[0]!.routine.taskUsd, rate));

  const parentToken = newToken();
  // Bound to the owner rather than left null: the fallback in bearerParent is a migration
  // affordance for tokens minted before members existed, and a token minted today should
  // carry the answer rather than make that path load-bearing.
  lockRepo.createParentToken(fam.id, "Demo parent", await sha256Hex(parentToken), memberRepo.ownerOf(fam.id)?.id);
  const deviceToken = newToken();
  lockRepo.createDevice(fam.id, "Demo tablet", await sha256Hex(deviceToken), null);

  return { familyId: fam.id, parentToken, deviceToken, children };
}

/**
 * Pay the seeded history for real, one on-chain tx per past job, and mark the matching
 * chore approved so the board shows the trail that produced the balance.
 *
 * Best-effort by design: a payout that fails leaves NO ledger row and NO approved chore,
 * so the demo degrades to a smaller history instead of claiming money that never moved.
 * Returns how many payouts landed.
 */
function seedDays(tz: string): string[] {
  const today = routines.localDay(tz);
  const elapsed = weekDays(mondayOf(today)).filter((d) => d <= today);
  return elapsed.length ? elapsed : [today];
}

/**
 * Half past five on a local day in `tz`, as epoch ms: the moment a seeded job "was said yes
 * to". The wall-clock reading is taken as if it were UTC and the zone's offset AT that
 * instant is subtracted; the second pass is for a candidate that straddles a DST edge,
 * where the offset read at the first guess is the wrong side's.
 */
export function localAfternoonMs(tz: string, day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 17, 30);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const offsetAt = (ms: number) => {
    const p = fmt.formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

export async function payDemoHistory(familyId: string, children: { id: string; label: string }[]): Promise<number> {
  const fam = repo.getFamily(familyId);
  if (!fam) return 0;
  const rate = await nimUsd();
  const days = seedDays(fam.tz);
  const owner = memberRepo.ownerOf(fam.id)?.id ?? null;
  let paid = 0;
  for (const kid of DEMO_KIDS) {
    const child = children.find((c) => c.label === kid.label);
    if (!child) continue;
    for (const [i, h] of kid.history.entries()) {
      const luna = seedEarnLuna(h.usd, rate);
      try {
        const j = job(h.job);
        const chore = repo.createChore(fam.id, child.id, j.en, luna, j.emoji, { titleKey: jobKey(j.id) });
        // The on-chain memo stays English on purpose: it is written once, into an
        // immutable transaction, and no device's language setting can be the right
        // one for a record that outlives the app.
        await payKidEarn(fam, child.id, luna, j.en);
        repo.setChoreStatus(chore.id, "approved");
        const day = days[i % days.length]!;
        // THE PARENT'S PROGRESS TAB COUNTS APPROVALS, NOT CHORE STATUS. The status above is
        // what the kid's board reads; the parent's "Jobs done" reads `approvals.decided_at`,
        // and with no row there it said 0 over a week of paid work. The row is decided by the
        // household's owner, the way a real yes from the phone is, and moved onto the day the
        // sticker sits on so the chart and the grid tell one story.
        //
        // The LEDGER row stays stamped now, deliberately: it is a real payout still settling,
        // and settlement measures its age from `created_at` (earn-settlement.ts), so a row
        // backdated five days would read as unresolved before the chain had a chance.
        const at = localAfternoonMs(fam.tz, day);
        const approval = approvalsRepo.openApproval(fam.id, child.id, "chore", chore.id);
        approvalsRepo.decideApproval(approval.id, "approved", "remote", null, null, owner);
        getDb().run("UPDATE approvals SET created_at=?, decided_at=? WHERE id=?", [at - 60_000, at, approval.id]);
        // 'shined' is the approved state: the sticker carries the golden shine a
        // parent's yes puts on it, which is what makes the grid read as a week of
        // finished work rather than a week of pending claims.
        stickersRepo.placeSticker({
          childId: child.id, subjectKind: "chore", subjectId: chore.id,
          day, stickerId: h.sticker,
          xPct: h.x, yPct: h.y, tiltDeg: h.tilt, state: "shined",
        });
        paid += 1;
      } catch {
        /* RPC hiccup: skip this row rather than fake it */
      }
    }
  }
  return paid;
}

// ---- throwaway bookkeeping ----

function stampDemo(familyId: string): void {
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now(), familyId]);
}

/** Ids of demo families minted before `cutoffMs`. */
export function staleDemoFamilies(cutoffMs: number): string[] {
  return staleDemoFamilyRows(cutoffMs).map((r) => r.id);
}

/** As `staleDemoFamilies`, with the stamp the sweeper needs to age a failed reclaim. */
export function staleDemoFamilyRows(cutoffMs: number): { id: string; demo_at: number }[] {
  return getDb()
    .query("SELECT id, demo_at FROM families WHERE demo_at IS NOT NULL AND demo_at < ? ORDER BY demo_at")
    .all(cutoffMs) as { id: string; demo_at: number }[];
}

/**
 * Delete a family and everything hanging off it, child rows first.
 *
 * SQLite here runs with `PRAGMA foreign_keys = ON` and the schema declares NO
 * `ON DELETE CASCADE`, so the order below is load-bearing: any table that points at a
 * row must be emptied before that row goes. Anything on-chain (the kids' accounts and
 * their NIM) is untouched — this only forgets the household, it cannot claw money back.
 */
export async function purgeFamily(familyId: string): Promise<void> {
  const db = getDb();
  const kidIds = (db.query("SELECT id FROM children WHERE family_id=?").all(familyId) as { id: string }[]).map((r) => r.id);
  const routineIds = (db.query("SELECT id FROM routines WHERE family_id=?").all(familyId) as { id: string }[]).map((r) => r.id);
  const list = (ids: string[]) => ids.map(() => "?").join(",");
  // READ THE PATHS BEFORE THE ROWS GO. `media_assets.path` is the only record of where each
  // uploaded file lives, so deleting the row first strands the file with nothing pointing at
  // it and no query that could even enumerate which files are orphans. See the unlink below.
  const mediaPaths = (db.query("SELECT path FROM media_assets WHERE family_id=?")
    .all(familyId) as { path: string }[]).map((r) => r.path);

  db.transaction(() => {
    if (routineIds.length) {
      db.run(`DELETE FROM task_runs WHERE run_id IN (SELECT id FROM routine_runs WHERE routine_id IN (${list(routineIds)}))`, routineIds);
      db.run(`DELETE FROM routine_runs WHERE routine_id IN (${list(routineIds)})`, routineIds);
      db.run(`DELETE FROM lock_windows WHERE routine_id IN (${list(routineIds)})`, routineIds);
      db.run(`DELETE FROM routine_tasks WHERE routine_id IN (${list(routineIds)})`, routineIds);
    }
    // The curfew is family-scoped and holds no children FK, so the table-list test cannot
    // see a miss here; without this a purged household's hours would outlive it and land on
    // whatever family later reused the id.
    db.run("DELETE FROM allow_windows WHERE family_id=?", [familyId]);
    db.run("DELETE FROM routines WHERE family_id=?", [familyId]);
    db.run("DELETE FROM star_events WHERE family_id=?", [familyId]);
    db.run("DELETE FROM send_requests WHERE family_id=?", [familyId]);
    db.run("DELETE FROM approvals WHERE family_id=?", [familyId]);
    db.run("DELETE FROM wallet_events WHERE family_id=?", [familyId]);
    db.run("DELETE FROM kid_purchases WHERE family_id=?", [familyId]);
    db.run("DELETE FROM kid_debits WHERE family_id=?", [familyId]);
    // #354. A savings target holds a children FK, so a purge that skips it strands a row
    // pointing at a kid who no longer exists — which is exactly what the table-list test guards.
    db.run("DELETE FROM savings_targets WHERE family_id=?", [familyId]);
    if (kidIds.length) {
      // Children of a practice, deepest first: a tick points at a STEP and at a SESSION, so
      // both of its parents have to outlive it by exactly one statement. Neither table
      // carries a children FK, so `demo-family.test.ts` cannot catch a miss here — a demo
      // household with a stepped practice would simply refuse to purge, forever.
      db.run(
        `DELETE FROM practice_step_ticks WHERE session_id IN
           (SELECT id FROM practice_sessions WHERE practice_id IN
             (SELECT id FROM practices WHERE family_id=?))`, [familyId],
      );
      db.run(`DELETE FROM practice_steps WHERE practice_id IN (SELECT id FROM practices WHERE family_id=?)`, [familyId]);
      db.run(`DELETE FROM practice_sessions WHERE practice_id IN (SELECT id FROM practices WHERE family_id=?)`, [familyId]);
      db.run(`DELETE FROM goal_rungs WHERE goal_id IN (SELECT id FROM goals WHERE family_id=?)`, [familyId]);
      // #377. The meter's per-day history hangs off the child, so a purge that skips it
      // strands rows pointing at a kid who is gone — the same shape as savings_targets above.
      db.run(`DELETE FROM screen_usage WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM sticker_placements WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM kid_stickers WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM stickers WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM kid_unlocks WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM kid_switch_secrets WHERE child_id IN (${list(kidIds)})`, kidIds);
      db.run(`DELETE FROM kid_prefs WHERE child_id IN (${list(kidIds)})`, kidIds);
    }
    // payout_attempts and kid_address_challenges both carry a child_id FK and were both
    // missed, so any household that had ever recorded a payout attempt could NEVER be purged:
    // `DELETE FROM children` threw SQLITE_CONSTRAINT_FOREIGNKEY, and because the throw escaped
    // the sweep loop it took every household after it in that cycle down too. Measured on the
    // live testnet instance 2026-08-01: a sweep of 82 stale families managed 33 before dying.
    // The list here must cover EVERY table with a children FK — `demo-family.test.ts` derives
    // that list from the schema and fails if this one falls behind, because this is the third
    // time a new table has been added without being added here.
    db.run("DELETE FROM payout_attempts WHERE family_id=?", [familyId]);
    db.run("DELETE FROM kid_address_challenges WHERE family_id=?", [familyId]);
    db.run("DELETE FROM kid_character_sets WHERE family_id=?", [familyId]);
    db.run("DELETE FROM practices WHERE family_id=?", [familyId]);
    // Before goals: a request points at the ladder its approval created.
    db.run("DELETE FROM goal_requests WHERE family_id=?", [familyId]);
    db.run("DELETE FROM goals WHERE family_id=?", [familyId]);
    db.run("DELETE FROM cashlinks WHERE family_id=?", [familyId]);
    db.run("DELETE FROM chores WHERE family_id=?", [familyId]);
    db.run("DELETE FROM media_assets WHERE family_id=?", [familyId]);
    db.run("DELETE FROM devices WHERE family_id=?", [familyId]);
    db.run("DELETE FROM lock_overrides WHERE family_id=?", [familyId]);
    db.run("DELETE FROM parent_tokens WHERE family_id=?", [familyId]);
    db.run("DELETE FROM pair_codes WHERE family_id=?", [familyId]);
    db.run("DELETE FROM family_budget_credits WHERE family_id=?", [familyId]);
    db.run("DELETE FROM referrals WHERE inviter_family_id=?", [familyId]);
    db.run("DELETE FROM family_invites WHERE family_id=?", [familyId]);
    // The household's grown-ups, AFTER parent_tokens and approvals above: both carry a
    // family_members FK, and a purge that took the people first would fail on the rows
    // pointing at them. Same ordering rule as children below.
    db.run("DELETE FROM member_invites WHERE family_id=?", [familyId]);
    db.run("DELETE FROM family_members WHERE family_id=?", [familyId]);
    db.run("DELETE FROM children WHERE family_id=?", [familyId]);
    db.run("DELETE FROM families WHERE id=?", [familyId]);
    // wallet_state is keyed, not foreign-keyed, so nothing above reaches the household's
    // own rows in it. They go last, with the family row they describe.
    forgetFamilyWalletState(familyId);
  })();

  // THE BYTES, NOT ONLY THE ROWS.
  //
  // This function was careful about rows and silent about files. `DELETE FROM media_assets`
  // drops the index; the JPEG stayed on the operator's disk with no row pointing at it, no
  // owner, no expiry, and no way to tell an orphan from a real family's photo. The kid app
  // hands a visitor three rear-camera capture buttons and the pitch is "try it with your
  // kid", so what a judge uploads to the public demo is plausibly a photograph of a child.
  // Every visitor mints a household; the sweeper purges it a day later; the image was kept
  // for ever, with no erasure path a visitor could invoke even if they asked for one.
  //
  // AFTER the transaction commits, deliberately: a file unlinked inside a transaction that
  // then rolls back is gone while its row survives, which is the one failure worse than the
  // one being fixed. Best-effort per file, exactly like DELETE /api/media/:id — a file
  // already missing must not strand the household that was otherwise erased cleanly.
  const dir = mediaDir();
  await Promise.all(mediaPaths.map((p) => unlink(join(dir, p)).catch(() => {})));
}

/** Default: a demo family is abandoned once it is a day old. */
export const DEMO_TTL_MS = Number(process.env.HATCH_DEMO_TTL_MS ?? 24 * 60 * 60 * 1000);

/**
 * How many TTLs a household may linger while its reclaim keeps failing.
 *
 * The sweeper must not wedge. If a kid's balance can never be swept — a node that stays down,
 * a row restored against a different seed — holding the family forever would grow the DB
 * without bound and stop the demo ever forgetting anyone. So a failed reclaim buys a retry,
 * not an exemption: past this multiple the household goes and the NIM stays where it is,
 * which is exactly the behaviour that shipped before reclaim existed.
 */
export const RECLAIM_GRACE_TTLS = Number(process.env.HATCH_DEMO_RECLAIM_GRACE_TTLS ?? 3);

/**
 * Most households one sweep will process.
 *
 * The reclaim makes two RPC calls per kid and the public node rate-limits: a backlog of 82
 * families is ~330 calls in a tight loop, and the 429s defeated even a four-attempt backoff, so
 * balances read as unreadable and the money stayed put. Capping the cycle keeps each pass inside
 * what the node will answer and lets the next tick take the next slice. A backlog drains over
 * several passes instead of failing loudly in one.
 */
export const MAX_FAMILIES_PER_SWEEP = Number(process.env.HATCH_DEMO_SWEEP_MAX ?? 12);

export interface SweepResult {
  /** Households deleted this cycle. */
  purged: number;
  /** Luna sent back to the hot wallet. */
  reclaimedLuna: number;
  /** Households left alive because their reclaim failed and they are still inside the grace window. */
  held: number;
  /** Households deleted with money still on them, because the grace window ran out. */
  abandoned: number;
  /** Households whose DELETE threw. A bug in purgeFamily's table list; never fatal to the sweep. */
  unpurgeable: number;
}

/**
 * Reclaim, then purge, every demo family older than the TTL.
 *
 * Order is the whole point: `purgeFamily` deletes the child rows that hold the derivation
 * coordinates, so once it has run there is nothing left to sign with and the money is
 * unreachable forever. Reclaim first, always.
 */
export async function sweepDemoFamilies(
  ttlMs = DEMO_TTL_MS, nowMs = Date.now(), chain?: ReclaimChain,
): Promise<SweepResult> {
  const rows = staleDemoFamilyRows(nowMs - ttlMs).slice(0, MAX_FAMILIES_PER_SWEEP);
  const out: SweepResult = { purged: 0, reclaimedLuna: 0, held: 0, abandoned: 0, unpurgeable: 0 };
  const giveUpBefore = nowMs - ttlMs * RECLAIM_GRACE_TTLS;

  for (const row of rows) {
    let clean = true;
    if (reclaimEnabled()) {
      try {
        const r = await reclaimDemoFamily(row.id, chain);
        out.reclaimedLuna += r.reclaimedLuna;
        clean = r.failed === 0;
      } catch {
        // A throw here is the household refusing to be reclaimed at all (not a demo family,
        // which cannot happen for a row this query returned). Treat it as a failed reclaim.
        clean = false;
      }
    }
    if (!clean && row.demo_at > giveUpBefore) { out.held += 1; continue; }
    if (!clean) out.abandoned += 1;
    // ONE BAD HOUSEHOLD MUST NOT END THE SWEEP. purgeFamily throws on a foreign-key it does
    // not cover, and an unguarded throw here took out every family queued behind it — the
    // sweep died a third of the way through 82 and reported nothing but a stack trace. A
    // household that cannot be deleted is a bug to fix, not a reason to stop forgetting
    // everyone else, so it is counted and skipped.
    try {
      // The purge deletes the child rows that HOLD the derivation coordinates, so a kid spend
      // still in flight across its awaits would have nothing left to sign with. Behind every
      // one of that household's spend keys, so it can only land between spends and never
      // through one. Ids sorted so two acquirers can never take them in opposite orders.
      const kidIds = repo.listChildren(row.id).map((k) => k.id).sort();
      await withChildSpendLocks(kidIds, async () => purgeFamily(row.id));
      out.purged += 1;
    } catch {
      out.unpurgeable += 1;
    }
  }
  return out;
}
