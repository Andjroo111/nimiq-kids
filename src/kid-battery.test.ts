// The kid app's battery corner (public/kid/js/battery.js). What is worth a test: the face is
// derived correctly from what the Battery Status API says (a 0..1 level, a boolean), the
// low state is red only when it matters, and a browser without the API gets NO pill rather
// than an empty white box in the corner.

import { test, expect, mock } from "bun:test";
import { kidIconsMock } from "./kid-icons-mock";

mock.module("../public/kid/js/icons.js", kidIconsMock);
(globalThis as { window?: unknown }).window = {};

const { batteryFace, batteryHtml, mountBattery } = await import("../public/kid/js/battery.js");

test("face: a 0..1 level becomes a whole percent, clamped", () => {
  expect(batteryFace(0.79, false).pct).toBe(79);
  expect(batteryFace(1, true).pct).toBe(100);
  expect(batteryFace(1.4, false).pct).toBe(100);
  expect(batteryFace(undefined, false).pct).toBe(0);
});

test("face: low only under 15% and OFF the charger", () => {
  expect(batteryFace(0.15, false).low).toBe(true);
  expect(batteryFace(0.16, false).low).toBe(false);
  expect(batteryFace(0.05, true).low).toBe(false);
});

test("face: the label says charging, in words a screen reader gets", () => {
  expect(batteryFace(0.5, false).label).toBe("Battery 50%");
  expect(batteryFace(0.5, true).label).toBe("Battery 50%, charging");
});

test("html: the fill IS the level, and the bolt only while charging", () => {
  const half = batteryHtml(batteryFace(0.5, false));
  expect(half).toContain('class="kb-fill" x="3" y="8" width="8"');
  expect(half).not.toContain("kb-bolt");
  expect(half).toContain("50%");
  const full = batteryHtml(batteryFace(1, true));
  expect(full).toContain('width="16"');
  expect(full).toContain("kb-bolt");
});

function fakeMount() {
  const el = {
    hidden: true, innerHTML: "", title: "", removed: false, attrs: {} as Record<string, string>,
    classes: new Set<string>(),
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    remove() { this.removed = true; },
    classList: { toggle(c: string, on: boolean) { if (on) el.classes.add(c); else el.classes.delete(c); } },
  };
  (globalThis as { document?: unknown }).document = { getElementById: (id: string) => (id === "kid-batt" ? el : null) };
  return el;
}

test("mount: no Battery API means no pill at all", async () => {
  const el = fakeMount();
  expect(await mountBattery({} as Navigator)).toBe(false);
  expect(el.removed).toBe(true);
});

test("mount: paints from the battery and follows its events", async () => {
  const el = fakeMount();
  const listeners: Record<string, () => void> = {};
  const battery = { level: 0.12, charging: false, addEventListener: (k: string, f: () => void) => { listeners[k] = f; } };
  expect(await mountBattery({ getBattery: async () => battery } as unknown as Navigator)).toBe(true);
  expect(el.hidden).toBe(false);
  expect(el.innerHTML).toContain("12%");
  expect(el.classes.has("is-low")).toBe(true);
  battery.charging = true; battery.level = 0.13;
  listeners.chargingchange!();
  expect(el.innerHTML).toContain("13%");
  expect(el.classes.has("is-low")).toBe(false);
  expect(el.attrs["aria-label"]).toBe("Battery 13%, charging");
});
