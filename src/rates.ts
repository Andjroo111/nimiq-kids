// What a NIM is worth, and the conversions that depend on it.
//
// Lives outside the routes because it is not a route's business: the wallet
// prices its payout ceiling here too, and a repo/service importing a route
// would be backwards.
//
// Live prices come from CoinGecko (coin id "nimiq-2"), the same source the
// Nimiq wallet's own FiatApi uses. 10-minute cache; on any failure the last
// good answer, or the static rate, keeps everything working.

/** Static fallback rate (env HATCH_NIM_USD, default 0.002) — used before the
 *  first successful fetch, and whenever the network is unavailable. */
export const NIM_USD = Number(process.env.HATCH_NIM_USD ?? 0.002);

export const LUNA = 100_000;

const RATE_TICKERS = [
  "usd", "eur", "gbp", "mxn", "brl", "cny", "inr",
  "jpy", "chf", "cad", "aud", "krw", "try", "vnd",
];

let ratesCache: { at: number; nim: Record<string, number> } | null = null;

export async function nimRates(): Promise<Record<string, number>> {
  // tests never touch the network — they get the static rate
  if (process.env.NODE_ENV === "test") return { usd: NIM_USD };
  if (ratesCache && Date.now() - ratesCache.at < 10 * 60_000) return ratesCache.nim;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=${RATE_TICKERS.join(",")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as Record<string, Record<string, number>>;
    const nim = json["nimiq-2"];
    if (nim && typeof nim.usd === "number") {
      ratesCache = { at: Date.now(), nim };
      return nim;
    }
  } catch {
    /* fall through to the last good answer */
  }
  return ratesCache?.nim ?? { usd: NIM_USD };
}

/** The live USD rate, guarded. A price of 0, a negative, or a NaN would make
 *  every conversion below explode (or silently produce an infinite payout
 *  ceiling), so a rate that isn't a sane positive number falls back to the
 *  static one rather than propagating. */
export async function nimUsd(): Promise<number> {
  const rate = (await nimRates()).usd;
  return Number.isFinite(rate) && rate > 0 ? rate : NIM_USD;
}

/**
 * Dollars -> a WHOLE number of NIM, in luna.
 *
 * Rewards are agreed in dollars ("this chore is worth $2") but paid and shown in
 * NIM, and a kid should see 4,317 NIM, never 0.1 NIM or 4,317.28 NIM. So the
 * conversion rounds to a whole coin at the moment the reward is created, and the
 * NIM figure is then FIXED — it is what was agreed. Its dollar value floats
 * afterwards, which is simply what owning a coin means.
 */
export function usdToWholeNimLuna(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : NIM_USD;
  return Math.max(1, Math.round(usd / safeRate)) * LUNA;
}

/**
 * The last known rate WITHOUT awaiting a fetch.
 *
 * For the one caller that cannot be async: the payout budget. `demoGrantLuna()` is read
 * inside `budgetView`/`checkSpend`, which are sync and called from the middle of an
 * approval, so making them async to look up a price would ripple through every money
 * route for a number that moves by the hour.
 *
 * A stale rate is the right trade here. This bounds a grant, not a payment: being a few
 * minutes behind moves a family's ceiling by pennies, and the ceiling is re-read on every
 * call anyway. Falls back to the static rate before the first successful fetch, which is
 * also what tests see (`nimRates` short-circuits on NODE_ENV=test and never fills the
 * cache), so a dollar-denominated grant is deterministic under test.
 */
export function nimUsdCached(): number {
  const rate = ratesCache?.nim.usd;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : NIM_USD;
}

/**
 * Has a real price ever been fetched in this process?
 *
 * Because the fallback is not a slightly-stale rate, it is a DIFFERENT rate: the static
 * $0.002 is roughly 4x the live price, so anything priced in dollars resolves to about a
 * quarter of the NIM it really costs. A caller that reports a number computed this way
 * without saying so publishes a confident wrong answer — which is exactly how /health came
 * to report `covers: true` about a starter board the grant does not cover.
 *
 * So callers that PUBLISH a converted figure have to be able to say which rate they used.
 * Callers that merely bound something (the payout budget) do not care: an approximate
 * ceiling is the point.
 */
export function hasLiveRate(): boolean {
  const rate = ratesCache?.nim.usd;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** Fill the cache once, best-effort, so a sync reader is not stuck on the static rate.
 *  Never throws and nothing waits on it: same contract as primeHotWalletSnapshot. */
export async function primeRates(): Promise<void> {
  await nimRates().catch(() => undefined);
}

/** What a luna amount is worth today. */
export function lunaToUsd(luna: number, rate: number): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : NIM_USD;
  return (luna / LUNA) * safeRate;
}
