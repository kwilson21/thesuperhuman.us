import { chromium } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
await mkdir("handoff-recording", {recursive:true});
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:"no-preference",recordVideo:{dir:"handoff-recording",size:{width:390,height:844}}});
const page=await context.newPage();
const opened=Date.now();
await page.goto("http://127.0.0.1:4321/",{waitUntil:"networkidle"});
await page.evaluate(()=>document.fonts.ready);
const footer=page.locator(".compact-footer");
const footerY=await footer.evaluate(e=>e.getBoundingClientRect().top+scrollY);
await page.evaluate(y=>scrollTo(0,y),footerY-950);
await page.waitForTimeout(600);
const start=(Date.now()-opened)/1000;
await page.waitForTimeout(1300);
for(let i=0;i<25;i++){await page.mouse.wheel(0,20);await page.waitForTimeout(70);}
await page.waitForTimeout(1300);
assert.equal(await page.locator("[data-pinned-contact]").getAttribute("data-docked"),"");
await page.screenshot({path:"handoff-recording/footer.png"});
for(let i=0;i<25;i++){await page.mouse.wheel(0,-20);await page.waitForTimeout(70);}
await page.waitForTimeout(1300);
assert.equal(await page.locator("[data-pinned-contact]").getAttribute("data-docked"),null);
await page.screenshot({path:"handoff-recording/pinned.png"});
for(let i=0;i<25;i++){await page.mouse.wheel(0,20);await page.waitForTimeout(70);}
await page.waitForTimeout(1500);
const end=(Date.now()-opened)/1000;
const video=page.video();
await context.close();
await video.saveAs("handoff-recording/contact-handoff-original.webm");
await browser.close();
await writeFile("handoff-recording/timing.json",JSON.stringify({start,duration:end-start}));
await writeFile("handoff-recording/README.txt","Real Chromium recording of PR351 continuous docking application code (same source as the pending PR351 revision). 390x844, normal motion. Local fixture preview, not production. Scroll down into footer, back up, then down again. No application code modified. Trimmed navigation/loading lead-in only.\n");
