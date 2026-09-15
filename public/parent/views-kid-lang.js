// nimiq.kids parent — WHAT LANGUAGE THIS KID'S TABLET READS IN (#432).
//
// The kid app's own language switcher was removed on 2026-08-27 and is not coming back: a
// control a child can reach is a control a child will find, and a tablet stuck in a language
// nobody in the house reads is a support call the parent cannot answer from their phone.
// Nothing replaced it, so until this card a kid's language was unsettable BY ANYBODY. It was
// whatever the tablet's browser happened to say.
//
// ONE CHOICE THAT IS NOT A LANGUAGE, and it is the default: "Same as the tablet". That is what
// every household has today, it is what `children.lang IS NULL` means, and it has to be a
// visible option rather than an empty state. A picker whose first entry is English would read
// as "this kid is set to English" over a household that has chosen nothing, and picking it
// would write a row that changes what the tablet does.
//
// The languages are NOT translated into the reader's language. A parent looking for Portuguese
// is looking for the word "Português", and a Spanish speaker reading "Portugués" in a list of
// five is doing a translation exercise to find their own. Every list on this screen is the
// endonym, which is what every language picker that works does.

import { $, call, closeSheet, openSheet, refresh, render, state, t, toast } from "./core.js";
import { esc } from "./fmt.js";
import { duotone, icon } from "./icons.js";
import { canManageHousehold } from "./grownups.js";

/** The five this app translates, each written the way its own readers write it. Not sorted
 *  by anything clever: English first because it is the fallback every missing string lands
 *  on, then alphabetical by the name a reader is scanning for. */
export const KID_LANGS = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
  { id: "pt", name: "Português" },
];

/**
 * What the tablet reads in, for one kid.
 *
 * A `<select>` rather than five rows, for the same reason the time zone in Settings is one:
 * six options is a list a parent scrolls past on every visit to this page, and the answer is
 * one word they already know.
 */
/** The row states the answer in one word; the picker waits in a sheet behind it (#420). */
export function kidLangRow(kid) {
  if (!canManageHousehold() || !kid) return "";
  const sub = KID_LANGS.find((l) => l.id === kid.lang)?.name ?? t("papp.langSameAsTablet");
  return `<button class="row" id="kid-lang-row" data-kid="${esc(kid.id)}">
    <span class="hex-tile">${duotone("duotone-globe", 22)}</span>
    <span class="row-main">
      <span class="row-label">${esc(t("papp.langTitle"))}</span>
      <span class="row-sub" title="${esc(sub)}">${esc(sub)}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button>`;
}

/**
 * One PATCH, and the empty option posts `null` rather than being left out.
 *
 * `lang` ABSENT is a 400 on the server, deliberately, so a client that forgot the field cannot
 * silently hand a household back to its tablet. That means "Same as the tablet" has to send an
 * explicit null, which is what `|| null` does here and why it is not `|| undefined`.
 */
function sheetKidLang(kid) {
  const current = kid.lang ?? "";
  const opt = (value, label) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  openSheet(`<h2>${esc(t("papp.langTitle"))}</h2>
    <div class="sub">${esc(t("papp.langSub", { name: kid.label }))}</div>
    <select class="nq-input" id="kl-sel">
      ${opt("", t("papp.langSameAsTablet"))}
      ${KID_LANGS.map((l) => opt(l.id, l.name)).join("")}
    </select>
    <button class="pill-btn blue" id="kl-save">${esc(t("papp.save"))}</button>`);

  $("kl-save")?.addEventListener("click", async () => {
    const btn = $("kl-save");
    btn.disabled = true;
    const r = await call("PATCH", `/api/children/${kid.id}/lang`, {
      lang: $("kl-sel").value || null,
    }).catch(() => null);
    btn.disabled = false;
    if (r?.status !== 200) { toast(t("papp.didntGoThrough"), "error"); return; }
    closeSheet();
    toast(t("papp.saved"), "success");
    await refresh();
    render();
  });
}

export function wireKidLangRow(el, kid) {
  el.querySelector("#kid-lang-row")?.addEventListener("click", () => sheetKidLang(kid));
}
