import { chromium, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir("handoff-recording",{recursive:true});
const results=[];
for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]) {
 const browser=await engine.launch();
 for(const width of [320,375,390,414]) {
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:"no-preference"});
  const page=await context.newPage();
  await page.goto("http://127.0.0.1:4321/",{waitUntil:"networkidle"});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
  const data=await page.evaluate(()=>{
   const button=document.querySelector('[data-pinned-contact] a');const slot=document.querySelector('[data-closing-button]');
   const dockY=scrollY+slot.getBoundingClientRect().top-button.getBoundingClientRect().top;
   const results=[];
   for(const delta of [-400,200,-100,300,-8,8,-300]){
    scrollTo(0,dockY+delta);
    const a=button.getBoundingClientRect();const f=slot.getBoundingClientRect();
    results.push({delta,scrollY,innerHeight,trackHeight:document.querySelector('[data-contact-track]').getBoundingClientRect().height,trackTop:document.querySelector('[data-contact-track]').getBoundingClientRect().top,box:document.querySelector('[data-pinned-contact]').getBoundingClientRect().toJSON(),slot:f.toJSON(),top:a.top,target:Math.min(f.top,innerHeight-16-a.height),error:a.top-Math.min(f.top,innerHeight-16-a.height)});
    const end=performance.now()+35;while(performance.now()<end){} // no scroll callback may run
   }
   return results;
  });
  results.push({engine:name,width,geometry:data});
  await writeFile('handoff-recording/rapid-geometry.json',JSON.stringify(results,null,2));
  console.log(`${name} ${width}: ${JSON.stringify(data)}`);
  await context.close();
 }
 await browser.close();
}
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:"no-preference",recordVideo:{dir:"handoff-recording",size:{width:390,height:844}}});
const page=await context.newPage();const opened=Date.now();
await page.goto('http://127.0.0.1:4321/',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
const y=await page.locator('.compact-footer').evaluate(e=>e.getBoundingClientRect().top+scrollY);
await page.evaluate(y=>scrollTo(0,y-950),y);await page.waitForTimeout(500);const start=(Date.now()-opened)/1000;
await page.waitForTimeout(700);
for (const direction of [1,-1,1,-1,1]) {
 for(let i=0;i<5;i++){await page.mouse.wheel(0,direction*100);await page.waitForTimeout(35);}
 await page.waitForTimeout(600);
}
await page.screenshot({path:'handoff-recording/footer.png'});const duration=(Date.now()-opened)/1000-start;
const video=page.video();await context.close();await video.saveAs('handoff-recording/contact-handoff-original.webm');await browser.close();
await writeFile('handoff-recording/timing.json',JSON.stringify({start,duration}));
await writeFile('handoff-recording/README.txt','Real Chromium mobile-viewport recording of PR352 native sticky fast-scroll candidate. Rapid down/up wheel gestures. Separate Chromium and WebKit same-task large-jump tests block main thread between jumps, no JS positioning callback can catch up. Not a physical iPhone recording. Loading lead-in only may be trimmed.');
