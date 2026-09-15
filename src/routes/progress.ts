// The parent's progress tracker (#379).

import { Hono } from "hono";
import * as repo from "../repo";
import { kidProgress, dayWindow } from "../repo-progress";
import { parentFamilyFrom, requireParent } from "../auth";

export const progressRoutes = new Hono();

/** How far back a parent may ask. Two weeks reads as "how is this going", ninety days as
 *  "did the thing we changed in June work". Beyond that the daily grain stops being the
 *  right question and the query stops being cheap. */
const MAX_DAYS = 90;
const DEFAULT_DAYS = 14;

/**
 * GET /api/parent/progress?days=14
 *
 * One payload for the whole household rather than a call per kid: the screen draws them
 * side by side, and two requests would render two children against two different `now`s --
 * a fortnight window that starts on different days for siblings, which is exactly the kind
 * of off-by-one that makes a parent distrust a chart.
 */
progressRoutes.get("/parent/progress", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const asked = Number(c.req.query("days"));
  const days = Number.isFinite(asked) ? Math.max(1, Math.min(MAX_DAYS, Math.round(asked))) : DEFAULT_DAYS;
  const nowMs = Date.now();

  const kids = repo.listChildren(fam.id);
  return c.json({
    days,
    window: dayWindow(fam.tz, days, nowMs),
    tz: fam.tz,
    children: kids.map((k) => ({
      id: k.id,
      label: k.label,
      emoji: k.emoji,
      ...kidProgress(k.id, fam.tz, days, nowMs),
    })),
    serverTime: nowMs,
  });
});
