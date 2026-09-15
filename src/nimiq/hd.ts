// HD kid accounts — every kid gets a REAL derived on-chain Nimiq account, and the SERVER holds
// the key material for it. The master seed (env HATCH_MASTER_SEED) is the single secret; storing
// only the small integer path components (children.account_index, children.hd_family_index) lets
// the server re-derive the exact same private key on demand for signing — the private key is
// never written to the DB, but it is always re-derivable by this process. Kid accounts are
// therefore server-custodied, not self-custodied; see docs/WALLET-CONTRACT.md.
//
// TWO PATH SHAPES, and which one a kid uses is data, not a guess:
//
//   legacy  m/44'/242'/7'/i'        hd_family_index IS NULL — indices were handed out
//                                   instance-globally, so i alone identifies the account.
//   scoped  m/44'/242'/7'/f'/i'     hd_family_index = f — every family owns its own branch and
//                                   its own index space, so kid i of family f is unrelated to
//                                   kid i of family g.
//
// Accounts created before per-family scoping KEEP the legacy path forever. Re-deriving them on
// the scoped path would produce different addresses and strand real funds, so `kidPath()` is the
// only place that decides, and it decides from the stored row. Never "upgrade" an existing row.
//
// The reverse is equally true and is why this move is ONE-WAY: a build that ignores
// hd_family_index reads a scoped row as a legacy one, derives a key for a different (empty)
// account and signs with it. Rolling back past scoped derivation, once any kid has been
// provisioned on it, therefore strands that kid's NIM until the deploy rolls forward again —
// see the rollback procedure in docs/WALLET-CONTRACT.md before downgrading anything.
//
// SLIP-0010 ed25519 implementation ported from nimiq.gift src/nimiq/hd.ts (same author/fleet;
// issue #35 tracks unifying the two into one shared package — do not diverge the crypto).
// @nimiq/core@2.5.1 exposes NO BIP32/ExtendedPrivateKey/Mnemonic API, so we implement SLIP-0010
// for ed25519 here — the same scheme Nimiq's legacy ExtendedPrivateKey used. ed25519 SLIP-0010 is
// hardened-only, which matches the all-hardened Nimiq path.
//
// Server-side only: this module touches the family secret and must never ship to the browser.

import { createHash, createHmac } from "node:crypto";
import { SIM } from "./client";

const HARDENED = 0x80000000;

/** Nimiq coin type per SLIP-0044. Path: m / 44' / 242' / 7' / [family'] / index'. */
export const NIMIQ_COIN_TYPE = 242;
/** 7' = Hatch family kid-account purpose (0' is nimiq.gift's cashlink lane — never collide). */
export const HATCH_ACCOUNT_PURPOSE = 7;
export const KID_PATH_PREFIX = [44, NIMIQ_COIN_TYPE, HATCH_ACCOUNT_PURPOSE] as const;

/**
 * Where one kid's key lives in the tree.
 *
 * `familyIndex: null` is NOT "unknown" — it is the explicit statement that this account was
 * created before per-family scoping and lives on the flat legacy path. It is a permanent
 * property of the row, and the pair (familyIndex, index) is what actually identifies a key.
 */
export interface KidHdAccount {
  index: number;
  familyIndex: number | null;
}

function assertPathComponent(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v >= HARDENED) {
    throw new Error(`kid ${name} must be an integer in [0, 2^31), got ${v}`);
  }
}

/** The full derivation path for a kid account. The ONE place the two shapes are decided. */
export function kidPath(account: KidHdAccount): number[] {
  assertPathComponent("account index", account.index);
  if (account.familyIndex === null) return [...KID_PATH_PREFIX, account.index];
  assertPathComponent("family index", account.familyIndex);
  return [...KID_PATH_PREFIX, account.familyIndex, account.index];
}

interface Slip10Node {
  key: Buffer; // 32-byte ed25519 private key (the seed scalar Nimiq's PrivateKey wraps)
  chainCode: Buffer; // 32-byte chain code
}

function hmac512(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha512", key).update(data).digest();
}

/** SLIP-0010 ed25519 master node from a binary seed (>=16-byte secret). */
function masterNode(seed: Buffer): Slip10Node {
  if (seed.length < 16) throw new Error("HD seed too short (>=16 bytes required)");
  const I = hmac512(Buffer.from("ed25519 seed", "utf8"), seed);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32, 64) };
}

/** SLIP-0010 ed25519 hardened child derivation. ed25519 has no non-hardened path. */
function deriveHardened(parent: Slip10Node, index: number): Slip10Node {
  const idx = (index | HARDENED) >>> 0;
  const data = Buffer.alloc(1 + 32 + 4);
  data[0] = 0x00; // ed25519 hardened marker
  parent.key.copy(data, 1);
  data.writeUInt32BE(idx, 33);
  const I = hmac512(parent.chainCode, data);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32, 64) };
}

/** Derive the 32-byte ed25519 private key at a path (each segment hardened). Pure / testable. */
export function derivePrivateKey(seed: Buffer, path: readonly number[]): Buffer {
  let node = masterNode(seed);
  for (const i of path) node = deriveHardened(node, i);
  return Buffer.from(node.key);
}

/** The kid account key at its path, as 32-byte hex. Re-derivable, and stable for the life of
 *  the row: same seed + same stored (familyIndex, index) always yields the same key. */
export function deriveKidPrivateKeyHex(seed: Buffer, account: KidHdAccount): string {
  return derivePrivateKey(seed, kidPath(account)).toString("hex");
}

/**
 * Read the master seed from env (hex, >=16 bytes; generate-family-seed.ts writes 32).
 *
 * NOTE ON SCOPE: this is ONE seed for the whole instance, not one seed per family. Per-family
 * path scoping (above) separates households inside the tree; it does not give them separate
 * secrets, and it says nothing across instances — two deployments configured with the same seed
 * derive the same key at the same (family, index) coordinates, so branch 0 / kid 0 on one is
 * branch 0 / kid 0 on the other. Separating deployments is a matter of separate seeds. Where the
 * seed lives, and whether each household should have its own, is an open custody question tracked
 * outside this repo.
 * A non-mainnet SIM run with no seed configured falls back to a fixed dev seed — the crypto is
 * offline, the derived addresses are testnet-only and never funded, and a fresh clone stays
 * demo-able. Off-SIM, or on MAINNET under any mode, a missing seed is a hard error: real accounts
 * need the real family secret.
 */
export function familySeed(): Buffer {
  const hex = (process.env.HATCH_MASTER_SEED ?? "").trim();
  if (!hex) {
    // The dev seed is PUBLIC — it is the literal string on the next line, in a public repo —
    // so it must never back a persisted, fundable account. On mainnet a missing
    // HATCH_MASTER_SEED is ALWAYS fatal, even in SIM: the path that actually loses money is a
    // real deploy that drops DEV_PARENT_PRIV (a key rotation, or the non-custodial step that
    // deletes it), which flips SIM on by itself (client.ts) and would otherwise swap every kid
    // onto a key anyone who has read this repo can compute. Only a non-mainnet SIM run may use it.
    const onMainnet = (process.env.NIMIQ_NETWORK ?? "test") === "main";
    if (SIM && !onMainnet) return createHash("sha256").update("nimiq.kids hatch SIM dev seed (never funded)").digest();
    throw new Error("HATCH_MASTER_SEED not set: cannot derive kid accounts. Run src/scripts/generate-family-seed.ts.");
  }
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("HATCH_MASTER_SEED must be hex");
  const buf = Buffer.from(hex, "hex");
  if (buf.length < 16) throw new Error("HATCH_MASTER_SEED too short (>=16 bytes)");
  return buf;
}

export interface DerivedKey extends KidHdAccount {
  privHex: string;
  /** user-friendly NQ.. address of the derived keypair */
  address: string;
}

/**
 * Derive a kid account's keypair + NQ address, using @nimiq/core for the ed25519 keypair/address
 * (OFFLINE crypto — works in SIM with no network). The privHex is used transiently for signing
 * and must never be persisted or logged.
 */
export async function deriveKidKey(account: KidHdAccount, seed: Buffer = familySeed()): Promise<DerivedKey> {
  const { index, familyIndex } = account;
  const privHex = deriveKidPrivateKeyHex(seed, account);
  const Nimiq = await import("@nimiq/core");
  const keyPair = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(privHex));
  return { index, familyIndex, privHex, address: keyPair.toAddress().toUserFriendlyAddress() };
}
