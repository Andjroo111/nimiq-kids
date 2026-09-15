// A kid choosing their own character, on their own first login.
//
// The identicon a kid sees is drawn from their address; the address is derived from one small
// integer, `children.account_index`. Today that integer is handed out as MAX+1 the first time a
// money path touches the kid (`assignKidAccount`), so the character is an accident of birth
// order. This module makes it a choice.
//
// THE LINE THIS MODULE HOLDS. `src/routes/kid-address.ts` is parent-authed for a reason it
// states plainly: a kid's tablet must not be able to point their own payouts somewhere, and a
// kiosk device is a shared object in a house. Picking a character does not cross that line and
// must never be allowed to. Registering an address introduces a destination the family has
// never controlled. Choosing an index selects among addresses this server ALREADY derives
// inside this family's own branch of the tree. So:
//
//   the server mints the offer and stores it
//   the device returns an index, never an address
//   an index that was not in a stored offer for THIS child is refused
//
// Everything else here is about the one-way door. An index that has been claimed and paid into
// cannot be re-picked: re-deriving would produce a different address and leave the NIM at the
// old one, which `kidKey()` turns into a thrown `kid_key_address_mismatch` rather than a wrong
// signature. Safe, but the money still does not move itself back. So the pick is refused the
// moment a kid holds coordinates at all, funded or not, rather than the moment it would hurt.

import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { getDb } from "./db";
import { custodyMode } from "./custody-boot";
import { deriveKidKey } from "./nimiq/hd";

/** Three rows of three. Nine fits a tablet without scrolling, which is what keeps this a
 *  delight rather than a menu. Nothing is signed, so the number is a UI decision, not a cost. */
export const CHOICES_PER_SET = 9;

/** How many times a kid may ask for a different nine. Bounded because each shuffle walks the
 *  family's index space forward by CHOICES_PER_SET and never walks back: without a cap, a kid
 *  tapping shuffle for ten minutes leaves a household whose next sibling starts at index 4,000.
 *  Ten sets is ninety characters, far past the point where choosing stops being fun. */
export const MAX_SETS_PER_CHILD = 10;

/** Long enough for a kid to think about it, short enough that a tablet left on a counter
 *  overnight does not hold a standing offer. */
export const SET_TTL_MS = 30 * 60 * 1000;

export interface CharacterSetRow {
  id: string;
  family_id: string;
  child_id: string;
  indices: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface CharacterChoice {
  index: number;
  /** The address the identicon is drawn from. PUBLIC. The private key never leaves `deriveKidKey`. */
  address: string;
}

export type CharacterRefusal =
  | "already_chosen"
  | "parent_custody"
  | "no_shuffles_left"
  | "set_not_found"
  | "set_expired"
  | "set_used"
  | "not_offered"
  | "index_taken";

export type IssueResult =
  | { ok: true; id: string; choices: CharacterChoice[]; expiresAt: number; shufflesLeft: number }
  | { ok: false; error: CharacterRefusal };

export type ClaimResult =
  | { ok: true; child: repo.Child; index: number }
  | { ok: false; error: CharacterRefusal };

function setsIssuedFor(childId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS n FROM kid_character_sets WHERE child_id=?")
    .get(childId) as { n: number };
  return row.n;
}

/** A kid who already holds coordinates or an address has nothing left to choose. Covers both
 *  custody shapes on purpose: a parent-registered address is a settled answer too. */
function alreadySettled(child: repo.Child): boolean {
  return child.account_index !== null || !!child.address;
}

/**
 * Mint a set of characters for this kid, or say why not.
 *
 * The offered indices start at the family's next free index and step forward by a whole set per
 * shuffle, so two shuffles never re-offer the same character and no index is consumed by being
 * looked at. Deriving an address here reads the family seed; only the address is returned, and
 * only from inside this function.
 */
export async function issueCharacterSet(fam: repo.Family, child: repo.Child): Promise<IssueResult> {
  if (custodyMode() === "parent") return { ok: false, error: "parent_custody" };
  if (alreadySettled(child)) return { ok: false, error: "already_chosen" };

  const issued = setsIssuedFor(child.id);
  if (issued >= MAX_SETS_PER_CHILD) return { ok: false, error: "no_shuffles_left" };

  // THE HOUSEHOLD'S BRANCH IS ASSIGNED HERE, BEFORE ANY ADDRESS IS DRAWN, and that ordering is
  // the whole correctness of this feature. A kid must receive the character they tapped, so the
  // path used to draw the nine has to be the path the claim will derive from. Deferring this to
  // the claim would derive the offer on the legacy flat path and the claim on the scoped one:
  // the kid picks a vampire and is given a pear, with nothing on any screen to explain it.
  //
  // Assigning early costs nothing. `assignFamilyHdIndex` is idempotent and permanent, so a
  // household that browses characters and abandons has consumed exactly the one branch index it
  // was always going to get.
  const familyIndex = wrepo.assignFamilyHdIndex(fam.id);

  // Read-only: finding out where to start must not cost a coordinate.
  const base = wrepo.nextFreeKidIndex(fam.id) + issued * CHOICES_PER_SET;
  const indices = Array.from({ length: CHOICES_PER_SET }, (_, i) => base + i);

  const choices: CharacterChoice[] = [];
  for (const index of indices) {
    const key = await deriveKidKey({ index, familyIndex });
    choices.push({ index, address: key.address });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  getDb().run(
    `INSERT INTO kid_character_sets (id, family_id, child_id, indices, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [id, fam.id, child.id, JSON.stringify(indices), now + SET_TTL_MS, now],
  );

  return {
    ok: true,
    id,
    choices,
    expiresAt: now + SET_TTL_MS,
    shufflesLeft: MAX_SETS_PER_CHILD - (issued + 1),
  };
}

export function getCharacterSet(id: string): CharacterSetRow | null {
  return (getDb().query("SELECT * FROM kid_character_sets WHERE id=?").get(id) as CharacterSetRow) ?? null;
}

/**
 * Claim one character out of a set this server minted.
 *
 * Order matters and is cheapest-first, same as the parent registration path: the refusals that
 * need no work come before the one that writes. The set is re-read from the database and never
 * trusted from the client, because the offer is the only thing standing between a device token
 * and an arbitrary derivation index.
 */
export async function claimCharacter(
  fam: repo.Family,
  child: repo.Child,
  req: { setId: string; index: number },
): Promise<ClaimResult> {
  if (custodyMode() === "parent") return { ok: false, error: "parent_custody" };
  if (alreadySettled(child)) return { ok: false, error: "already_chosen" };

  const set = getCharacterSet(req.setId);
  // Same refusal for "no such set" and "another household's set", so the endpoint is not a
  // probe for set ids belonging to other families.
  if (!set || set.family_id !== fam.id || set.child_id !== child.id) {
    return { ok: false, error: "set_not_found" };
  }
  if (set.used_at !== null) return { ok: false, error: "set_used" };
  if (set.expires_at <= Date.now()) return { ok: false, error: "set_expired" };

  const offered: number[] = JSON.parse(set.indices);
  if (!offered.includes(req.index)) return { ok: false, error: "not_offered" };

  // The write. The household's branch was fixed when the offer was minted and is never
  // reassigned, so `claimKidAccountIndex` reads back the same `familyIndex` the nine were drawn
  // against and the kid gets the character they tapped.
  const account = wrepo.claimKidAccountIndex(child.id, req.index);
  if (!account) return { ok: false, error: "index_taken" };

  const key = await deriveKidKey(account);
  wrepo.setChildAddress(child.id, key.address);
  getDb().run("UPDATE kid_character_sets SET used_at=? WHERE id=?", [Date.now(), set.id]);

  return { ok: true, child: repo.getChild(child.id)!, index: account.index };
}
