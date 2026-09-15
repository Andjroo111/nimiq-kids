// Ambient types for kid-lang.js so src/kid-language-tablet.test.ts type-checks without pulling
// public/ JS into the compile scope (allowJs stays off, same arrangement as
// public/parent/connect-batch.d.ts).

export const DEVICE_LANG_KEY: string;

export interface KidLangDeps {
  getLanguage: () => string;
  setLanguage: (id: string) => void;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}

/** The device's own language, captured once and never re-read from the shell after that. */
export function deviceLang(deps: KidLangDeps): string;

/** Put the tablet into this child's language, or back into the device's own. Returns the
 *  language it settled on. */
export function applyKidLang(
  child: { lang?: string | null } | null | undefined,
  deps: KidLangDeps,
): string;
