// The add-a-job picker: a grid of named jobs, with typing still one tap away.
//
// This is the half of localization that a translation table cannot do. Chores
// live in SQLite as text, and text a parent typed is theirs — we render it
// verbatim in every language rather than machine-translating a household's own
// words (see src/title-catalog.ts). So the way to get a kid's board translated
// is not to translate harder, it is to make the ordinary path produce a KEY:
// tapping "Empty the dishwasher" stores `cat.job.dishwasher` and that row is in
// the reader's language forever, on every device, including ones bought later.
//
// It has to be faster than typing or it is just a language tax on the parent.
// Hence: tiles, not a dropdown; grouped, not one long list; search that filters
// as you type and hands the typed text straight to the free-text field when
// nothing matches, so a miss costs nothing and never dead-ends.
//
// Renders from `GET /api/catalog/jobs`, which sends KEYS and no prose — the
// tiles are translated client-side by whatever language the reader is in, so
// this grid is never the one screen still in English.

import { esc } from "./esc.js";

let cache = null;

/** The catalog, fetched once per page load. */
export async function jobCatalog() {
  if (!cache) {
    cache = fetch("/api/catalog/jobs")
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      // An offline tablet gets the free-text field and nothing else, which is
      // the pre-picker behaviour rather than a broken sheet.
      .catch(() => ({ groups: [] }));
  }
  return cache;
}

/**
 * The picker's markup.
 *
 * `t` is passed in rather than imported: the kid app and the parent app each
 * have their own, bound to their own merged locale set, and this module is
 * shared by both.
 */
export function jobPickerHtml({ t, groups, searchable = true }) {
  if (!groups.length) return "";
  return `
    <div class="jp" data-job-picker>
      ${searchable ? `
      <input class="jp-search" id="jp-search" type="search" autocomplete="off"
        placeholder="${esc(t("cat.ui.search"))}" aria-label="${esc(t("cat.ui.search"))}" />` : ""}
      <div class="jp-grid" id="jp-grid">
        ${groups.map((g) => `
          <div class="jp-group" data-group="${esc(g.id)}">
            <div class="jp-group-hd">${esc(t(g.labelKey))}</div>
            <div class="jp-tiles">
              ${g.jobs.map((j) => `
                <button type="button" class="jp-tile" data-job="${esc(j.id)}"
                  data-name="${esc(t(j.key).toLowerCase())}" aria-pressed="false">
                  <span class="jp-emoji" aria-hidden="true">${esc(j.emoji)}</span>
                  <span class="jp-name">${esc(t(j.key))}</span>
                </button>`).join("")}
            </div>
          </div>`).join("")}
      </div>
      <div class="jp-none" id="jp-none" hidden>${esc(t("cat.ui.noMatch"))}</div>
    </div>`;
}

/**
 * Wire the grid up. Returns a reader for what is currently chosen.
 *
 * The selection is EXCLUSIVE with the free-text field on purpose: typing after
 * tapping clears the tile, because a title and a key that disagree would render
 * as two different chores on two devices in the same house. Whichever the parent
 * touched last is the one that counts, and the UI shows which that is.
 */
export function wireJobPicker({ root = document, titleInput, onPick, initialId = null } = {}) {
  const picker = root.querySelector("[data-job-picker]");
  if (!picker) return { catalogId: () => null };

  let picked = null;
  const tiles = () => picker.querySelectorAll(".jp-tile");

  const clear = () => {
    picked = null;
    tiles().forEach((b) => { b.classList.remove("is-on"); b.setAttribute("aria-pressed", "false"); });
  };

  tiles().forEach((b) => {
    b.onclick = () => {
      const was = picked === b.dataset.job;
      clear();
      if (!was) {
        picked = b.dataset.job;
        b.classList.add("is-on");
        b.setAttribute("aria-pressed", "true");
        // The tile's own words go into the text field so the parent can see what
        // they picked in one place, and can edit it into their own wording. That
        // edit clears the key below, which is exactly right: once they change the
        // words, the words are theirs.
        if (titleInput) titleInput.value = b.querySelector(".jp-name").textContent;
      } else if (titleInput) {
        titleInput.value = "";
      }
      onPick?.(picked);
    };
  });

  if (titleInput) {
    titleInput.addEventListener("input", () => {
      if (picked && titleInput.value !== pickedName()) { clear(); onPick?.(null); }
    });
  }
  const pickedName = () =>
    picker.querySelector(`.jp-tile[data-job="${picked}"] .jp-name`)?.textContent ?? null;

  /**
   * Open with a tile already chosen. Used by "Add it again", which reproduces a finished
   * job: the job's catalog id has to survive into the new chore or the copy loses its
   * translation key and comes back English on the tablet while the phone shows Spanish.
   *
   * Deliberately routed through select() rather than tracked as a separate "carried" id
   * alongside `picked`. Everything that makes the picker safe is written against `picked`
   * — the exclusivity with the text field, the clear-on-divergent-input above, the search
   * miss below — and a second source of truth would sit outside all of it. This way, a
   * parent who edits the prefilled title clears the key by the rule that already exists,
   * with nothing new to keep in step.
   */
  const select = (id) => {
    const tile = id ? picker.querySelector(`.jp-tile[data-job="${id}"]`) : null;
    if (!tile) return;
    picked = id;
    tile.classList.add("is-on");
    tile.setAttribute("aria-pressed", "true");
    if (titleInput) titleInput.value = tile.querySelector(".jp-name").textContent;
  };
  select(initialId);

  const search = picker.querySelector(".jp-search");
  if (search) {
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let hits = 0;
      picker.querySelectorAll(".jp-group").forEach((g) => {
        let shown = 0;
        g.querySelectorAll(".jp-tile").forEach((b) => {
          const hit = !q || b.dataset.name.includes(q);
          b.hidden = !hit;
          if (hit) shown++;
        });
        g.hidden = shown === 0;
        hits += shown;
      });
      picker.querySelector("#jp-none").hidden = hits > 0;
      // Nothing matched, so what they typed IS the job. Handing it straight to
      // the free-text field means a search miss costs one tap, not a restart.
      if (!hits && titleInput && q) { clear(); titleInput.value = search.value.trim(); onPick?.(null); }
    });
  }

  return { catalogId: () => picked };
}
