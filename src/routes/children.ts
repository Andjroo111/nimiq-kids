import { Hono } from "hono";
import * as repo from "../repo";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { INVALID_EMOJI, readEmoji } from "../emoji-field";
import { gatedChildIds } from "../kid-switch";
import { refuseBoardWrite } from "./members";

export const children = new Hono();

children.get("/children", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  // `hasSecret` is the ONLY thing about a kid's switch secret that crosses the wire (#123) —
  // the roster has to know which faces cost something to tap. The hash lives in its own
  // table precisely so a route like this one cannot spread it by returning the row.
  const gated = new Set(gatedChildIds(fam.id));
  return c.json({
    children: repo.listChildren(fam.id).map((ch) => ({ ...ch, hasSecret: gated.has(ch.id) })),
  });
});

children.post("/children", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  // Who is in the family is not a supporter's call.
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  const emoji = readEmoji(body.emoji, "🦖");
  if (emoji === null) return c.json(INVALID_EMOJI, 400);
  if (!label) return c.json({ error: "label_required" }, 400);
  if (label.length > 24) return c.json({ error: "label_too_long" }, 400);
  // COPPA: label is a nickname only; never collect a real/legal name or any other PII.
  const child = repo.createChild(fam.id, label, emoji);
  return c.json({ child }, 201);
});

/**
 * The language ONE kid's tablet reads in (#432), or null to hand it back to the device.
 *
 * Parent-authed, never kid and never device: the kid-side switcher was removed on 2026-08-27
 * and must not come back, which is exactly why a kid's language was unsettable by anybody
 * until this route existed.
 *
 * `lang: null` is a real, meaningful value here and not a missing field, so an ABSENT `lang`
 * is a 400 rather than a clear. A client that forgot to send one would otherwise silently
 * reset a household, and "the picker did nothing" is a much cheaper bug to have than "the
 * picker reset it".
 */
children.patch("/children/:id/lang", async (c) => {
  const child = repo.getChild(c.req.param("id") ?? "");
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  if (!("lang" in (body as object))) return c.json({ error: "lang_required" }, 400);
  const raw = (body as { lang?: unknown }).lang;
  const lang = raw === null || raw === "" ? null : String(raw);
  if (lang !== null && !(repo.KID_LANGS as readonly string[]).includes(lang)) {
    return c.json({ error: "unknown_language", allowed: repo.KID_LANGS }, 400);
  }
  repo.setChildLang(child.id, lang);
  return c.json({ child: { id: child.id, label: child.label, lang } });
});

children.get("/children/:id", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "not_found" }, 404);
  // Omit the bearer `url` (it holds the claim secret) — fetch it per-cashlink via /cashlinks/:id/link.
  // Keep address + funding tx hash so the UI can show an on-chain "Receipt".
  const cashlinks = repo.listCashlinksForChild(child.id).map(({ url, ...safe }) => safe);
  // History split: chore earnings vs learning earnings (learn-to-earn), claimed payouts only.
  const earnings = repo.earningsByKind(child.id);
  return c.json({ child, cashlinks, earnings });
});
