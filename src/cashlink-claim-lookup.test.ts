import { test, expect } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";

// Regression for the unauthenticated LIKE-wildcard injection: a scanned-link lookup
// spliced the caller's secret into `url LIKE '%'||secret`, so `#%%%%%%%%` matched every
// row and handed back other families' bearer URLs (= spendable private keys). The lookup
// is now EXACT equality on the stored #fragment.

function mint(familyId: string, childId: string, secret: string) {
  return repo.createCashlink({
    id: crypto.randomUUID(),
    family_id: familyId,
    chore_id: null,
    child_id: childId,
    kind: "peer",
    cashlink_address: "NQ_ADDR",
    value_luna: 100_000,
    message: null,
    url: `https://hub.nimiq.com/cashlink/#${secret}`,
    funding_tx_hash: "h",
    status: "ready",
  });
}

test("wildcard payload never matches a cashlink it does not know the secret of", () => {
  initTestDb();
  const famA = repo.createFamily("Mom A", "NQ00");
  const famB = repo.createFamily("Mom B", "NQ01");
  const kidA = repo.createChild(famA.id, "Sam");
  const kidB = repo.createChild(famB.id, "Ava");
  mint(famA.id, kidA.id, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  mint(famB.id, kidB.id, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

  // The exploit request and its per-character enumeration variants:
  expect(repo.getCashlinkByUrl("#%%%%%%%%")).toBeNull();
  expect(repo.getCashlinkByUrl("#A%%%%%%%%")).toBeNull();
  expect(repo.getCashlinkByUrl("#B%%%%%%%%")).toBeNull();
  expect(repo.getCashlinkByUrl("#____________")).toBeNull(); // `_` is a LIKE metachar too
});

test("the exact scanned fragment still resolves, across a differing origin", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam");
  const secret = "ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11ZZ11";
  const cl = mint(fam.id, kid.id, secret);

  // Same origin.
  expect(repo.getCashlinkByUrl(`https://hub.nimiq.com/cashlink/#${secret}`)?.id).toBe(cl.id);
  // QR minted on the parent phone (mainnet host), opened on a testnet-host tablet:
  // origin differs, fragment is identical, so it must still resolve.
  expect(repo.getCashlinkByUrl(`https://hub.nimiq-testnet.com/cashlink/#${secret}`)?.id).toBe(cl.id);
  // Bare fragment (what the handler slices to) also resolves.
  expect(repo.getCashlinkByUrl(`#${secret}`)?.id).toBe(cl.id);
});

test("a literal % inside a real secret is matched as a character, not a wildcard", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam");
  const secret = "pct%pct%pct%pct%pct%pct%pct%pct%pct%pct%pct%";
  const cl = mint(fam.id, kid.id, secret);
  // Exact match with the literal %s present.
  expect(repo.getCashlinkByUrl(`#${secret}`)?.id).toBe(cl.id);
  // A short all-wildcard probe must not match it.
  expect(repo.getCashlinkByUrl("#%%%%%%%%")).toBeNull();
});
