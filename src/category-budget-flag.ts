/**
 * Per-category time budgets — feature flag (slice 1, docs/CATEGORY-TIME-BUDGETS.md).
 *
 * Gates only the PARENT CONTROL that writes `store_categories.budget_kind`. The column
 * itself is always present and always readable: a flag that hid the column would make the
 * migration conditional, and a schema that differs by env is the kind of thing that is
 * discovered on the live box.
 *
 * Off by default. Nothing in the ruling, the meter or the shelf reads `budget_kind` yet,
 * so turning this on changes exactly one thing: a parent can label a shelf.
 */
export const CATEGORY_BUDGETS_ENABLED = (): boolean =>
  process.env.FEATURE_CATEGORY_BUDGETS === "1";

/** The taxonomy Andjroo settled on: utility (free) / learning (free) / games (priced).
 *  `null` clears the tag; anything else is refused rather than stored, because a typo'd
 *  kind would read as "untagged" later and silently drop a shelf out of its budget. */
export const BUDGET_KINDS = ["utility", "learning", "games"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export function cleanBudgetKind(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return { ok: true, value: null };
  return (BUDGET_KINDS as readonly string[]).includes(s) ? { ok: true, value: s } : { ok: false };
}
