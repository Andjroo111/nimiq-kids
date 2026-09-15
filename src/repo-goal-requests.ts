// A kid asking for a goal ladder (#389).
//
// The whole point of the shape is that a request carries WHICH SET and nothing else. Title,
// target and rungs are settled by the grown-up and the kid together when it is approved, so
// there is no path here that turns a tap into a ladder with terms nobody agreed.

import { getDb } from "./db";

const uid = () => crypto.randomUUID();
const now = () => Date.now();

export interface GoalRequest {
  id: string; family_id: string; child_id: string; pack_id: string;
  note: string | null; status: string; goal_id: string | null;
  created_at: number; decided_at: number | null;
}

/** Pending requests only — the kid's screen shows "asked" off this, and the parent's queue
 *  is the same list. A decided row is kept but is nobody's to-do any more. */
export function listPending(familyId: string, childId?: string): GoalRequest[] {
  const db = getDb();
  return childId
    ? db.query("SELECT * FROM goal_requests WHERE family_id=? AND child_id=? AND status='pending' ORDER BY created_at")
        .all(familyId, childId) as GoalRequest[]
    : db.query("SELECT * FROM goal_requests WHERE family_id=? AND status='pending' ORDER BY created_at")
        .all(familyId) as GoalRequest[];
}

export function listForChild(childId: string): GoalRequest[] {
  return getDb().query("SELECT * FROM goal_requests WHERE child_id=? ORDER BY created_at DESC")
    .all(childId) as GoalRequest[];
}

export function get(id: string): GoalRequest | null {
  return (getDb().query("SELECT * FROM goal_requests WHERE id=?").get(id) as GoalRequest) ?? null;
}

/** The kid's ask. Returns the EXISTING pending row when they ask for the same pack twice:
 *  a kid tapping a set they already asked for should not stack five identical cards in a
 *  grown-up's queue, and the second tap is the same wish, not a new one. */
export function create(familyId: string, childId: string, packId: string, note: string | null): GoalRequest {
  const open = getDb().query(
    "SELECT * FROM goal_requests WHERE child_id=? AND pack_id=? AND status='pending'",
  ).get(childId, packId) as GoalRequest | null;
  if (open) return open;

  const r: GoalRequest = {
    id: `gr-${uid()}`, family_id: familyId, child_id: childId, pack_id: packId,
    note, status: "pending", goal_id: null, created_at: now(), decided_at: null,
  };
  getDb().run(
    `INSERT INTO goal_requests (id, family_id, child_id, pack_id, note, status, goal_id, created_at, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [r.id, r.family_id, r.child_id, r.pack_id, r.note, r.status, r.goal_id, r.created_at, r.decided_at],
  );
  return r;
}

/** Decide it. `goalId` is the ladder an approval created — stored so the kid's screen can
 *  point at the thing their ask turned into, and so an approved request can never be
 *  mistaken for one still waiting. */
export function decide(id: string, status: "approved" | "declined", goalId: string | null = null): GoalRequest | null {
  getDb().run(
    "UPDATE goal_requests SET status=?, goal_id=?, decided_at=? WHERE id=? AND status='pending'",
    [status, goalId, now(), id],
  );
  return get(id);
}
