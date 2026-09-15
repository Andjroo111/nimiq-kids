// WHICH ROW AN APP BELONGS IN (#399).
//
// Andjroo, 2026-09-01: "everything is kind of be organized a little bit more, so like learning a
// little bit more like free time play games videos, but the voice recorder to go into the
// utility section, so could the timer."
//
// Twenty-five tiles in one flat grid is the same problem as the games being hard to find at all:
// a four-year-old scanning for the drawing app reads twenty-five pictures. Five rows, each one
// a word a kid can be told, is the fix.
//
// ⚠️ AN UNRECOGNISED PACKAGE IS NEVER HIDDEN. `categoryOf` falls back to `play`, so a parent who
// allowlists something new sees it appear on the tablet on the next sync. The opposite default
// (hide what we do not know) turns this file into a second, invisible allowlist that a grown-up
// cannot see and cannot edit — the allowlist is the parent's, and this only decides where a tile
// sits within it.
//
// In the shared lib, not in the kid app, for the reason box-glyphs.js is: the parent's installed-
// apps picker is the other renderer of this same list, and two copies drift (#34).

/** The rows, in the order they are drawn. `key` is also the locale suffix: app.kidGamesRowPlay. */
export const CATEGORIES = [
  { key: "play", label: "app.kidGamesRowPlay" },
  { key: "learn", label: "app.kidGamesRowLearn" },
  { key: "create", label: "app.kidGamesRowCreate" },
  { key: "watch", label: "app.kidGamesRowWatch" },
  { key: "tools", label: "app.kidGamesRowTools" },
];

/** Package to row. Anything absent is `play` — see the warning above. */
export const APP_CATEGORY = {
  // play
  "com.mojang.minecraftpe": "play",
  "com.ustwo.monumentvalley": "play",
  "com.tocaboca.tocalifeworld": "play",
  "com.tocaboca.tocakitchen2": "play",
  "com.sagosago.World.googleplay": "play",
  "com.drpanda.town.street": "play",
  "com.playpokpok.pokpok": "play",
  "com.lego.legobuildinginstructions": "play",
  // learn
  "org.inaturalist.seek": "learn",
  "com.labs.merlinbirdid.app": "learn",
  "com.noctuasoftware.stellarium_free": "learn",
  "gov.nasa": "learn",
  "com.ellotechnology.learn": "learn",
  "com.learnyland.codeland": "learn",
  "com.originatorkids.EndlessSpanish": "learn",
  "com.ululab.numbers": "learn",
  "com.duolingo.literacy": "learn",
  // create
  "com.adsk.sketchbook": "create",
  "com.cateater.stopmotionstudio": "create",
  // watch
  "com.google.android.apps.youtube.kids": "watch",
  "com.netflix.mediaclient": "watch",
  // tools
  "com.sec.android.app.camera": "tools",
  "com.sec.android.gallery3d": "tools",
  "com.sec.android.app.popupcalculator": "tools",
  "com.sec.android.app.voicenote": "tools",
  "com.sec.android.app.clockpackage": "tools",
  // Spotify Kids is music, and music is a thing you put on rather than a thing you play.
  // It sits with the other things-you-put-on until there are enough of them for a row.
  "com.spotify.kids": "watch",
  "com.gamestar.pianoperfect": "create",
};

/** The row a package belongs in. Unknown is `play`, deliberately. */
export function categoryOf(pkg) {
  return APP_CATEGORY[pkg] ?? "play";
}

/**
 * Group `apps` into the rows above, dropping every row that came out empty.
 *
 * Empty rows are dropped rather than drawn hollow because a heading with nothing under it makes
 * a kid think something was taken away. Watch holding exactly one app is not that: one tile is
 * the honest picture of how much video they get.
 *
 * `extra` is a list of {category, ...tile} that are not Android packages at all — today that is
 * only the Timer, which is a Tools tile because a timer is a thing on the tablet that is not a
 * game. They are appended to their row after the real apps.
 */
export function groupApps(apps, extra = []) {
  const bins = new Map(CATEGORIES.map((c) => [c.key, []]));
  for (const a of apps) bins.get(categoryOf(a.pkg))?.push(a);
  for (const e of extra) bins.get(e.category)?.push(e);
  return CATEGORIES
    .map((c) => ({ ...c, items: bins.get(c.key) }))
    .filter((c) => c.items.length);
}
