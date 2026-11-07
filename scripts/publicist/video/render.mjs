#!/usr/bin/env node
// Checks and renders a publicist video scene page (docs/publicist/video-standard.md).
//
//   node scripts/publicist/video/render.mjs <scene.html> [out.mp4] [--size 1920x1080] [--fps 30]
//   node scripts/publicist/video/render.mjs <scene.html> --check
//   node scripts/publicist/video/render.mjs <scene.html> --stills 1.5,9,20 [--out-dir dir]
//
// The page builds its scenes with window.VideoKit.run (kit.js), which this script
// injects together with kit.css and the site's Libron font. Rendering runs the
// understandability check first and stops if it fails; stills skip the check so a
// draft can be looked at. Writes an H.264 mp4 with no audio. Needs ffmpeg.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fonts = resolve(here, '../../../public/fonts/libron-v0.25');

// The standard's limits. Change them in the doc and here together.
export const LIMITS = {
  headlineWords: 7, // the takeaway, read on its own during the lead
  sceneWords: 14, // everything visible in a finished scene, headline included
  minLead: 0.5, // headline alone before anything else moves
  minHold: 2, // the finished frame held still
  secondsPerWord: 0.3, // hold at least this per visible word, when that is longer than minHold
  safeMargin: 24, // text keeps this far from the frame's edges
};

// How long a finished frame with this many words on screen must hold still.
export const requiredHold = (words) => Math.max(LIMITS.minHold, LIMITS.secondsPerWord * words);

function args(argv) {
  const o = { size: '1920x1080', fps: 30 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--stills') o.stills = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--size') o.size = argv[++i];
    else if (a === '--fps') o.fps = Number(argv[++i]);
    else rest.push(a);
  }
  [o.scene, o.out] = rest;
  const [w, h] = o.size.split('x').map(Number);
  return { ...o, w, h };
}

const fontCss = ['Regular', 'Bold'].map((wt, i) => `@font-face{font-family:Libron;font-weight:${i ? 700 : 400};src:url('${pathToFileURL(join(fonts, `Libron-${wt}.woff2`)).href}')}`).join('');
const injectCss = fontCss + readFileSync(join(here, 'kit.css'), 'utf8');

export async function openScene(file, { w, h }) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript({ path: join(here, 'kit.js') });
  await page.addInitScript((css) => {
    const add = () => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).prepend(s); };
    if (document.documentElement) add(); else new MutationObserver((_, ob) => { if (document.documentElement) { ob.disconnect(); add(); } }).observe(document, { childList: true });
  }, injectCss);
  await page.goto(pathToFileURL(resolve(file)).href);
  await page.evaluate(async () => { await document.fonts.load('700 84px Libron'); await document.fonts.ready; });
  const video = await page.evaluate(() => window.VIDEO);
  if (!video) { await browser.close(); throw new Error('The page did not call VideoKit.run({ plan, draw }), so there is no window.VIDEO.'); }
  return { browser, page, video };
}

// Everything the viewer can read at time t, in the scene or around it (the corner tag
// counts too): words, and where text sits. inScene marks the current scene's own text.
function readScene(sceneId) {
  const scene = document.getElementById(sceneId);
  const visible = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= Number(cs.opacity); } return o; };
  const items = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent.trim();
    if (!text || n.parentElement.closest('script, style')) continue;
    const o = visible(n.parentElement);
    if (o < 0.05) continue;
    const inScene = !!scene && scene.contains(n);
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1).map((x) => ({ l: x.left, t: x.top, r: x.right, b: x.bottom }));
    items.push({ text, o, words: text.split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length, headline: inScene && !!n.parentElement.closest('[data-role="headline"]'), inScene, rects });
  }
  const headlines = scene ? scene.querySelectorAll('[data-role="headline"]').length : 0;
  return { found: !!scene, headlines, items, fontOk: document.fonts.check('700 84px Libron') };
}

export async function check(page, video, { w, h, fps = 30 }) {
  const problems = [];
  const say = (s, msg) => problems.push(`${s.id}: ${msg}`);
  for (const s of video.plan) {
    if (s.hold < LIMITS.minHold) say(s, `holds ${s.hold}s; hold the finished frame at least ${LIMITS.minHold}s`);
    // the headline must be readable on its own before any other text appears
    let headAt = null, otherAt = null, found = true, fontOk = true, headlines = 0;
    // frame by frame, so a lead shorter than minLead can't round up to it
    const step = 1 / fps;
    for (let k = 0, t = s.start; t < s.end && otherAt === null; k++, t = s.start + k * step) {
      await page.evaluate((x) => window.render(x), t);
      const r = await page.evaluate(readScene, s.id);
      if (!r.found) { found = false; break; }
      fontOk = r.fontOk; headlines = r.headlines;
      if (headAt === null && r.items.some((x) => x.headline && x.o >= 0.6)) headAt = t;
      if (r.items.some((x) => x.inScene && !x.headline)) otherAt = t;
    }
    if (!found) { say(s, 'no element with this id'); continue; }
    if (!fontOk) say(s, 'Libron did not load');
    if (headlines !== 1) say(s, headlines ? `${headlines} headlines; a scene has one takeaway` : 'no headline (data-role="headline"); every scene states its takeaway');
    else if (headAt === null) say(s, otherAt === null ? 'the headline never becomes readable' : 'other text appears before the headline is readable; show the headline alone first');
    else if (otherAt !== null && otherAt - headAt < LIMITS.minLead - 1e-6) say(s, `other text appears ${(otherAt - headAt).toFixed(1)}s after the headline; show the headline alone for at least ${LIMITS.minLead}s first`);
    // the finished frame
    await page.evaluate((t) => window.render(t), s.end - 0.05);
    const fin = await page.evaluate(readScene, s.id);
    const words = fin.items.reduce((n, x) => n + x.words, 0);
    const hw = fin.items.filter((x) => x.headline).reduce((n, x) => n + x.words, 0);
    if (hw > LIMITS.headlineWords) say(s, `headline has ${hw} words; keep it to ${LIMITS.headlineWords}`);
    if (words > LIMITS.sceneWords) say(s, `${words} words on screen; keep a scene to ${LIMITS.sceneWords}`);
    const needHold = requiredHold(words);
    if (s.hold + 1e-9 < needHold) say(s, `${words} words on screen need a ${needHold.toFixed(1)}s hold; it has ${s.hold}s`);
    const m = LIMITS.safeMargin;
    for (const x of fin.items) for (const r of x.rects) if (r.l < m || r.t < m || r.r > w - m || r.b > h - m) { say(s, `"${x.text}" runs outside the frame's safe area`); break; }
    for (let i = 0; i < fin.items.length; i++) for (let j = i + 1; j < fin.items.length; j++) {
      const hit = fin.items[i].rects.some((a) => fin.items[j].rects.some((b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2));
      if (hit) say(s, `"${fin.items[i].text}" overlaps "${fin.items[j].text}"`);
    }
  }
  return problems;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.scene) { console.log('Usage: node scripts/publicist/video/render.mjs <scene.html> [out.mp4] [--check] [--stills t1,t2] [--size 1920x1080] [--fps 30]'); process.exit(1); }
  const { browser, page, video } = await openScene(o.scene, o);
  try {
    if (o.stills) {
      const dir = resolve(o.outDir || '.');
      for (const t of o.stills.split(',')) { await page.evaluate((x) => window.render(x), Number(t)); const f = join(dir, `${basename(o.scene, '.html')}-${t}.png`); await page.screenshot({ path: f }); console.log(f); }
      return;
    }
    const problems = await check(page, video, o);
    console.log(`${video.plan.length} scenes, ${video.total.toFixed(1)}s`);
    if (problems.length) { console.error(`Not ready (${problems.length}):\n- ${problems.join('\n- ')}`); process.exitCode = 1; return; }
    console.log('Check passed.');
    if (o.check) return;
    const out = resolve(o.out || `${basename(o.scene, '.html')}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(o.fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    let failed = null;
    const done = new Promise((r, j) => {
      ff.on('error', (e) => { failed = new Error(`ffmpeg could not start: ${e.message}`); j(failed); });
      ff.on('close', (c) => { if (c) { failed = failed || new Error(`ffmpeg exited ${c}`); j(failed); } else r(); });
    });
    done.catch(() => {});
    ff.stdin.on('error', (e) => { failed = failed || new Error(`ffmpeg input closed: ${e.message}`); });
    const n = Math.round(video.total * o.fps);
    for (let i = 0; i < n && !failed; i++) {
      await page.evaluate((x) => window.render(x), i / o.fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), done.catch(() => {})]);
    }
    if (failed) throw failed;
    ff.stdin.end();
    await done;
    console.log(`${out} · ${n} frames`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
