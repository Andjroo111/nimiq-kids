// getStakerByAddress error classification (src/nimiq/chain-probe.ts).
//
// These are not shape tests. Each payload below is one a real node actually sent, because
// the bug this file exists to prevent was a classifier that looked right and matched the
// wrong field. On 2026-08-11 nimiq.kids could not boot: the custody guard asks whether a
// derived kid address holds stake, Albatross answered "no staker with address ..." inside
// `error.data` while `error.message` said only "Internal error", and the classifier read
// `message`. A definite zero was read as an unreadable balance and the guard refused.
//
// The three kinds are NOT interchangeable and the guard treats them very differently:
//   unsupported -> the node will not answer, fall back to the transaction count
//   no-staker   -> a proven zero, boot
//   unknown     -> throw, because a broken RPC must never read as an empty staker

import { expect, test } from "bun:test";
import { classifyStakerError } from "./chain-probe";

test("Albatross reports a missing staker in error.data, not error.message", () => {
  // Verbatim from rpc.nimiqwatch.com, 2026-08-11.
  expect(
    classifyStakerError({
      message: "Internal error",
      data: "No staker with address: NQ64 0BLA MFUF QT6M PD4V 80Y6 YPL0 R8V2 A1JM",
    }),
  ).toBe("no-staker");
});

test("a missing staker phrased in message still classifies", () => {
  expect(classifyStakerError({ message: "no staker at this address" })).toBe("no-staker");
  expect(classifyStakerError({ message: "staker not found" })).toBe("no-staker");
});

test("a node that does not implement the method is 'unsupported', not a zero", () => {
  expect(classifyStakerError({ message: "method not supported: getStakerByAddress" })).toBe(
    "unsupported",
  );
  // The public endpoint gates methods with this wording rather than -32601.
  expect(classifyStakerError({ message: "Method not allowed" })).toBe("unsupported");
});

test("anything else is unknown, so the caller throws instead of inventing a zero", () => {
  expect(classifyStakerError({ message: "consensus not established (syncing)" })).toBe("unknown");
  expect(classifyStakerError({ message: "Internal error", data: "database is locked" })).toBe(
    "unknown",
  );
  expect(classifyStakerError({})).toBe("unknown");
});

test("a syncing node never reads as a proven zero", () => {
  // The exact payload the unpatched local node returned while stuck behind the fork. If this
  // ever classifies as no-staker, the guard would boot on an unverified account.
  expect(
    classifyStakerError({ message: "consensus not established (syncing)", data: undefined }),
  ).not.toBe("no-staker");
});
