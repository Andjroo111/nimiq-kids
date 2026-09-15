// Drive the multi-grown-up flow end to end against a RUNNING instance, and say what happened.
//
//   BASE=http://127.0.0.1:3991 DB_PATH=/path/to/that.db bun tools/grownups-drive.mjs
//
// ⚠️ NEVER POINT IT AT A LIVE BOX. It approves payouts, mints join codes and removes a member.
// Bring up your own: an isolated PORT + DB_PATH + HATCH_CUSTODY=parent, per
// docs/RUNBOOK-MINI.md and the audit-harness recipe. The instance must be parent-custody or
// the whole point (whose wallet signs) is not exercised at all.
//
// Two PRECONDITIONS are set up here rather than assumed, and both are the demo seed's shape
// rather than a gap in the feature: a demo household on a parent-custody instance boots with
// the all-zero placeholder for a till, and its kids have NO address until a parent registers
// one out of their own wallet with a signed proof. The till goes through its own route; the
// kid's address is written straight into SQLite, because forging a Keyguard signature to reach
// the payout path would prove nothing about the payout path.

const B = process.env.BASE ?? "http://127.0.0.1:3991";
const j = async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) });
const api = (tok, method, path, body) => fetch(B + path, {
  method,
  headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(j);

const say = (label, ok, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);

const seed = await api(null, "POST", "/api/demo/family", {});
const OWNER = seed.data.parentToken;
const kid = seed.data.children[0];
const fam = seed.data.family;

// PRECONDITIONS, not the feature. A demo household on a parent-custody instance boots with the
// all-zero placeholder for a till (nothing has connected a wallet) and its kids have NO address
// at all — under parent custody a kid only gets one when a parent registers it out of their own
// wallet, with a signed proof. Neither is what this script is testing, so both are set up here:
// the till through its own route, the kid's address straight into SQLite (the registration flow
// has its own tests; forging a Keyguard signature to reach the payout path would prove nothing
// about the payout path).
const OWNER_ADDR = "NQ43 040G 2081 040G 2081 040G 2081 040G 2081";
const KID_ADDR = "NQ44 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3";
let r = await api(OWNER, "PATCH", "/api/family/address", { address: OWNER_ADDR });
say("precondition: the household has a real till", r.status === 200, r.data.address ?? r.data.error);
const { Database } = await import("bun:sqlite");
const db = new Database(process.env.DB_PATH);
db.run("UPDATE children SET address=?, address_source='parent' WHERE id=?", [KID_ADDR, kid.id]);
db.close();
say("precondition: the kid has an address", true, KID_ADDR);

// 1. roster
r = await api(OWNER, "GET", "/api/family/members");
say("owner reads the roster", r.status === 200 && r.data.members.length === 1 && r.data.me.role === "owner",
  `${r.data.members?.[0]?.label} · ${r.data.me?.role} · ownWalletPays=${r.data.ownWalletPays}`);
say("the owner's own wallet moved with the till", r.data.members[0].address === OWNER_ADDR,
  r.data.members[0].address);

// 2. invite
r = await api(OWNER, "POST", "/api/family/members/invite", { label: "Grandma Jo", role: "supporter" });
say("owner mints a join code", r.status === 201 && /^\d{6}$/.test(r.data.code), `code ${r.data.code}`);
const CODE = r.data.code;

// 3. join
r = await api(null, "POST", "/api/members/join", { code: CODE });
say("the code admits Grandma and mints HER token", r.status === 201 && !!r.data.token,
  `${r.data.member?.label} · ${r.data.member?.role}`);
const GRAN = r.data.token;
const GRAN_ID = r.data.member.id;

// single use
r = await api(null, "POST", "/api/members/join", { code: CODE });
say("the code is single use", r.status === 404);

// 4. Grandma's own wallet
const GRAN_ADDR = "NQ23 0810 40G2 0810 40G2 0810 40G2 0810 40G2";
r = await api(GRAN, "PUT", "/api/family/members/me/address", { address: GRAN_ADDR });
say("Grandma points her approvals at her own wallet", r.status === 200 && r.data.member.address === GRAN_ADDR);

// she cannot claim the owner's
r = await api(GRAN, "PUT", "/api/family/members/me/address", { address: OWNER_ADDR });
say("she cannot claim a wallet already spoken for", r.status === 409, r.data.error + " by " + r.data.byLabel);
await api(GRAN, "PUT", "/api/family/members/me/address", { address: GRAN_ADDR });

// 5. a supporter cannot price work
r = await api(GRAN, "POST", "/api/chores", { childId: kid.id, title: "Feed the cat", rewardUsd: 1 });
say("a supporter cannot put work on the board", r.status === 403, JSON.stringify(r.data));
r = await api(OWNER, "POST", "/api/chores", { childId: kid.id, title: "Feed the cat", rewardLuna: 500 });
say("the owner can", r.status === 201);
const chore = r.data.chore;

// 6. the money: Grandma approves -> intent from HER wallet
r = await api(GRAN, "POST", `/api/chores/${chore.id}/approve`, {});
const senderOk = r.status === 202 && r.data.signingIntent?.sender === GRAN_ADDR;
say("Grandma's approval mints a tx from HER wallet", senderOk,
  `status ${r.status} · sender ${r.data.signingIntent?.sender ?? r.data.error} · to ${r.data.signingIntent?.recipient}`);

// 7. the owner taps the same card
r = await api(OWNER, "POST", `/api/chores/${chore.id}/approve`, {});
say("the owner taps it too and is handed HER bytes back", r.status === 409 && r.data.error === "already_claimed"
  && r.data.signingIntent?.sender === GRAN_ADDR, `${r.data.error} · sender ${r.data.signingIntent?.sender}`);

// 8. the till has not moved
r = await api(OWNER, "GET", "/api/parent/overview");
say("THE TILL DID NOT MOVE", r.data.parentAddress === OWNER_ADDR, `${r.data.parentAddress}`);
say("the overview names the acting grown-up", r.data.member?.role === "owner", JSON.stringify(r.data.member?.can));

// 9. the queue names the payer for the OTHER grown-up
r = await api(OWNER, "GET", "/api/approvals?status=pending");
const card = r.data.approvals.find((a) => a.subjectKind === "chore");
say("the card names whose wallet it is waiting on", card?.payerLabel === "Grandma Jo" && card?.payerMemberId === GRAN_ID,
  `payerLabel=${card?.payerLabel}`);

// 10. removal cuts her phone off
r = await api(OWNER, "DELETE", `/api/family/members/${GRAN_ID}`);
say("the owner removes her", r.status === 200);
r = await api(GRAN, "GET", "/api/family/members");
say("her phone stops working immediately", r.status === 401);
