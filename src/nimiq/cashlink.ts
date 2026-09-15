// Mint a real, claimable Nimiq Cashlink: generate keypair -> fund from the parent wallet (via the
// WalletProvider) -> encode the bearer URL. nimiq.kids never holds funds. See docs/adr/0001.

import type { WalletProvider } from "../wallet";
import { CASHLINK_FUNDING_MARKER, encodeCashlinkPayload } from "./cashlink-codec";
import { CASHLINK_BASE, envMs, getClient, getNimiq, SIM } from "./client";

export interface MintResult {
  cashlinkAddress: string; // the address we POLL for claim
  url: string; // shareable; secret lives ONLY in the #fragment
  fundingTxHash: string;
  valueLuna: number;
}

/**
 * Mint a Cashlink for `valueLuna`. If the host wallet exposes native cashlink minting we prefer it;
 * otherwise we roll our own (keypair + funding tx + URL).
 */
export async function mintCashlink(
  provider: WalletProvider,
  valueLuna: number,
  message = "",
): Promise<MintResult> {
  // Prefer the host SDK's native minting if it's there (June 3+).
  if (provider.requestCashlink) {
    try {
      const r = await provider.requestCashlink({ valueLuna, message });
      return { ...r, valueLuna };
    } catch {
      // fall through to local mint
    }
  }

  const Nimiq = await getNimiq();
  const clKey = Nimiq.KeyPair.generate();
  const clAddr = clKey.toAddress();
  const cashlinkAddress = clAddr.toUserFriendlyAddress();

  // BUILD THE URL BEFORE THE MONEY MOVES.
  //
  // The URL fragment IS the cashlink's private key — it is the only way to ever spend from
  // this address again. It used to be derived after the broadcast and the funding wait, so
  // `clKey` was a local variable holding the sole copy of a key that real NIM was about to
  // be sent to. Anything that threw in between — an aborted broadcast, a crash, a restart —
  // destroyed it and stranded the funds permanently.
  //
  // That is not hypothetical: it happened on mainnet on 2026-08-01. The broadcast aborted
  // client-side at the sender's old 15 s timeout, the chain executed the transfer anyway,
  // and 0.1 NIM is now unspendable at NQ22 D4XK HBAD H8NY 3UKX P7EA 0EPT 9DLY Y2FF.
  //
  // Deriving it first costs nothing and means the key always outlives the transfer.
  const url = CASHLINK_BASE + encodeCashlinkPayload(clKey.privateKey.serialize(), valueLuna, message);

  // THE FUNDING TRANSACTION CARRIES THE MARKER, NOT THE MESSAGE.
  //
  // Both of those halves matter and they used to be wrong together, because this passed
  // `extraData: message`:
  //
  //   1. Nimiq Wallet identifies a Cashlink by the recipient data on its funding transaction.
  //      Without `CASHLINK_FUNDING_MARKER` the transfer is an ordinary payment in every
  //      wallet's history, even though the link itself claims perfectly well.
  //   2. The message was going ON CHAIN IN THE CLEAR. It is parent-authored free text
  //      attached to a child's account, on a public mainnet instance, permanently.
  //
  // The message is not lost: it travels in the URL payload, which is where the Hub reads it
  // from and where it has always been (see the `encodeCashlinkPayload` call above). `nimiq/hub`
  // does exactly this split — `recipientData: CashlinkExtraData.FUNDING` alongside a separate
  // `cashlinkMessage`.
  //
  // SPLIT BUILD FROM BROADCAST WHERE THE PROVIDER ALLOWS IT.
  //
  // `sendTransaction` bundles build, sign and broadcast, so a transaction that was never
  // built is indistinguishable from one whose broadcast response was lost. That ambiguity
  // is what forced the gift route to refund blindly on every failure — which is wrong in
  // the case that actually costs money, because it hands the kid their balance back while
  // the NIM is live on chain.
  //
  // WalletProvider already documents the pair as the answer (provider.ts): a failure in
  // `prepareTransaction` is PROVABLY pre-broadcast. The payout path uses it; minting never
  // did. All three real providers implement it, so in production the stage is always known.
  let fundingTxHash: string | null = null;
  let stage: MintStage = "build";
  try {
    if (provider.prepareTransaction && provider.broadcastRaw) {
      const prepared = await provider.prepareTransaction({
        recipient: cashlinkAddress,
        valueLuna,
        extraDataBytes: CASHLINK_FUNDING_MARKER,
      });
      // Past this line nothing is provable any more: the bytes are on their way.
      stage = "broadcast";
      await provider.broadcastRaw(prepared.rawTxHex);
      fundingTxHash = prepared.txHash;
    } else {
      // No pair — we cannot tell build from broadcast, so we must not claim to.
      stage = "send";
      fundingTxHash = await provider.sendTransaction({
        recipient: cashlinkAddress,
        valueLuna,
        extraDataBytes: CASHLINK_FUNDING_MARKER,
      });
    }
    stage = "confirm";

    // A returned tx hash is NOT proof the money moved. Verified on the live testnet
    // 2026-07-31: `sendRawTransaction` answered with a hash for a transaction that never
    // executed (a conflicting spend of the same balance), and the app happily handed the
    // parent a Cashlink URL for an address holding nothing. The Hub renders that link as
    // a real "30 000 NIM — Claim your Cash", and checkClaim() then reads the empty
    // address as CLAIMED. So the link is only a link once the funds are actually there.
    await waitForFunding(cashlinkAddress, valueLuna);
  } catch (cause) {
    // Still a failure — the caller must NOT hand this out as a spendable link. But the
    // recovery material rides along so the only copy of the key is never dropped on the floor.
    throw new CashlinkMintError(cashlinkAddress, url, valueLuna, fundingTxHash, cause, stage);
  }

  return { cashlinkAddress, url, fundingTxHash, valueLuna };
}

/**
 * How far the mint got. Only `build` is provably harmless.
 *
 * `send` means the provider exposes no prepare/broadcast pair, so build and broadcast
 * happened behind one call and cannot be told apart — it is treated exactly like
 * `broadcast`, never like `build`.
 */
export type MintStage = "build" | "send" | "broadcast" | "confirm";

/**
 * A mint that failed. `stage` says whether money could possibly have moved.
 *
 * ⚠️ `fundingTxHash === null` narrows NOTHING — the 2026-08-01 mainnet incident had a null
 * hash and the transfer executed. Never reason from it. Use `provablyUnsent`.
 *
 * The one unconditional guarantee is that `url` — the private key — survived the failure.
 */
export class CashlinkMintError extends Error {
  constructor(
    readonly cashlinkAddress: string,
    /** Carries the private key. It is the only way to recover the funds. */
    readonly url: string,
    readonly valueLuna: number,
    readonly fundingTxHash: string | null,
    readonly cause: unknown,
    readonly stage: MintStage,
  ) {
    super(`cashlink_mint_failed at ${stage}: ${cashlinkAddress} (${String(cause)})`);
    this.name = "CashlinkMintError";
  }

  /**
   * True only when the transaction demonstrably never reached the wire, so reversing a
   * reservation is safe.
   *
   * Deliberately a whitelist of one. Everything else — a lost broadcast response, a
   * confirmation timeout, or a provider that cannot separate the two — is ambiguous, and
   * the safe reading of ambiguity is that the money LEFT. Refunding a gift whose funding
   * actually landed pays the kid twice: they keep their balance and the Cashlink is live
   * and claimable, with the hot wallet short the difference. Leaving a reservation in place
   * when nothing moved is recoverable by hand; the reverse is not.
   */
  get provablyUnsent(): boolean {
    return this.stage === "build";
  }
}

/** How long to wait for a funding tx to actually land. Albatross blocks are ~1s; the
 *  ceiling is a hung/rejected broadcast, not a slow one. */
const FUNDING_CONFIRM_MS = envMs("HATCH_FUNDING_CONFIRM_MS", 20_000);
const FUNDING_POLL_MS = 1_000;

/**
 * Block until the cashlink address actually holds `valueLuna` on chain. Throws
 * `Error('funding_not_confirmed')` if it never arrives, so the caller can leave the
 * request retryable instead of minting a link with no money behind it.
 * No-op in SIM (there is no chain to read).
 */
export async function waitForFunding(cashlinkAddress: string, valueLuna: number): Promise<void> {
  if (SIM) return;
  const client = await getClient();
  const deadline = Date.now() + FUNDING_CONFIRM_MS;
  let last = 0;
  for (;;) {
    last = await client.getBalance(cashlinkAddress).catch(() => 0);
    if (last >= valueLuna) return;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, FUNDING_POLL_MS));
  }
  throw new Error(`funding_not_confirmed: ${cashlinkAddress} holds ${last} of ${valueLuna} luna`);
}
