// Minimal ambient types for approved.js so src/kid-approval-notice.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same
// pattern and same caveat as grow-gate.d.ts: this covers the PURE, testable exports only.
// `announceApprovals` and `markApprovalsSeen` touch localStorage and the DOM toast and are
// pinned against source instead, so they are deliberately absent. approved.js is the
// implementation of record.

/** A card off `GET /kids/:id/chart` -> `todayTasks`. Only the fields the rule reads are
 *  named; the server sends considerably more. `kind` is "task" for a routine task run and
 *  "chore" | "lesson" for a standalone job. */
export interface ChartCard {
  kind: string;
  /** Routine task runs only. */
  taskRunId?: string;
  runId?: string;
  runStatus?: string;
  routineTitle?: string;
  routineTitleKey?: string | null;
  /** Chores and lessons only. */
  choreId?: string;
  title?: string;
  titleKey?: string | null;
  status?: string;
  rewardLuna?: number;
  /** What a DECIDED approval actually paid for this subject, plus the reason if it was
   *  partial (#369). Null until a grown-up has ruled, so an open job still shows its promise.
   *  Served by settledView in src/routes/stickers.ts, never recomputed here: the amount used
   *  to be re-derived from rewardLuna and that stopped matching the server the day partial
   *  credit shipped. Every task row of a RUN carries the same run-level object. */
  settled?: { paidLuna: number; shareBps: number | null; note: string | null } | null;
  /** Routine task runs only: 1 = a side quest, the step the day finishes without (#342). */
  optional?: number;
  placement?: { day?: string; state?: string } | null;
}

/** One approval that has landed and whose sticker is still uncollected. */
export interface ApprovedSubject {
  /** `run:<runId>` or `chore:<choreId>` — what the "already told them" marker stores. */
  key: string;
  title?: string;
  titleKey?: string | null;
  /** What the server paid for this subject, in luna. Taken from `settled.paidLuna` when a
   *  grown-up has ruled, so a partial yes reports the smaller figure it really paid. */
  luna: number;
  /** Why it was not the whole amount, when a grown-up paid part of it. Null on a full yes:
   *  that is not a judgement about the work and owes no explanation. */
  note?: string | null;
  /** The picker target for the first still-uncollected card of the subject. */
  target: { kind: string; id: string };
}

/** The ring's five names: open | waiting | retry | reward | done. */
export function cardState(tk: ChartCard, all: ChartCard[]): string;

/** Has this run become the kid's to END? True only when every required step is finished, the
 *  run is still in_progress, and a side quest is sitting there unclaimed (#341). */
export function runFinishable(all: ChartCard[], runId: string): boolean;

/** Every landed-but-uncollected approval on the chart, ONE entry per approval. */
export function approvedSubjects(
  chart?: { todayTasks?: ChartCard[] } | null,
): ApprovedSubject[];

/** The subjects `seen` has not been told about yet. A missing marker means never told. */
export function freshSubjects(
  chart?: { todayTasks?: ChartCard[] } | null,
  seen?: string[] | null,
): ApprovedSubject[];

/** The one line the kid reads, for `fresh` approvals and a parent called `name`. */
export function noticeText(fresh: ApprovedSubject[], name: string): string;
