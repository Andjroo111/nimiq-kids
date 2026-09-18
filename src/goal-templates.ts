// The goal templates the parent climb offers at step 5 (routes/onboard.ts `goal.template`).
//
// A GOAL IS NOT A CHORE. Andjroo, 2026-09-18: nimiq.kids has two separate things, the
// everyday loop (jobs and routines on the board, done today, approved, paid) and GOALS, a
// hexagon ladder with a prize at the top whose rungs are things a kid has to MANAGE
// ("what do they have to manage?" is the rung sheet's own prompt). Step 5 had merged them:
// the first goal's rungs were the three starter chores. They are goal-shaped now: a skill in
// three or four steps, climbed in order. The starter chores still land on the board as the
// everyday jobs they are (SAMPLE_CHORES, starter-board.ts).
//
// Titles are CATALOG KEYS (cat.goal.<id>, cat.goal.<id>.<n> in src/locales/catalog.ts), so a
// ladder built here is in the kid's language on the tablet, the way the demo's own ladder is.
// Every step pays the same modest amount: the prize is the theme, the NIM is encouragement.

export interface GoalTemplate {
  id: string;
  emoji: string;
  /** The drawn icon the picker shows (a src/task-icons.ts id, public/assets/icons/<icon>.png).
   *  Every template has one: an emoji on the picker is old art (Andjroo, 2026-09-18), so a
   *  template with no drawn icon is not offered. Bike and swim wait on their icons. */
  icon: string;
  /** Number of steps; the keys are cat.goal.<id>.1 .. .<steps>. */
  steps: number;
  /** What each step pays, in dollars, resolved to whole NIM at onboard time like a chore. */
  rewardUsd: number;
}

export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  { id: "shoes", emoji: "👟", icon: "shoes", steps: 3, rewardUsd: 0.5 },
  { id: "read", emoji: "📚", icon: "book", steps: 3, rewardUsd: 0.5 },
  { id: "piano", emoji: "🎹", icon: "piano", steps: 3, rewardUsd: 0.5 },
  { id: "name", emoji: "✏️", icon: "pencilpaper", steps: 3, rewardUsd: 0.5 },
];

export const DEFAULT_GOAL_TEMPLATE = "shoes";

export const goalTemplate = (id: unknown): GoalTemplate | null =>
  typeof id === "string" ? (GOAL_TEMPLATES.find((t) => t.id === id) ?? null) : null;

export const goalTitleKey = (id: string) => `cat.goal.${id}`;
export const goalStepKey = (id: string, n: number) => `cat.goal.${id}.${n}`;

/** Every key the templates expect a locale to define; the parity test reads this. */
export function goalTemplateKeys(): string[] {
  return GOAL_TEMPLATES.flatMap((t) => [
    goalTitleKey(t.id),
    ...Array.from({ length: t.steps }, (_, i) => goalStepKey(t.id, i + 1)),
  ]);
}
