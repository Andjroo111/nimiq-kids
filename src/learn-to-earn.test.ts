// Learn-to-Earn (Brilliant offshoot, PRD §Offshoot): a "lesson" is a chore whose completion
// condition is finishing a learning task. Same parent-attested approval, IDENTICAL Cashlink payout.
// Tests cover: chore-kind data model, route validation, payout parity, and the earnings split.
import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { mintCashlink } from "./nimiq/cashlink";
import { decodeCashlinkPayload, payloadFromUrl } from "./nimiq/cashlink-codec";
import { CASHLINK_BASE } from "./nimiq/client";
import { SimProvider } from "./wallet/sim-provider";
import { chores as choresRoute } from "./routes/chores";

beforeEach(() => {
  initTestDb();
});

function household() {
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam", "🦖");
  return { fam, kid };
}

// ---- data model ----

test("createChore defaults to kind 'chore' with no lesson fields", () => {
  const { fam, kid } = household();
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  expect(ch.kind).toBe("chore");
  expect(ch.subject).toBeNull();
  expect(ch.reward_shape).toBeNull();
  const fromDb = repo.getChore(ch.id)!;
  expect(fromDb.kind).toBe("chore");
  expect(fromDb.subject).toBeNull();
});

test("lesson chore persists kind, subject and reward shape", () => {
  const { fam, kid } = household();
  const ch = repo.createChore(fam.id, kid.id, "Finish algebra lesson", 200_000, "📐", {
    kind: "lesson", subject: "math", rewardShape: "per-streak-day",
  });
  const fromDb = repo.getChore(ch.id)!;
  expect(fromDb.kind).toBe("lesson");
  expect(fromDb.subject).toBe("math");
  expect(fromDb.reward_shape).toBe("per-streak-day");
});

test("lesson reward shape defaults to per-lesson; non-lesson chores never carry lesson fields", () => {
  const { fam, kid } = household();
  const lesson = repo.createChore(fam.id, kid.id, "Python basics", 300_000, "💻", {
    kind: "lesson", subject: "coding",
  });
  expect(repo.getChore(lesson.id)!.reward_shape).toBe("per-lesson");
  // a plain chore ignores stray lesson fields
  const plain = repo.createChore(fam.id, kid.id, "Trash", 100_000, "🗑️", {
    kind: "chore", subject: "math", rewardShape: "per-milestone",
  });
  expect(repo.getChore(plain.id)!.subject).toBeNull();
  expect(repo.getChore(plain.id)!.reward_shape).toBeNull();
});

// ---- route validation ----

async function postChore(body: Record<string, unknown>) {
  const res = await choresRoute.request("/chores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("POST /chores accepts a lesson and rejects bad subject / reward shape / kind", async () => {
  const { kid } = household();
  const ok = await postChore({ childId: kid.id, title: "Finish a Brilliant lesson", rewardLuna: 200_000, kind: "lesson", subject: "coding" });
  expect(ok.status).toBe(201);
  expect(ok.json.chore.kind).toBe("lesson");
  expect(ok.json.chore.subject).toBe("coding");
  expect(ok.json.chore.reward_shape).toBe("per-lesson"); // default
  expect(ok.json.chore.emoji).toBe("💻"); // subject default icon

  const noSubject = await postChore({ childId: kid.id, title: "Lesson", rewardLuna: 100_000, kind: "lesson" });
  expect(noSubject.status).toBe(400);
  expect(noSubject.json.error).toBe("invalid_subject");

  const badShape = await postChore({ childId: kid.id, title: "Lesson", rewardLuna: 100_000, kind: "lesson", subject: "math", rewardShape: "per-vibe" });
  expect(badShape.status).toBe(400);
  expect(badShape.json.error).toBe("invalid_reward_shape");

  const badKind = await postChore({ childId: kid.id, title: "X", rewardLuna: 100_000, kind: "quest" });
  expect(badKind.status).toBe(400);
  expect(badKind.json.error).toBe("invalid_kind");
});

test("POST /chores without kind still creates a plain chore (back-compat)", async () => {
  const { kid } = household();
  const r = await postChore({ childId: kid.id, title: "Dishes", rewardLuna: 100_000, emoji: "🧽" });
  expect(r.status).toBe(201);
  expect(r.json.chore.kind).toBe("chore");
});

// ---- payout parity ----

test("lesson payout uses the IDENTICAL cashlink path as a chore payout", async () => {
  const { fam, kid } = household();
  const provider = new SimProvider();
  const chore = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const lesson = repo.createChore(fam.id, kid.id, "Algebra lesson", 500_000, "📐", { kind: "lesson", subject: "math" });

  for (const task of [chore, lesson]) {
    const mint = await mintCashlink(provider, task.reward_luna, `nimiq.kids: ${task.title}`);
    expect(mint.url.startsWith(CASHLINK_BASE)).toBe(true);
    expect(mint.valueLuna).toBe(500_000);
    expect(decodeCashlinkPayload(payloadFromUrl(mint.url)).value).toBe(500_000); // same codec, same format
    repo.setChoreStatus(task.id, "approved");
    const cl = repo.createCashlink({
      id: crypto.randomUUID(), family_id: fam.id, chore_id: task.id, child_id: kid.id,
      kind: "payout", cashlink_address: mint.cashlinkAddress, value_luna: mint.valueLuna,
      message: task.title, url: mint.url, funding_tx_hash: mint.fundingTxHash, status: "ready",
    });
    repo.markCashlinkClaimed(cl.id);
    repo.addBalanceAndStreak(kid.id, cl.value_luna);
    repo.setChoreStatus(task.id, "claimed");
  }

  const after = repo.getChild(kid.id)!;
  expect(after.balance_luna).toBe(1_000_000); // both payouts credited identically
  expect(after.streak_count).toBe(2);
  expect(repo.getChore(lesson.id)!.status).toBe("claimed");
});

// ---- earnings history split ----

test("earningsByKind splits chore vs learning earnings; pending payouts and peer gifts excluded", () => {
  const { fam, kid } = household();
  const mk = (choreId: string | null, value: number, kind: "payout" | "peer", status: repo.CashlinkStatus) =>
    repo.createCashlink({
      id: crypto.randomUUID(), family_id: fam.id, chore_id: choreId, child_id: kid.id, kind,
      cashlink_address: "NQ_A", value_luna: value, message: null, url: "u", funding_tx_hash: null, status,
    });

  const dish = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const math = repo.createChore(fam.id, kid.id, "Math lesson", 200_000, "📐", { kind: "lesson", subject: "math" });
  const code = repo.createChore(fam.id, kid.id, "Coding lesson", 300_000, "💻", { kind: "lesson", subject: "coding", rewardShape: "per-milestone" });
  const pend = repo.createChore(fam.id, kid.id, "Pending lesson", 900_000, "📐", { kind: "lesson", subject: "math" });

  const a = mk(dish.id, 500_000, "payout", "ready"); repo.markCashlinkClaimed(a.id);
  const b = mk(math.id, 200_000, "payout", "ready"); repo.markCashlinkClaimed(b.id);
  const c = mk(code.id, 300_000, "payout", "ready"); repo.markCashlinkClaimed(c.id);
  mk(pend.id, 900_000, "payout", "ready");     // NOT claimed — excluded
  const gift = mk(null, 100_000, "peer", "ready"); repo.markCashlinkClaimed(gift.id); // peer — excluded

  const e = repo.earningsByKind(kid.id);
  expect(e.choreLuna).toBe(500_000);
  expect(e.learningLuna).toBe(500_000); // 200k math + 300k coding

  const empty = repo.earningsByKind("nope");
  expect(empty.choreLuna).toBe(0);
  expect(empty.learningLuna).toBe(0);
});
