// NimiqPayProvider — stub for the in-wallet Mini Apps provider that ships June 3 2026.
// Mirrors the documented Nimiq Hub API shape (chooseAddress / signTransaction), which is the
// strongest available signal for the Pay provider surface. Tolerant of return-shape variations.
// We BROADCAST ourselves via @nimiq/core so an async/sync hash from the host doesn't matter.
// Lit up + confirmed against the real SDK in Phase "deferred to June 3" (SPEC §9).

import { getClient, getNimiq, toRawTxHex } from "../nimiq/client";
import type { PreparedTx, SendTxOptions, WalletProvider } from "./provider";

export class NimiqPayProvider implements WalletProvider {
  readonly kind = "nimiq-pay" as const;
  private cachedAddress: string | null = null;

  // Injection mechanism is UNKNOWN until June 3 — we detect, we don't assume.
  constructor(private injected: any) {}

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress;
    const r = await this.injected.chooseAddress({ appName: "nimiq.kids" });
    this.cachedAddress = r?.address ?? r;
    return this.cachedAddress!;
  }

  /** The host wallet signs; WE broadcast — so the split the retriable payout path needs is
   *  already the natural shape here. Handing the bytes back is what lets a retry replay this
   *  one transaction instead of asking the wallet to sign a second, different one. */
  async prepareTransaction({ recipient, valueLuna, fee = 0, extraData, extraDataBytes }: SendTxOptions): Promise<PreparedTx> {
    const Nimiq = await getNimiq();
    const client = await getClient();
    const height = await client.getHeadHeight();
    const signed = await this.injected.signTransaction({
      appName: "nimiq.kids",
      sender: await this.getAddress(),
      recipient,
      value: valueLuna,
      fee,
      validityStartHeight: height,
      // Raw bytes win, for the same reason as the dev provider: the Cashlink marker is not
      // expressible as a string. The host wallet already wants a Uint8Array here.
      extraData: extraDataBytes ?? (extraData ? new TextEncoder().encode(extraData) : undefined),
    });
    const raw = signed?.serializedTx ?? signed?.raw ?? signed;
    return {
      rawTxHex: toRawTxHex(raw),
      txHash: signed?.hash ?? Nimiq.Transaction.fromAny(raw).hash(),
    };
  }

  async broadcastRaw(rawTxHex: string): Promise<string> {
    return (await getClient()).sendTransaction(rawTxHex);
  }

  async sendTransaction(opts: SendTxOptions): Promise<string> {
    const prepared = await this.prepareTransaction(opts);
    await this.broadcastRaw(prepared.rawTxHex);
    return prepared.txHash;
  }

  async requestCashlink(opts: { valueLuna: number; message?: string }) {
    if (!this.injected.requestCashlink) throw new Error("native cashlink not available");
    const r = await this.injected.requestCashlink({
      appName: "nimiq.kids",
      value: opts.valueLuna,
      message: opts.message,
    });
    return { url: r.link ?? r.url, cashlinkAddress: r.address, fundingTxHash: r.hash };
  }
}
