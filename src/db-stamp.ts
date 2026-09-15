// Which chain is this database's history written on, and whose seed derived its addresses?
//
// Three live instances run off this one repo, and `NIMIQ_NETWORK` is a plain env var read at
// import. Nothing recorded which chain a database belonged to. Point a mainnet DB at testnet,
// or restore the wrong backup, and NOTHING VISIBLY BREAKS: kid addresses are identical across
// networks because they derive from the same seed, so every screen renders, every historical
// `wallet_events.tx_hash` links to an explorer for the wrong chain, and every balance is read
// from a chain that never saw those transactions. It does not fail. It lies quietly.
//
// So the database says what it is, once, and disagreement stops the boot.
//
// The seed half is a FINGERPRINT, never the seed: a salted SHA-256, truncated. It exists to
// answer "is this the same seed as last time?" and nothing else. A rotated or restored-from-
// elsewhere seed derives different addresses for the same children, which is the same class
// of silent wrongness as the network — the rows say a kid owns NQ…A while the server can only
// sign for NQ…B, and `kidKey`'s per-kid mismatch guard only catches it later, one child at a
// time, at signing time.
//
// No I/O of its own: the store is injected, so the rule can be tested without a database.
// Synchronous throughout, because `initDb` is and making it async would ripple into every
// test and every boot path for no gain.

import { createHash } from "node:crypto";
import type { CustodyMode } from "./custody-boot";

/** The two facts a database is stamped with. `seedFingerprint` is null when no seed is set
 *  (SIM development), which is itself a fact worth pinning. */
export interface DbStamp {
  network: string;
  seedFingerprint: string | null;
}

export type StampVerdict =
  /** Nothing disagrees. `write` is the keys that are ABSENT and should be recorded now —
   *  which covers a brand-new database, one that predates this check, and one first used in
   *  SIM that has since acquired a seed. A key already present is never in this list. */
  | { kind: "ok"; write: Partial<DbStamp> }
  /** Stamp present and it does NOT agree. Refuse to boot, and say what to do. */
  | { kind: "refuse"; message: string };

export const STAMP_NETWORK_KEY = "db_network";
export const STAMP_SEED_KEY = "db_seed_fingerprint";

/**
 * A stable, non-reversible tag for a seed.
 *
 * Salted with a constant so the digest is specific to this use: an unsalted SHA-256 of a
 * hex seed is a value someone could otherwise recognise from another context. It is not a
 * password hash and does not need to be — the input is 32 bytes of entropy, so there is no
 * dictionary to run — but a bare digest of a secret sitting in a database is the kind of
 * thing that gets copied into a bug report.
 */
export function seedFingerprint(seed: string | undefined): string | null {
  if (!seed) return null;
  return createHash("sha256").update(`nimiq.kids/db-stamp/v1|${seed}`).digest("hex").slice(0, 16);
}

/** The env var that lets an operator say "yes, I meant to do that". Named in every refusal. */
export const OVERRIDE_ENV = "HATCH_ALLOW_DB_STAMP_MISMATCH";

/**
 * Compare what the database says with what this process is configured for.
 *
 * STAMP ONLY AN UNSTAMPED DATABASE, AND NEVER REWRITE ONE. Every existing database predates
 * this check, so the first boot after it ships adopts whatever that instance is currently
 * running as — which is correct, because that instance IS currently running as that. A check
 * that rewrote the stamp on mismatch would be a check that always passes.
 */
export function stampVerdict(opts: {
  stored: Partial<DbStamp>;
  current: DbStamp;
  /**
   * Which custody model this process runs. Not a stamped fact — a fact about the PROCESS,
   * like `network` is, and the reason the seed-went-away rule below has two answers.
   *
   * Deliberately NOT recorded in the stamp. A stamp is only ever written once and never
   * rewritten, which is what makes the other two trustworthy; custody is a setting an
   * operator can legitimately turn back off within the hour of turning it on, so a stamped
   * custody would be a fact that starts lying the moment a flip is rolled back. Better an
   * unrecorded fact than a stale one.
   */
  custody?: CustodyMode;
  override?: boolean;
}): StampVerdict {
  const { stored, current } = opts;
  const custody = opts.custody ?? "server";
  const problems: string[] = [];
  if (stored.network && stored.network !== current.network) {
    problems.push(
      `  NETWORK: this database's history was written on '${stored.network}', but this process ` +
      `is configured for '${current.network}'.\n` +
      "    Every tx_hash in it belongs to the other chain, and every balance would be read from\n" +
      "    a chain that never saw them. Addresses look identical either way, so nothing on any\n" +
      "    screen would show you this.",
    );
  }
  // A stamp with no fingerprint means the database was first used with no seed at all, which
  // is ordinary SIM development. Acquiring one later is not a mismatch — nothing was derived
  // from the absent seed — so only a CHANGE between two real seeds is refused.
  if (stored.seedFingerprint && current.seedFingerprint
      && stored.seedFingerprint !== current.seedFingerprint) {
    problems.push(
      "  SEED: this database's kid addresses were derived from a different HATCH_MASTER_SEED.\n" +
      "    The children's rows name accounts this process cannot sign for. Balances read as\n" +
      "    zero and payouts go to addresses nobody in this household holds.",
    );
  }
  // A seed that has GONE AWAY is two different events, and the stamp originally only knew
  // about the bad one.
  //
  // Under server custody it is a misconfiguration: the seed is what derives kid accounts, so
  // a process without one falls back to the built-in development seed and every child's row
  // starts naming an account nobody here can sign for.
  //
  // Under `HATCH_CUSTODY=parent` it is THE POINT. The whole flip is "delete the seed, and
  // stop being able to sign for a kid at all" — nothing re-derives anything, because nothing
  // derives anything. Refusing here made the recorded stamp the last thing standing in front
  // of the migration this repo was built to perform, and the only way past it was the
  // override, which by design does not stamp and so comes back every single boot.
  //
  // This is not the transition going unguarded. `custody-boot.ts` guards it, and far more
  // strictly than a fingerprint comparison can: it goes and reads the chain, and refuses
  // unless every server-derived kid address holds neither a balance nor a stake. The stamp's
  // job is catching the WRONG DATABASE; that one's job is catching money left behind.
  if (stored.seedFingerprint && !current.seedFingerprint && custody !== "parent") {
    problems.push(
      "  SEED: this database was used with a HATCH_MASTER_SEED and this process has none.\n" +
      "    Kid accounts would be re-derived from the built-in development seed.\n" +
      "    If you meant to go non-custodial, set HATCH_CUSTODY=parent. That is the supported\n" +
      "    way to run without a seed, and it checks every derived address is empty first.",
    );
  }
  if (!problems.length) {
    const write: Partial<DbStamp> = {};
    if (!stored.network) write.network = current.network;
    if (!stored.seedFingerprint && current.seedFingerprint) write.seedFingerprint = current.seedFingerprint;
    return { kind: "ok", write };
  }

  const message = [
    "",
    "nimiq.kids REFUSING TO BOOT: this database is not the one this process is configured for.",
    "",
    ...problems,
    "",
    "  What to do:",
    "    - point DB_PATH at the right database, or",
    "    - point this process at the right network/seed (check the env file you sourced), or",
    `    - if this really is deliberate, set ${OVERRIDE_ENV}=1 for this boot. The stamp is NOT`,
    "      rewritten, so the refusal comes back the next time and you do not lose the record.",
    "",
  ].join("\n");

  // An override does NOT stamp: the record stays as it is, so the refusal comes back next
  // boot and an operator cannot silently convert a mistake into the new truth.
  return opts.override ? { kind: "ok", write: {} } : { kind: "refuse", message };
}
