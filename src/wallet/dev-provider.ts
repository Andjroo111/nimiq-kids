// DevProvider — makes the whole loop run end-to-end TODAY on testnet, with no Mini Apps SDK.
// Signs + broadcasts with a funded TESTNET key (the parent funding wallet — never a child key,
// never mainnet). The key lives in env (DEV_PARENT_PRIV), is git-ignored, and is the only place a
// private key is held server-side. Verified API path: docs/NIMIQ-CASHLINK-REFERENCE.md.

import { getClient, getNimiq } from "../nimiq/client";
import type { PreparedTx, SendTxOptions, WalletProvider } from "./provider";

export class DevProvider implements WalletProvider {
  readonly kind = "dev" as const;

  constructor(private privHex: string = process.env.DEV_PARENT_PRIV ?? "") {
    if (!this.privHex) {
      // Not fatal at construction — getAddress/sendTransaction will throw a clear error if used.
      // (Lets the app boot for read-only UI even without a funded key configured.)
    }
  }

  private async keyPair() {
    const Nimiq = await getNimiq();
    if (!this.privHex) throw new Error("DEV_PARENT_PRIV not set: cannot sign. See docs/SPEC.md §3.4.");
    return Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(this.privHex));
  }

  async getAddress(): Promise<string> {
    const kp = await this.keyPair();
    return kp.toAddress().toUserFriendlyAddress();
  }

  /**
   * Everything up to and including the signature — no network write. The head-height and
   * network-id reads happen HERE, which is why an unreachable node fails at prepare time:
   * the caller then knows for certain that nothing was broadcast.
   *
   * The returned bytes are frozen. Rebuilding later would produce a DIFFERENT transaction
   * (validityStartHeight has advanced), hashing differently and dedupeing against nothing —
   * so a retry must replay these bytes, never rebuild.
   */
  async prepareTransaction({ recipient, valueLuna, fee = 0, extraData, extraDataBytes }: SendTxOptions): Promise<PreparedTx> {
    const Nimiq = await getNimiq();
    const client = await getClient();
    const kp = await this.keyPair();
    const height = await client.getHeadHeight();
    const networkId = await client.getNetworkId();
    // Raw bytes win: a caller that supplied them has a payload no string can express.
    const data = extraDataBytes ?? new TextEncoder().encode(extraData ?? "");
    const tx = Nimiq.TransactionBuilder.newBasicWithData(
      kp.toAddress(),
      Nimiq.Address.fromUserFriendlyAddress(recipient),
      data,
      BigInt(valueLuna),
      BigInt(fee),
      height,
      networkId,
    );
    tx.sign(kp, undefined);
    return { rawTxHex: tx.toHex(), txHash: tx.hash() }; // both already hex strings in v2.5.1
  }

  async broadcastRaw(rawTxHex: string): Promise<string> {
    const client = await getClient();
    return client.sendTransaction(rawTxHex);
  }

  async sendTransaction(opts: SendTxOptions): Promise<string> {
    const prepared = await this.prepareTransaction(opts);
    await this.broadcastRaw(prepared.rawTxHex);
    return prepared.txHash;
  }
}
