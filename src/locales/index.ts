// nimiq.kids app locales, assembled in the 5 languages the shell ships. These
// merge ON TOP of shellLocales at boot (mergeLocales(shellLocales, appLocales)),
// so the shell's own `shell.*` strings stay authoritative and the app's `app.*`
// strings come from here.

import en from "./en";
import es from "./es";
import de from "./de";
import fr from "./fr";
import pt from "./pt";
import type { Locales } from "nimiq-app-shell";
import { catEn, catEs, catDe, catFr, catPt } from "./catalog";

// `cat.*` is the titles WE author (src/title-catalog.ts) — the chores, routines
// and Treasure Box rows that used to be stored as English prose in SQLite and so
// stayed English under translated headings. Shared verbatim with parentLocales:
// the kid's board and the parent's approval queue name the same jobs, and two
// copies of "Brush your teeth" is two things to keep in step.
export const appLocales: Locales = {
  en: { ...en, ...catEn }, es: { ...es, ...catEs }, de: { ...de, ...catDe },
  fr: { ...fr, ...catFr }, pt: { ...pt, ...catPt },
};

export { en, es, de, fr, pt };
