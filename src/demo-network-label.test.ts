// The one claim the demo landing page has to get right (issue #31).
//
// The label was the literal "Testnet demo". True today, because the only instance setting
// HATCH_DEMO_ENABLED is the testnet one, but an assertion the page could not check: seed a
// demo family anywhere else and it keeps promising testnet while handing a visitor a
// household on another network. This is the page whose whole job is telling a stranger the
// money is not real, so the claim has to be derived rather than stated.

import { test, expect } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import { demoLanding, networkLabel } from "./routes/demo";

test("a testnet instance still says Testnet demo", () => {
  expect(networkLabel("test", false)).toBe("Testnet demo");
});

test("a simulated instance says so instead of claiming testnet", () => {
  // The case that was already wrong in the wild: a SIM instance said "Testnet demo"
  // while touching no chain at all, spotted while photographing the app for #20.
  expect(networkLabel("test", true)).toBe("Simulated demo");
  expect(networkLabel("main", true)).toBe("Simulated demo");
});

test("a mainnet instance warns about real money and never calls itself a demo", () => {
  const label = networkLabel("main", false);
  expect(label).toContain("Mainnet");
  expect(label).toContain("real money");
  // The failure this exists to prevent: a household on real funds reassuring a visitor
  // that the money is play money.
  expect(label.toLowerCase()).not.toContain("demo");
  expect(label).not.toContain("Testnet");
});

test("no two instance shapes produce the same label", () => {
  const labels = [
    networkLabel("test", false),
    networkLabel("main", false),
    networkLabel("test", true),
  ];
  expect(new Set(labels).size).toBe(labels.length);
});

// ...and the page actually renders it, rather than keeping its own copy of the string.
test("the served page carries the derived label, not a hardcoded one", async () => {
  initTestDb();
  process.env.HATCH_DEMO_ENABLED = "1";
  try {
    const app = new Hono().route("/", demoLanding);
    const html = await (await app.request("http://hatch.test/demo")).text();
    const rendered = html.match(/<span class="net"[^>]*>([^<]*)<\/span>/)?.[1];

    // Whatever this test process's own NETWORK/SIM are, the page must agree with the
    // function rather than assert a third thing.
    const { NETWORK, SIM } = await import("./nimiq/client");
    expect(rendered).toBe(networkLabel(NETWORK, SIM));
  } finally {
    delete process.env.HATCH_DEMO_ENABLED;
  }
});

// ---------------------------------------------------------------------------
// The page's LANGUAGE, chosen server side. This page has no app shell, so there is
// nothing to call t() on: it was English in every language while the app behind it
// translated, and it is the first screen a non-English judge sees.
// ---------------------------------------------------------------------------

import { GATE, pickLang } from "./locales/demo-gate";

/** The rendered markup only.
 *
 *  The page deliberately embeds EVERY language in a script tag (that is what lets a
 *  returning visitor's stored language win), so asserting "no English anywhere" against
 *  the whole document is always false. What matters is what is painted.
 */
const body = (html: string) => html.slice(0, html.indexOf("<script>"));

const servePage = async (headers: Record<string, string> = {}, path = "/demo") => {
  initTestDb();
  process.env.HATCH_DEMO_ENABLED = "1";
  try {
    const app = new Hono().route("/", demoLanding);
    const res = await app.request(`http://hatch.test${path}`, { headers });
    return { res, html: await res.text() };
  } finally {
    delete process.env.HATCH_DEMO_ENABLED;
  }
};

test("a Spanish browser gets the page in Spanish, lang attribute included", async () => {
  const { html } = await servePage({ "accept-language": "es-ES,es;q=0.9,en;q=0.8" });
  expect(html).toContain('<html lang="es">');
  expect(html).toContain(GATE.es.lede);
  expect(html).toContain(GATE.es.openKid);
  expect(body(html)).not.toContain(GATE.en.lede);
});

test("?lang= overrides the browser, so a link can pin the language", async () => {
  const { html } = await servePage({ "accept-language": "de-DE,de;q=0.9" }, "/demo?lang=fr");
  expect(html).toContain('<html lang="fr">');
  expect(html).toContain(GATE.fr.openParent);
});

test("an English browser is unchanged", async () => {
  const { html } = await servePage({ "accept-language": "en-GB,en;q=0.9" });
  expect(html).toContain('<html lang="en">');
  expect(html).toContain(GATE.en.lede);
});

test("the response varies on Accept-Language", async () => {
  // Negotiated per request: without this a shared cache hands one visitor's language
  // to the next.
  const { res } = await servePage({ "accept-language": "pt-BR" });
  expect(res.headers.get("vary")).toContain("Accept-Language");
});

test("every string on the page comes from the table, none left hardcoded", async () => {
  // The whole bug was prose baked into the template. If a new string is added inline,
  // the Spanish page keeps an English sentence and this catches it.
  const { html } = await servePage({ "accept-language": "es" });
  const painted = body(html);
  for (const [key, en] of Object.entries(GATE.en)) {
    if (GATE.es[key as keyof typeof GATE.en] === en) continue; // proper nouns
    expect(painted, `en leaked: ${key}`).not.toContain(en);
  }
});

test("a returning visitor's stored language is carried to the client", async () => {
  // The server picks from Accept-Language, which is right for a first-time judge and
  // wrong for someone coming back from a Spanish kid app. The page ships every
  // language and re-renders from the shell's own key.
  const { html } = await servePage({ "accept-language": "en" });
  expect(html).toContain('localStorage.getItem("nimiq-app-lang")');
  for (const lang of ["es", "de", "fr", "pt"] as const) {
    expect(html, `${lang} not embedded`).toContain(GATE[lang].openKid);
  }
});

test("the served language is what pickLang decides, not a second implementation", async () => {
  for (const header of ["es-ES,es;q=0.9", "ja,fr;q=0.7", "pt-BR", "*"]) {
    const { html } = await servePage({ "accept-language": header });
    expect(html, header).toContain(`<html lang="${pickLang(header)}">`);
  }
});
