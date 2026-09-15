// Minimal ambient types for esc.js so src/parent-toast-sink.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same pattern
// and same caveat as public/kid/js/util.d.ts: esc.js is the implementation of record.

/** HTML-escape for element content AND attributes, single or double quoted. */
export function esc(s: unknown): string;
