// The kid-side approval notice (public/kid/js/approved.js), issue #323.
//
// The silence this closes: a parent approves from their own phone, the chart re-renders on its
// next poll, and the sticker the kid earned sits behind a tap nothing told them to make.
//
// `approvedSubjects` is a function with inputs for the same reason grow-gate.js is: the notice
// itself lives inside chart.js's screen graph, but the RULE it fires on does not have to.
// Everything below is the rule; the four wiring facts that a refactor could silently undo are
// asserted against source at the bottom.

import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kidIconsMock } from "./kid-icons-mock";

// approved.js imports util.js, which pulls in icons.js and its browser-absolute
// `/js/lib/box-glyphs.js`. The shared stub, same as fmt-nim-whole.test.ts.
mock.module("../public/kid/js/icons.js", kidIconsMock);

const { approvedSubjects, freshSubjects, cardState } = await import("../public/kid/js/approved.js");

const root = join(import.meta.dir, "..");

/** A routine task card as `/kids/:id/chart` serializes it. */
const task = (over: Record<string, unknown> = {}) => ({
  kind: "task", taskRunId: "tr1", runId: "run1", routineId: "r1",
  routineTitle: "Morning", routineTitleKey: null,
  status: "done", runStatus: "approved", rewardLuna: 3_000, placement: null,
  ...over,
});
/** A chore card. */
const chore = (over: Record<string, unknown> = {}) => ({
  kind: "chore", choreId: "c1", title: "Tidy your room", titleKey: null,
  status: "approved", rewardLuna: 7_203, placement: null,
  ...over,
});

test("nothing approved, nothing to say", () => {
  expect(approvedSubjects({ todayTasks: [chore({ status: "submitted" })] })).toEqual([]);
  expect(approvedSubjects({ todayTasks: [] })).toEqual([]);
  expect(approvedSubjects(null)).toEqual([]);
  expect(approvedSubjects(undefined)).toEqual([]);
});

test("a sticker already placed is a moment already had", () => {
  // `done`, not `reward`: the kid collected it, so there is nothing waiting behind a tap.
  const placed = chore({ placement: { day: "2026-08-04" } });
  expect(cardState(placed, [placed])).toBe("done");
  expect(approvedSubjects({ todayTasks: [placed] })).toEqual([]);
});

test("an approved chore names itself and what it paid", () => {
  const [s] = approvedSubjects({ todayTasks: [chore()] });
  expect(s.key).toBe("chore:c1");
  expect(s.title).toBe("Tidy your room");
  expect(s.luna).toBe(7_203);
  expect(s.target).toEqual({ kind: "chore", id: "c1" });
});

test("ONE routine yes is ONE notice, not one per task", () => {
  // Four toasts for one parent tap is worse than the silence this replaces.
  const run = [
    task({ taskRunId: "tr1" }),
    task({ taskRunId: "tr2" }),
    task({ taskRunId: "tr3" }),
    task({ taskRunId: "tr4" }),
  ];
  const subjects = approvedSubjects({ todayTasks: run });
  expect(subjects.length).toBe(1);
  expect(subjects[0]!.key).toBe("run:run1");
  expect(subjects[0]!.title).toBe("Morning");
});

test("a run pays the sum of its DONE tasks, which is what the server pays", () => {
  // runRewardLuna (src/repo-routines.ts) sums reward_luna WHERE tr.status='done'. A skipped
  // task is off the board and off the bill, and reading its reward would overstate the toast
  // against the NIM that actually landed.
  const subjects = approvedSubjects({
    todayTasks: [
      task({ taskRunId: "tr1", rewardLuna: 3_000, status: "done" }),
      task({ taskRunId: "tr2", rewardLuna: 4_203, status: "done" }),
      task({ taskRunId: "tr3", rewardLuna: 9_999, status: "skipped" }),
    ],
  });
  expect(subjects[0]!.luna).toBe(7_203);
});

test("the notice points at the first UNCOLLECTED card of the run", () => {
  // One yes turns every task green and the kid collects them one at a time. A target that
  // ignored placements would reopen a sticker they already placed.
  const subjects = approvedSubjects({
    todayTasks: [
      task({ taskRunId: "tr1", placement: { day: "2026-08-04" } }),
      task({ taskRunId: "tr2" }),
      task({ taskRunId: "tr3" }),
    ],
  });
  expect(subjects[0]!.target).toEqual({ kind: "task", id: "tr2" });
});

test("two subjects landing together are two entries", () => {
  const subjects = approvedSubjects({ todayTasks: [task(), chore()] });
  expect(subjects.map((s) => s.key).sort()).toEqual(["chore:c1", "run:run1"]);
});

test("a job worth nothing is still worth telling them about", () => {
  // A kid can add their own job and it may carry no reward. The board stopped filtering by
  // reward for exactly that reason, and the sticker is the point either way.
  const [s] = approvedSubjects({ todayTasks: [chore({ rewardLuna: 0 })] });
  expect(s.luna).toBe(0);
  expect(s.key).toBe("chore:c1");
});

test("a card sent back is not an approval", () => {
  const back = chore({ status: "rejected" });
  expect(cardState(back, [back])).toBe("retry");
  expect(approvedSubjects({ todayTasks: [back] })).toEqual([]);
});

test("told once: a subject already in the marker is not fresh", () => {
  const chart = { todayTasks: [chore()] };
  expect(freshSubjects(chart, []).length).toBe(1);
  expect(freshSubjects(chart, ["chore:c1"]).length).toBe(0);
});

test("never told on this device = tell them, which is the closed-app case", () => {
  // The whole point of a marker rather than an in-session diff: a kid whose app was shut when
  // the yes arrived has to hear about it on next open.
  const chart = { todayTasks: [chore()] };
  expect(freshSubjects(chart, null).length).toBe(1);
  expect(freshSubjects(chart, undefined).length).toBe(1);
});

// ---------- the wiring, which is what a refactor silently undoes ----------

const approved = readFileSync(join(root, "public", "kid", "js", "approved.js"), "utf8");
const chart = readFileSync(join(root, "public", "kid", "js", "chart.js"), "utf8");
const waiting = readFileSync(join(root, "public", "kid", "js", "waiting.js"), "utf8");
const util = readFileSync(join(root, "public", "kid", "js", "util.js"), "utf8");

test("EVERY path that already celebrates banks the approval as told first", () => {
  // The double-fire the issue names. A routine is the one that bites: its first sticker opens
  // automatically and the rest stay `reward`, so a missed mark here announces a payout the kid
  // just watched. One call site in chart.js (demo chore self-approve) and three in waiting.js
  // (demo routine self-approve, on-tablet PIN, and the remote-approval poll).
  expect(chart.match(/markApprovalsSeen\(\)/g)?.length).toBe(1);
  expect(waiting.match(/markApprovalsSeen\(\)/g)?.length).toBe(3);

  // ...and always BEFORE the celebration it belongs to, never after. Comments are stripped
  // first: both files explain this in prose directly above the code, and the prose names the
  // same two functions the assertion looks for.
  // Line-based, NOT a /* ... */ regex: waiting.js carries `accept="image/*"`, and a lazy
  // block match starting there eats every call in the file and passes on an empty haystack.
  const code = (src: string) => src.split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  let calls = 0;
  for (const [file, src] of [["chart.js", chart], ["waiting.js", waiting]] as const) {
    for (const m of code(src).matchAll(/^[^\n]*\bnimCelebration\(/gm)) {
      if (m[0].includes("export function")) continue; // the declaration, not a call
      calls++;
      const before = code(src).slice(0, m.index);
      const since = before.slice(before.lastIndexOf("refreshChart()"));
      expect(since, `${file}: a celebration with no mark before it`).toContain("markApprovalsSeen()");
    }
  }
  expect(calls, "every celebration accounted for").toBe(4);
});

test("the notice reads cardState, it does not re-derive 'approved'", () => {
  // Three readers of this rule had already drifted apart once. The fourth reads the function.
  expect(approved).toContain('cardState(tk, all) !== "reward"');
  // And chart.js reads the same one rather than keeping a copy.
  expect(chart).toContain('from "./approved.js"');
  expect(chart).not.toContain("function cardState");
});

test("util.js is approved.js's only import", () => {
  // Two reasons, and both are load-bearing. A cycle back into chart.js resolves at boot and
  // breaks nothing until the load order changes; and pulling stickers.js in would drag
  // confetti, the photo store and the API client behind it, which is what makes a rule
  // testable only through the screen it happens to live on. Opening the sheet is an argument.
  const imports = [...approved.matchAll(/^import[\s\S]*?from "(.*?)";$/gm)].map((m) => m[1]);
  expect(imports).toEqual(["./util.js"]);
  expect(approved).toContain("onTap: () => openSticker(fresh[0].target)");
});

test("a tappable toast cleans up after itself", () => {
  // `.kid-toast` is pointer-events: none so ordinary toasts never eat a tap meant for the
  // screen behind them. A handler left under a hidden toast is a sheet opening from nowhere.
  const fn = /export function toast\([\s\S]*?\n\}/.exec(util)?.[0] ?? "";
  expect(fn).toContain('el.classList.remove("show", "is-tappable")');
  expect(fn).toContain("el.onclick = null");
  expect(readFileSync(join(root, "public", "kid", "kid.css"), "utf8"))
    .toContain(".kid-toast.is-tappable { pointer-events: auto;");
});
