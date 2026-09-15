import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { initDb } from "./db";
import { envMs, NETWORK, SIM } from "./nimiq/client";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { kidSwitchRoutes } from "./routes/kid-switch";
import { chores } from "./routes/chores";
import { cashlinks } from "./routes/cashlinks";
import { routinesRoutes } from "./routes/routines";
import { approvalsRoutes } from "./routes/approvals";
import { starsRoutes } from "./routes/stars";
import { mediaRoutes } from "./routes/media";
import { prefsRoutes } from "./routes/prefs";
import { parentRoutes } from "./routes/parent";
import { lockRoutes } from "./routes/lock";
import { progressRoutes } from "./routes/progress";
import { walletRoutes } from "./routes/wallet";
import { stickersRoutes } from "./routes/stickers";
import { practicesRoutes } from "./routes/practices";
import { goalsRoutes } from "./routes/goals";
import { savingsRoutes } from "./routes/savings";
import { storeRoutes } from "./routes/store";
import { invitesRoutes, inviteLanding } from "./routes/invites";
import { securityHeaders } from "./security-headers";
import { cacheBusting } from "./serve-cache";
import { compressText } from "./serve-compress";
import { rootRedirectWhenLegacyClosed } from "./root-redirect";
import { onboardRoutes } from "./routes/onboard";
import { memberRoutes } from "./routes/members";
import { kidAddressRoutes } from "./routes/kid-address";
import { kidCharacterRoutes } from "./routes/kid-character";
import { payoutRoutes } from "./routes/payouts";
import { custodyMode, formatBootReport, parentCustodyBootReport } from "./custody-boot";
import { listDerivedKidAccounts, hotWalletSnapshotLuna as wrepoHotWalletSnapshotLuna } from "./repo-wallet";
import { demoLanding, demoRoutes, demoSeedEnabled } from "./routes/demo";
import { healthRoutes } from "./routes/health";
import { DEMO_TTL_MS, seedHistoryLunaAt, seedHistoryUsd, sweepDemoFamilies } from "./demo-family";
import { nimUsd } from "./rates";
import { demoGrantLuna } from "./repo-budget";
import { sweepPendingEarns } from "./wallet/kid-wallet";

/** How often in-flight chore payouts are reconciled against the chain. Albatross blocks land
 *  in about a second, so a minute is unhurried and costs one by-hash lookup per open payout. */
const EARN_SWEEP_MS = envMs("HATCH_EARN_SWEEP_MS", 60_000);
// version from package.json — a hand-bumped literal here went stale in 0.13.0
// and made a successful deploy look like a no-op from /health
import pkg from "../package.json";

initDb();

// ---- the parent-custody boot guard ----------------------------------------------------
//
// HATCH_CUSTODY=parent claims nobody on this machine can sign for a kid. Before the server
// answers a single request, go and check: no signing key in the environment, and every
// server-derived kid account read from the chain and proved empty. A non-zero balance or an
// unreadable one prints a worklist and REFUSES TO START.
//
// Top-level await, above the Hono app, on purpose. Bun starts listening when this module
// finishes evaluating, so anything that must happen before the first request has to block
// here. A fire-and-forget check (like primeHotWalletSnapshot below) would let the instance
// serve money endpoints for the seconds it took to fail.
//
// Unset HATCH_CUSTODY and nothing in this block runs at all — server custody is unchanged.
if (custodyMode() === "parent") {
  const report = await parentCustodyBootReport({
    listDerivedKids: listDerivedKidAccounts,
    getBalance: async (address: string) => {
      const { getClient } = await import("./nimiq/client");
      return (await getClient()).getBalance(address);
    },
    // A zero basic balance is not an empty account: a stake lives in the staking contract.
    // getStakeLuna answers null when the node has no staker RPC (which the live mainnet
    // endpoint does not), and the guard falls back to transaction history for its proof.
    getStakeLuna: async (address: string) => {
      const { getStakeLuna } = await import("./nimiq/chain-probe");
      return getStakeLuna(address);
    },
    getTxCount: async (address: string) => {
      const { getTxCount } = await import("./nimiq/chain-probe");
      return getTxCount(address);
    },
    // DEV_PARENT_PRIV is the hot wallet's only key and parent custody deletes it, so the
    // guard has to look at what that wallet was last holding before the door shuts.
    hotWalletSnapshotLuna: () => wrepoHotWalletSnapshotLuna(),
  });
  if (!report.ok) {
    console.error(formatBootReport(report));
    process.exit(1);
  }
  console.log(`[custody] parent custody armed · ${report.checkedEmpty} derived kid account(s) verified empty`);
}

const app = new Hono();

// FIRST, above every route. Hono matches in registration order, so an `app.use("/*")` placed
// down with the static handler applies only to what falls through to it — which is why the
// API answered with no security headers at all while the middleware "was installed". Every
// response gets these, static files and /api/* alike: the media route echoes the uploader's
// own declared MIME, so `nosniff` is doing real work there rather than being boilerplate.
app.use("/*", securityHeaders());

// /health moved to routes/health.ts so the endpoint every runbook here tells you to trust
// can be tested without booting this file (which opens the DB on import).
app.route("/", healthRoutes);

// Stable public link for the walkthrough video, submitted to the competition before
// the video existed. Repointing is an env change plus a restart, never a re-submit.
// Falls back to the portal so the link is never dead.
app.get("/video", (c) => c.redirect(process.env.VIDEO_URL || "/portal/", 302));

// API
app.route("/api", families);
app.route("/api", children);
app.route("/api", kidSwitchRoutes); // #123: the switch gate — a kid's secret picture on a shared tablet
app.route("/api", chores);
app.route("/api", cashlinks);
// Family mode: routines + approvals + stars + media + prefs + parent page.
app.route("/api", routinesRoutes);
app.route("/api", approvalsRoutes);
app.route("/api", starsRoutes);
app.route("/api", mediaRoutes);
app.route("/api", prefsRoutes);
app.route("/api", parentRoutes);
app.route("/api", lockRoutes); // Phase B: kiosk devices, lock state (+SSE), overrides
app.route("/api", progressRoutes); // #379: the parent's progress tracker
app.route("/api", walletRoutes); // V2: real kid accounts — wallet, send, staking, deposits, rates
app.route("/api", kidAddressRoutes); // Parent-owned kid addresses: chooseAddress + a signed binding proof
app.route("/api", kidCharacterRoutes); // #381: a kid picks their own character at first login
app.route("/api", payoutRoutes); // Parent-signed chore payouts: relay the bytes, verify every field first
app.route("/api", stickersRoutes); // V3: the sticker chart — chart feed, placements, inventory, photo stickers
app.route("/api", practicesRoutes); // Practices: weekly-target habits (piano, a workout) + their sessions
app.route("/api", goalsRoutes);     // Goals: a ladder a kid climbs, one priced rung at a time
app.route("/api", savingsRoutes);   // Savings: what a kid is saving for, and how close (a MIRROR)
app.route("/api", storeRoutes); // V3: the Treasure Box — data-driven categories, real-NIM buys
app.route("/api", invitesRoutes); // Mini-app port slice 1: invite-a-family referral attribution
app.route("/api", onboardRoutes); // Slice 2: self-serve create-your-family + pairing-code token handoff
app.route("/api", memberRoutes); // The household's grown-ups: roster, join codes, each one's own wallet
app.route("/api", demoRoutes); // Judge demo (HATCH_DEMO_SEED=1 only): one seeded family per visitor

// Public HTML landings (no auth) — registered before static so they win over the PWA.
app.route("/", inviteLanding);
app.route("/", demoLanding);

// ⚠️ gzip goes OUTERMOST, above cacheBusting: that middleware rewrites HTML bodies by
// reading them back as text, and a compressed body reads as noise. First registered is
// outermost in Hono, so this line must stay above the two below it.
app.use("/*", compressText());

// Force-revalidate the shell + serve-time version stamping so an installed PWA
// never runs stale code and a deploy busts every cache layer (src/serve-cache.ts).
// cacheBusting goes FIRST so it also wraps what rootRedirectWhenLegacyClosed returns:
// that middleware short-circuits "/" (it serves the marketing page rather than calling
// next), so registered the other way round the judge-facing landing page would be the
// one response on the site that never gets Cache-Control: no-cache.
app.use("/*", cacheBusting());
app.use("/*", rootRedirectWhenLegacyClosed);

// Static PWA (after API so /api/* wins)
//
// ⚠️ THE AUDIO MIME IS NOT OPTIONAL, AND ITS ABSENCE IS SILENT. Hono's MIME table has no
// entry for `.m4a`, so the hatch sounds went out as `application/octet-stream` — and this
// app sets `X-Content-Type-Options: nosniff` deliberately (see the header block above), so
// the browser is forbidden from guessing its way to the right answer. The egg hatched, the
// confetti fired and nothing played, with a 200 in the network tab and no console error.
// Anything audio we add later lands in the same hole, so the map is the fix rather than
// re-encoding to a format that happens to be in Hono's table.
app.use("/*", serveStatic({
  root: "./public",
  mimes: { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" },
}));

console.log(`nimiq.kids ${pkg.version} · network=${NETWORK} · mode=${SIM ? "DEMO (simulated payouts)" : "REAL settlement"}`);

// Judge-demo housekeeping: every visitor mints a throwaway household, so without a
// sweeper the table grows forever. Once at boot (a restart must not skip a day's worth)
// and hourly after. unref() so the timer never holds the process open.
if (demoSeedEnabled()) {
  // The sweep now moves money (it returns each abandoned household's NIM to the hot wallet
  // before forgetting it — see demo-reclaim.ts), so it is async and every branch below is
  // reported. A reclaim that never lands is the failure this logging exists to surface:
  // `held` says the sweeper is retrying, `abandoned` says it gave up and NIM was stranded.
  // Re-entrancy guard. The old sweep was synchronous DB work and could not overlap itself;
  // this one is two RPC round trips per kid, so a backlog of households can easily outrun the
  // hourly timer. Two concurrent sweeps would read the same balance twice and try to spend it
  // twice, and the second transaction is the one that fails — noisily, and for a reason that
  // looks like a chain fault rather than our own scheduling.
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) { console.log("[demo] sweep still running, skipping this tick"); return; }
    sweeping = true;
    try {
      const r = await sweepDemoFamilies();
      if (r.purged || r.held) {
        const nim = Math.round(r.reclaimedLuna / 100_000).toLocaleString();
        console.log(
          `[demo] swept ${r.purged} abandoned demo ${r.purged === 1 ? "family" : "families"}` +
          ` · reclaimed ${nim} NIM` +
          (r.held ? ` · ${r.held} held for retry` : "") +
          (r.abandoned ? ` · ${r.abandoned} ABANDONED with NIM still on them` : "") +
          (r.unpurgeable ? ` · ${r.unpurgeable} UNPURGEABLE (purgeFamily is missing a table)` : ""),
        );
      }
    } catch (err) {
      console.error("[demo] sweep failed:", err);
    } finally {
      sweeping = false;
    }
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
  console.log(`[demo] seeded per-visitor demo families ON · ttl=${Math.round(DEMO_TTL_MS / 3_600_000)}h`);

  // Say out loud whether this instance can afford its own demo.
  //
  // The seed is priced in DOLLARS (see demo-family.ts), so its cost in luna moves with the
  // market and is three orders of magnitude above the flat-NIM seed it replaced. The
  // history is paid by payKidEarn, which does not consult the budget, but its rows COUNT
  // as spent — so a grant that no longer clears the history leaves every minted family at
  // zero available and the first approval a judge tries dies with `budget_exhausted`.
  // Nothing in the mint response says so (paidHistory is still 4), which is exactly the
  // kind of silence that costs an afternoon. Fire-and-forget: a rate lookup must never
  // stand between the process and its listening socket.
  void (async () => {
    try {
      const needed = seedHistoryLunaAt(await nimUsd());
      const grant = demoGrantLuna();
      const nim = (luna: number) => Math.round(luna / 100_000).toLocaleString("en-US");
      if (grant < needed) {
        console.warn(
          `[demo] HATCH_DEMO_GRANT_LUNA=${grant} (${nim(grant)} NIM) is BELOW the seeded `
          + `history of ${nim(needed)} NIM ($${seedHistoryUsd().toFixed(2)}). Every demo family `
          + `will mint with no budget left and the first approval will fail with `
          + `budget_exhausted. Raise it to at least ${Math.ceil(needed * 2)}.`,
        );
      } else {
        console.log(`[demo] budget ok · grant ${nim(grant)} NIM covers the ${nim(needed)} NIM seeded history`);
      }
    } catch { /* a rate lookup that fails is not a boot failure */ }
  })();
}

/**
 * In-flight chore payouts reconcile HERE and nowhere else.
 *
 * This tick used to share the job with GET /kids/:id/wallet. It does not any more: a chain
 * read on a request path is a chain read a child is waiting for, and the reads that take
 * longest are the ones about payouts that did not land. The sweep is now the whole mechanism,
 * which also makes it independent of whether anyone is looking — a tablet left off no longer
 * leaves a payout pending with nobody told.
 *
 * unref() so the timer never holds the process open; no-op in SIM (no chain to ask).
 */
if (!SIM) {
  const sweepEarns = () => {
    sweepPendingEarns()
      .then((left) => { if (left) console.log(`[earn] ${left} ${left === 1 ? "child" : "children"} still hold an unsettled payout`); })
      .catch((err) => console.error("[earn] sweep failed:", err));
  };
  sweepEarns();
  setInterval(sweepEarns, EARN_SWEEP_MS).unref();
}

/**
 * Read the hot wallet once at boot, so the parent app has a number to show.
 *
 * `visibleFundsLuna` hands an EXEMPT family (the single-household install, the operator's
 * own) the raw chain snapshot, and that snapshot is only ever written by an explicit
 * deposit-check. Until one has run the parent app has nothing to render, so TOTAL BALANCE
 * and the Family wallet row both fell back to a dash — which is what every parent on a
 * fresh install saw the first time they opened the app, and it reads as "this screen did
 * not load" rather than "not checked yet" (#32).
 *
 * This used to run only on demo instances, which is why it never reached the households
 * it matters most to. It is safe everywhere for the same three reasons it was safe there:
 *
 *   - SIM returns immediately. That is the whole of the trap in #32 — on an instance
 *     whose chain read answers 0, writing the snapshot writes a ZERO, `payableLuna()`
 *     then returns 0, and every approval afterwards fails with `budget_exhausted`.
 *     A simulated instance has no chain to ask, so it must never write one.
 *   - A snapshot that already exists is left alone, so this never overwrites a real
 *     deposit-check.
 *   - A failed read writes NOTHING and leaves the value null. An unreachable node must
 *     not be recorded as an empty wallet.
 *
 * Off the request path by construction: it runs once, at boot, and nothing waits on it.
 */
async function primeHotWalletSnapshot(): Promise<void> {
  if (SIM) return;
  try {
    const { makeProvider } = await import("./wallet");
    const { getClient } = await import("./nimiq/client");
    const { getWalletState, setWalletState } = await import("./repo-wallet");
    const { HOT_BALANCE_KEY } = await import("./routes/wallet");
    if (getWalletState(HOT_BALANCE_KEY) !== null) return; // already tracked
    const balance = await (await getClient()).getBalance(await makeProvider().getAddress());
    setWalletState(HOT_BALANCE_KEY, String(balance));
    console.log(`[wallet] hot wallet snapshot primed at ${balance} luna`);
  } catch (err) {
    console.error("[wallet] could not prime the hot wallet snapshot:", err);
  }
}

primeHotWalletSnapshot();
// Warm the price cache the same way, and for a sharper reason: sync readers cannot fetch,
// so an unwarmed cache means every dollar-denominated figure this process reports is
// computed at the static fallback. Best-effort, off the request path, nothing waits on it.
import("./rates").then((m) => m.primeRates()).catch(() => undefined);

// LAN HTTPS for the kiosk tablet (getUserMedia + service workers require a secure
// context). TLS_CERT/TLS_KEY point at mkcert-issued files; absent = plain HTTP
// (dev/demo/tests unchanged). The Cloudflare tunnel origin sets noTLSVerify.
const tls = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: Bun.file(process.env.TLS_CERT), key: Bun.file(process.env.TLS_KEY) }
  : undefined;

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
  ...(tls ? { tls } : {}),
};
