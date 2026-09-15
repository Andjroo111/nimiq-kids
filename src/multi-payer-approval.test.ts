// THE FEATURE, at the money layer: two grown-ups, two wallets, one kid's account.
//
// Under `HATCH_CUSTODY=parent` approving does not pay — it mints a transaction for the
// approver's own wallet to sign. Before this branch that transaction's sender was
// `families.parent_address`, so a grandparent's approval produced bytes only the household's
// owner could sign. These tests pin the four states of `payoutSender` at the route, and the
// two invariants that would cost real money if they slipped:
//
//   1. the TILL does not move when a grown-up who is not the owner approves;
//   2. a claimed payout keeps ITS sender, so one chore is never signable twice by two wallets.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as memberRepo from "./repo-members";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { chores } from "./routes/chores";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono().route("/api", chores).route("/api", approvalsRoutes);

const OWNER_WALLET = "NQ43 040G 2081 040G 2081 040G 2081 040G 2081";
const GRAN_WALLET = "NQ23 0810 40G2 0810 40G2 0810 40G2 0810 40G2";
const DAD_WALLET = "NQ32 0G20 8104 0G20 8104 0G20 8104 0G20 8104";
const KID_WALLET = "NQ44 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3";

const ENV = { ...process.env };
const HEAD = 7_680_000;

/** Hermetic: a head height and nothing else. The intent pins the height it was minted at, so
 *  the mint needs one; nothing in this file may reach a network or broadcast. */
const chainStub = (): ChainClient => ({
  getHeadHeight: async () => HEAD,
  getNetworkId: async () => 5,
  sendTransaction: async () => { throw new Error("nothing in this file may broadcast"); },
  getBalance: async () => 0,
});

let fam: repo.Family;
let kid: repo.Child;
let ownerId: string;
let owner: string;
let gran: string;
let granId: string;
let dad: string;

async function phoneFor(label: string, role: memberRepo.MemberRole, address: string | null) {
  const m = memberRepo.createMember(fam.id, label, role, { address });
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer), m.id);
  return { bearer, id: m.id };
}

beforeEach(async () => {
  // Parent custody: the server holds no key, so approving hands back something to sign.
  // HATCH_CUSTODY=parent also refuses to boot with DEV_PARENT_PRIV set (src/custody-boot.ts).
  process.env.HATCH_CUSTODY = "parent";
  delete process.env.DEV_PARENT_PRIV;
  process.env.NIMIQ_SIM = "0";

  _setChainClient(chainStub());

  initTestDb();
  const f = repo.createFamily("Mom", OWNER_WALLET);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  wrepo.setChildAddress(kid.id, KID_WALLET);

  ownerId = memberRepo.ownerOf(fam.id)!.id;
  owner = newToken();
  lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(owner), ownerId);
  const g = await phoneFor("Grandma Jo", "supporter", GRAN_WALLET);
  gran = g.bearer; granId = g.id;
  dad = (await phoneFor("Dad", "coparent", DAD_WALLET)).bearer;
});

afterEach(() => {
  process.env = { ...ENV };
  _setChainClient(null); // never leak the stub into another file's chain client
});

const req = (bearer: string | null, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** A submitted chore with a pending approval, exactly as a kid handing one in leaves it. */
function submittedChore(rewardLuna = 500) {
  const chore = repo.createChore(fam.id, kid.id, "Feed the cat", rewardLuna, "🐱");
  repo.setChoreStatus(chore.id, "submitted");
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  return { chore, approval };
}

type Signed = { signingIntent?: { sender: string; recipient: string; valueLuna: number } };

// ---- the four states of "whose wallet" ----

test("a grandparent's approval mints a transaction from HER wallet to the kid", async () => {
  const { approval } = submittedChore();
  const res = await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  // 202: accepted, not done. Nothing has moved and the card stays in the queue until her
  // wallet has signed — see parentSignedApprove for why it is deliberately left pending.
  expect(res.status).toBe(202);
  const body = await res.json() as Signed;
  expect(body.signingIntent).toMatchObject({
    sender: GRAN_WALLET, recipient: KID_WALLET, valueLuna: 500,
  });
  // The chain-side record agrees: this is the row the relay verifies the signature against.
  expect(wrepo.getPayoutAttempt(`chore:${approvalsRepo.getApproval(approval.id)!.subject_id}`)?.sender)
    .toBe(GRAN_WALLET);
});

test("the other parent's approval mints from HIS wallet — nobody is privileged here", async () => {
  const { approval } = submittedChore();
  const body = await (await req(dad, "POST", `/api/approvals/${approval.id}/approve`)).json() as Signed;
  expect(body.signingIntent!.sender).toBe(DAD_WALLET);
});

test("a grown-up with no wallet connected still approves, and the owner covers it", async () => {
  memberRepo.setMemberAddress(granId, null);
  const { approval } = submittedChore();
  const body = await (await req(gran, "POST", `/api/approvals/${approval.id}/approve`)).json() as Signed;
  // Her yes is worth having before she has connected anything; the household pays as it did
  // before she arrived.
  expect(body.signingIntent!.sender).toBe(OWNER_WALLET);
});

test("an on-tablet PIN has no grown-up behind it and pays from the owner's wallet", async () => {
  await repo.setFamilyPin(fam.id, await Bun.password.hash("4242"));
  const { approval } = submittedChore();
  // No bearer at all — this is the tablet, which is the household's own.
  const res = await req(null, "POST", `/api/approvals/${approval.id}/approve`, { pin: "4242" });
  expect(res.status).toBe(202);
  expect((await res.json() as Signed).signingIntent!.sender).toBe(OWNER_WALLET);
});

// ---- the two invariants ----

test("THE TILL DOES NOT MOVE when somebody other than the owner approves", async () => {
  // If a grandparent's approval also re-pointed `families.parent_address`, the kid's next
  // Treasure Box purchase would leave the household into her wallet, and the per-family budget
  // — which nets a buy against a refund only because they are the same account — would stop
  // bounding anything. This is the regression that costs real money.
  const { approval } = submittedChore();
  await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  expect(repo.getFamily(fam.id)!.parent_address).toBe(OWNER_WALLET);
  expect(memberRepo.ownerOf(fam.id)!.address).toBe(OWNER_WALLET);
});

test("a claimed payout keeps ITS sender: the second grown-up is handed the first one's bytes", async () => {
  const { approval } = submittedChore();
  const first = await (await req(gran, "POST", `/api/approvals/${approval.id}/approve`)).json() as Signed;

  const second = await req(dad, "POST", `/api/approvals/${approval.id}/approve`);
  // 409 `already_claimed`, carrying GRANDMA's intent — not a second, different transaction for
  // one chore. This is what stops two grown-ups on two phones paying for the same job twice,
  // and it is refused before either wallet opens.
  expect(second.status).toBe(409);
  const body = await second.json() as { error: string; signingIntent: { sender: string } };
  expect(body.error).toBe("already_claimed");
  expect(body.signingIntent.sender).toBe(GRAN_WALLET);
  expect(body.signingIntent.sender).toBe(first.signingIntent!.sender);
  // Dad's wallet will refuse these bytes (public/parent/payout-sign.js checks the connected
  // account against intent.sender), which is the correct outcome: this one is Grandma's.
});

test("the approval stays PENDING through all of it — the card is the screen", async () => {
  const { approval } = submittedChore();
  await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  await req(dad, "POST", `/api/approvals/${approval.id}/approve`);
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("pending");
  // A mobile wallet is a full-page redirect away, so a card that left the queue on the tap
  // would strand the kid's work behind a signature nobody can reach any more.
});

// ---- the household with nobody who can pay ----

test("a household where nobody has a wallet refuses rather than minting a half-intent", async () => {
  memberRepo.setMemberAddress(ownerId, null);
  memberRepo.setMemberAddress(granId, null);
  repo.setFamilyParentAddress(fam.id, "");
  const { approval } = submittedChore();
  const res = await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "no_parent_address" });
});

// ---- the trail ----

test("a zero-reward job has nothing to sign, and records WHO approved it", async () => {
  // Not the parent-signed path at all (there is nothing to send), so it settles inline — which
  // is the branch that writes decided_by_member_id directly rather than through the relay.
  const { chore, approval } = submittedChore(0);
  const res = await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  expect(res.status).toBe(200);
  const decided = approvalsRepo.getApproval(approval.id)!;
  expect(decided.status).toBe("approved");
  expect(decided.decided_by_member_id).toBe(granId);
  expect(repo.getChore(chore.id)!.status).toBe("approved");
});

test("a rejection records who said no", async () => {
  const { approval } = submittedChore();
  const res = await req(dad, "POST", `/api/approvals/${approval.id}/reject`, { note: "bowl's still full" });
  expect(res.status).toBe(200);
  const decided = approvalsRepo.getApproval(approval.id)!;
  expect(decided.status).toBe("rejected");
  expect(decided.decided_by_member_id).not.toBeNull();
  expect(decided.note).toBe("bowl's still full");
});

// ---- approving from the BOARD is the same decision as approving from the QUEUE ----

test("the board route and the queue route agree on who pays", async () => {
  // Two routes approve the same chore and they share ONE payout ref, so two answers to "whose
  // wallet" would mint bytes for two different wallets under one claim.
  const chore = repo.createChore(fam.id, kid.id, "Feed the cat", 500, "🐱");
  const res = await req(gran, "POST", `/api/chores/${chore.id}/approve`);
  expect(res.status).toBe(202);
  expect((await res.json() as Signed).signingIntent!.sender).toBe(GRAN_WALLET);
});

// ---- what the card is told ----

test("the queue names the grown-up whose wallet a claimed payout is waiting on", async () => {
  const { approval } = submittedChore();
  await req(gran, "POST", `/api/approvals/${approval.id}/approve`);
  // Dad's phone reads the queue and must be able to say "Grandma Jo started paying this one"
  // BEFORE he taps, rather than sending him into a wallet that declines the bytes.
  const feed = await (await req(dad, "GET", "/api/approvals?status=pending")).json() as {
    approvals: { id: string; payerLabel: string | null; payerMemberId: string | null }[];
  };
  const card = feed.approvals.find((x) => x.id === approval.id)!;
  expect(card.payerLabel).toBe("Grandma Jo");
  expect(card.payerMemberId).toBe(granId);
});

test("an untouched card names nobody — there is nothing to warn about yet", async () => {
  const { approval } = submittedChore();
  const feed = await (await req(dad, "GET", "/api/approvals?status=pending")).json() as {
    approvals: { id: string; payerLabel: string | null }[];
  };
  expect(feed.approvals.find((x) => x.id === approval.id)!.payerLabel).toBeNull();
});
