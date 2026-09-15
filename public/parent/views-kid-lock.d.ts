// Minimal ambient types for views-kid-lock.js so src/until-curfew.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same
// pattern and same caveat as the kid app's approved.d.ts: this covers the PURE, testable
// export only. `lockCard` and `wireLockCard` render and bind, and are not named here.
// views-kid-lock.js is the implementation of record.

/** Minutes from `nowMs` until the household's hours next close, or null when there is no
 *  curfew or we are already outside it — both of which would make a sheet row that either
 *  cannot be computed or expires the moment it is tapped. */
export function untilCurfewMins(nowMs?: number): number | null;
