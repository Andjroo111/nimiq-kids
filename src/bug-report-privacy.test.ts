// A bug report from this app must not publish a child's identifier.
//
// The corner menu's "Report a bug" goes browser -> bot.nimiq.tech -> an LLM-written issue on
// the PUBLIC repo. No server of ours is in that path, so nothing downstream can catch a
// mistake, and nearly every call this app makes is addressed by CHILD UUID.
//
// That is why diagnostics were switched OFF here (#140): the shell's only redaction was one
// regex for NQ-address shapes, so a kid tapping Buy on a pack she already owned filed
// `POST /api/kids/8f3c…/buy -> 400` into a public issue. It cost every report its URL, its
// failed requests and its console errors — the useful half.
//
// `nimiq-app-shell` v0.9.2 closed it client-side, which is the only place it CAN be closed
// when there is no server of ours in the path: `scrubAddresses` now redacts any 8-4-4-4-12
// hex UUID as "[id redacted]" alongside the address shapes, and `pageContext` cuts `url` and
// `referrer` at the first ? or # so a `?childId=` never reaches the scrubber at all. So
// diagnostics are back ON, and what has to stay true has moved with them.
//
// Two kinds of test, and they answer different questions:
//
//   * SOURCE assertions — that the wiring is there, on BOTH bundles, and that this repo hands
//     the shell nothing about a household to publish. Same shape demo-family.test.ts uses to
//     keep purgeFamily's delete list honest.
//   * A BEHAVIOURAL proof, through the shell that is actually installed. Turning diagnostics
//     on is only safe because of a scrub in a PINNED dependency, and a pin is a claim, not a
//     fact: a bump that silently resolved to an older build would leave this app publishing
//     UUIDs again with a green manifest. So the last tests drive a realistic report all the
//     way to the wire with `fetch` stubbed, and read what would have been POSTed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  installReportCapture,
  pageContext,
  submitToBot,
  type FeedbackInput,
} from "nimiq-app-shell";

const shells = ["app-shell.ts", "parent-shell.ts"] as const;
const source = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");

/** The `reportBug: { ... }` option object, whichever shell it is in. */
function reportBugBlock(file: string): string {
  const s = source(file);
  const at = s.indexOf("reportBug: {");
  expect(at, `${file} wires reportBug`).toBeGreaterThan(-1);
  // Balance braces from the opening one so the block ends where it really ends.
  let depth = 0;
  for (let i = s.indexOf("{", at); i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(at, i + 1);
  }
  throw new Error(`${file}: unbalanced reportBug block`);
}

for (const file of shells) {
  test(`${file} files bug reports with diagnostics ON`, () => {
    // The inverse of what this asserted while #140 was open. Diagnostics are the URL, the
    // failed requests and the console errors — a report without them names a screen nobody
    // can find. They are on because the shell scrubs; the proof that it does is at the
    // bottom of this file, and if that fails this line is the one that becomes unsafe.
    expect(reportBugBlock(file)).toContain("diagnostics: true");
  });

  test(`${file} sends no household identifier as report context`, () => {
    // `context` values are sent VERBATIM — the shell's own doc comment says so. Whatever is
    // in this object is published, so it may only ever be facts about the page. Comments are
    // stripped first: the note explaining WHY this matters names the very routes it is about.
    const block = reportBugBlock(file).replace(/^\s*\/\/.*$/gm, "");
    // Named precisely: `labels:` is a legitimate key on the bot options and a bare "label"
    // substring would flag it, which is how a guard like this stops being read.
    for (const forbidden of [
      "childId", "child.id", "familyId", "family_id", "fam.id",
      ".address", ".label", "Token", "deviceToken", "state.child",
    ]) {
      expect(block, `${file} reportBug block mentions ${forbidden}`).not.toContain(forbidden);
    }
  });
}

test("the reports are filed against this repo, which is PUBLIC", () => {
  // Not a style point: it is why the scrub has to happen in the browser. If this ever became
  // a private tracker the trade-off in those comments would be a different one, and this test
  // is where the next reader trips over that.
  for (const file of shells) expect(reportBugBlock(file)).toContain('repo: "nimiq.kids"');
});

test("no shell claims the payload carries nothing about a child", () => {
  // The comment above `reportContext` used to assert "Nothing here identifies a child: no
  // name, no address, no family id" in a way that read as a claim about the whole payload,
  // and NEXT-SESSION.md repeated it. It was true of that object and false of what was sent,
  // which is precisely what stopped anyone looking. A claim like that must be scoped.
  for (const file of shells) {
    const s = source(file);
    expect(s).not.toContain("Nothing here identifies a child: no name, no address, no family id.");
    expect(s).not.toContain("the shell redacts address-shaped text client-side");
  }
});

test("the shell is pinned to a tag, not to a moving branch", () => {
  // The scrub lives in a dependency. Pinning at `#main` would mean a privacy guarantee this
  // app depends on could change without a commit here, and the behavioural tests below would
  // be measuring whatever main happened to be that morning.
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  expect(pkg.dependencies["nimiq-app-shell"]).toMatch(
    /^github:Andjroo111\/nimiq-app-shell#v\d+\.\d+\.\d+$/,
  );
});

// ---------------------------------------------------------------------------------------
// The behavioural proof: a real report, through the installed shell, to the wire.
// ---------------------------------------------------------------------------------------

const KID_UUID = "8f3c1d2e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";
const SIBLING_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const KID_ADDRESS = "NQ42 5D09 A7PK 0D4N GN9T 8V7M ES2J S8KL KC2T";
const BOT = "https://bot.nimiq.tech";

type Loose = Record<string, unknown>;
const g = globalThis as unknown as Loose;
const saved: Loose = {};
const had: Record<string, boolean> = {};
let realConsoleError: typeof console.error;

function stub(name: string, value: unknown): void {
  had[name] = name in g;
  saved[name] = g[name];
  g[name] = value;
}

/** The kid app as it really is when a parent opens the reporter: a child-scoped URL, an
 *  invite referrer, and a phone-sized viewport. Stubbed globals rather than a DOM harness —
 *  the shell reads these behind typeof guards precisely so it runs outside a browser, and
 *  this repo has no DOM harness by convention. */
function pretendBrowser(href: string, referrer: string): void {
  stub("location", { href });
  stub("document", { title: "Nimiq Kids", referrer });
  stub("navigator", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
    language: "en",
  });
  stub("window", {
    addEventListener: () => {},
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 3,
    // The capture wraps this. App code calls the global `fetch`, which in a browser IS
    // `window.fetch`, so driving the app's failing calls through here is the real path.
    fetch: async (input: string) =>
      new Response(JSON.stringify({ error: "already_owned" }), {
        status: input.includes("/buy") ? 400 : 500,
      }),
  });
}

beforeAll(async () => {
  pretendBrowser(
    `https://nimiq.kids/kid/${KID_UUID}/treasure?childId=${KID_UUID}&t=abc123`,
    `https://nimiq.life/apps?invite=${SIBLING_UUID}`,
  );

  // Silence first, THEN install: the capture binds whatever `console.error` is at install
  // time as its pass-through, so this keeps the fake errors out of the test output while
  // still exercising the real wrapper.
  realConsoleError = console.error;
  console.error = () => {};
  installReportCapture(BOT);

  // What actually lands in a report from this app, verbatim in shape.
  console.error(`[chart] no rows for kid ${KID_UUID} (address ${KID_ADDRESS})`);
  console.error(`[payout] cashlink mint failed for kid_${SIBLING_UUID}_v2 — retrying`);
  const w = g.window as { fetch: (u: string) => Promise<Response> };
  await w.fetch(`/api/kids/${KID_UUID}/buy`);
  await w.fetch(`/api/media?childId=${KID_UUID}`);
});

afterAll(() => {
  console.error = realConsoleError;
  for (const name of Object.keys(saved)) {
    if (had[name]) g[name] = saved[name];
    else delete g[name];
  }
});

test("a real kid-app report reaches the wire with no child UUID and no address", async () => {
  const wire: string[] = [];
  const realFetch = globalThis.fetch;
  // The issue service, stubbed — and stubbed HOSTILE on the second leg: the draft it hands
  // back quotes the UUID straight out of the report. That is exactly what an LLM writing an
  // issue body does, and it is a second chance to publish the thing, on a payload this app
  // never composed. `submitToBot` scrubs the draft too; this is where that gets proven.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    wire.push(String(init.body));
    const drafted = String(url).endsWith("/api/draft");
    return new Response(
      JSON.stringify(
        drafted
          ? {
              reportId: "r-1",
              draft: {
                title: `Treasure box refuses a purchase for kid ${KID_UUID}`,
                body: `The child at ${KID_ADDRESS} cannot buy.`,
                labels: ["bug"],
              },
            }
          : { number: 401, url: "https://github.com/Andjroo111/nimiq-kids/issues/401" },
      ),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  // Composed the way the sheet composes it when the diagnostics box is ticked
  // (openReportBugSheet: `input.pageContext = pageContext()` in bot mode).
  const input: FeedbackInput = {
    type: "bug",
    title: "Treasure box won't let her buy anything",
    description: "She taps the sticker pack and nothing happens.",
    context: { surface: "kid", version: "0.103.3" },
    pageContext: pageContext() as unknown as Record<string, unknown>,
  };

  try {
    const result = await submitToBot({ repo: "nimiq.kids" }, input);
    expect(result.ok).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
  }

  expect(wire.length, "both legs of the bot flow were exercised").toBe(2);
  const sent = wire.join("\n");

  // The whole point. Every identifier that was in the page, in the failed requests, in the
  // console errors, or in the service's own draft — gone from what would have been POSTed.
  expect(sent).not.toContain(KID_UUID);
  expect(sent).not.toContain(SIBLING_UUID);
  expect(sent).not.toContain(KID_ADDRESS);
  expect(sent).not.toContain(KID_ADDRESS.replace(/ /g, ""));
  // Belt and braces against a UUID this file did not think of: nothing 8-4-4-4-12 at all.
  expect(sent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  // Absence is cheap — a shell that sent an empty body would pass every line above. These
  // say the diagnostics genuinely travelled and were REDACTED rather than dropped, which is
  // the difference between this bump and the #140 workaround it replaces.
  expect(sent).toContain("[id redacted]");
  expect(sent).toContain("[address redacted]");
  expect(sent).toContain("/api/kids/[id redacted]/buy");
  expect(sent).toContain("400");
  expect(sent).toContain("[chart] no rows for kid [id redacted]");
  // A UUID inside a `kid_<uuid>_v2` key is the case a `\b` boundary would sail straight
  // past, because `_` is a word character. It is why the shell matches on hex neighbours.
  expect(sent).toContain("kid_[id redacted]_v2");
  // And the report is still a report: the person's own words survive untouched.
  expect(sent).toContain("She taps the sticker pack and nothing happens.");
  expect(sent).toContain("surface");

  // The page URL, field by field rather than by substring — this is the one the kiosk
  // wrapper can stuff a child id into twice over, once in the path and once in the query.
  const ctx = (JSON.parse(wire[0]) as { context: Record<string, unknown> }).context as {
    url: string; referrer: string; networkFailures: string[];
  };
  // Path: redacted. Query and fragment: gone before the scrubber ever saw them.
  expect(ctx.url).toBe("https://nimiq.kids/kid/[id redacted]/treasure");
  expect(ctx.url).not.toContain("?");
  expect(sent).not.toContain("t=abc123");
  // The referrer is cut the same way — an invite link is a child id in someone else's query.
  expect(ctx.referrer).toBe("https://nimiq.life/apps");

  // Known, and deliberately pinned rather than left to be discovered: a FAILED REQUEST keeps
  // its own `pathname + search`, so a query KEY survives even though the value is redacted.
  // That is the right trade — "which endpoint 500'd, with which parameters" is most of a bug
  // report — but it means the rule for this repo is that a query string may carry ids, which
  // the scrub handles, and never a secret, which it cannot. Keep tokens out of URLs.
  expect(ctx.networkFailures.join("\n")).toContain("/api/media?childId=[id redacted] → 500");
});

test("a parent-app report is scrubbed the same way, the service's draft included", async () => {
  // Same shell, same path, the surface that carries the MOST child ids: every board, chart
  // and approval screen in the parent app is addressed by one. Run separately so a scrub
  // that somehow only worked on the first submission of a session cannot hide here.
  const wire: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    wire.push(String(init.body));
    return new Response(
      JSON.stringify(
        String(url).endsWith("/api/draft")
          ? {
              reportId: "r-2",
              draft: { title: `Approval stuck for ${SIBLING_UUID}`, body: "No detail.", labels: [] },
            }
          : { number: 402, url: "https://github.com/Andjroo111/nimiq-kids/issues/402" },
      ),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const input: FeedbackInput = {
    type: "bug",
    title: "Approving a job does nothing",
    description: `Nothing happens when I approve. Console said kid ${SIBLING_UUID} is unknown.`,
    context: { surface: "parent", version: "0.103.3" },
    pageContext: pageContext() as unknown as Record<string, unknown>,
  };

  try {
    expect((await submitToBot({ repo: "nimiq.kids" }, input)).ok).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
  }

  const sent = wire.join("\n");
  // Including the one the PARENT typed into the description by hand, which is the only place
  // a UUID can enter a report without any of our code putting it there.
  expect(sent).not.toContain(SIBLING_UUID);
  expect(sent).not.toContain(KID_UUID);
  expect(sent).toContain("Console said kid [id redacted] is unknown.");
});
