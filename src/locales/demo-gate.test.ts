// The judge-demo gate's language, which is chosen SERVER side because this page has no
// app shell to call t() on. It is the first screen a non-English judge sees on the demo
// instance, and it was English in every language until now.

import { test, expect } from "bun:test";
import { GATE, GATE_LANGS, pickLang, networkLabel } from "./demo-gate";

const enKeys = Object.keys(GATE.en).sort();

test("ships the 5 app languages", () => {
  expect([...GATE_LANGS].sort()).toEqual(["de", "en", "es", "fr", "pt"]);
  expect(Object.keys(GATE).sort()).toEqual(["de", "en", "es", "fr", "pt"]);
});

test("every language mirrors en's keys exactly and nothing is empty", () => {
  for (const lang of GATE_LANGS) {
    expect(Object.keys(GATE[lang]).sort(), lang).toEqual(enKeys);
    for (const [k, v] of Object.entries(GATE[lang])) expect(v, `${lang}.${k}`).toBeTruthy();
  }
});

test("no em or en dashes (brand rule 18)", () => {
  for (const lang of GATE_LANGS) {
    for (const v of Object.values(GATE[lang])) expect(v).not.toMatch(/[—–]/);
  }
});

test("nothing is left in English by accident", () => {
  // "Mainnet" is a proper noun and stays; everything else should actually differ.
  for (const lang of GATE_LANGS.filter((l) => l !== "en")) {
    const same = enKeys.filter((k) => GATE[lang][k as keyof typeof GATE.en] === GATE.en[k as keyof typeof GATE.en]);
    expect(same, `${lang} untranslated`).toEqual([]);
  }
});

// ---------- negotiation ----------

test("?lang= wins outright", () => {
  // What a judge gets handed in a link, and what makes this testable without
  // spoofing a browser header.
  expect(pickLang("de-DE,de;q=0.9", "es")).toBe("es");
  expect(pickLang(null, "PT")).toBe("pt");
});

test("an unsupported or junk ?lang= falls through to the header", () => {
  expect(pickLang("fr-FR,fr;q=0.9", "klingon")).toBe("fr");
  expect(pickLang("fr-FR,fr;q=0.9", "")).toBe("fr");
  expect(pickLang("fr-FR,fr;q=0.9", "../../etc/passwd")).toBe("fr");
});

test("Accept-Language is honoured by q-value, most-preferred first", () => {
  expect(pickLang("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
  // Order in the header is NOT the ranking; q is.
  expect(pickLang("en;q=0.2,de;q=0.9")).toBe("de");
});

test("a region tag still matches its language", () => {
  // Shipping five languages and then refusing a Brazilian judge because the tag is
  // not bare "pt" would be the worst of both.
  expect(pickLang("pt-BR,pt;q=0.9")).toBe("pt");
  expect(pickLang("es-419")).toBe("es");
  expect(pickLang("de-CH")).toBe("de");
});

test("a language we do not ship falls back to English, not to a near miss", () => {
  expect(pickLang("ja-JP,ja;q=0.9")).toBe("en");
  expect(pickLang("nl,da;q=0.8")).toBe("en");
});

test("the first language we DO ship wins over an earlier one we do not", () => {
  expect(pickLang("ja,ko;q=0.9,fr;q=0.8")).toBe("fr");
});

test("a wildcard is ignored rather than treated as a match", () => {
  // `*` matching our first entry would silently hand everyone English anyway, while
  // looking in the code like negotiation was happening.
  expect(pickLang("*")).toBe("en");
  expect(pickLang("*;q=0.5,de;q=0.1")).toBe("de");
});

test("absent, empty or malformed headers give English rather than throwing", () => {
  for (const h of [undefined, null, "", "   ", ",,,", ";q=", "en;q=notanumber"]) {
    expect(() => pickLang(h)).not.toThrow();
  }
  expect(pickLang(undefined)).toBe("en");
  expect(pickLang(",,,")).toBe("en");
  // q=0 means "not acceptable" and must not be selected.
  expect(pickLang("de;q=0")).toBe("en");
});

// ---------- the network label ----------

test("the network label translates and mainnet still reads as a warning", () => {
  expect(networkLabel("test", true, "es")).toBe(GATE.es.netSim);
  expect(networkLabel("test", false, "de")).toBe(GATE.de.netTest);
  for (const lang of GATE_LANGS) {
    const main = networkLabel("main", false, lang);
    expect(main).toBe(GATE[lang].netMain);
    // If a seeded household ever runs against real funds, the line has to warn. No
    // language may quietly call it a demo.
    expect(main.toLowerCase(), lang).not.toMatch(/demo|démo|demonstra/);
  }
});

test("networkLabel defaults to English for callers that pass no language", () => {
  expect(networkLabel("test", true)).toBe("Simulated demo");
  expect(networkLabel("main", false)).toBe("Mainnet · real money");
});
