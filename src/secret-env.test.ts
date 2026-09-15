// A key generator that says "chmod 600" has to mean it.
//
// Both generators appended their secret with `writeFileSync(envPath, env, { mode: 0o600 })`, and
// stated the guarantee as fact in their header comments. `mode` is only honoured when the call
// CREATES the file, and both scripts `existsSync`-check and bail when it is missing — so the file
// always already existed and the argument was dead in both. An operator who made the env file
// with a plain `touch` under the usual umask 022 got 0644, ran the generator, was told it
// succeeded, and left the HD master seed behind every kid account on the instance readable by
// every local account and every backup tool on the box. hd.ts calls it "the single secret".
//
// The last two tests run the REAL scripts as subprocesses against a deliberately world-readable
// env file, because the unit above them is only worth anything if the scripts actually use it.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSecretLines, readEnv } from "./scripts/secret-env";

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kids-secret-env-"));
  envPath = join(dir, "instance.env");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The exact shape the bug needed: a file an operator created with a permissive umask. */
function worldReadableEnv(): void {
  writeFileSync(envPath, "EXISTING=1\n");
  chmodSync(envPath, 0o644);
  expect(statSync(envPath).mode & 0o077).not.toBe(0); // the precondition really is set up
}

const mode = (p: string) => statSync(p).mode & 0o777;

test("appending a secret locks the file down first", () => {
  worldReadableEnv();
  appendSecretLines(envPath, ["", "SECRET=abc", ""]);
  expect(mode(envPath)).toBe(0o600);
  expect(readEnv(envPath)).toContain("SECRET=abc");
  expect(readEnv(envPath)).toContain("EXISTING=1"); // appended, never rewritten
});

test("an already-private file is left private", () => {
  writeFileSync(envPath, "EXISTING=1\n", { mode: 0o600 });
  chmodSync(envPath, 0o600);
  appendSecretLines(envPath, ["SECRET=abc"]);
  expect(mode(envPath)).toBe(0o600);
});

test("a group/other-readable DIRECTORY is reported, not silently changed", () => {
  worldReadableEnv();
  chmodSync(dir, 0o755);
  const real = console.warn;
  const said: string[] = [];
  console.warn = (...a: unknown[]) => { said.push(a.map(String).join(" ")); };
  try { appendSecretLines(envPath, ["SECRET=abc"]); } finally { console.warn = real; }

  expect(said.join("\n")).toContain(`chmod 700 ${dir}`);
  // The operator's directory is theirs. It may hold things this script knows nothing about.
  expect(mode(dir)).toBe(0o755);
});

test("a private directory says nothing", () => {
  worldReadableEnv();
  chmodSync(dir, 0o700);
  const real = console.warn;
  const said: string[] = [];
  console.warn = (...a: unknown[]) => { said.push(a.map(String).join(" ")); };
  try { appendSecretLines(envPath, ["SECRET=abc"]); } finally { console.warn = real; }
  expect(said).toEqual([]);
});

// ---- the scripts themselves, run for real ----

async function runScript(script: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, "scripts", script), envPath],
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, NIMIQ_SIM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: out + err };
}

test("generate-family-seed leaves the env file 0600, whatever it was before", async () => {
  worldReadableEnv();
  const { code, out } = await runScript("generate-family-seed.ts");
  expect(code, out).toBe(0);
  expect(readEnv(envPath)).toContain("HATCH_MASTER_SEED=");
  expect(mode(envPath)).toBe(0o600);
  // The seed is in the file and NOT on stdout — the address-only discipline the header claims.
  const seed = /HATCH_MASTER_SEED=([0-9a-f]+)/.exec(readEnv(envPath))![1]!;
  expect(seed.length).toBe(64);
  expect(out).not.toContain(seed);
});

test("generate-hot-wallet leaves the env file 0600, whatever it was before", async () => {
  worldReadableEnv();
  const { code, out } = await runScript("generate-hot-wallet.ts");
  expect(code, out).toBe(0);
  expect(readEnv(envPath)).toContain("DEV_PARENT_PRIV=");
  expect(mode(envPath)).toBe(0o600);
  const priv = /DEV_PARENT_PRIV=([0-9a-f]+)/.exec(readEnv(envPath))![1]!;
  expect(priv.length).toBe(64);
  expect(out).not.toContain(priv);
});

test("both generators still refuse to overwrite a key that is already there", async () => {
  worldReadableEnv();
  expect((await runScript("generate-family-seed.ts")).code).toBe(0);
  const after = readEnv(envPath);
  const second = await runScript("generate-family-seed.ts");
  expect(second.code).toBe(1);
  expect(second.out).toContain("refusing to overwrite");
  expect(readEnv(envPath)).toBe(after); // not one byte appended
  expect(readFileSync(envPath, "utf8").match(/HATCH_MASTER_SEED=/g)!.length).toBe(1);
});
