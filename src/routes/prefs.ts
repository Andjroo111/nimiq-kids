// Kid customization prefs (cosmetic — kid-driven, no auth) + the asset catalog.

import { Hono } from "hono";
import * as repo from "../repo";
import * as media from "../repo-media";
import * as stickersRepo from "../repo-stickers";
import { familyForSubject } from "./families";

export const prefsRoutes = new Hono();

/** The scenes every kid has always had, drawn as CSS gradients in the kid app
 *  (`BUILTIN_BGS` in public/kid/js/util.js). Free, and the two lists must stay in step:
 *  a scene here that the app cannot draw is a blank screen, and one there that is missing
 *  here is refused with `background_not_owned` the moment a kid taps it. */
const BUILTIN_BACKGROUNDS = ["meadow", "ocean", "space", "city"];

/** prefs + everything EARNED that the kid can equip: timer styles (free egg + purchased Box
 *  styles) and the wallpapers finishing a sticker theme handed over.
 *
 *  Backgrounds ride on prefs rather than on `/catalog` because they are per-CHILD: the catalog
 *  is one bundled manifest for the whole app, and a sibling who has not finished the dragons
 *  must not see the dragon valley sitting in their picker. */
const prefsView = (childId: string) => ({
  prefs: media.getPrefs(childId),
  timerStyles: stickersRepo.ownedTimerStyles(childId),
  backgrounds: stickersRepo.unlockedBackgrounds(childId),
});

prefsRoutes.get("/children/:id/prefs", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  return c.json(prefsView(child.id));
});

prefsRoutes.put("/children/:id/prefs", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.hatchMode !== undefined && body.hatchMode !== "surprise" && body.hatchMode !== "photo") {
    return c.json({ error: "invalid_hatch_mode" }, 400);
  }
  if (body.hatchAssetId) {
    const asset = media.getMedia(String(body.hatchAssetId));
    // The photo must belong to the kid's own family — no grafting another household's asset.
    if (!asset || asset.kind !== "image" || asset.family_id !== child.family_id) {
      return c.json({ error: "media_not_found" }, 404);
    }
  }
  if (body.timerStyleId !== undefined) {
    const styleId = String(body.timerStyleId);
    if (styleId !== "egg" && !stickersRepo.TIMER_STYLE_IDS.includes(styleId)) {
      return c.json({ error: "invalid_timer_style" }, 400);
    }
    // Timer styles are EARNED: only the free egg or a style bought in the Treasure Box.
    if (styleId !== "egg" && !stickersRepo.ownsUnlock(child.id, "timer_style", styleId)) {
      return c.json({ error: "style_not_owned" }, 403);
    }
  }
  // A theme's wallpaper is EARNED the same way a timer style is, so it takes the same guard.
  // The four built-in scenes stay free — they are what every kid has always had, and the
  // check has to let them through or this refuses the app's own defaults.
  for (const id of [body.backgroundId, body.timerBackgroundId]) {
    if (id === undefined || id === null) continue;
    const bg = String(id);
    if (BUILTIN_BACKGROUNDS.includes(bg)) continue;
    if (!stickersRepo.ownsBackground(child.id, bg)) {
      return c.json({ error: "background_not_owned" }, 403);
    }
  }
  media.updatePrefs(child.id, {
    background_id: body.backgroundId !== undefined ? String(body.backgroundId) : undefined,
    // Explicit null is meaningful here and must survive: it is how a kid says
    // "put the timer back on the app's scene". String(null) would write the
    // literal "null" and the timer would look for a background called that.
    timer_background_id: body.timerBackgroundId !== undefined
      ? (body.timerBackgroundId === null ? null : String(body.timerBackgroundId))
      : undefined,
    music_id: body.musicId !== undefined ? String(body.musicId) : undefined,
    timer_sound_id: body.timerSoundId !== undefined ? String(body.timerSoundId) : undefined,
    alarm_sound_id: body.alarmSoundId !== undefined ? String(body.alarmSoundId) : undefined,
    hatch_mode: body.hatchMode,
    hatch_asset_id: body.hatchAssetId !== undefined ? (body.hatchAssetId ? String(body.hatchAssetId) : null) : undefined,
    timer_style_id: body.timerStyleId !== undefined ? String(body.timerStyleId) : undefined,
  });
  return c.json(prefsView(child.id));
});

/** Bundled-asset catalog. public/assets/manifest.json is authored by the art pipeline
 *  (Phase D); until it exists the catalog is empty and the kid app falls back to defaults. */
prefsRoutes.get("/catalog", async (c) => {
  const f = Bun.file("public/assets/manifest.json");
  if (await f.exists()) return c.json(await f.json());
  return c.json({ backgrounds: [], music: [], timerSounds: [], alarms: [], animals: [] });
});
