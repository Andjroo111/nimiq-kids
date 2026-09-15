import { chromium } from "/Users/USERNAME/projects/nimiq.software/node_modules/playwright/index.js";

const URL_ = "https://kids-dev.internal/sounds/voice.html";

const browser = await chromium.launch({ channel: "chrome" });
// Phone viewport + a real tap, matching how Andjroo will actually open this.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

const errors: string[] = [];
const failed: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));

const audioStatus: number[] = [];
page.on("response", (r) => {
  if (r.url().includes("/clips/")) audioStatus.push(r.status());
});

await page.goto(URL_, { waitUntil: "load", timeout: 45000 });
const clips = await page.locator("button.clip").count();

// Tap the first clip and watch whether playback actually advances.
await page.locator("button.clip").first().click();
await page.waitForTimeout(1400);

const result = await page.evaluate(() => {
  const a = document.querySelector("audio") as HTMLAudioElement | null;
  // The page uses a single JS-created Audio element, so reach it via a probe instead.
  return (window as any).__probe ?? null;
});

// Probe the shared element directly.
const played = await page.evaluate(async () => {
  const el = new Audio(
    document.querySelector("button.clip")!.getAttribute("data-src")!,
  );
  return await new Promise<string>((res) => {
    el.addEventListener("loadedmetadata", () => {
      el.play().then(() => {
        setTimeout(() => {
          res(`played=${el.currentTime > 0.05} currentTime=${el.currentTime.toFixed(2)} dur=${el.duration.toFixed(2)}`);
        }, 900);
      }).catch((e) => res(`play() rejected: ${e.name}`));
    });
    el.addEventListener("error", () => res(`load error code=${el.error?.code}`));
    setTimeout(() => res("timeout"), 8000);
  });
});

const highlighted = await page.locator("button.clip.on").count();

console.log(`url            : ${URL_}`);
console.log(`clips rendered : ${clips}`);
console.log(`audio requests : ${audioStatus.length} -> [${[...new Set(audioStatus)].join(",")}]`);
console.log(`playback       : ${played}`);
console.log(`tap highlight  : ${highlighted === 1 ? "ok" : `${highlighted} highlighted`}`);
console.log(`failed reqs    : ${failed.length ? failed.join(" | ") : "none"}`);
console.log(`console errors : ${errors.length ? errors.join(" | ") : "none"}`);

await page.screenshot({
  path: "/Users/USERNAME/data/automation/nimiq-kids-sounds/shots/live-390.png",
});
await browser.close();
