// nimiq.kids kid app — thin fetch wrappers over the Hono API. Kid endpoints are open
// by design (it's their tablet); parent actions carry a PIN. Slice 3: a paired tablet
// stores a DEVICE token and sends it as a bearer, so the boot surfaces (/api/family,
// /api/children) scope to ITS household on a multi-family instance. Unpaired tablets
// on a legacy instance keep working with no token at all.

const TOKEN_KEY = "kid.deviceToken";
export const deviceToken = () => localStorage.getItem(TOKEN_KEY);
export const saveDeviceToken = (token) => localStorage.setItem(TOKEN_KEY, token);

const headers = (extra = {}) => {
  const token = deviceToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
};

const get = async (p) => (await fetch(p, { headers: headers() })).json();
const send = async (method, p, body) => (await fetch(p, {
  method, headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body ?? {}),
})).json();
const post = (p, body) => send("POST", p, body);
const put = (p, body) => send("PUT", p, body);
const del = (p) => send("DELETE", p);

export const api = {
  health: () => get("/health"),
  family: () => get("/api/family"),
  children: () => get("/api/children"),

  // Boot probe: unlike the sugar above this keeps the HTTP status, so main.js can
  // tell "pairing required" (401 on a public instance) apart from a normal roster.
  bootChildren: async () => {
    const r = await fetch("/api/children", { headers: headers() });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  // 6-digit code from the parent app (Settings -> Pair a device) -> device token.
  pairDevice: (pairCode, label) => post("/api/devices/register", { pairCode, label }),

  // #123 the switch gate: a kid's secret picture on a shared tablet. `unlock` is called on
  // EVERY switch, including for a kid who has no secret, the server decides whether that
  // cost anything, so the client never has to hold a second copy of that rule.
  switchPictures: () => get("/api/switch/pictures"),
  unlockKid: async (childId, body) => {
    const r = await fetch(`/api/kids/${childId}/unlock`, {
      method: "POST", headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  // KEEPS THE HTTP STATUS, for the same reason bootChildren does: a tablet that is not paired
  // gets 401 here, and a kid who tapped their pictures correctly must not be told "not those
  // ones". Enrolling is the one screen where the failure a child CAN fix and the failure only
  // a grown-up can fix look identical, so the caller needs to tell them apart.
  setSwitchSecret: async (childId, body) => {
    const r = await fetch(`/api/kids/${childId}/switch-secret`, {
      method: "POST", headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },

  routines: (childId) => get(`/api/routines?childId=${encodeURIComponent(childId)}`),
  today: (routineId) => get(`/api/routines/${routineId}/today`),
  startTask: (taskRunId) => post(`/api/task-runs/${taskRunId}/start`),
  doneTask: (taskRunId) => post(`/api/task-runs/${taskRunId}/done`),
  /**
   * POST and answer with the HTTP STATUS, not the body, and never throw.
   *
   * Every other write here goes through `post()`, which returns `res.json()` whatever the
   * status, so a 500 and a 200 are the same value to the caller. The outbox cannot work that
   * way: its whole job is telling "the server has it" (2xx, or 409 already_finished) apart
   * from "try again later" (5xx) and "this will never work" (404). 0 means no answer at all,
   * which is the offline case and the one the queue exists for.
   */
  postStatus: async (path) => {
    try {
      const r = await fetch(path, { method: "POST", headers: headers({ "content-type": "application/json" }), body: "{}" });
      return r.status;
    } catch { return 0; }
  },
  runApproval: (runId) => get(`/api/routine-runs/${runId}/approval`),
  choreApproval: (choreId) => get(`/api/chores/${choreId}/approval`),
  resubmitRun: (runId) => post(`/api/routine-runs/${runId}/submit`),

  // V3 sticker chart + Treasure Box
  chart: (childId, week) => get(`/api/kids/${encodeURIComponent(childId)}/chart${week ? `?week=${week}` : ""}`),
  // The sets a kid can collect, and their own asks. Both open to the tablet: a theme is a
  // catalogue of art, and a kid's own wishes are theirs to see.
  goalThemes: () => get("/api/goal-themes"),
  goalRequests: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/goal-requests`),
  askForGoal: (childId, packId) => post(`/api/kids/${encodeURIComponent(childId)}/goal-requests`, { packId }),
  // The calendar's month grid. Separate from chart() on purpose: chart() is on a
  // 10s poll, this is fetched once, when a kid opens the month.
  month: (childId, month) => get(`/api/kids/${encodeURIComponent(childId)}/month${month ? `?month=${month}` : ""}`),
  placeTaskSticker: (taskRunId, body) => post(`/api/task-runs/${taskRunId}/sticker`, body),
  placeChoreSticker: (choreId, body) => post(`/api/chores/${choreId}/sticker`, body),
  placePracticeSticker: (sessionId, body) => post(`/api/practice-sessions/${sessionId}/sticker`, body),

  // Practices: weekly-target habits (piano, a workout). logPractice is idempotent
  // per day — twice on a Sunday is still one day toward the week. `stepIds` is what the kid
  // ticked on a practice made of exercises, and it decides what the day pays; the server
  // writes it once, so a later call the same day carries it in vain.
  logPractice: (practiceId, seconds, stepIds) => post(`/api/practices/${practiceId}/session`, {
    seconds, ...(stepIds ? { stepIds } : {}),
  }),
  // Goals: a ladder the kid climbs. Claiming a rung opens the parent's approval, exactly as
  // handing in a chore does; the server decides whether that rung is theirs to claim.
  claimRung: (goalId, rungId) => post(`/api/goals/${goalId}/rungs/${rungId}/claim`, {}),
  stickers: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/stickers`),
  // localRef is a `local:<uuid>` handle into this device's IndexedDB — the photo itself is
  // never uploaded (#282).
  photoSticker: (childId, localRef) => post(`/api/kids/${encodeURIComponent(childId)}/photo-sticker`, { localRef }),
  store: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/store`),
  // What the kid is saving for (#355). The METER itself rides on /kids/:id/wallet — these two
  // are only the writes, because the meter is a mirror of that endpoint's own balance and
  // reading it separately would mean two reads of one number.
  setSavings: (childId, body) => post(`/api/kids/${encodeURIComponent(childId)}/savings`, body),
  clearSavings: (childId) => del(`/api/kids/${encodeURIComponent(childId)}/savings`),
  purchases: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/purchases`),
  buy: (childId, itemId) => post(`/api/kids/${encodeURIComponent(childId)}/buy`, { itemId }),

  approve: (approvalId, pin) => post(`/api/approvals/${approvalId}/approve`, { pin }),
  attachPhoto: (approvalId, mediaAssetId) => post(`/api/approvals/${approvalId}/photo`, { mediaAssetId }),

  chores: (childId) => get(`/api/chores?childId=${encodeURIComponent(childId)}`),
  submitChore: (choreId) => post(`/api/chores/${choreId}/submit`),
  // A kid adding a job to their own board, and taking one off again. Removal is
  // SOFT server-side: the parent can still see what went (see routes/chores.ts).
  createChore: (body) => post("/api/chores", body),
  removeChore: (choreId) => post(`/api/chores/${choreId}/remove`),
  taskIcons: () => get("/api/task-icons"),

  stars: (childId) => get(`/api/children/${childId}/stars`),
  prefs: (childId) => get(`/api/children/${childId}/prefs`),
  putPrefs: (childId, patch) => put(`/api/children/${childId}/prefs`, patch),
  catalog: () => get("/api/catalog"),

  media: (childId, role) => get(`/api/media?childId=${encodeURIComponent(childId)}&role=${role}`),
  async upload(file, role, childId) {
    const form = new FormData();
    form.set("file", file); form.set("role", role); form.set("childId", childId);
    return (await fetch("/api/media", { method: "POST", headers: headers(), body: form })).json();
  },

  cashlinkStatus: (id) => get(`/api/cashlinks/${id}/status`),
  cashlinkLink: (id) => get(`/api/cashlinks/${id}/link`),
  claimSim: (id) => post(`/api/cashlinks/${id}/claim-sim`),

  // V2 kid wallet (docs/WALLET-CONTRACT.md)
  wallet: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/wallet`),
  /** The nine characters a kid may choose from, minted by the server (#381). */
  characterChoices: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/character-choices`),
  /** Claim one of them. The body carries the offer id and an INDEX, never an address. */
  chooseCharacter: (childId, body) => post(`/api/kids/${encodeURIComponent(childId)}/character`, body),
  sendNim: (childId, body) => post(`/api/kids/${encodeURIComponent(childId)}/send`, body),
  /** A scanned address: queues for a parent's OK, never moves funds here. */
  sendScanned: (childId, toAddress, valueLuna) =>
    post(`/api/kids/${encodeURIComponent(childId)}/send`, { scanned: { toAddress, valueLuna } }),
  /** Claim a scanned Cashlink. SIM settles it directly; REAL hands the URL to the
   *  wallet that can sweep it, which is the real claim path. */
  claimCashlink: (url) => post(`/api/cashlinks/claim`, { url }),
  staking: (childId) => get(`/api/kids/${encodeURIComponent(childId)}/staking`),
  stake: (childId, valueLuna) => post(`/api/kids/${encodeURIComponent(childId)}/stake`, { valueLuna }),
  unstake: (childId, valueLuna) => post(`/api/kids/${encodeURIComponent(childId)}/unstake`, { valueLuna }),
  rates: () => get("/api/rates"),
};
