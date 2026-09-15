// TWO SIBLINGS, ONE TABLET (#432). This is the half a server test cannot reach.
//
// The shell's `setLanguage` PERSISTS: `createI18n` writes every call to localStorage and reads
// that key back at the next boot, ahead of the browser's own preference. So a per-kid setting
// silently becomes a device-wide one unless something stops it:
//
//   Sam is Spanish -> setLanguage("es") -> storage says "es"
//   Ava has chosen nothing -> storage wins -> Ava reads Spanish, forever
//
// And it presents as the app ignoring Ava's setting, when the truth is she has none. Every
// assertion below is a step of that sequence, run against a fake tablet.
import { test, expect } from "bun:test";
import { applyKidLang, deviceLang, DEVICE_LANG_KEY } from "../public/kid/js/kid-lang.js";

/** A tablet: a shell whose setLanguage persists exactly the way the real one does, plus the
 *  storage it persists into. `boot()` is a fresh page load reading that same storage back. */
function tablet(browserLang = "de") {
  const store = new Map<string, string>();
  const SHELL_KEY = "nimiq-shell-lang";
  let current = store.get(SHELL_KEY) ?? browserLang;
  const deps = {
    getLanguage: () => current,
    // The real one writes storage. That is the whole hazard.
    setLanguage: (id: string) => { current = id; store.set(SHELL_KEY, id); },
    read: (k: string) => store.get(k) ?? null,
    write: (k: string, v: string) => { store.set(k, v); },
  };
  return {
    deps,
    store,
    get language() { return current; },
    /** A fresh boot: the shell resolves storage first, exactly as createI18n does. */
    boot() { current = store.get(SHELL_KEY) ?? browserLang; },
  };
}

test("a kid with no language of their own gets the device's, untouched", () => {
  const t = tablet("de");
  expect(applyKidLang({ lang: null }, t.deps)).toBe("de");
  expect(t.language).toBe("de");
});

test("a kid with a language gets it", () => {
  const t = tablet("de");
  applyKidLang({ lang: "es" }, t.deps);
  expect(t.language).toBe("es");
});

test("THE LEAK: a sibling with no language does not inherit the last kid's", () => {
  const t = tablet("de");
  applyKidLang({ lang: "es" }, t.deps);      // Sam
  expect(t.language).toBe("es");
  applyKidLang({ lang: null }, t.deps);      // Ava, who has chosen nothing
  expect(t.language).toBe("de");             // NOT "es"
});

test("THE LEAK ACROSS A REBOOT, which is how it would actually be met", () => {
  const t = tablet("de");
  applyKidLang({ lang: "es" }, t.deps);      // Sam, yesterday
  t.boot();                                  // the tablet is turned off and on
  // The shell alone would resolve "es" here, because that is what it persisted.
  expect(t.language).toBe("es");
  applyKidLang({ lang: null }, t.deps);      // Ava taps her own face
  expect(t.language).toBe("de");
});

test("the device's answer is captured ONCE, never re-read from the shell", () => {
  const t = tablet("de");
  expect(deviceLang(t.deps)).toBe("de");
  expect(t.store.get(DEVICE_LANG_KEY)).toBe("de");
  applyKidLang({ lang: "pt" }, t.deps);
  // Re-reading the shell here would answer "pt" and cement the leak.
  expect(deviceLang(t.deps)).toBe("de");
});

test("switching back and forth stays correct in both directions", () => {
  const t = tablet("fr");
  for (let i = 0; i < 3; i++) {
    applyKidLang({ lang: "es" }, t.deps);
    expect(t.language).toBe("es");
    applyKidLang({ lang: null }, t.deps);
    expect(t.language).toBe("fr");
  }
});

test("storage that throws does not take the tablet down", () => {
  const bang = () => { throw new Error("private mode"); };
  // main.js wraps both accessors; this asserts the module survives them returning nothing.
  const deps = {
    getLanguage: () => "en",
    setLanguage: () => {},
    read: () => null,
    write: () => { try { bang(); } catch { /* swallowed, as main.js does */ } },
  };
  expect(applyKidLang({ lang: null }, deps)).toBe("en");
  expect(applyKidLang({ lang: "es" }, deps)).toBe("es");
});
