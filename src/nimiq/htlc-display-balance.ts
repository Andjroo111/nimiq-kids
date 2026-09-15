// The number the connected-wallet corner control renders, with Nimiq Pay's HTLCs added back.
//
// A Nimiq Pay address's BASIC balance under-reports whenever Pay has NIM parked in a swap
// HTLC — sometimes all the way to zero, so the corner tells a solvent visitor they are broke.
// `createHtlcAwareBalance` (nimiq-settlement v0.3.0) walks the address's history, finds the
// HTLC contracts it funded, and adds back the ones still ours.
//
// THE WALK CANNOT SIT ON A REQUEST. Measured on our own mainnet node: a basic balance read is
// ~0.35s, a `getTransactionsByAddress` history read is ~13.3s. 37x. So nothing here ever
// awaits a walk. Every call answers from the basic balance immediately and schedules the walk
// in the BACKGROUND; whatever it finds is folded into the next caller's answer, and
// `htlcAware` says which of the two numbers the caller actually got. A corner that paints in
// 0.35s and corrects itself a moment later beats one that hangs for thirteen seconds.
//
// DISPLAY ONLY. Never gate a spend or a credit on this — see nimiq.kids#276, where the
// affordability pre-check was DELETED rather than made HTLC-aware, because re-reading both
// balances after the fact proves a money movement and no snapshot ever can.
//
// A NON-HISTORY NODE CANNOT DO THIS AT ALL. `read()` throws there rather than hand back a
// number that silently under-reports (settlement's `onDegraded: "throw"` default, kept). We
// catch that, keep serving the basic balance with `htlcAware: false`, and stop asking for
// COOLDOWN_MS — otherwise every corner render pays a doomed multi-second walk.

import { createHtlcAwareBalance, type HtlcAwareBalance } from "nimiq-settlement";
import { RPC_URL } from "./client";

/** Basic-balance cache TTL. Was inline in the /wallet/balance route; unchanged at 30s. */
const BASIC_TTL_MS = 30_000;
/** How long an HTLC delta is reused. Long, because each refresh costs a ~13.3s walk. */
const HTLC_TTL_MS = 5 * 60_000;
/** How long to stop walking after a failure — a node with no history index fails forever. */
const COOLDOWN_MS = 15 * 60_000;
/** Both caches are unbounded in principle (any address may be queried); clear at this size. */
const MAX_ENTRIES = 500;

export interface DisplayBalance {
  /** The number to render: basic + unexpired HTLCs we funded, once a walk has landed. */
  balanceLuna: number;
  /** What `getBalance` alone reported. */
  basicLuna: number;
  /** The HTLC add-back folded into `balanceLuna`. 0 until a walk lands. */
  htlcLuna: number;
  /** False means `balanceLuna` is the basic balance and may under-report. */
  htlcAware: boolean;
}

const basicCache = new Map<string, { at: number; basicLuna: number }>();
const htlcCache = new Map<string, { at: number; htlcLuna: number }>();
/** Addresses whose walk failed, and when — re-armed after COOLDOWN_MS. */
const cooldown = new Map<string, number>();
const walking = new Set<string>();

let _reader: HtlcAwareBalance | null = null;
let _readerOverride: HtlcAwareBalance | null = null;

/** test seam, mirroring `_setChainClient` in ./client. Never set outside tests: the walk has
 *  no other way to be driven without a history node, and a real one takes ~13.3s per call. */
export function _setHtlcReader(r: HtlcAwareBalance | null) {
  _readerOverride = r;
  _reader = null;
  basicCache.clear();
  htlcCache.clear();
  cooldown.clear();
  walking.clear();
}

function reader(): HtlcAwareBalance {
  if (_readerOverride) return _readerOverride;
  // `retries: 1` (settlement defaults to 3): this runs in the background where a slow answer
  // costs nothing, but a dead node must reach its cooldown quickly instead of burning four
  // multi-second attempts per address.
  if (!_reader) _reader = createHtlcAwareBalance({ url: RPC_URL, retries: 1 });
  return _reader;
}

/** Refresh one address's HTLC add-back. Never awaited by a request; never throws. */
function scheduleWalk(address: string): void {
  if (walking.has(address)) return;
  const failedAt = cooldown.get(address);
  if (failedAt !== undefined && Date.now() - failedAt < COOLDOWN_MS) return;
  walking.add(address);
  void (async () => {
    try {
      const bal = await reader().read(address);
      if (htlcCache.size > MAX_ENTRIES) htlcCache.clear();
      htlcCache.set(address, { at: Date.now(), htlcLuna: bal.htlcLuna });
      cooldown.delete(address);
    } catch (err) {
      // Loud on purpose: falling back to the basic balance IS the under-report this module
      // exists to fix, so a reader that cannot walk must be visible in the log, not implied
      // by a quietly small number on a screen.
      console.warn(`[htlc-display-balance] walk failed for ${address}, serving basic balance:`, (err as Error)?.message ?? err);
      if (cooldown.size > MAX_ENTRIES) cooldown.clear();
      cooldown.set(address, Date.now());
    } finally {
      walking.delete(address);
    }
  })();
}

/**
 * Balance to display for `address`. Resolves at basic-read speed, always.
 *
 * `readBasic` is injected rather than imported so this module does not reach for a chain
 * client the route has already built (and so a test needs no node at all).
 */
export async function displayBalance(
  address: string,
  readBasic: (address: string) => Promise<number>,
): Promise<DisplayBalance> {
  const cachedBasic = basicCache.get(address);
  let basicLuna: number;
  if (cachedBasic && Date.now() - cachedBasic.at < BASIC_TTL_MS) {
    basicLuna = cachedBasic.basicLuna;
  } else {
    basicLuna = await readBasic(address);
    if (basicCache.size > MAX_ENTRIES) basicCache.clear();
    basicCache.set(address, { at: Date.now(), basicLuna });
  }

  const htlc = htlcCache.get(address);
  const fresh = htlc !== undefined && Date.now() - htlc.at < HTLC_TTL_MS;
  if (!fresh) scheduleWalk(address);

  // A stale HTLC delta is still better than none: it was true minutes ago, where the basic
  // balance is known to be wrong whenever Pay holds a swap open. The refresh is already
  // scheduled above, so the number self-corrects.
  const htlcLuna = htlc?.htlcLuna ?? 0;
  return {
    balanceLuna: basicLuna + htlcLuna,
    basicLuna,
    htlcLuna,
    htlcAware: htlc !== undefined,
  };
}
