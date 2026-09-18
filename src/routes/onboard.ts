// Self-serve onboarding (mini-app port slice 2): a total stranger — a competition
// judge inside Nimiq Pay, or an invited family from a ?ref link — creates their own
// household and is using nimiq.kids in under a minute. One POST creates the family
// (family mode, same as the live household), the first kid, a few sample chores,
// and mints the parent bearer token core.js already speaks.
//
// Also the 6-digit pairing-code fallback: WebViews can drop the #t= fragment, so a
// signed-in session can show a short-lived single-use code and any other device
// (the Pay WebView included) types it to mint a parent token for the same family.
//
// Guardrails: parent-custodial framing lives in the UI copy; here the server stores
// the same minimal data as everywhere else (labels + emoji, zero kid PII), and a
// ?ref join records ONLY the joined status + timestamp on the inviter's referral.

import { Hono } from "hono";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";
import * as referrals from "../repo-referrals";
import { newToken, parentFamilyFrom, requireParent, sha256Hex } from "../auth";
import { makeProvider } from "../wallet";
import { normalizeNqAddress } from "./wallet";
import { custodyMode } from "../custody-boot";
import { job, jobKey } from "../title-catalog";
import { SAMPLE_CHORES } from "../starter-board";
import { nimUsd, usdToWholeNimLuna } from "../rates";
import { clientIp } from "../client-ip";
import { allow, resetRateLimits } from "../rate-limit";
import { pairAttemptAllowed, pairGuessBudgetSpent, recordPairGuessMiss } from "../pair-brake";
import { refuseHouseholdWrite } from "./members";
import * as memberRepo from "../repo-members";
import * as goalsRepo from "../repo-goals";
import { goalTemplate, goalTitleKey, goalStepKey } from "../goal-templates";
import { catEn } from "../locales/catalog";
import * as stickersRepo from "../repo-stickers";

export { resetRateLimits };

export const onboardRoutes = new Hono();

export const PAIR_CODE_TTL_MS = 5 * 60 * 1000;

// The starter board every new family wakes up to (family mode requires luna > 0) now lives
// in ../starter-board, because the budget has to be able to ask what it costs. See the
// header there for why it is priced in dollars.

// Rate limiting lives in ../rate-limit (one shared store) and the caller's identity in
// ../client-ip (peer address, never a header the caller chose).

// ---- create your family ----

const PLACEHOLDER_ADDRESS = "NQ00 0000 0000 0000 0000 0000 0000 0000 0000";

/**
 * The address a household's money comes back TO: the recipient of every kid -> parent
 * send and every Treasure Box purchase, and the counterparty drawn on every earn.
 *
 * A parent who onboards without connecting a wallet used to get PLACEHOLDER_ADDRESS
 * stored as the real thing — and it is not an address at all, it fails its checksum.
 * Verified on testnet 2026-07-31: on such a family `POST /kids/:id/send {toParent}`
 * answered 400 "Invalid checksum" and every `POST /kids/:id/buy` answered 502, i.e.
 * the whole Treasure Box was dead on the judge path, which is exactly the path that
 * never connects a wallet.
 *
 * Fall back to the instance hot wallet instead — the same address ensureFamily()
 * has always given the legacy household, the same one POST /api/demo/family uses,
 * and the same one that pays every earn. The placeholder survives only for a
 * read-only boot with no signing key configured, where there is no wallet to name.
 *
 * UNDER PARENT CUSTODY THE FALLBACK IS A LIE AND THERE IS NO FALLBACK.
 *
 * `families.parent_address` is where a kid's money comes back TO, and under parent custody
 * it is also the account that will eventually SIGN every payout. Naming the instance hot
 * wallet there means the household's own row points at somebody else's wallet: the parent
 * cannot spend from it, the Treasure Box charges to it, and the whole "the server has no
 * signature" claim is false for that family from the moment it is created.
 *
 * So on a parent-custody instance an onboarding request has to bring a real address, and
 * one that is not this. NONCUSTODIAL-PLAN calls this out as "the biggest onboarding
 * regression in the plan and it is non-negotiable"; keeping it behind the custody switch is
 * what stops it from also being a regression on the judge path, which never connects a
 * wallet and is unchanged on server custody.
 */
async function familyWalletAddress(): Promise<string> {
  try {
    return await makeProvider().getAddress();
  } catch {
    return PLACEHOLDER_ADDRESS;
  }
}

/** New families per IP per hour + per instance per day. Env-overridable brakes, read once at
 *  import so a test cannot move them mid-run; exported so a test can spend the day's budget
 *  against the same number the route enforces rather than a copy of it. */
export const ONBOARD_MAX_PER_IP_HOUR = Number(process.env.HATCH_ONBOARD_PER_IP_HOUR ?? 3);
export const ONBOARD_MAX_PER_DAY = Number(process.env.HATCH_ONBOARD_PER_DAY ?? 200);

/** The first goal, as the parent climb sends it (WP2, corrected 2026-09-18): the theme pack
 *  the parent picked as the prize (data only, the path draws the gift mark) and a GOAL TEMPLATE
 *  (src/goal-templates.ts), a skill in steps. Andjroo: a goal is not a chore. The first cut had
 *  the goal's rungs be the three starter chores, which fused the everyday loop (jobs on the
 *  board, done today, paid) with the ladder (steps to manage, a prize on top). Now the board
 *  gets its three everyday jobs AND the kid gets a ladder whose rungs are the template's steps.
 *  The SLOT prices nothing here: every step pays the template's own modest amount. */
/** Kept for the copy sheet's preview banner; a ladder built here carries the TEMPLATE's key. */
export const ONBOARD_GOAL_TITLE_KEY = "cat.goal.first";
type OnboardGoal = { packId: string | null; template: string };
function readGoal(raw: unknown): { goal: OnboardGoal | null; error?: string } {
  if (raw === undefined || raw === null) return { goal: null };
  if (typeof raw !== "object") return { goal: null, error: "goal_invalid" };
  const g = raw as { packId?: unknown; template?: unknown };
  const packId = g.packId ? String(g.packId) : null;
  if (packId && !stickersRepo.isThemePack(packId)) return { goal: null, error: "unknown_theme" };
  if (!goalTemplate(g.template)) return { goal: null, error: "goal_template_invalid" };
  return { goal: { packId, template: String(g.template) } };
}

/**
 * POST /api/onboard — the judge path. Body:
 *   { parentLabel, kidLabel, kidEmoji?, address?, ref?, goal? }
 * Creates family (mode 'family') + first kid + sample chores, mints the parent
 * bearer token (returned ONCE — the client stores it the way core.js expects),
 * and marks the inviter's referral joined when a valid ?ref code rides along.
 *
 * With `goal: { packId, template }` (the parent climb's step 5) the same POST ALSO creates the
 * kid's FIRST GOAL: one ladder, climbed in order, its rungs the template's steps. The three
 * sample chores land on the board either way: they are the everyday loop, the goal is the
 * other thing. Atomic with the family, so a household never exists half-onboarded, and still
 * one call under the brake. No `goal` keeps today's board for the judge route.
 */
onboardRoutes.post("/onboard", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parentLabel = String(body.parentLabel ?? "").trim();
  const kidLabel = String(body.kidLabel ?? "").trim();
  const kidEmoji = String(body.kidEmoji ?? "🦖").trim() || "🦖";
  if (!parentLabel) return c.json({ error: "parent_label_required" }, 400);
  if (parentLabel.length > 24) return c.json({ error: "parent_label_too_long" }, 400);
  // COPPA: the kid label is a nickname only — never a legal name, never any other PII.
  if (!kidLabel) return c.json({ error: "kid_label_required" }, 400);
  if (kidLabel.length > 24) return c.json({ error: "kid_label_too_long" }, 400);
  // THE CODEC, NOT A SHAPE. The old guard was `/^NQ[0-9A-Z ]{2,42}$/`, which accepts any
  // NQ-ish string of roughly the right length — wrong checksum, wrong length, transposed
  // characters, all fine. routes/wallet.ts already had the real check and its comment records
  // why: three malformed addresses passed the regex on 2026-07-31, queued, pinged the parent,
  // and threw "Invalid checksum" only at approve time, after the approval had been decided.
  // A predicate written down twice is a bug with a delay on it, so this now calls the same
  // function rather than keeping a second, weaker copy of the same question.
  const rawInput = String(body.address ?? "").trim();
  const rawAddress = rawInput ? await normalizeNqAddress(rawInput) : "";
  if (rawInput && !rawAddress) return c.json({ error: "invalid_address" }, 400);
  // See familyWalletAddress: under parent custody there is no hot-wallet fallback, because
  // a family whose `parent_address` is the instance wallet cannot sign for itself.
  if (custodyMode() === "parent" && !rawAddress) return c.json({ error: "address_required" }, 400);
  const { goal, error: goalError } = readGoal(body.goal);
  if (goalError) return c.json({ error: goalError }, 400);
  // Under SERVER custody the family wallet MUST be the instance hot wallet, and a caller-supplied
  // address is ignored. A kid's Treasure Box buy pays into `parent_address` (signed with the kid's
  // key) while a coupon-reject refund pays out of the hot wallet; the per-family budget nets the
  // two to zero only because they are the SAME account. Letting a self-serve caller point
  // `parent_address` at a wallet they own broke that symmetry — the spend enriched their wallet
  // while the refund drained the shared float, unbounded, since the budget saw net zero.
  const parentAddress = custodyMode() === "server" ? await familyWalletAddress() : rawAddress!;

  // The brake sits AFTER validation so typos never burn the budget — it guards
  // actual row creation (the thing worth bounding).
  //
  // TWO BRAKES, TWO CODES (#242). They used to share `too_many_requests`, and a screen given
  // one code can only say one thing: the caller cannot tell "you, in the last hour" from "this
  // instance, for the rest of today", and those have different answers. Written as two
  // statements rather than one `||` so the per-IP refusal still short-circuits — a caller who
  // has spent their own hour must not also spend a count from the instance's day.
  if (!allow(`onboard:${clientIp(c)}`, ONBOARD_MAX_PER_IP_HOUR, 60 * 60 * 1000)) {
    return c.json({ error: "too_many_requests" }, 429);
  }
  if (!allow("onboard:all", ONBOARD_MAX_PER_DAY, 24 * 60 * 60 * 1000)) {
    return c.json({ error: "too_many_families_today" }, 429);
  }

  const created = repo.createFamily(parentLabel, parentAddress);
  // Same mode as the live household: family mode (approvals + real kid accounts).
  repo.updateFamilySettings(created.id, { mode: "family" });
  const fam = repo.getFamily(created.id)!;
  const kid = repo.createChild(fam.id, kidLabel, kidEmoji);
  // Resolve the dollar prices to whole NIM once, against the live rate — same conversion the
  // demo seeder and the chore-creation route use, so a starter chore is worth what an
  // identical hand-made one would be.
  const rate = await nimUsd();
  // The everyday loop: three jobs on the board, whether or not a goal rides along.
  const chores = SAMPLE_CHORES.map((s) => {
    const j = job(s.job);
    return repo.createChore(fam.id, kid.id, j.en, usdToWholeNimLuna(s.rewardUsd, rate), j.emoji, { titleKey: jobKey(j.id) });
  });
  // The other thing: a ladder of the template's steps, climbed in order, the prize on top.
  // The title is the template's own (Ride the bike), a catalog key so the tablet translates it.
  const tpl = goal ? goalTemplate(goal.template)! : null;
  const en = (key: string) => (catEn as Record<string, string>)[key] ?? key;
  const ladder = tpl ? goalsRepo.createGoal(fam.id, kid.id, en(goalTitleKey(tpl.id)),
    { emoji: tpl.emoji, ordered: true, titleKey: goalTitleKey(tpl.id), packId: goal!.packId }) : null;
  const rungs = ladder && tpl ? Array.from({ length: tpl.steps }, (_, i) =>
    goalsRepo.addRung(ladder.id, en(goalStepKey(tpl.id, i + 1)), {
      emoji: tpl.emoji, rewardLuna: usdToWholeNimLuna(tpl.rewardUsd, rate), titleKey: goalStepKey(tpl.id, i + 1),
    })) : [];

  const token = newToken();
  // The household was created a few lines up, so its owner is this parent, by construction.
  lockRepo.createParentToken(fam.id, `${parentLabel}'s phone`, await sha256Hex(token), memberRepo.ownerOf(fam.id)?.id);

  // Invited family: flip the inviter's referral accepted -> joined. Best-effort and
  // attribution-only — nothing about THIS household lands on the inviter's side.
  const ref = String(body.ref ?? "").trim().toUpperCase();
  if (ref) referrals.recordJoin(ref);

  return c.json({
    token, // shown once; only the hash is stored
    family: { id: fam.id, parentLabel: fam.parent_label, mode: fam.mode },
    child: { id: kid.id, label: kid.label, emoji: kid.emoji },
    chores: chores.map((ch) => ({
      id: ch.id, title: ch.title, titleKey: ch.title_key, emoji: ch.emoji, rewardLuna: ch.reward_luna,
    })),
    ...(ladder ? { goal: {
      id: ladder.id, title: ladder.title, titleKey: ladder.title_key, packId: ladder.pack_id, template: tpl!.id,
      rungs: rungs.map((r) => ({ id: r.id, title: r.title, titleKey: r.title_key, emoji: r.emoji, rewardLuna: r.reward_luna })),
    } } : {}),
  }, 201);
});

// ---- pairing codes ----

function newPairCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

/** Signed-in side: mint a fresh 6-digit code for THIS family (supersedes any live
 *  one). The code crosses to the other device by eyeball, never by URL. */
onboardRoutes.post("/parent/pair-code", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // Admitting a device to the household is the household's own business. A grandparent who
  // wants a grown-up in is asking for /family/members/invite, which is a different capability
  // with a different role gate on it.
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  // #364: optionally name the kid this code's tablet belongs to. The alternative was a
  // parent typing a raw child UUID on a tablet keyboard, and the alternative to THAT was
  // leaving it blank — which is not an error, it silently follows the family's first kid.
  const body = await c.req.json().catch(() => ({}));
  const childId = body.childId ? String(body.childId) : null;
  if (childId && repo.getChild(childId)?.family_id !== fam.id) return c.json({ error: "child_not_found" }, 404);
  const code = newPairCode();
  const row = lockRepo.createPairCode(fam.id, await sha256Hex(code), PAIR_CODE_TTL_MS, childId);
  return c.json({ code, expiresAt: row.expires_at, ttlMs: PAIR_CODE_TTL_MS, childId }, 201);
});

/** Other device: type the code, get a parent token for that family. Single use.
 *  Two brakes, both in ../pair-brake: per caller, and an instance-wide budget of wrong
 *  guesses that `POST /api/devices/register` spends from as well. */
onboardRoutes.post("/pair", async (c) => {
  if (!pairAttemptAllowed(clientIp(c)) || pairGuessBudgetSpent()) {
    return c.json({ error: "too_many_attempts" }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return c.json({ error: "bad_code" }, 400);
  const row = lockRepo.redeemPairCode(await sha256Hex(code));
  if (!row) { recordPairGuessMiss(); return c.json({ error: "bad_code" }, 404); }
  const fam = repo.getFamily(row.family_id);
  if (!fam) { recordPairGuessMiss(); return c.json({ error: "bad_code" }, 404); }
  const token = newToken();
  // A pairing code re-attaches a phone to a household somebody already signed in to, and only
  // the owner can mint one (refuseHouseholdWrite on /parent/pair-code), so this is their phone.
  // A grown-up JOINING a household types a member invite instead — POST /api/members/join.
  lockRepo.createParentToken(fam.id, "Paired device", await sha256Hex(token), memberRepo.ownerOf(fam.id)?.id);
  return c.json({ token, family: { id: fam.id, parentLabel: fam.parent_label } });
});
