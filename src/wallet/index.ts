// The one place provider selection happens. App code only ever calls makeProvider() and the
// WalletProvider interface — swapping to the real Mini Apps SDK on June 3 is this one branch.

import { SIM } from "../nimiq/client";
import { DevProvider } from "./dev-provider";
import { NimiqPayProvider } from "./nimiqpay-provider";
import { SimProvider } from "./sim-provider";
import type { WalletProvider } from "./provider";

export type { WalletProvider, SendTxOptions, PreparedTx } from "./provider";

let _provider: WalletProvider | null = null;

export function makeProvider(): WalletProvider {
  if (_provider) return _provider;
  const injected = (globalThis as any)?.nimiqPay;
  if (injected) _provider = new NimiqPayProvider(injected);
  else if (SIM) _provider = new SimProvider();
  else _provider = new DevProvider();
  return _provider;
}

/** test seam */
export function _setProvider(p: WalletProvider | null) {
  _provider = p;
}

/**
 * V2: a provider bound to a SPECIFIC private key (a kid's derived account key) — used when the
 * KID's account signs (sibling transfers, funding an approved cashlink, staking goes through
 * src/nimiq/staking.ts directly). SIM returns the SimProvider (ledger-only, fake hashes);
 * DevProvider already accepts a privHex constructor arg. Never cached — keys are per-kid.
 */
export function providerForKey(privHex: string): WalletProvider {
  if (SIM) return new SimProvider();
  return new DevProvider(privHex);
}
