// nimiq.kids kid app v3 — the TREASURE BOX: its own full-screen world, opened
// from the chest button in the dock. Shelves are CATEGORY-DRIVEN from server
// data (store_categories) so new shelves (backgrounds, characters, sounds,
// seasonal) appear with zero UI code change. Buying spends the kid's REAL NIM
// back to the family wallet; a brief chest-opening moment marks the entry
// (skipped under prefers-reduced-motion).

import { celebrate } from "/js/lib/confetti.js";
import { api } from "./api.js";
import {
  state, $, esc, t, toast, setScreen, bgFor, fmtNimLuna, fmtFiat, parentName,
  openSheet, closeSheet,
  sheetHeadText,
  rowTitle,
} from "./util.js";
import { arrowIcon, checkIcon, maskIcon, glyph, minuteDialIcon } from "./icons.js";
import { refreshStore, refreshWallet, refreshChart, refreshPrefs, refreshPurchases, refreshGoalSets } from "./data.js";
import { packFan, stickerFace } from "/js/lib/box-glyphs.js";
import { timerPreview } from "./timer-previews.js";
import { TIMER_LABELS, equipTimerStyle } from "./timer-style.js";
import { showChart } from "./chart.js";
// Sets you can collect live on a shelf here now (#400), drawn by the SAME card the
// chart used to draw. One set card in the product, not two that drift.
import { setGroup, onSetTap } from "./upkeep.js";

// ---------- "new items" badge (client-side seen tracking, no pulsing) ----------
const seenKey = () => `kid.boxSeen.${state.child?.id ?? ""}`;
const seenSet = () => {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey()) ?? "[]")); } catch { return new Set(); }
};
const buyable = () => (state.store?.items ?? []).filter((i) => !i.owned); // owned: packs + timer styles
export function boxBadgeCount() {
  const seen = seenSet();
  return buyable().filter((i) => !seen.has(i.id)).length;
}
const markAllSeen = () => {
  try { localStorage.setItem(seenKey(), JSON.stringify(buyable().map((i) => i.id))); } catch { /* ok */ }
};

// ---------- shelf labels ----------
// This used to be a hard-coded id -> key map living here, which worked and was
// the only localized title in the product. A shelf now carries its own
// `titleKey` from the server (a parent-made shelf carries none), so the map is
// gone and one helper covers shelves, items, chores and routines alike.
const catLabel = (cat) => rowTitle(cat);

// ---------- item tiles ----------

/** The face a kind falls back to when nothing named one. */
const KIND_GLYPH = { coupon: "ticket", screen_time: "gamepad", pack: "medal" };

/** An item's glyph NAME is data: its own `payload.icon`, else the icon its
 *  category carries, else a per-kind default. That chain is what lets a
 *  parent-created category and its items show the right picture with no UI code
 *  change at all — the same reason the shelves themselves come from data. */
function itemGlyph(item) {
  const cat = (state.store?.categories ?? []).find((c) => c.id === item.categoryId);
  return item.payload?.icon || cat?.icon || KIND_GLYPH[item.kind] || "ticket";
}

function itemFace(item) {
  // The fan lives in the shared lib so the parent's shelf manager draws the same
  // packs from the same code (#34). An artless pack falls through to its glyph.
  if (item.kind === "pack") return packFan(item.stickers) || glyph(itemGlyph(item), "bx-item-ic");
  // DRAWN ART WINS, when there is any (#404). `artUrl` is the server's answer for both apps
  // (routes/store.ts itemView), so the kid's shelf and the parent's manager cannot end up
  // showing two different pictures of the same thing.
  //
  // ⚠️ Everything below stays. A parent-created coupon whose face nobody has drawn gets null
  // and falls through to the glyph it has always had, which is what keeps a household's own
  // shelf working without an art pipeline behind it.
  if (item.artUrl) return `<img class="bx-item-art" src="${esc(item.artUrl)}" alt="" />`;
  // Minutes ARE the difference between these tiles, so they draw the difference.
  if (item.kind === "screen_time") return minuteDialIcon(item.payload?.minutes, "bx-item-ic");
  if (item.kind === "timer_style") return timerPreview(item.payload?.styleId, "bx-timer-prev");
  return glyph(itemGlyph(item), "bx-item-ic"); // future kinds arrive with a face, not a crash
}

function itemTitle(item) {
  if (item.kind === "screen_time" && item.payload?.minutes) {
    return t("app.kidMinutes", { count: item.payload.minutes });
  }
  if (item.kind === "timer_style" && TIMER_LABELS[item.payload?.styleId]) {
    return t(TIMER_LABELS[item.payload.styleId]);
  }
  return rowTitle(item);
}

/** A grown-up is holding the screen shut, so the minutes on this tile buy nothing (#301).
 *  The server refuses the buy; this is the shelf saying so first, in the kid's words and
 *  with a name on it, because "no" from a parent is a different thing from a broken app. */
function unavailableNote(item) {
  if (item.unavailable === "locked_by_parent") {
    return `<span class="bx-unavailable">${esc(t("app.kidScreenOffByGrownup", { name: parentName() }))}</span>`;
  }
  // #377. A different "no" and it needs different words: nobody is cross, the day simply
  // has a ceiling and this tile is above what is left of it. "Come back tomorrow" is the
  // whole message, and it is true — the cap resets at midnight.
  if (item.unavailable === "over_daily_cap") {
    return `<span class="bx-unavailable">${esc(t("app.kidCapReached"))}</span>`;
  }
  return "";
}

function itemTile(item) {
  const owned = !!item.owned; // packs + timer styles report ownership
  const off = !!item.unavailable;
  const locked = !owned && !off && item.priceLuna > (state.wallet?.balanceLuna ?? 0);
  // A coupon has no `owned` state and is re-buyable on purpose, so the tile stayed at full
  // price with nothing to say one was already queued and a second tap spent the money again
  // in silence (#121). This says it. It does NOT disable the tile: two ice cream trips is a
  // real thing for a kid to want, and refusing that is a different decision from telling
  // them where the first one got to.
  const waiting = item.pendingCount > 0
    ? `<span class="bx-waiting">${esc(t("app.kidWaitingCount", { count: item.pendingCount }))}</span>`
    : "";
  return `
    <button class="bx-item ${owned ? "is-owned" : ""} ${locked ? "is-locked" : ""} ${off ? "is-off" : ""}" data-item="${esc(item.id)}" ${owned || off ? "disabled" : ""}>
      ${itemFace(item)}
      <span class="bx-item-title">${esc(itemTitle(item))}</span>
      ${owned
        ? `<span class="bx-owned">${checkIcon()} ${esc(t("app.kidHaveIt"))}</span>`
        : off
          ? unavailableNote(item)
          : `<span class="bx-price">${fmtNimLuna(item.priceLuna)} NIM</span>
             <span class="bx-fiat">${esc(fmtFiat(item.priceLuna))}</span>`}
      ${waiting}
    </button>`;
}

// ---------- "My prizes": the receipt the Box never had (#121) ----------
//
// A six-year-old spent 500 NIM of their own money on an ice cream trip, saw confetti, and
// the app behaved as though it had never happened. When the parent handed it over days
// later the row flipped to `fulfilled` in a table no screen read. Saving up for something
// is why a kid tolerates chores, so the thing they saved for has to exist somewhere.
//
// Three states, in the kid's words, because "pending_parent" is not one of them:
//   pending_parent -> waiting on {parent}
//   fulfilled      -> you got it
//   done           -> ready (packs and timer styles, which need nobody)
const PRIZE_STATE = {
  pending_parent: (p) => t("app.kidPrizeWaiting", { name: parentName() }),
  fulfilled: () => t("app.kidPrizeGot"),
  done: () => t("app.kidPrizeReady"),
  refunded: () => t("app.kidPrizeRefunded"),
};

function prizeRow(p) {
  const label = (PRIZE_STATE[p.status] ?? PRIZE_STATE.done)(p);
  return `
    <div class="bx-prize is-${esc(p.status)}">
      <span class="bx-prize-main">
        <span class="bx-prize-title">${esc(p.title)}</span>
        <span class="bx-prize-state">${esc(label)}</span>
      </span>
      <span class="bx-prize-price">${fmtNimLuna(p.priceLuna)} NIM</span>
    </div>`;
}

/** The shelf, or nothing at all on a kid who has never bought anything. An empty "My
 *  prizes" above full shelves reads as something broken rather than as something to come. */
function prizesShelf() {
  const prizes = state.purchases ?? [];
  if (!prizes.length) return "";
  return `
    <section class="bx-shelf bx-prizes">
      <h2 class="bx-shelf-hd">${esc(t("app.kidMyPrizes"))}</h2>
      <div class="bx-prize-list">${prizes.map(prizeRow).join("")}</div>
    </section>`;
}

/**
 * SETS YOU CAN COLLECT — moved here off the Today list (#400).
 *
 * Andjroo, 2026-09-01: "anytime, practice, set and you collect, that part is also very
 * confusing... the set could definitely go into this sticker box." He is right about why:
 * Today answers WHAT NOW, and five of its six headings were things to do while this one was a
 * thing to want. Reading them in one column, a kid cannot tell which is which.
 *
 * ⚠️ IT IS A WISH SHELF, NOT A SALE, AND THE HEADING HAS TO SAY SO. Every other shelf in this
 * screen has a price on every tile and a tap that spends real NIM. A tap here ASKS a grown-up
 * for a ladder, and what it costs and what it is called are settled with them
 * (`src/routes/goals.ts`) — which is exactly why the card cannot show a number. Sitting
 * silently among priced shelves it would read as free stuff.
 *
 * The cards are `setGroup`'s own, imported rather than copied: the chart and the Box drawing
 * two different set cards is how the Treasure Box once had five drawing styles.
 */
function setsShelf() {
  const grp = setGroup(state.goalThemes, state.chart?.goals, state.goalRequests);
  if (!grp) return "";
  return `
    <section class="bx-shelf bx-sets">
      <h2 class="bx-shelf-hd">${esc(t("app.kidSets"))}</h2>
      <p class="bx-sets-sub">${esc(t("app.kidSetsSub"))}</p>
      <div class="bx-set-list">${grp.cards.join("")}</div>
    </section>`;
}

// ---------- the screen ----------
export async function showBox() {
  const kid = state.child;
  if (!kid) return showChart();
  // refreshGoalSets is here and not only on the chart because the Box is now the ONLY
  // place a set is offered (#400). A kid who opens it first would otherwise meet an
  // empty shelf that fills in a second, which reads as the app losing them.
  await Promise.all([refreshStore(), refreshWallet(), refreshPurchases(), refreshGoalSets()]);
  const store = state.store ?? { categories: [], items: [] };
  const bg = bgFor();
  const balance = state.wallet?.balanceLuna ?? 0;
  const seen = seenSet();
  const all = buyable();
  const fresh = all.filter((i) => !seen.has(i.id));
  // On a first visit the seen-set is empty, so "New in the box" held every item
  // and the category shelves below repeated all of them (20 tiles for 10 items).
  // A "new" shelf only means something when it is a strict subset.
  const showNew = fresh.length > 0 && fresh.length < all.length;

  const shelves = (store.categories ?? []).map((cat, n) => {
    const items = (store.items ?? []).filter((i) => i.categoryId === cat.id);
    if (!items.length) return "";
    return `
      <section class="bx-shelf" style="--shelf-i:${n + 1}">
        <h2 class="bx-shelf-hd">${esc(catLabel(cat))}</h2>
        <div class="bx-row">${items.map(itemTile).join("")}</div>
      </section>`;
  }).join("");

  setScreen(`
    <div class="k-box box-enter">
      <button class="back-btn" id="bx-back">${arrowIcon("left")}</button>
      <!-- THE SLAB (scene.css). The back button is absolutely positioned over the screen's
           top-left and stays outside: it is chrome that floats, at the one rung the slab does
           not quiet. In landscape the slab is what lays the two shelf columns. -->
      <div class="k-slab bx-slab">
        <header class="bx-hd">
          <span class="bx-hd-title">
            <span class="bx-chest">${maskIcon("box", "bx-chest-ic")}</span>
            <h1 class="bx-title">${esc(t("app.kidTreasureBox"))}</h1>
          </span>
          <span class="bx-balance">${fmtNimLuna(balance)} <i>NIM</i></span>
        </header>
        ${prizesShelf()}
        ${showNew ? `
          <section class="bx-shelf bx-new">
            <h2 class="bx-shelf-hd">${esc(t("app.kidNewThings"))}</h2>
            <div class="bx-row">${fresh.map(itemTile).join("")}</div>
          </section>` : ""}
        ${shelves}
        <!-- ⚠️ LAST, and that is deliberate. Everything above is priced and a tap spends real
             NIM; this is a wish shelf. Drawn first it took the whole opening screen with five
             cards a kid cannot buy, which pushes the actual shop below the fold. -->
        ${setsShelf()}
      </div>
    </div>`, "k-screen box-screen", bg);

  $("bx-back").onclick = () => { markAllSeen(); showChart(); };
  document.querySelectorAll("[data-item]").forEach((b) => {
    b.onclick = () => {
      const item = (state.store?.items ?? []).find((i) => i.id === b.dataset.item);
      if (item) openBuySheet(item);
    };
  });
  // A set is ASKED for, never bought, so it goes nowhere near openBuySheet. `onSetTap` is the
  // same call the chart used to make (#400) — it is only the shelf around it that moved.
  document.querySelectorAll("[data-set]").forEach((b) => {
    b.onclick = () => onSetTap(b.dataset.set, showBox);
  });
}

// ---------- buy flow ----------
function openBuySheet(item) {
  const balance = state.wallet?.balanceLuna ?? 0;
  const after = balance - item.priceLuna;
  const enough = after >= 0;
  openSheet(`
    ${sheetHeadText(itemTitle(item))}
    <div class="bx-buy-face">${itemFace(item)}</div>
    <p class="bx-buy-cost">${esc(t("app.kidCosts", { amount: fmtNimLuna(item.priceLuna) }))}</p>
    <p class="bx-buy-fiat">${esc(t("app.kidAbout", { amount: fmtFiat(item.priceLuna) }))}</p>
    <p class="bx-buy-left">${esc(enough
      ? t("app.kidLeftAfter", { amount: fmtNimLuna(after) })
      : t("app.kidMoreToGo", { amount: fmtNimLuna(-after) }))}</p>
    ${enough
      ? `<button class="mega-btn gold" id="bx-buy">${esc(t("app.kidGetIt"))}</button>`
      : `<button class="mega-btn" id="bx-earn">${esc(t("app.kidGoEarn"))}</button>`}`);
  $("sheet-x").onclick = closeSheet;
  if (!enough) { $("bx-earn").onclick = () => { closeSheet(); showChart(); }; return; }
  $("bx-buy").onclick = async () => {
    $("bx-buy").disabled = true;
    const res = await api.buy(state.child.id, item.id).catch(() => ({ error: "network" }));
    closeSheet();
    if (res.error) {
      // `locked_by_parent` is reachable even with the tile greyed: a grown-up can lock the
      // screen while the Box is already open. Say who, not "something went wrong".
      toast(res.error === "insufficient_funds" ? t("app.kidNotEnough")
        : res.error === "locked_by_parent" ? t("app.kidScreenOffByGrownup", { name: parentName() })
        // Reachable with the tile ungreyed for the same reason as the line above: a sibling
        // tap or a parent lowering the cap can land while the Box is already open.
        : res.error === "earned_cap_reached" ? t("app.kidCapReached")
        : t("app.errGeneric"));
      return showBox();
    }
    await Promise.all([refreshWallet(), refreshStore(), refreshChart()]);
    if (res.kind === "pack") return packOpenMoment(res.stickers ?? []);
    if (res.kind === "timer_style") {
      await refreshPrefs(); // the owned-styles list just grew
      return timerEquipMoment(res.styleId);
    }
    if (res.kind === "screen_time") {
      celebrate();
      toast(`${t("app.kidScreenOn")} ${t("app.kidMinutes", { count: res.minutes })}`);
      return showBox();
    }
    // #376. An app is theirs from now on and the icon is already in the games grid, so the
    // useful thing to say is where to find it -- NOT the coupon line, which promises a
    // grown-up will make something happen and would be a lie about a purchase that already
    // completed. Kinds fall through to that coupon message, so every new kind has to claim
    // its own line here or it inherits a wrong one silently.
    if (res.kind === "app") {
      celebrate();
      toast(t("app.kidAppBought"));
      return showBox();
    }
    celebrate();
    toast(t("app.kidCouponPending", { name: parentName() }));
    showBox();
  };
}

/** Timer bought: celebrate + "use it now?" jumps into the studio Timer sheet
 *  (equips the new style and shows it selected among the kid's owned rigs). */
function timerEquipMoment(styleId) {
  celebrate();
  openSheet(`
    ${sheetHeadText(t("app.kidYoursNow"))}
    <div class="bx-buy-face">${timerPreview(styleId, "bx-timer-prev")}</div>
    <button class="mega-btn" id="bx-equip">${esc(t("app.kidUseItNow"))}</button>`);
  $("sheet-x").onclick = () => { closeSheet(); showBox(); };
  $("bx-equip").onclick = () => equipTimerStyle(styleId);
}

/** Pack tear-open: the pack splits, the new stickers fly out into the light. */
function packOpenMoment(stickers) {
  const overlay = $("kid-overlay");
  overlay.innerHTML = `
    <div class="pack-burst">
      <div class="pack-stks">
        ${stickers.map((s, i) => `
          <span class="stk stk-flat pack-fly" style="--i:${i};--n:${stickers.length}">${stickerFace(s)}</span>`).join("")}
      </div>
      <div class="pack-label">${esc(t("app.kidNewStickers"))}</div>
    </div>`;
  overlay.classList.add("show");
  celebrate();
  const done = () => { overlay.classList.remove("show"); overlay.innerHTML = ""; showBox(); };
  overlay.onclick = done;
  setTimeout(done, 2800);
}
