// Coming BACK to the demo, which is the visit the landing page used to get wrong.
//
// A demo household is swept HATCH_DEMO_TTL_MS after it is minted (four hours on the live
// instance, hourly sweeper), and that deletes the `devices` and `parent_tokens` rows the
// two bearers in localStorage name. Those keys never expire. The page decided "this
// visitor already has a family" from the PRESENCE of three keys, so a returning visitor
// was shown two buttons into a household the server had forgotten: /kid/ booted,
// /api/children answered 401, and main.js bounced them back here via ?fresh=1. The tap
// looked like it had done nothing and the demo "only worked the second time you loaded it".
//
// These tests run the page's OWN inline script, extracted from the served HTML, against
// stubbed storage and fetch. A substring assertion would pass on a page that never called
// the probe it mentions; this fails unless the shipped script actually behaves.

import { test, expect } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import { demoLanding } from "./routes/demo";

async function servedPage(): Promise<string> {
  initTestDb();
  process.env.HATCH_DEMO_ENABLED = "1";
  try {
    const app = new Hono().route("/", demoLanding);
    return await (await app.request("http://hatch.test/demo")).text();
  } finally {
    delete process.env.HATCH_DEMO_ENABLED;
  }
}

const html = await servedPage();

/** The page ships one script block: the language table, then the two IIFEs. */
const pageScript = html.slice(
  html.indexOf("<script>") + "<script>".length,
  html.lastIndexOf("</script>"),
);

interface Call { method: string; url: string; auth: string | null }

interface Run {
  store: Record<string, string>;
  calls: Call[];
  /** Which of the page's three panels are visible when the dust settles. */
  panel: { loading: boolean; ready: boolean; failed: boolean };
  failmsg: string;
}

/**
 * Execute the page script with the storage a returning visitor would have.
 *
 * `respond` is the whole server: it sees method + path and returns the status and body,
 * or throws to simulate a dead network.
 */
async function run(
  store: Record<string, string>,
  respond: (method: string, path: string) => { status: number; body?: unknown },
  search = "",
): Promise<Run> {
  const calls: Call[] = [];

  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };

  const els = new Map<string, { hidden: boolean; textContent: string; addEventListener: () => void }>();
  const el = (id: string) => {
    if (!els.has(id)) els.set(id, { hidden: id !== "loading", textContent: "", addEventListener: () => {} });
    return els.get(id)!;
  };
  const document = {
    getElementById: el,
    querySelectorAll: () => [] as unknown[],
    documentElement: { lang: "en" },
    title: "",
  };

  const fetchStub = (url: string, opts?: { method?: string; headers?: Record<string, string> }) => {
    const method = opts?.method ?? "GET";
    calls.push({ method, url, auth: opts?.headers?.Authorization ?? null });
    let res: { status: number; body?: unknown };
    try {
      res = respond(method, url);
    } catch (err) {
      return Promise.reject(err); // a dead network, not an answer
    }
    return Promise.resolve({ status: res.status, json: () => Promise.resolve(res.body ?? {}) });
  };

  new Function("localStorage", "document", "location", "history", "fetch", pageScript)(
    localStorage,
    document,
    { search, pathname: "/demo", href: "/demo" + search },
    { replaceState: () => {} },
    fetchStub,
  );

  // Long enough for the promise chains (probe, then mint, then json) to settle.
  await new Promise((r) => setTimeout(r, 20));

  return {
    store,
    calls,
    panel: { loading: !el("loading").hidden, ready: !el("ready").hidden, failed: !el("failed").hidden },
    failmsg: el("failmsg").textContent,
  };
}

const MINTED = {
  status: 201,
  body: {
    parentToken: "new-parent", deviceToken: "new-device",
    family: { id: "fam-new", parentLabel: "Mom" }, children: [], paidHistory: 4, network: "test",
  },
};

const alive = { kidsParentToken: "p1", "kid.deviceToken": "d1", "kids.demoFamilyId": "fam-1" };

// ---------------------------------------------------------------------------
// The bug
// ---------------------------------------------------------------------------

test("a household the server has swept is replaced, not offered", async () => {
  const r = await run({ ...alive, "kid.childId": "kid-1" }, (method, url) => {
    if (url.startsWith("/api/children")) return { status: 401, body: { error: "pairing_required" } };
    if (method === "POST" && url === "/api/demo/family") return MINTED;
    throw new Error("unexpected " + method + " " + url);
  });

  // It asked, with the bearer it was about to hand the kid app.
  expect(r.calls[0]).toEqual({ method: "GET", url: "/api/children", auth: "Bearer d1" });
  // Got a 401, so it minted rather than showing the buttons.
  expect(r.calls.some((c) => c.method === "POST" && c.url === "/api/demo/family")).toBe(true);
  expect(r.store["kid.deviceToken"]).toBe("new-device");
  expect(r.store.kidsParentToken).toBe("new-parent");
  expect(r.store["kids.demoFamilyId"]).toBe("fam-new");
  // The kid picked out of the DEAD family must not ride into the new one, or the kid app
  // boots straight past the roster on an id that is not in it.
  expect(r.store["kid.childId"]).toBeUndefined();
  // And the visitor ends up where one tap works.
  expect(r.panel).toEqual({ loading: false, ready: true, failed: false });
});

test("a household that is still there is kept, and nothing is minted", async () => {
  const r = await run({ ...alive }, (method, url) => {
    if (url.startsWith("/api/children")) return { status: 200, body: { children: [] } };
    throw new Error("must not mint over a live family: " + method + " " + url);
  });

  expect(r.calls.map((c) => c.url)).toEqual(["/api/children"]);
  expect(r.store["kid.deviceToken"]).toBe("d1"); // untouched
  expect(r.panel.ready).toBe(true);
});

test("offline keeps the family rather than throwing it away", async () => {
  // The probe is a check, not a gate. A visitor on a flaky connection with a perfectly
  // good household must not have it deleted because one request failed, and must not be
  // stranded on "Setting up your family" either.
  const r = await run({ ...alive }, () => { throw new Error("network down"); });

  expect(r.store["kid.deviceToken"]).toBe("d1");
  expect(r.calls.some((c) => c.method === "POST")).toBe(false);
  expect(r.panel).toEqual({ loading: false, ready: true, failed: false });
});

// ---------------------------------------------------------------------------
// The paths that already worked, pinned so the probe cannot cost them
// ---------------------------------------------------------------------------

test("a first-time visitor mints straight away, with no probe to wait for", async () => {
  const r = await run({}, (method, url) => {
    if (method === "POST" && url === "/api/demo/family") return MINTED;
    throw new Error("unexpected " + method + " " + url);
  });

  expect(r.calls).toHaveLength(1);
  expect(r.calls[0].url).toBe("/api/demo/family");
  expect(r.panel.ready).toBe(true);
});

test("a half-written storage counts as no household", async () => {
  // A token with no family id (a partially cleared browser, an interrupted mint) has
  // nothing to probe WITH on the parent side, so it mints rather than guessing.
  const partials: Record<string, string>[] = [
    { kidsParentToken: "p1" },
    { "kid.deviceToken": "d1" },
    { kidsParentToken: "p1", "kids.demoFamilyId": "fam-1" },
  ];
  for (const partial of partials) {
    const r = await run({ ...partial }, (method, url) => {
      if (method === "POST" && url === "/api/demo/family") return MINTED;
      throw new Error("probed on incomplete storage: " + url);
    });
    expect(r.calls.map((c) => c.url)).toEqual(["/api/demo/family"]);
  }
});

test("?fresh=1 still forgets all four keys, the kid last picked included", async () => {
  const r = await run(
    { ...alive, "kid.childId": "kid-1" },
    (method, url) => {
      if (method === "POST" && url === "/api/demo/family") return MINTED;
      throw new Error("reset must not probe the family it is discarding: " + url);
    },
    "?fresh=1",
  );

  expect(r.calls.map((c) => c.url)).toEqual(["/api/demo/family"]);
  expect(r.store["kid.childId"]).toBeUndefined();
  expect(r.store["kids.demoFamilyId"]).toBe("fam-new");
});

test("a mint that fails says so, rather than showing buttons into nothing", async () => {
  const r = await run({}, () => ({ status: 429, body: { error: "too_many_requests" } }));
  expect(r.panel).toEqual({ loading: false, ready: false, failed: true });
  expect(r.failmsg).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The probe has to stay the same question the kid app asks
// ---------------------------------------------------------------------------

test("the probe uses the kid app's own token key and boot endpoint", async () => {
  // If either side is renamed, the page starts answering a different question from the one
  // that decides whether /kid/ boots, and the bounce comes back silently.
  const api = await Bun.file(new URL("../public/kid/js/api.js", import.meta.url)).text();
  const tokenKey = api.match(/TOKEN_KEY = "([^"]+)"/)?.[1];
  expect(tokenKey).toBe("kid.deviceToken");
  // bootChildren, the call whose 401 sends a demo visitor back to this page.
  expect(api).toContain('fetch("/api/children"');
  expect(pageScript).toContain('var DEVICE_KEY = "' + tokenKey + '"');
  expect(pageScript).toContain('fetch("/api/children"');
});
