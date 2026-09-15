// nimiq.kids parent — planning ONE wallet connect that covers every kid at once.
//
// The per-child route (`registerKidAddress`, views-wallet.js) is what a parent uses today and
// is the stronger evidence: its challenge names one child and one address, so the wallet's
// signature proves that pairing. It costs one popup and one manual "Add address" per child.
//
// `connectAccount` costs ONE popup for the whole family and no manual step, because the
// Keyguard derives each requested path on the spot. The price is exact and is not hidden here:
//
//   THE SIGNED CHALLENGE CANNOT NAME A CHILD. Every key in the batch signs the same bytes, so
//   which returned address is Ivy's and which is Sam's is asserted BY THIS FILE, in the order
//   it asked for the paths. It is not proved. What stays proved is that every address in the
//   batch belongs to the parent, so the worst a swap can do is land Ivy's allowance in Sam's
//   jar, both inside the parent's own wallet.
//
// The server records which flow wrote each row (`children.address_proof_kind`) and never
// flattens the two into one boolean. Neither does the copy.
//
// Nothing in this file touches the DOM, the network or the wallet: it is the arithmetic of
// which kid gets which derivation path and whether what came back can be posted at all.
// src/parent-connect-batch.test.ts is the whole of its test surface.

/** Nimiq's standard account path, one slot per kid.
 *
 *  SLOT 0 IS NEVER HANDED TO A KID. It is where a Nimiq wallet puts its first address, which
 *  on nearly every household IS the family wallet, and the server refuses that pairing
 *  (`address_is_the_family_wallet`) — correctly, since payouts to self move nothing and error
 *  nowhere. Kids start at 1. */
export const kidKeyPath = (slot) => `m/44'/242'/0'/${slot}'`;

/**
 * May this instance offer a parent ANY of its kids' keys?
 *
 * ONLY where the server holds none. Under `kidCustody: "server"` the instance derives every
 * kid's account from its own seed and signs their sends, stakes and Treasure Box buys with
 * it. Moving a kid onto a parent-owned address there does not add a capability, it REMOVES
 * one: `kidOutflowRefusal` answers 409 `parent_signature_required` for every kid-initiated
 * outflow from that moment on (src/wallet/kid-wallet.ts), kid-signed-by-parent outflows are
 * Phase 4 of NONCUSTODIAL-PLAN.md and do not exist, and no route moves a kid back. The kid's
 * money keeps arriving and stops being spendable, permanently, one tap deep on the home
 * screen. The Hub also refuses to sign FROM a connect-derived address, so the parent cannot
 * spend it either.
 *
 * Under `kidCustody: "parent"` the same flow is the ONLY way a kid gets an address at all:
 * that instance boots with no seed by design and mints nothing.
 *
 * So the answer is the instance's, never the screen's, and `HATCH_CUSTODY` decides alone.
 * Unknown resolves to NO — an instance that has not answered is not one to hand keys around
 * on, and the offer reappears the moment it does.
 */
export const offersParentCustody = (custody) => custody?.kidCustody === "parent";

/**
 * Who is in this batch, and on which path.
 *
 * A kid already on a parent-owned address is left out — there is nothing to ask their wallet
 * for — but their SLOT IS STILL SPENT. The slot follows a child's position in the roster, not
 * their position among the ones still waiting, because the roster is ordered by creation and
 * never renumbers. Pack the slots instead and a fourth kid added next month would be handed
 * the path of a sibling who registered months ago, and the server would refuse the whole
 * batch for a duplicate the parent has no way to see.
 */
export function planConnectBatch(children) {
  const out = [];
  (children ?? []).forEach((child, i) => {
    if (!child?.id || child.addressSource === "parent") return;
    out.push({ childId: child.id, label: child.label ?? "", keyPath: kidKeyPath(i + 1) });
  });
  return out;
}

const bare = (a) => String(a ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Turn what the wallet handed back into what the batch endpoint takes, or refuse.
 *
 * ORDER IS THE MAPPING. The Hub returns one signature per requested key path, in the order
 * they were asked for, and that index is the only thing tying an address to a child. So the
 * two cheap checks that would catch a wallet which did NOT honour that are made here rather
 * than assumed: a count that disagrees, and two paths that came back as the same address.
 * Both mean the index no longer means what this file thinks it means, and posting anyway
 * would file one kid's money under another's name with a valid signature on top.
 */
export function assignmentsFrom(entries, signatures) {
  const sigs = Array.isArray(signatures) ? signatures : [];
  if (sigs.length !== entries.length) {
    return { ok: false, error: "signature_count", want: entries.length, got: sigs.length };
  }
  const seen = new Set();
  const assignments = [];
  for (let i = 0; i < entries.length; i++) {
    const s = sigs[i] ?? {};
    if (!s.signer || !s.publicKeyHex || !s.signatureHex) {
      return { ok: false, error: "signature_missing", childId: entries[i].childId };
    }
    if (seen.has(bare(s.signer))) {
      return { ok: false, error: "signature_repeat", childId: entries[i].childId };
    }
    seen.add(bare(s.signer));
    assignments.push({
      childId: entries[i].childId,
      keyPath: entries[i].keyPath,
      address: s.signer,
      publicKeyHex: s.publicKeyHex,
      signatureHex: s.signatureHex,
    });
  }
  return { ok: true, assignments };
}

/**
 * Which sentence to say when the batch did not go through, as a key plus its parameters.
 *
 * Returned rather than rendered so this stays testable without i18n or a DOM, and so the one
 * fact that is true of EVERY refusal here — the batch is all or nothing, so nothing at all
 * was written — is carried by the strings themselves instead of a caller remembering to add it.
 *
 * `nameOf` resolves a childId to the label the parent knows them by; `nim` renders luna as the
 * app renders every other amount. Both are injected rather than imported so this file keeps no
 * dependency at all, and so a test can assert on the numbers it passed in.
 */
export function connectRefusal(data, { nameOf = () => "", nim = String } = {}) {
  const name = nameOf(data?.childId) ?? "";
  switch (data?.error) {
    // ---- the wallet disagreed with what we asked it for (never reached the server) ----
    case "signature_count": return { key: "papp.cbCountMismatch", params: { got: data.got, want: data.want } };
    case "signature_repeat": return { key: "papp.cbSameAddress", params: {} };
    case "signature_missing": return { key: "papp.cbIncomplete", params: {} };
    // ---- the server refused, naming the entry it stopped on ----
    case "address_is_the_family_wallet": return { key: "papp.cbIsFamilyWallet", params: {} };
    case "address_is_a_grownup_wallet": return { key: "papp.addrIsGrownUpWallet", params: { name: data.byLabel ?? "" } };
    case "duplicate_address": return { key: "papp.cbSameAddress", params: {} };
    case "address_taken": return { key: "papp.cbTaken", params: { name, other: data.byLabel ?? "" } };
    case "proof_invalid": return { key: "papp.cbProofFailed", params: {} };
    case "funds_at_old_address": return { key: "papp.cbOldHasFunds", params: { name, amount: nim(data.balanceLuna ?? 0) } };
    // These two say exactly the right thing already on the per-child route; a second wording
    // of "start again" is a second thing to keep translated for no gain.
    case "challenge_expired":
    case "challenge_used": return { key: "papp.addrExpired", params: {} };
    case "balance_check_failed": return { key: "papp.addrCheckFailed", params: {} };
    default: return { key: "papp.cbNothingSetUp", params: {} };
  }
}
