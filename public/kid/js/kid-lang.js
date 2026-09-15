// nimiq.kids kid app — WHICH LANGUAGE THIS TABLET READS IN, per child (#432).
//
// ⚠️ THE SHELL'S `setLanguage` PERSISTS. `createI18n` writes every call to localStorage and
// reads that same key back at the next boot, AHEAD of the browser's own preference. On a
// shared tablet that turns a per-kid setting into a device-wide one:
//
//   Sam is set to Spanish  ->  setLanguage("es")  ->  storage says "es"
//   Ava, who has chosen nothing, boots  ->  storage wins  ->  Ava reads Spanish, forever
//
// And it would look like the app ignoring Ava's setting, when the truth is she has none.
//
// So the DEVICE's own answer is captured once into a key the shell never touches, before any
// kid language is applied, and a child with no language of their own is RESTORED to it rather
// than left alone. Leaving it alone is the bug: it leaves the last sibling's language up.
//
// The capture is safe on the boot that ships this. Nothing has written a kid language yet, so
// `getLanguage()` is still the device's own answer. And the kid app mounts no language control
// at all (there is no `#lang` slot in public/kid/index.html — removed 2026-08-27, not coming
// back), so nothing else on the tablet moves it afterwards.
//
// Every dependency is injected so `src/kid-language-tablet.test.ts` can play out two siblings
// on one tablet without a browser. main.js supplies the real ones.

/** The shell never touches this key. That separation is the whole mechanism. */
export const DEVICE_LANG_KEY = "kid.deviceLang";

/**
 * The device's own language, captured the first time anyone asks and never again.
 *
 * Re-reading it later would read back whatever the last kid was set to, because that is what
 * the shell persisted, which is exactly the leak this file exists to close.
 */
export function deviceLang({ getLanguage, read, write }) {
  const stored = read(DEVICE_LANG_KEY);
  if (stored) return stored;
  const now = getLanguage() || "en";
  write(DEVICE_LANG_KEY, now);
  return now;
}

/**
 * Put the tablet into this child's language, or back into the device's own.
 *
 * Returns the language it settled on, so a caller can assert on it. A child with `lang: null`
 * is not a no-op: it is an instruction to go back to the device.
 */
export function applyKidLang(child, deps) {
  // CAPTURE FIRST, ALWAYS, even when this child has a language of their own and the captured
  // value is about to go unused. Written lazily inside the `||` below it is never reached on
  // the first call for a kid who HAS one, so nothing is captured, and the next sibling's
  // fallback reads the shell, which by then is that first kid's language. That is the leak
  // this file exists to close, and it survived the first draft of this file: two tests in
  // src/kid-language-tablet.test.ts failed on exactly it.
  const device = deviceLang(deps);
  const target = child?.lang || device;
  if (target && target !== deps.getLanguage()) deps.setLanguage(target);
  return target;
}
