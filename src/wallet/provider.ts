// The ONLY surface nimiq.kids uses to touch a wallet. See docs/adr/0002.
// The provider only MOVES funds from the parent's own wallet — nimiq.kids never holds funds.
// Cashlink encoding is ours (src/nimiq/cashlink.ts); the provider just signs + broadcasts the
// funding transaction.

export interface SendTxOptions {
  /** user-friendly NQ.. recipient address */
  recipient: string;
  /** 1 NIM = 100_000 luna */
  valueLuna: number;
  /** default 0 on Albatross */
  fee?: number;
  /** small UTF-8 reference, e.g. "chore:42" */
  extraData?: string;
  /**
   * Exact recipient-data bytes, for callers whose payload is not text. Takes precedence over
   * `extraData` when both are given.
   *
   * This exists because `extraData` is encoded with `TextEncoder`, which is UTF-8, so it can
   * only ever express bytes that happen to BE valid UTF-8 for the string handed in. Nimiq's
   * Cashlink FUNDING marker is `[0, 130, 128, 146, 135]`, four bytes of which are above 0x7F;
   * as a string it encodes to nine bytes and the resulting transaction is not a Cashlink to
   * any wallet. There is no string that TextEncoder turns into those five bytes, so this is a
   * new field rather than a smarter encoder.
   */
  extraDataBytes?: Uint8Array;
}

/** A signed transaction that has NOT been broadcast: the exact bytes, and the hash they
 *  already determine. Holding these before the broadcast is what makes a retry safe. */
export interface PreparedTx {
  /** broadcast-ready serialized hex */
  rawTxHex: string;
  /** hash of exactly those bytes — known before anything is sent */
  txHash: string;
}

export interface WalletProvider {
  readonly kind: "dev" | "nimiq-pay";
  /** the parent's funding address */
  getAddress(): Promise<string>;
  /** sign + broadcast a funding tx; returns the tx hash (hex). Funds never touch nimiq.kids. */
  sendTransaction(opts: SendTxOptions): Promise<string>;
  /**
   * Build + sign WITHOUT broadcasting. Optional, because an injected wallet may never
   * expose the bytes — but a provider that implements this pair gets two properties that
   * `sendTransaction` alone cannot offer, and that a retriable payout depends on:
   *
   *   1. A failure in `prepareTransaction` is PROVABLY pre-broadcast. Nothing was sent,
   *      so a retry may safely build a fresh transaction. (This is the common real
   *      failure — an unreachable node fails at the head-height read.)
   *   2. A failure in `broadcastRaw` is ambiguous by nature, but the caller still holds
   *      the bytes, so the retry can put the SAME transaction back on the wire instead
   *      of a new one. One transaction cannot be applied twice, whatever the node
   *      answered the first time.
   *
   * Without the pair, a failure anywhere is indistinguishable from a payment that landed,
   * and the payout path must fail closed rather than guess.
   */
  prepareTransaction?(opts: SendTxOptions): Promise<PreparedTx>;
  /** Put already-signed bytes on the wire. Broadcasting the same bytes twice is safe. */
  broadcastRaw?(rawTxHex: string): Promise<string>;
  /** if the June-3 SDK exposes native cashlink minting we prefer it; else mintCashlink() rolls its own. */
  requestCashlink?(opts: { valueLuna: number; message?: string }): Promise<{
    url: string;
    cashlinkAddress: string;
    fundingTxHash: string;
  }>;
}
