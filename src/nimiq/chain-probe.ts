// The two chain reads the custody boot guard needs and nothing else needs.
//
// They live here rather than in client.ts because client.ts is the module every money path
// imports, and these are boot-time diagnostics. Keeping them apart also means the guard's
// dependencies stay small enough to fake in a test without a chain.
//
// Both talk to the node directly rather than through `ChainClient`, because `ChainClient` is
// the SIM-swappable interface for things the app does in normal operation, and a parent-custody
// instance has no provider at all. These questions have to reach a real node or fail loudly.

import { RPC_URL, RPC_TIMEOUT_MS } from "./client";

/**
 * One JSON-RPC round trip. Returns the envelope so callers can tell a refusal from a null.
 *
 * `error.data` is carried alongside `error.message` because Albatross puts the useful text
 * there. A missing staker comes back as `{code: -32603, message: "Internal error", data: "No
 * staker with address: NQ.."}` — matching only on `message` sees the generic "Internal error"
 * and cannot tell a real zero from a broken node. That mistake took nimiq.kids down on
 * 2026-08-11: every classifier below fell through to a throw, and the boot guard refused.
 */
async function rpc(
  method: string,
  params: unknown[],
): Promise<{ data?: unknown; error?: { message?: string; data?: string } }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: { data?: unknown };
      error?: { message?: string; data?: string };
    };
    if (json.error) return { error: json.error };
    return { data: json.result?.data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A node saying it does not implement the method, as opposed to a node saying the address has
 * no staker. The first is "ask someone else", the second is a real zero, and the boot guard
 * treats them very differently, so the distinction cannot be collapsed here.
 */
function isUnsupportedMethod(message: string | undefined): boolean {
  return /method not (supported|found)|unknown method|not implemented|not allowed|-32601/i.test(message ?? "");
}

/** What a getStakerByAddress error actually means. */
export type StakerErrorKind = "unsupported" | "no-staker" | "unknown";

/**
 * Classify a getStakerByAddress error. Exported and pure so the three cases can be pinned
 * against the payloads real nodes actually send, which is the whole reason this exists:
 * the classifier used to read `error.message` alone, and Albatross puts the sentence that
 * distinguishes the cases in `error.data`. On 2026-08-11 that made
 * `{code: -32603, message: "Internal error", data: "No staker with address: NQ.."}` fall
 * through to "unknown", so the custody boot guard treated a definite zero as an unreadable
 * balance and nimiq.kids would not start.
 */
export function classifyStakerError(error: { message?: string; data?: string }): StakerErrorKind {
  const text = [error.message, error.data].filter(Boolean).join(" ");
  if (isUnsupportedMethod(text)) return "unsupported";
  if (/no staker|staker not found|does not exist/i.test(text)) return "no-staker";
  return "unknown";
}

/**
 * Total luna at `address` inside the staking contract, active plus retired plus anything
 * waiting on release. Every one of those needs the address's own key to move.
 *
 * `null` = THE NODE WOULD NOT ANSWER. The mainnet endpoint this instance uses returns
 * `method not supported: getStakerByAddress`, so null is routine and the caller has a
 * documented fallback. Anything else that goes wrong throws, because a broken RPC must not
 * read as an empty staker.
 */
export async function getStakeLuna(address: string): Promise<number | null> {
  const { data, error } = await rpc("getStakerByAddress", [address]);
  if (error) {
    switch (classifyStakerError(error)) {
      case "unsupported":
        return null;
      // "no staker at this address" is a legitimate zero, and nodes phrase it as an error.
      case "no-staker":
        return 0;
      default:
        throw new Error(`getStakerByAddress: ${JSON.stringify(error)}`);
    }
  }
  if (!data) return 0; // answered, and there is no staker
  const s = data as { balance?: number; inactiveBalance?: number; retiredBalance?: number };
  return (s.balance ?? 0) + (s.inactiveBalance ?? 0) + (s.retiredBalance ?? 0);
}

/**
 * How many transactions `address` has ever appeared in, capped: the guard only cares whether
 * the answer is zero, so asking for one is enough and keeps the read cheap on a busy address.
 *
 * Throws if the node cannot answer. Zero is a claim about the chain and has to be earned.
 */
export async function getTxCount(address: string): Promise<number> {
  const { data, error } = await rpc("getTransactionsByAddress", [address, 1]);
  if (error) throw new Error(`getTransactionsByAddress: ${JSON.stringify(error)}`);
  if (!Array.isArray(data)) throw new Error("getTransactionsByAddress: node returned a non-list");
  return data.length;
}
