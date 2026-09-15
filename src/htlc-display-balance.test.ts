// The corner control's balance. Two things must both stay true, and they pull against
// each other: the number must include Nimiq Pay's HTLCs (or it under-reports a solvent
// visitor to zero), and the handler must answer at basic-read speed (the HTLC walk is
// ~13.3s against ~0.35s). So the walk is never awaited, and these tests pin that.

import { test, expect } from "bun:test";
import type { AddressBalance, HtlcAwareBalance } from "nimiq-settlement";
import { displayBalance, _setHtlcReader } from "./nimiq/htlc-display-balance";

const ADDR = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

/** Settle the microtask queue so a scheduled background walk can run to completion. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function fakeReader(read: (address: string) => Promise<AddressBalance>): HtlcAwareBalance {
  return {
    read,
    readMany: async () => { throw new Error("unused"); },
    historySupported: async () => true,
  };
}

function balance(basicLuna: number, htlcLuna: number): AddressBalance {
  return {
    address: ADDR,
    basicLuna,
    htlcLuna,
    htlcCount: htlcLuna > 0 ? 1 : 0,
    totalLuna: basicLuna + htlcLuna,
    reclaimableLuna: 0,
    reclaimableCount: 0,
    complete: true,
  };
}

test("the first read answers at basic speed and says so", async () => {
  // The walk never resolves. If the handler awaited it, this test would hang.
  _setHtlcReader(fakeReader(() => new Promise<AddressBalance>(() => {})));
  const out = await displayBalance(ADDR, async () => 1_000);
  expect(out.balanceLuna).toBe(1_000);
  expect(out.htlcAware).toBe(false); // honest: this number may under-report
});

test("once the walk lands, the HTLC is added back", async () => {
  _setHtlcReader(fakeReader(async () => balance(0, 44_209_318)));
  // A Pay wallet mid-swap: basic reads ZERO while the money sits in the contract.
  const first = await displayBalance(ADDR, async () => 0);
  expect(first.balanceLuna).toBe(0);
  await flush();
  const second = await displayBalance(ADDR, async () => 0);
  expect(second.balanceLuna).toBe(44_209_318);
  expect(second.htlcLuna).toBe(44_209_318);
  expect(second.htlcAware).toBe(true);
});

test("the basic balance is cached, so the corner is not an RPC proxy", async () => {
  _setHtlcReader(fakeReader(async () => balance(500, 0)));
  let reads = 0;
  const read = async () => { reads++; return 500; };
  await displayBalance(ADDR, read);
  await flush();
  await displayBalance(ADDR, read);
  expect(reads).toBe(1);
});

test("a node that cannot walk degrades to the basic balance, and is not asked again", async () => {
  // The failure mode this whole module guards: a non-history node throws rather than
  // hand back a silent under-report. The route must still answer, and must not pay a
  // doomed multi-second walk on every render.
  let attempts = 0;
  _setHtlcReader(fakeReader(async () => { attempts++; throw new Error("no_history_index"); }));
  const first = await displayBalance(ADDR, async () => 700);
  expect(first.balanceLuna).toBe(700);
  await flush();
  const second = await displayBalance(ADDR, async () => 700);
  expect(second.balanceLuna).toBe(700);
  expect(second.htlcAware).toBe(false);
  await flush();
  expect(attempts).toBe(1); // cooled down, not retried per request
});

test("a stale HTLC delta keeps being served while the refresh runs", async () => {
  // Staleness is the lesser error: the delta was true minutes ago, where the basic
  // balance is known to be wrong for as long as the swap is open.
  let hang = false;
  _setHtlcReader(fakeReader(() =>
    hang ? new Promise<AddressBalance>(() => {}) : Promise.resolve(balance(100, 900)),
  ));
  await displayBalance(ADDR, async () => 100);
  await flush();
  hang = true;
  const out = await displayBalance(ADDR, async () => 100);
  expect(out.balanceLuna).toBe(1_000);
  expect(out.htlcAware).toBe(true);
});
