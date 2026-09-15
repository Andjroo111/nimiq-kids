// The judge-demo gate's own strings, in the 5 languages the app ships.
//
// This page is not like the others and that is why it has its own file. Every other
// surface gets its language from the shell bundle at runtime (`t()` off
// window.nimiqKidsShell), but the gate is a standalone HTML document served straight
// out of src/routes/demo.ts: no shell, no app bundle, nothing to call `t()` on. So it
// stayed English in every language while the app behind it translated — and it is the
// FIRST screen a non-English judge sees on the demo instance.
//
// The language is therefore chosen on the SERVER, from Accept-Language, and baked into
// the response. A returning visitor who already picked a language in the app is handled
// separately: every string ships in every language (this is 12 strings, so the whole
// table is under 2KB) and a few lines of inline script re-render from the shell's own
// `nimiq-app-lang` key. First-time visitors get the right language with no flash;
// returning ones get the language they chose rather than the one their browser asks for.
//
// Same copy rules as everywhere else: English is authoritative, the other four mirror
// its keys exactly (parity test in demo-gate.test.ts), no em or en dashes.

export const GATE_LANGS = ["en", "es", "de", "fr", "pt"] as const;
export type GateLang = (typeof GATE_LANGS)[number];

export interface GateStrings {
  /** <title>. */
  title: string;
  /** What this page is, under the lockup. */
  lede: string;
  /** While the family is being minted. */
  setting: string;
  openKid: string;
  openParent: string;
  failed: string;
  /** The rate-limiter's 429, which is a different problem from a generic failure. */
  busy: string;
  tryAgain: string;
  refresh: string;
  /** The three network labels. `mainnet` must read as a WARNING, not reassurance:
   *  a seeded household running against real funds is not a demo. */
  netSim: string;
  netTest: string;
  netMain: string;
}

export const GATE: Record<GateLang, GateStrings> = {
  en: {
    title: "Try NIMIQ.kids",
    lede: "This is a demo family.",
    setting: "Setting up your family…",
    openKid: "Open the kids' tablet",
    openParent: "Open the parent app",
    failed: "Something went wrong setting up the demo.",
    busy: "The demo is busy right now. Give it a minute and try again.",
    tryAgain: "Try again",
    refresh: "Refresh demo family",
    netSim: "Simulated demo",
    netTest: "Testnet demo",
    netMain: "Mainnet · real money",
  },
  es: {
    title: "Prueba NIMIQ.kids",
    lede: "Esta es una familia de demostración.",
    setting: "Preparando tu familia…",
    openKid: "Abrir la tableta de los niños",
    openParent: "Abrir la app de madres y padres",
    failed: "Algo salió mal al preparar la demostración.",
    busy: "La demostración está ocupada ahora mismo. Espera un minuto e inténtalo de nuevo.",
    tryAgain: "Inténtalo de nuevo",
    refresh: "Renovar la familia de demostración",
    netSim: "Demostración simulada",
    netTest: "Demostración en testnet",
    netMain: "Mainnet · dinero real",
  },
  de: {
    title: "NIMIQ.kids ausprobieren",
    lede: "Das ist eine Demo-Familie.",
    setting: "Deine Familie wird eingerichtet…",
    openKid: "Das Kinder-Tablet öffnen",
    openParent: "Die Eltern-App öffnen",
    failed: "Beim Einrichten der Demo ist etwas schiefgelaufen.",
    busy: "Die Demo ist gerade ausgelastet. Warte kurz und versuch es noch einmal.",
    tryAgain: "Noch einmal versuchen",
    refresh: "Demo-Familie erneuern",
    netSim: "Simulierte Demo",
    netTest: "Testnet-Demo",
    netMain: "Mainnet · echtes Geld",
  },
  fr: {
    title: "Essayer NIMIQ.kids",
    lede: "Voici une famille de démonstration.",
    setting: "Préparation de votre famille…",
    openKid: "Ouvrir la tablette des enfants",
    openParent: "Ouvrir l'app des parents",
    failed: "Un problème est survenu pendant la préparation de la démo.",
    busy: "La démo est très sollicitée en ce moment. Patientez une minute et réessayez.",
    tryAgain: "Réessayer",
    refresh: "Renouveler la famille de démo",
    netSim: "Démo simulée",
    netTest: "Démo sur testnet",
    netMain: "Mainnet · argent réel",
  },
  pt: {
    title: "Experimente o NIMIQ.kids",
    lede: "Esta é uma família de demonstração.",
    setting: "Preparando sua família…",
    openKid: "Abrir o tablet das crianças",
    openParent: "Abrir o app dos pais",
    failed: "Algo deu errado ao preparar a demonstração.",
    busy: "A demonstração está ocupada agora. Espere um minuto e tente de novo.",
    tryAgain: "Tentar de novo",
    refresh: "Renovar a família de demonstração",
    netSim: "Demonstração simulada",
    netTest: "Demonstração na testnet",
    netMain: "Mainnet · dinheiro real",
  },
};

const isGateLang = (v: string): v is GateLang => (GATE_LANGS as readonly string[]).includes(v);

/**
 * Which language to serve this request in.
 *
 * `override` is `?lang=`, and it wins outright — it is what a judge is handed in a link
 * and what makes the page testable without spoofing a browser header.
 *
 * Otherwise Accept-Language, by q-value, most-preferred first. Region is dropped
 * (`es-419`, `pt-BR` and `de-CH` are all served): shipping five languages and then
 * refusing a Brazilian judge because the tag is not bare `pt` would be the worst of
 * both. A `*` wildcard is ignored rather than treated as a match for the first
 * language in our list, which would silently give everyone English anyway.
 *
 * Falls back to English, which is also what an absent or malformed header gets.
 */
export function pickLang(acceptLanguage?: string | null, override?: string | null): GateLang {
  const wanted = (override ?? "").trim().toLowerCase();
  if (isGateLang(wanted)) return wanted;

  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((s) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(s))
        .find(Boolean);
      // A tag with no q is q=1. An unparseable q is treated as 0 rather than as 1,
      // so a malformed entry cannot outrank a well-formed one.
      return { base: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "", q: q ? Number(q[1]) : 1 };
    })
    .filter((e) => e.base && e.base !== "*" && Number.isFinite(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q);

  return ranked.find((e) => isGateLang(e.base))?.base as GateLang ?? "en";
}

/** The label above the card. Mainnet is a warning, not a demo badge. */
export function networkLabel(network: "test" | "main", sim: boolean, lang: GateLang = "en"): string {
  const s = GATE[lang];
  if (sim) return s.netSim;
  return network === "test" ? s.netTest : s.netMain;
}
