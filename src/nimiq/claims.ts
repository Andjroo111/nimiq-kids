// Claim detection. The kid opens the cashlink, the wallet sweeps the funds, the cashlink address
// balance drops to ~0. We detect that by polling the balance over RPC (no light-client).
// See docs/NIMIQ-CASHLINK-REFERENCE.md.

import { getClient } from "./client";

export interface ClaimStatus {
  claimed: boolean;
  balanceLuna: number;
}

export async function checkClaim(cashlinkAddress: string, expectedLuna: number): Promise<ClaimStatus> {
  const client = await getClient();
  const balanceLuna = await client.getBalance(cashlinkAddress);
  // Claimed once the funded value has left the address (allow for fee dust).
  return { claimed: balanceLuna < expectedLuna, balanceLuna };
}
