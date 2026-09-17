// nimiq.kids parent — the TREASURE BOX manager: shelves (store_categories) and
// the things on them (store_items).
//
// The kid app has always read its shelves from data, so a new shelf appears
// there with zero UI code change. What did not exist was any way for a parent to
// WRITE that data. This screen is it.
//
// Three rules run through the whole surface:
//  · Nothing is deleted, ever. `kid_purchases.item_id` is a real FK and a
//    purchase has to stay readable forever, so "remove" is HIDE (active=0) and
//    hidden rows still show here, greyed, with a Show button. It is the same
//    treatment a retired sticker gets, and the same one the Timers shelf got.
//  · A parent creates only what a parent can honour: a coupon (which lands in
//    their own approval feed) or screen time (which rides the lock-override
//    path). Sticker packs and timer rigs need art and unlock ids that only the
//    catalogue can supply, so they are shown but not editable here.
//  · A face is picked from the SAME palette the kid app draws with
//    (/js/lib/box-glyphs.js), so the picker can never offer a glyph the shelf
//    cannot render.

import { rowTitle, state, t, views, call, render, toast, openSheet, closeSheet, go, $ } from "./core.js";
import { icon, duotone, boxGlyph, boxMinutes, GLYPHS, loadGlyphs } from "./icons.js";
import { esc, fmtNim, LUNA } from "./fmt.js";
import { packFan, CATALOG } from "/js/lib/box-glyphs.js";
import { canManageBoard } from "./grownups.js";

const NIM_LABEL = (luna) => `${fmtNim(luna)} NIM`;
/** Kinds the catalogue owns outright: shown, never edited from here. */
const LOCKED_KINDS = ["timer_style"];
/**
 * Catalogue rows a parent may still PRICE (#288).
 *
 * A sticker pack's name keys its translations and its payload points at the stickers it
 * grants, so the row stays the catalogue's — but what it COSTS is the family's, because the
 * price ladder is the whole meaning of the Treasure Box and one household's chores are not
 * another's. The server files it as a per-family override, so a pack repriced here moves
 * for this household and nobody else's.
 */
const PRICE_ONLY_KINDS = ["pack"];

let glyphsReady = false;

export async function loadStore() {
  const [r, buys] = await Promise.all([
    call("GET", "/api/parent/store"),
    // What the kids have actually bought (#121). Read alongside the catalogue rather than
    // inside it: a failure here must never blank the shelves a parent came to edit.
    call("GET", "/api/parent/purchases").catch(() => null),
    glyphsReady ? null : loadGlyphs(),
  ]);
  glyphsReady = true;
  if (r.status === 200) state.store = r.data;
  else state.store = { categories: [], items: [], error: true };
  state.purchases = buys?.status === 200 ? buys.data.purchases ?? [] : [];
  if (state.tab === "store") render();
}

/**
 * What the kids bought, and which ones are still on the parent (#121).
 *
 * The parent is the missing half of a coupon: the kid spends, an approval opens, and the
 * parent hands the thing over in the real world days later. Until now the only trace was a
 * row in the approvals feed that disappeared once actioned, so "did I ever actually take
 * her for that ice cream" had no answer anywhere.
 *
 * Waiting rows come FIRST and carry the kid's name, because they are the ones that are
 * still a job. Everything else is history and reads in time order under them.
 */
function purchasesCard() {
  const all = state.purchases ?? [];
  if (!all.length) return "";
  const kidName = (id) => state.overview?.children?.find((k) => k.id === id)?.label ?? "";
  const waiting = all.filter((p) => p.status === "pending_parent");
  const rest = all.filter((p) => p.status !== "pending_parent");
  const row = (p) => `
    <div class="bx-row-p ${p.status === "pending_parent" ? "" : "is-off"}">
      <div class="bx-row-main">
        <div class="bx-row-title">${esc(p.title)}</div>
        <div class="bx-row-sub">${esc(kidName(p.childId))} &middot; ${NIM_LABEL(p.priceLuna)}${
          p.status === "fulfilled" ? ` &middot; ${t("papp.boxBoughtDone")}` : ""}</div>
      </div>
      ${p.status === "pending_parent"
        ? `<span class="bx-row-waiting">${t("papp.boxBoughtWaiting")}</span>`
        : ""}
    </div>`;
  return `
    <div class="card set-card">
      <div class="set-head">${duotone("duotone-medal", 24)}<h3>${t("papp.boxBoughtTitle")}</h3></div>
      ${waiting.length ? "" : `<div class="set-hint">${t("papp.boxBoughtNoneWaiting")}</div>`}
      ${[...waiting, ...rest].map(row).join("")}
    </div>`;
}

/**
 * Every app this household's tablets have REPORTED installed, de-duplicated across them and
 * named by their own labels.
 *
 * Read from `state.devices` -- the same probe the allowlist picker already uses -- so adding
 * an app to the shelf needs no new endpoint and cannot offer a package the server would then
 * refuse. Empty when no tablet has reported, which is what hides the "App" kind entirely: a
 * shelf of apps in a household with no tablet sells permission to launch nothing.
 */
function installedApps() {
  const byPkg = new Map();
  for (const d of Array.isArray(state.devices) ? state.devices : []) {
    for (const a of d.installedApps ?? []) if (!byPkg.has(a.pkg)) byPkg.set(a.pkg, a);
  }
  return [...byPkg.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/**
 * A row's face: a pack fans its own stickers, minutes draw their own dial, everything
 * else names a glyph.
 *
 * The pack case is the one that was missing (#34). Every pack row drew the generic
 * `ticket` while the kid saw the real fanned pack art for the same shelf item, so the two
 * sides of one product did not look like the same product. The chain below could never
 * have found it: a pack's payload carries `packId`, never `icon`, and `cat-stickers` has
 * `icon: null` on purpose because packs draw their own art. Both fall through to the
 * default. The art already shipped; this view was simply never wired to it.
 *
 * `packFan` comes from the same shared lib the glyph palette does, and returns "" for a
 * pack with no stickers, so an artless one still falls back to a glyph rather than
 * rendering an empty box.
 */
const itemFace = (item, cat) => {
  if (item.kind === "pack") {
    const fan = packFan(item.stickers, "bx-fan-row");
    if (fan) return fan;
  }
  // DRAWN ART WINS, and it is the SERVER's answer, not a second copy of the rule (#404).
  // The kid's shelf reads the identical `artUrl` off the identical endpoint, so a parent can
  // never be looking at a glyph while their child looks at a picture. That divergence is #34.
  if (item.artUrl) return `<img class="bx-item-art-p" src="${esc(item.artUrl)}" alt="" />`;
  if (item.kind === "screen_time") return boxMinutes(item.payload?.minutes, 22);
  return boxGlyph(item.payload?.icon || cat?.icon || "ticket", 22);
};

views.store = (el) => {
  // The tab is hidden for a supporter (`setChrome`), but hidden chrome is not a permission:
  // a restored tab from a previous session, or a `go("store")` from anywhere, would land
  // them on the whole catalogue editor. Same call `storeCard` made before this became a tab.
  if (!canManageBoard()) { go("home"); return; }
  const store = state.store;
  if (!store) { el.innerHTML = `<div class="card pstate"><h3>${t("papp.loading")}</h3></div>`; loadStore(); return; }

  const byCat = (id) => store.items.filter((i) => i.categoryId === id);
  const shelves = store.categories.map((cat, n) => {
    const items = byCat(cat.id);
    const rows = items.length
      ? items.map((i) => {
          const locked = LOCKED_KINDS.includes(i.kind);
          return `<div class="bx-row-p ${i.active ? "" : "is-off"}">
            <span class="bx-row-ic">${itemFace(i, cat)}</span>
            <div class="bx-row-main">
              <div class="bx-row-title">${esc(rowTitle(i))}</div>
              <div class="bx-row-sub">${NIM_LABEL(i.priceLuna)}${i.active ? "" : ` &middot; ${t("papp.boxHidden")}`}</div>
            </div>
            ${locked
              ? `<span class="bx-row-lock">${icon("locked-lock", 13)}</span>`
              : `<button class="pill-btn ghost sm" data-item="${esc(i.id)}">${t("papp.boxEdit")}</button>`}
          </div>`;
        }).join("")
      : `<div class="set-hint bx-empty">${t("papp.boxNoThings")}</div>`;
    return `
      <div class="card set-card bx-shelf-p ${cat.active ? "" : "is-off"}">
        <div class="bx-shelf-hd-p">
          <span class="bx-shelf-ic">${boxGlyph(cat.icon ?? "ticket", 22)}</span>
          <h3>${esc(rowTitle(cat))}</h3>
          <div class="bx-shelf-tools">
            <button class="icon-btn" data-move="${esc(cat.id)}" data-dir="-1" ${n === 0 ? "disabled" : ""}
              aria-label="${esc(t("papp.boxMoveUp"))}">${icon("chevron-left", 12)}</button>
            <button class="icon-btn" data-move="${esc(cat.id)}" data-dir="1" ${n === store.categories.length - 1 ? "disabled" : ""}
              aria-label="${esc(t("papp.boxMoveDown"))}">${icon("chevron-left", 12)}</button>
            <button class="pill-btn ghost sm" data-cat="${esc(cat.id)}">${t("papp.boxEdit")}</button>
          </div>
        </div>
        ${cat.active ? "" : `<div class="set-hint">${t("papp.boxShelfHiddenSub")}</div>`}
        ${rows}
        <button class="pill-btn ghost wide" data-add="${esc(cat.id)}">${t("papp.boxAddThing")}</button>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="set-hint bx-intro">${t("papp.boxCount", {
      shelves: store.categories.filter((c) => c.active).length,
      things: store.items.filter((i) => i.active).length,
    })}</div>
    ${purchasesCard()}
    ${shelves}
    <button class="pill-btn blue wide" id="bx-new-shelf">${t("papp.boxNewShelf")}</button>`;

  $("bx-new-shelf").onclick = () => sheetCategory(null);
  el.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () =>
    sheetCategory(store.categories.find((c) => c.id === b.dataset.cat))));
  el.querySelectorAll("[data-item]").forEach((b) => (b.onclick = () =>
    sheetItem(store.items.find((i) => i.id === b.dataset.item))));
  el.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => sheetItem(null, b.dataset.add)));
  el.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => moveCategory(b.dataset.move, Number(b.dataset.dir))));
};

// ---- the glyph picker (one palette, shared with the kid app) ----

// 148 Phosphor glyphs in nine categories (public/js/lib/phosphor.js, from
// tools/icons/phosphor-list.json). Andjroo, 2026-09-15: "the parents are gonna need basically to
// be able to pick an icon for their coupons or for other stuff that they wanna give to the kid."
// The selected one always shows, even an old name (dinner, gamepad) the catalogue no longer
// lists: it rides at the top as its own row so an edit never loses the picture a shelf has.
function glyphPicker(selected) {
  const listed = GLYPHS.includes(selected);
  const grid = (names) => `<div class="glyph-grid">${names.map((g) => `
    <button type="button" class="glyph-opt ${g === selected ? "on" : ""}" data-glyph="${esc(g)}"
      aria-label="${esc(g)}" aria-pressed="${g === selected}">${boxGlyph(g, 26)}</button>`).join("")}</div>`;
  return `<div class="glyph-cats">
    ${selected && !listed ? grid([selected]) : ""}
    ${Object.entries(CATALOG).map(([cat, names]) => `
      <div class="glyph-cat"><div class="glyph-cat-hd">${esc(cat)}</div>${grid(names)}</div>`).join("")}
  </div>`;
}
/** Wire the picker: one selected at a time, the value read back off the DOM. */
function wireGlyphPicker() {
  document.querySelectorAll(".glyph-opt").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".glyph-opt").forEach((o) => {
      o.classList.remove("on");
      o.setAttribute("aria-pressed", "false");
    });
    b.classList.add("on");
    b.setAttribute("aria-pressed", "true");
  }));
}
const pickedGlyph = () => document.querySelector(".glyph-opt.on")?.dataset.glyph ?? null;

// ---- shelves ----

function sheetCategory(cat) {
  const isNew = !cat;
  openSheet(`
    <h2>${isNew ? t("papp.boxNewShelf") : t("papp.boxEditShelf")}</h2>
    <input class="nq-input" id="bx-cat-title" maxlength="40" placeholder="${esc(t("papp.boxShelfName"))}"
      value="${esc(cat?.title ?? "")}" />
    <div class="set-hint">${t("papp.boxPickFace")}</div>
    ${glyphPicker(cat?.icon ?? null)}
    <div class="btn-row">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bx-cat-hide">${cat.active ? t("papp.boxHide") : t("papp.boxShow")}</button>`}
      <button class="pill-btn blue" id="bx-cat-save">${t("papp.save")}</button>
    </div>
    ${isNew ? "" : `<div class="set-hint">${t("papp.boxHideNote")}</div>`}`);
  wireGlyphPicker();
  $("bx-cat-save").onclick = async () => {
    const title = $("bx-cat-title").value.trim();
    if (!title) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bx-cat-save").disabled = true;
    const body = { title, icon: pickedGlyph() };
    const r = isNew
      ? await call("POST", "/api/parent/store/categories", body)
      : await call("PATCH", `/api/parent/store/categories/${cat.id}`, body);
    finish(r, isNew ? 201 : 200);
  };
  $("bx-cat-hide")?.addEventListener("click", async () => {
    finish(await call("PATCH", `/api/parent/store/categories/${cat.id}`, { active: !cat.active }));
  });
}

/** Reorder by SWAPPING sort with the neighbour, so the list stays a total order
 *  even if two rows were ever seeded with the same sort value. */
async function moveCategory(id, dir) {
  const list = state.store.categories;
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], bNode = list[j];
  await Promise.all([
    call("PATCH", `/api/parent/store/categories/${a.id}`, { sort: j }),
    call("PATCH", `/api/parent/store/categories/${bNode.id}`, { sort: i }),
  ]);
  await loadStore();
}

// ---- things on a shelf ----

/** What the kid will actually see under the NIM price, live as it is typed. The price ladder
 *  is the Treasure Box's whole meaning, so every sheet that sets a price shows this. */
function wireFiat() {
  const show = () => {
    const nim = Number($("bx-it-price").value);
    $("bx-it-fiat").textContent = Number.isFinite(nim) && nim > 0
      ? t("papp.boxWorth", { amount: `$${(nim * (state.rates?.nimUsd ?? 0)).toFixed(2)}` })
      : "";
  };
  $("bx-it-price").oninput = show;
  show();
}

/**
 * Pricing a catalogue row (#288): one field, and the row's own name as the heading.
 *
 * The server takes `priceNim` and NOTHING else on a shared row, so this sheet sends nothing
 * else. Typing the catalogue's own price back in withdraws the override there, which is why
 * there is no separate reset control: putting the number back IS the reset.
 */
function sheetItemPrice(item) {
  openSheet(`
    <h2>${esc(rowTitle(item))}</h2>
    <input class="nq-input" id="bx-it-price" type="number" inputmode="numeric" min="1" step="1"
      placeholder="${esc(t("papp.boxPriceNim"))}" value="${Math.round(item.priceLuna / LUNA)}" />
    <div class="set-hint" id="bx-it-fiat"></div>
    <div class="btn-row">
      <button class="pill-btn blue" id="bx-it-save">${t("papp.save")}</button>
    </div>`);
  wireFiat();
  $("bx-it-save").onclick = async () => {
    const priceNim = Math.round(Number($("bx-it-price").value));
    const minPrice = picked === "app" ? 0 : 1;
    if (!Number.isFinite(priceNim) || priceNim < minPrice) { toast(t("papp.boxPriceNeeded"), "error"); return; }
    $("bx-it-save").disabled = true;
    finish(await call("PATCH", `/api/parent/store/items/${item.id}`, { priceNim }));
  };
}

function sheetItem(item, categoryId) {
  const isNew = !item;
  const kind = item?.kind ?? "coupon";
  // A catalogue row a parent may only price: no name field, no face picker, no Hide button,
  // because none of those are theirs to move. The pack's own name is the heading instead of
  // the generic one, so the sheet says what is being priced without needing a line of copy.
  const priceOnly = PRICE_ONLY_KINDS.includes(kind);
  if (priceOnly) return sheetItemPrice(item);
  openSheet(`
    <h2>${isNew ? t("papp.boxNewThing") : t("papp.boxEditThing")}</h2>
    ${isNew ? `
      <div class="set-hint">${t("papp.boxKind")}</div>
      <div class="app-toggle bx-kind">
        <button class="pill-btn ghost sm on" data-kind="coupon">${t("papp.boxKindCoupon")}</button>
        <button class="pill-btn ghost sm" data-kind="screen_time">${t("papp.boxKindScreen")}</button>
        ${installedApps().length ? `<button class="pill-btn ghost sm" data-kind="app">${t("papp.boxKindApp")}</button>` : ""}
      </div>` : ""}
    <input class="nq-input" id="bx-it-title" maxlength="40" placeholder="${esc(t("papp.boxThingName"))}"
      value="${esc(item?.title ?? "")}" />
    <input class="nq-input" id="bx-it-price" type="number" inputmode="numeric" min="1" step="1"
      placeholder="${esc(t("papp.boxPriceNim"))}" value="${item ? Math.round(item.priceLuna / LUNA) : ""}" />
    <div class="set-hint" id="bx-it-fiat"></div>
    <div id="bx-it-mins" ${kind === "screen_time" ? "" : "hidden"}>
      <input class="nq-input" id="bx-it-minutes" type="number" inputmode="numeric" min="1" max="480" step="1"
        placeholder="${esc(t("papp.boxMinutes"))}" value="${item?.payload?.minutes ?? ""}" />
    </div>
    <!-- A PICKER, never a text field. The package name lands in the tablet's LockTask
         allowlist, so typing one is naming any app on the device, Settings included -- the
         server refuses anything the tablet did not report and this is the same rule, said
         before the tap instead of after it. -->
    <div id="bx-it-app" ${kind === "app" ? "" : "hidden"}>
      <div class="set-hint">${t("papp.boxPickApp")}</div>
      <select class="nq-input" id="bx-it-pkg">
        ${installedApps().map((a) => `<option value="${esc(a.pkg)}"
          ${item?.payload?.pkg === a.pkg ? "selected" : ""}>${esc(a.label)}</option>`).join("")}
      </select>
      <div class="set-hint">${t("papp.boxAppFree")}</div>
    </div>
    <!-- ⚠️ NO FACE PICKER ON A ROW THAT HAS DRAWN ART (#404). NO BACKTICKS IN HERE: this
         comment is inside a template literal, and a stray one ends the string mid-sentence.
         The picker writes payload.icon, and storeArtUrl reads that same field first, so on
         the two seeded coupons a parent
         tapping a glyph would save successfully and change nothing they can see. A control
         that reports success and does nothing is worse than one that is not offered. Same
         call PRICE_ONLY_KINDS already makes for packs: a catalogue row's face is not the
         parent's to move. A row they created themselves has no art and keeps the picker. -->
    ${item?.artUrl ? "" : `
      <div class="set-hint">${t("papp.boxPickFace")}</div>
      ${glyphPicker(item?.payload?.icon ?? null)}`}
    <div class="btn-row">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bx-it-hide">${item.active ? t("papp.boxHide") : t("papp.boxShow")}</button>`}
      <button class="pill-btn blue" id="bx-it-save">${t("papp.save")}</button>
    </div>
    ${isNew ? "" : `<div class="set-hint">${t("papp.boxHideNote")}</div>`}`);
  // Guarded: the picker is absent on a row with drawn art, and wiring one that is not there
  // would throw on the way into the sheet.
  if (!item?.artUrl) wireGlyphPicker();

  let picked = kind;
  document.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => {
    picked = b.dataset.kind;
    document.querySelectorAll("[data-kind]").forEach((o) => o.classList.toggle("on", o === b));
    $("bx-it-mins").hidden = picked !== "screen_time";
    $("bx-it-app").hidden = picked !== "app";
    // An app may be free (that is how starter picks work); nothing else may.
    $("bx-it-price").min = picked === "app" ? "0" : "1";
    // The name defaults to the app's own, because "Minecraft" is what a kid is looking for
    // and retyping it is a chance to get it wrong.
    if (picked === "app" && !$("bx-it-title").value.trim()) {
      $("bx-it-title").value = installedApps().find((a) => a.pkg === $("bx-it-pkg").value)?.label ?? "";
    }
  }));
  $("bx-it-pkg")?.addEventListener("change", () => {
    const label = installedApps().find((a) => a.pkg === $("bx-it-pkg").value)?.label ?? "";
    if (label) $("bx-it-title").value = label;
  });

  wireFiat();

  $("bx-it-save").onclick = async () => {
    const title = $("bx-it-title").value.trim();
    if (!title) { toast(t("papp.boxNameNeeded"), "error"); return; }
    const priceNim = Math.round(Number($("bx-it-price").value));
    if (!Number.isFinite(priceNim) || priceNim < 1) { toast(t("papp.boxPriceNeeded"), "error"); return; }
    const minutes = Math.round(Number($("bx-it-minutes")?.value));
    if (picked === "screen_time" && (!Number.isFinite(minutes) || minutes < 1)) {
      toast(t("papp.boxMinutesNeeded"), "error"); return;
    }
    $("bx-it-save").disabled = true;
    const r = isNew
      ? await call("POST", "/api/parent/store/items",
          { categoryId, kind: picked, title, priceNim, icon: pickedGlyph(), minutes,
            pkg: $("bx-it-pkg")?.value })
      // ⚠️ `icon` IS OMITTED, not sent as null, on a row with drawn art (#404). The server
      // reads `body.icon !== undefined` and a null DELETES `payload.icon` from the row --
      // which on a relaxed single-household instance is exactly where `storeArtUrl` looks,
      // so saving a price would have quietly taken the picture off the tile. There is no
      // picker on those rows, so `pickedGlyph()` would return null every time.
      : await call("PATCH", `/api/parent/store/items/${item.id}`,
          { title, priceNim, ...(item?.artUrl ? {} : { icon: pickedGlyph() }) });
    finish(r, isNew ? 201 : 200);
  };
  $("bx-it-hide")?.addEventListener("click", async () => {
    finish(await call("PATCH", `/api/parent/store/items/${item.id}`, { active: !item.active }));
  });
}

/** One outcome path for every write: close, tell, reload. */
async function finish(r, ok = 200) {
  if (r.status !== ok) {
    const btn = $("bx-cat-save") ?? $("bx-it-save");
    if (btn) btn.disabled = false;
    toast(t("papp.couldntSave"), "error");
    return;
  }
  closeSheet();
  toast(t("papp.saved"), "success");
  await loadStore();
}
