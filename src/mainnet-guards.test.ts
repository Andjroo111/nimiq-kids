// The mainnet arm switch: real money only moves with BOTH an explicit RPC URL and
// MAINNET_ARMED=1. Module-level constants are computed at import, so each case runs
// in a subprocess with its own env.

import { test, expect } from "bun:test";

async function importClientWith(env: Record<string, string>): Promise<{ ok: boolean; err: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", 'await import("./src/nimiq/client.ts"); console.log("OK")'],
    env: { ...process.env, NIMIQ_SIM: "", DEV_PARENT_PRIV: "", NIMIQ_RPC_URL: "", MAINNET_ARMED: "", HATCH_REQUIRE_REAL: "", ...env },
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return { ok: out.includes("OK"), err };
}

const HOT_KEY = "0".repeat(64); // any 64-hex — only presence matters for the SIM flag

test("main + non-SIM + no RPC url refuses to load", async () => {
  const r = await importClientWith({ NIMIQ_NETWORK: "main", DEV_PARENT_PRIV: HOT_KEY });
  expect(r.ok).toBe(false);
  expect(r.err).toContain("explicit NIMIQ_RPC_URL");
});

test("main + non-SIM + url but NOT armed refuses to load", async () => {
  const r = await importClientWith({ NIMIQ_NETWORK: "main", DEV_PARENT_PRIV: HOT_KEY, NIMIQ_RPC_URL: "http://127.0.0.1:8649" });
  expect(r.ok).toBe(false);
  expect(r.err).toContain("MAINNET_ARMED=1");
});

test("main + non-SIM + url + armed loads", async () => {
  const r = await importClientWith({
    NIMIQ_NETWORK: "main", DEV_PARENT_PRIV: HOT_KEY,
    NIMIQ_RPC_URL: "http://127.0.0.1:8649", MAINNET_ARMED: "1",
  });
  expect(r.ok).toBe(true);
});

test("main in SIM mode loads without url or arm (SIM never touches RPC)", async () => {
  const r = await importClientWith({ NIMIQ_NETWORK: "main", NIMIQ_SIM: "1" });
  expect(r.ok).toBe(true);
});

test("testnet keeps its local default and needs no arming", async () => {
  const r = await importClientWith({ NIMIQ_NETWORK: "test", DEV_PARENT_PRIV: HOT_KEY });
  expect(r.ok).toBe(true);
});

// The competition guard: a shipped build must never quietly fall back to SIM
// (docs/ROADMAP.md Phase 1 "no simulated settlement path reachable").

test("HATCH_REQUIRE_REAL=1 with no funded key (implicit SIM) refuses to load", async () => {
  const r = await importClientWith({ HATCH_REQUIRE_REAL: "1" });
  expect(r.ok).toBe(false);
  expect(r.err).toContain("SIM mode is active");
});

test("HATCH_REQUIRE_REAL=1 with a stray NIMIQ_SIM=1 refuses to load even with a key", async () => {
  const r = await importClientWith({ HATCH_REQUIRE_REAL: "1", NIMIQ_SIM: "1", DEV_PARENT_PRIV: HOT_KEY });
  expect(r.ok).toBe(false);
  expect(r.err).toContain("SIM mode is active");
});

test("HATCH_REQUIRE_REAL=1 with a funded key loads", async () => {
  const r = await importClientWith({ HATCH_REQUIRE_REAL: "1", DEV_PARENT_PRIV: HOT_KEY });
  expect(r.ok).toBe(true);
});

test("without the flag, SIM stays the friendly fresh-clone default", async () => {
  const r = await importClientWith({});
  expect(r.ok).toBe(true);
});

// The custody policy, as a BOOTED instance would report it (same subprocess pattern).
// custody.ts deliberately does NOT import nimiq/client (import-time throws live there),
// so a subprocess proves the module stands alone under a mainnet-shaped env — the
// mainnet case below still passes the full armed env a real boot would carry.

async function custodyViewWith(env: Record<string, string>): Promise<Record<string, unknown> | null> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e",
      'const m = await import("./src/custody.ts"); console.log("VIEW:" + JSON.stringify(m.custodyView()))'],
    env: { ...process.env, NIMIQ_SIM: "", DEV_PARENT_PRIV: "", NIMIQ_RPC_URL: "", MAINNET_ARMED: "", HATCH_REQUIRE_REAL: "", HATCH_REQUIRE_PARENT_APPROVAL: "", HATCH_LEGACY_BOOT: "", NIMIQ_NETWORK: "", ...env },
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const line = out.split("\n").find((l) => l.startsWith("VIEW:"));
  return line ? JSON.parse(line.slice(5)) : null;
}

test("a real armed mainnet boot reports approval FORCED and kid auth required", async () => {
  // The deploy-honesty requirement: the mainnet instance must say so after this ships.
  const v = await custodyViewWith({
    NIMIQ_NETWORK: "main", DEV_PARENT_PRIV: HOT_KEY,
    NIMIQ_RPC_URL: "http://127.0.0.1:8649", MAINNET_ARMED: "1",
  });
  expect(v).toEqual({
    demoUnlocked: false, requiresParentApproval: true, warning: null,
    kidAuthRequired: true, kidCustody: "server",
  });
});

test("main in SIM mode is STILL gated: simulating does not unlock a mainnet instance", async () => {
  // This used to assert demo-unlocked. An instance configured for mainnet now reports the
  // gate whether or not it can actually sign, because the alternative is that switching on
  // SIM (or removing the key) quietly relaxes the policy on the one instance where that
  // must never happen. Demo mode still belongs to the testnet instances, which is where
  // every live demo actually runs (:3950 and :3963 are both NIMIQ_NETWORK=test).
  const v = await custodyViewWith({ NIMIQ_NETWORK: "main", NIMIQ_SIM: "1" });
  expect(v!.requiresParentApproval).toBe(true);
  expect(v!.demoUnlocked).toBe(false);
  expect(v!.warning).toBeNull();
});

test("testnet with a key + HATCH_REQUIRE_PARENT_APPROVAL=1 reports approval forced", async () => {
  const v = await custodyViewWith({
    NIMIQ_NETWORK: "test", DEV_PARENT_PRIV: HOT_KEY, HATCH_REQUIRE_PARENT_APPROVAL: "1",
  });
  expect(v!.requiresParentApproval).toBe(true);
  expect(v!.warning).toBeNull();
});
