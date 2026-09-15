// SimProvider — lets the FULL UX loop run with no faucet, no funded key, and no network.
// It still generates a real Nimiq keypair (offline crypto) so cashlink URLs are real-format and the
// codec is genuinely exercised; only the on-chain funding tx is simulated. Claim is simulated via
// POST /api/cashlinks/:id/claim-sim. The real testnet path (DevProvider) is used when DEV_PARENT_PRIV
// is set. See src/nimiq/client.ts SIM flag.

import { getNimiq } from "../nimiq/client";
import type { PreparedTx, SendTxOptions, WalletProvider } from "./provider";

const simHash = () => {
  let h = "";
  for (const b of crypto.getRandomValues(new Uint8Array(32))) h += b.toString(16).padStart(2, "0");
  return h;
};

export class SimProvider implements WalletProvider {
  readonly kind = "dev" as const;
  private addr: string | null = null;

  async getAddress(): Promise<string> {
    if (this.addr) return this.addr;
    const Nimiq = await getNimiq();
    // deterministic-ish demo parent address (generated once per process)
    this.addr = Nimiq.KeyPair.generate().toAddress().toUserFriendlyAddress();
    return this.addr;
  }

  /** SIM implements the prepare/broadcast pair too, so the retriable-payout path SIM
   *  exercises is the same one testnet takes — only the bytes are made up. */
  async prepareTransaction(_opts: SendTxOptions): Promise<PreparedTx> {
    const txHash = simHash();
    return { rawTxHex: `sim:${txHash}`, txHash };
  }

  async broadcastRaw(rawTxHex: string): Promise<string> {
    return rawTxHex.startsWith("sim:") ? rawTxHex.slice(4) : rawTxHex;
  }

  async sendTransaction(_opts: SendTxOptions): Promise<string> {
    // Simulated funding tx hash — 64 hex chars, no chain write.
    return simHash();
  }
}
