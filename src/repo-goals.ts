// Goals domain: a LADDER a kid climbs. Single leg, then hold it thirty seconds, then both
// legs. Same conventions as repo.ts — pure functions over getDb(), no HTTP.
//
// A job answers "what today". A practice answers "how often this week". A goal answers HOW
// FAR HAVE I GOT, which is neither, and that is why it is its own thing rather than another
// mode of a practice: it has no day, no weekly target and no streak. A rung is reached ONCE,
// ever, and the ladder is finished when the top one is.
//
// The money rule is the CHORE's, not the practice's: a rung carries its own price and the
// parent's yes pays it. What is new is only which rungs a kid may claim, and even that is the
// parent's call per goal — `ordered` (Andjroo, 2026-08-04: "sometimes it could be any of them,
// sometimes they don't need to go in order").

import { getDb } from "./db";
import { latestApprovalFor } from "./repo-approvals";
import * as stickersRepo from "./repo-stickers";

export interface Goal {
  id: string; family_id: string; child_id: string;
  title: string; title_key: string | null; emoji: string;
  ordered: number;
  /** The sticker THEME this ladder collects toward, or null for a plain ladder that pays NIM
   *  and nothing else. See schema.sql: the theme is on the goal, never on the rung. */
  pack_id: string | null;
  active: number; created_at: number;
}
export interface GoalRung {
  id: string; goal_id: string; position: number;
  title: string; title_key: string | null; emoji: string;
  reward_luna: number; active: number;
}

/**
 * Where a rung stands.
 *
 *   locked   an earlier rung is still to climb, on an ORDERED ladder
 *   open     the kid's to do
 *   waiting  claimed, sitting with a grown-up
 *   climbed  approved and paid
 *
 * `open` covers a REJECTED rung deliberately, and that is the difference between a rung and
 * a practice day. A day is over and cannot be redone, so declining one refuses the payment
 * and nothing else. A rung is a thing the kid could not do YET — "not this time" sends them
 * back to try again, which is what a chore's reject has always meant.
 */
export type RungState = "locked" | "open" | "waiting" | "climbed";

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- goals ----
export function createGoal(
  familyId: string, childId: string, title: string,
  opts: { emoji?: string; ordered?: boolean; titleKey?: string | null; packId?: string | null } = {},
): Goal {
  const g: Goal = {
    id: uid(), family_id: familyId, child_id: childId, title, title_key: opts.titleKey ?? null,
    emoji: opts.emoji || "🪜",
    ordered: opts.ordered === false ? 0 : 1,
    pack_id: opts.packId ?? null,
    active: 1, created_at: now(),
  };
  getDb().run(
    `INSERT INTO goals (id, family_id, child_id, title, title_key, emoji, ordered, pack_id, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [g.id, g.family_id, g.child_id, g.title, g.title_key, g.emoji, g.ordered, g.pack_id,
      g.active, g.created_at],
  );
  return g;
}

export function getGoal(id: string): Goal | null {
  return (getDb().query("SELECT * FROM goals WHERE id=?").get(id) as Goal) ?? null;
}

/** `includeInactive` is the parent board's view only, the same rule listRoutines and
 *  listPractices follow: a retired ladder must stay reachable by whoever retired it. */
export function listGoals(familyId: string, childId?: string, includeInactive = false): Goal[] {
  const db = getDb();
  const active = includeInactive ? "" : "AND active=1 ";
  return (childId
    ? db.query(`SELECT * FROM goals WHERE family_id=? AND child_id=? ${active}ORDER BY created_at`)
      .all(familyId, childId)
    : db.query(`SELECT * FROM goals WHERE family_id=? ${active}ORDER BY created_at`)
      .all(familyId)) as Goal[];
}

export function updateGoal(
  id: string,
  patch: { title?: string; emoji?: string; ordered?: boolean; active?: boolean; packId?: string | null },
): Goal | null {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    // Their words now, so our key goes — the rule updateTask() and updatePractice() run.
    fields.push("title=?", "title_key=?");
    vals.push(patch.title, null);
  }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  if (patch.ordered !== undefined) { fields.push("ordered=?"); vals.push(patch.ordered ? 1 : 0); }
  if (patch.packId !== undefined) { fields.push("pack_id=?"); vals.push(patch.packId); }
  if (patch.active !== undefined) { fields.push("active=?"); vals.push(patch.active ? 1 : 0); }
  if (!fields.length) return getGoal(id);
  vals.push(id);
  getDb().run(`UPDATE goals SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
  return getGoal(id);
}

// ---- rungs ----
export function addRung(
  goalId: string, title: string,
  opts: { emoji?: string; rewardLuna?: number; titleKey?: string | null; position?: number } = {},
): GoalRung {
  const db = getDb();
  const position = opts.position
    ?? ((db.query("SELECT MAX(position) AS m FROM goal_rungs WHERE goal_id=?")
      .get(goalId) as { m: number | null }).m ?? -1) + 1;
  const r: GoalRung = {
    id: uid(), goal_id: goalId, position, title, title_key: opts.titleKey ?? null,
    emoji: opts.emoji || "🪜", reward_luna: Math.max(0, Math.round(opts.rewardLuna ?? 0)), active: 1,
  };
  db.run(
    `INSERT INTO goal_rungs (id, goal_id, position, title, title_key, emoji, reward_luna, active)
     VALUES (?,?,?,?,?,?,?,?)`,
    [r.id, r.goal_id, r.position, r.title, r.title_key, r.emoji, r.reward_luna, r.active],
  );
  return r;
}

export function getRung(id: string): GoalRung | null {
  return (getDb().query("SELECT * FROM goal_rungs WHERE id=?").get(id) as GoalRung) ?? null;
}

export function listRungs(goalId: string, includeInactive = false): GoalRung[] {
  const active = includeInactive ? "" : "AND active=1 ";
  return getDb().query(`SELECT * FROM goal_rungs WHERE goal_id=? ${active}ORDER BY position`)
    .all(goalId) as GoalRung[];
}

export function updateRung(
  id: string, patch: { title?: string; emoji?: string; rewardLuna?: number; active?: boolean },
): GoalRung | null {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) { fields.push("title=?", "title_key=?"); vals.push(patch.title, null); }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  if (patch.rewardLuna !== undefined) {
    fields.push("reward_luna=?"); vals.push(Math.max(0, Math.round(patch.rewardLuna)));
  }
  if (patch.active !== undefined) { fields.push("active=?"); vals.push(patch.active ? 1 : 0); }
  if (!fields.length) return getRung(id);
  vals.push(id);
  getDb().run(`UPDATE goal_rungs SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
  return getRung(id);
}

// ---- where the climb has got to ----

/**
 * A rung's state, read off its APPROVAL rather than off a column.
 *
 * The same choice `practiceView().payState` makes, for the same reason: the approval is the
 * record of what the parent decided, and under parent custody it is not decided until the
 * signed bytes are on the wire. A second place to write "climbed" is a second place for it to
 * disagree with whether the money moved.
 *
 * `locked` is NOT read here — it depends on the rungs beside this one, which a single rung
 * cannot see. `goalView` resolves it against the whole ladder.
 */
export function rungState(rungId: string): Exclude<RungState, "locked"> {
  const a = latestApprovalFor("goal_rung", rungId);
  if (!a) return "open";
  return a.status === "pending" ? "waiting" : a.status === "approved" ? "climbed" : "open";
}

/** Is any rung of this ladder sitting with a grown-up? The freeze the parent's edits take. */
export function hasRungAwaitingApproval(goalId: string): boolean {
  return listRungs(goalId, true).some((r) => rungState(r.id) === "waiting");
}

/**
 * Everything the apps need to draw one ladder.
 *
 * ⚠️ `locked` is resolved HERE, across the whole ladder, because whether a rung may be
 * claimed is a fact about its NEIGHBOURS. On an ordered ladder a rung opens only once every
 * rung below it has been climbed — a rung still WAITING does not open the next one, or a kid
 * could claim the whole ladder in the minute before a parent looks at their phone.
 *
 * On an unordered ladder nothing is ever locked. Both shapes exist because both happen: a
 * plank held longer every week is a sequence, five swimming badges are not.
 */
export function goalView(g: Goal, includeInactiveRungs = false) {
  const rungs = listRungs(g.id, includeInactiveRungs);
  let blocked = false;
  const view = rungs.map((r) => {
    const state = rungState(r.id);
    const locked = g.ordered === 1 && blocked;
    if (state !== "climbed") blocked = true;
    return {
      id: r.id, title: r.title, titleKey: r.title_key, emoji: r.emoji,
      rewardLuna: r.reward_luna, active: !!r.active,
      state: (locked ? "locked" : state) as RungState,
    };
  });
  const climbed = view.filter((r) => r.state === "climbed").length;
  return {
    id: g.id, title: g.title, titleKey: g.title_key, emoji: g.emoji,
    ordered: g.ordered === 1,
    packId: g.pack_id,
    // How the THEME is going, which is a fact about the kid's whole collection and not about
    // this ladder: the same five dragons are collected across every ladder set to that theme.
    // Null when the ladder collects nothing, which is every goal built before 2026-08-04.
    theme: g.pack_id ? stickersRepo.themeProgress(g.child_id, g.pack_id) : null,
    active: !!g.active,
    rungs: view,
    climbed,
    total: view.length,
    done: view.length > 0 && climbed === view.length,
    // What is left on the ladder, so a card can say what finishing it is worth without
    // adding up the rungs the kid has already been paid for.
    leftLuna: view.filter((r) => r.state !== "climbed").reduce((n, r) => n + r.rewardLuna, 0),
  };
}

/** May the kid claim this rung right now? The server's own answer, never the client's. */
export function rungClaimable(goal: Goal, rungId: string): boolean {
  const rung = getRung(rungId);
  if (!rung || !rung.active || rung.goal_id !== goal.id || !goal.active) return false;
  return goalView(goal).rungs.find((r) => r.id === rungId)?.state === "open";
}
