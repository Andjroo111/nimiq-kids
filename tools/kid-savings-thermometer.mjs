// The savings thermometer on the kid's money screen (#355). Drives a real browser through
// tools/kid-drive.mjs, because the assertion that matters is a PICTURE: the fill has to be
// partway up at a partway balance, and the number beside it has to be "NIM to go" and never a
// percentage. A six year old does not read 62%.
//
//   BASE=http://127.0.0.1:3994 node kid-savings-thermometer.mjs
//
// Copy alongside kid-drive.mjs into a directory that has playwright (~/Projects/sendhome).
import { demoHousehold, openKidBoard } from "./kid-drive.mjs";
const B = process.env.BASE ?? "http://127.0.0.1:3994";
const { chromium } = await import("playwright");
const fs = await import("node:fs"); fs.mkdirSync("/tmp/th", { recursive: true });
const api = async (p,o={},t)=>(await fetch(B+p,{...o,headers:{"content-type":"application/json",...(t?{Authorization:`Bearer ${t}`}:{}),...(o.headers||{})}})).json();
let failed=false; const check=(n,ok,d="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${d?` -- ${d}`:""}`);if(!ok)failed=true;};
const home = await demoHousehold(B); const kid = home.children[0];
const bal = (await api(`/api/kids/${kid.id}/wallet`,{},home.parentToken)).balanceLuna;
console.log(`   kid balance ${bal} luna`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
const page = await openKidBoard(ctx,{base:B,deviceToken:home.deviceToken,child:kid});
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.locator("#dock-money, [id*=money]").first().click().catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
check("empty state is on the money screen", (await page.locator(".k-th-empty").count())>0);
await page.screenshot({path:"/tmp/th/1-empty.png"});

// set a target the kid is PART way to, so the fill is mid
await api(`/api/kids/${kid.id}/savings`,{method:"POST",body:JSON.stringify({title:"A bike",targetLuna:Math.round(bal*2),emoji:"🚲"})},home.parentToken);
await page.reload({waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,3000));
await page.locator("#dock-money, [id*=money]").first().click().catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
check("the thermometer is drawn", (await page.locator(".k-th-svg").count())>0);
const togo=(await page.locator(".k-th-togo").first().textContent().catch(()=>"")).trim();
check("it says NIM to go, not a percentage", /NIM to go/.test(togo) && !/%/.test(togo), togo);
const fill=await page.locator(".k-th-fill").first().evaluate(e=>e.getBoundingClientRect().height).catch(()=>0);
check("the fill is partly up, not empty and not full", fill>4 && fill<58, `${Math.round(fill)}px of ~60`);
check("no page errors", errs.length===0, errs.join(" | "));
await page.screenshot({path:"/tmp/th/2-half.png"});
await b.close();
console.log(failed?"\nFAILED":"\nAll checks passed");
process.exit(failed?1:0);
