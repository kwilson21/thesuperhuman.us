#!/usr/bin/env node
// Render the link-preview scenes in scripts/og-video/scenes/ to a poster PNG and a looping MP4 each.
//
//   node scripts/og-video/render.mjs                 every scene
//   node scripts/og-video/render.mjs home services   only these scenes
//   node scripts/og-video/render.mjs --sheet home    contact sheet of frames for review; writes nothing to public/
//   node scripts/og-video/render.mjs --sheet --at=0,1500 home   also saves those moments (ms) at full size
//
// A scene is a 1200×630 HTML page whose <html> carries data-duration (ms). All motion must be CSS
// animations or Web Animations: the renderer pauses every animation and steps currentTime frame by
// frame, so frames and posters come out the same on every run. MP4 bytes also depend on the ffmpeg
// build and the CPU, so a scene whose frames have not changed keeps its committed, reviewed video.
// Frame 0 is the poster: a PNG, or a JPEG when <html> carries data-poster="jpeg" (photographs,
// which PNG cannot keep under the size limit). The frame at data-duration must match frame 0, so
// the clip loops without a jump.
//
// Each manifest entry records the local files the scene loaded and a hash of them, so a test can
// tell when a scene, the kit or an image changed without a new render.
//
// Needs ffmpeg with libx264. Set CHROMIUM_PATH when Playwright's bundled Chromium is unavailable.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENES = join(ROOT, 'scripts/og-video/scenes');
const PUBLIC = join(ROOT, 'public/og');
const RAW = join(PUBLIC, 'raw');
const MANIFEST = join(ROOT, 'src/data/og-media.json');
const SHEETS = join(ROOT, '.og-video');
const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;
const FPS = 30;
// Messages allows 10 MB for the whole preview; Discord measures the file within a 10 s budget.
const MAX_VIDEO_BYTES = 2.5 * 1024 * 1024;
// WhatsApp documents 600 KB as its og:image ceiling.
const MAX_POSTER_BYTES = 600 * 1024;
const ENCODE = [
  '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
  '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
  // Scenes are flat colour and type: tune for animation, and spend more bits on flat areas so the
  // paper and soft artwork masks do not band in predicted frames. x264's output depends on its
  // thread count, so pin it rather than let it follow the CPU count.
  '-c:v', 'libx264', '-threads', '6', '-preset', 'slow', '-tune', 'animation', '-x264-params', 'aq-mode=3', '-crf', '20', '-maxrate', '3M', '-bufsize', '6M',
  '-profile:v', 'high', '-g', String(FPS * 2),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-movflags', '+faststart',
];

const args = process.argv.slice(2);
const sheetOnly = args.includes('--sheet');
const moments = (args.find(arg => arg.startsWith('--at='))?.slice(5).split(',') ?? []).filter(Boolean).map(Number);
if (moments.some(time => !Number.isFinite(time) || time < 0)) fail('--at takes milliseconds, for example --at=0,1500,3000');
const requested = args.filter(arg => !arg.startsWith('--'));
const available = readdirSync(SCENES).filter(name => name.endsWith('.html')).map(name => basename(name, '.html')).sort();
const unknown = requested.filter(key => !available.includes(key));
if (unknown.length) fail(`Unknown scene: ${unknown.join(', ')}. Scenes: ${available.join(', ')}`);
const keys = requested.length ? requested : available;
if (!spawnSync('ffmpeg', ['-version']).stdout?.length) fail('ffmpeg is required.');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const manifest = readManifest();
const problems = [];
try {
  const queue = [...keys];
  const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
      try {
        const result = await renderScene(key);
        if (result) manifest[key] = result;
      } catch (error) {
        problems.push(`${key}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, keys.length) }, worker));
} finally {
  await browser.close();
  // Scenes that finished have already replaced their files, so record them even if others failed.
  if (!sheetOnly) writeManifest(manifest);
}
if (problems.length) fail(problems.join('\n'));

async function renderScene(key) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
  const errors = [];
  const inputs = new Set();
  page.on('requestfinished', request => { if (request.url().startsWith('file:')) inputs.add(relative(ROOT, fileURLToPath(request.url()))); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.url()} failed to load`));
  await page.goto(pathToFileURL(join(SCENES, `${key}.html`)).href, { waitUntil: 'load' });
  const setup = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => { throw new Error(`${image.src} did not decode`); })));
    // Only elements that draw text need their font; a wrapper's inherited family may never load.
    const texts = [...document.querySelectorAll('body *')].filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
    const families = [...new Set(texts.map(element => getComputedStyle(element).fontFamily.split(',')[0].trim().replace(/["']/g, '')))];
    const missing = families.filter(family => !document.fonts.check(`16px "${family}"`) || ![...document.fonts].some(face => face.family.replace(/["']/g, '') === family && face.status === 'loaded'));
    const animations = document.getAnimations();
    for (const animation of animations) animation.pause();
    const root = document.documentElement;
    // A line that may not wrap must fit its own box, or it runs into its neighbour unseen.
    const cramped = texts.filter(element => getComputedStyle(element).whiteSpace === 'nowrap' && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map(element => element.textContent.trim().slice(0, 40));
    return {
      duration: Number(root.dataset.duration),
      poster: root.dataset.poster === 'jpeg' ? 'jpeg' : 'png',
      animations: animations.length,
      missing,
      cramped,
      overflow: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight,
    };
  });
  let failed = false;
  const problem = message => { problems.push(`${key}: ${message}`); failed = true; };
  if (errors.length) problem(errors.join('; '));
  if (setup.missing.length) problem(`fonts not loaded: ${setup.missing.join(', ')}`);
  if (setup.overflow) problem('content overflows the 1200×630 frame');
  if (setup.cramped.length) problem(`text wider than its box: ${setup.cramped.join(' | ')}`);
  if (!Number.isInteger(setup.duration) || setup.duration < 2000 || setup.duration > 10000) problem('data-duration must be an integer from 2000 to 10000 ms');
  if (!setup.animations) problem('no animations found');
  if (failed) { await page.close(); return null; }

  const frames = Math.round(setup.duration * FPS / 1000);
  const work = mkdtempSync(join(tmpdir(), `og-${key}-`));
  try {
    const capture = async (time, file) => {
      await page.evaluate(t => { for (const animation of document.getAnimations()) animation.currentTime = t; }, time);
      await page.screenshot({ path: file });
    };
    // An infinite animation wraps back to frame 0 at exactly data-duration, so look 1 ms earlier.
    await capture(0, join(work, '0000.png'));
    await capture(setup.duration - 1, join(work, 'end.png'));
    const seam = await difference(join(work, '0000.png'), join(work, 'end.png'));
    if (seam > 0.5) problem(`the end of the loop differs from frame 0 (mean difference ${seam.toFixed(2)}), so the loop jumps`);
    if (sheetOnly) {
      const bytes = (await posterOf(join(work, '0000.png'), setup.poster)).length;
      if (bytes > MAX_POSTER_BYTES) problem(`poster is ${bytes} bytes; keep it under ${MAX_POSTER_BYTES}`);
      else console.log(`${key}: poster ${bytes} bytes as ${setup.poster}`);
      await contactSheet(key, frames, capture, work);
      for (const time of moments) await capture(time, join(SHEETS, `${key}-t${time}.png`));
      return null;
    }
    for (let frame = 1; frame < frames; frame++) await capture(frame * 1000 / FPS, join(work, `${String(frame).padStart(4, '0')}.png`));
    const source = sourceHash([...inputs].sort());
    const framesHash = createHash('sha256');
    for (let frame = 0; frame < frames; frame++) framesHash.update(readFileSync(join(work, `${String(frame).padStart(4, '0')}.png`)));
    framesHash.update(JSON.stringify(ENCODE));
    const sameFrames = framesHash.digest('hex').slice(0, 16);
    const previous = manifest[key];
    if (!failed && previous?.frames === sameFrames && [previous.image, previous.video.replace('/og/', '/og/raw/')].every(file => existsSync(join(ROOT, 'public', file)))) {
      console.log(`${key}: frames unchanged; keeping ${previous.video}`);
      return { ...previous, inputs: source.inputs, source: source.hash };
    }

    const video = join(work, 'video.mp4');
    const encode = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-framerate', String(FPS), '-i', join(work, '%04d.png'),
      ...ENCODE, video,
    ], { encoding: 'utf8' });
    if (encode.status !== 0) { problem(`ffmpeg failed: ${encode.stderr}`); return null; }
    const poster = await posterOf(join(work, '0000.png'), setup.poster);
    const videoBytes = readFileSync(video);
    if (videoBytes.length > MAX_VIDEO_BYTES) problem(`video is ${videoBytes.length} bytes; keep it under ${MAX_VIDEO_BYTES}`);
    if (poster.length > MAX_POSTER_BYTES) problem(`poster is ${poster.length} bytes; keep it under ${MAX_POSTER_BYTES}`);
    if (failed) return null;

    const imageName = `${key}-${hash(poster)}.${setup.poster === 'jpeg' ? 'jpg' : 'png'}`;
    const videoName = `${key}-${hash(videoBytes)}.mp4`;
    mkdirSync(RAW, { recursive: true });
    removeStale(PUBLIC, key, imageName);
    removeStale(RAW, key, videoName);
    writeFileSync(join(PUBLIC, imageName), poster);
    writeFileSync(join(RAW, videoName), videoBytes);
    console.log(`${key}: ${frames} frames, poster ${poster.length} bytes, video ${videoBytes.length} bytes`);
    return {
      image: `/og/${imageName}`,
      video: `/og/${videoName}`,
      width: WIDTH,
      height: HEIGHT,
      durationMs: setup.duration,
      imageBytes: poster.length,
      videoBytes: videoBytes.length,
      frames: sameFrames,
      inputs: source.inputs,
      source: source.hash,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
    await page.close();
  }
}

// Twelve evenly spaced frames on one image, so a reviewer can read the motion at a glance.
async function contactSheet(key, frames, capture, work) {
  const count = 12;
  const tile = { width: 600, height: 315 };
  const tiles = [];
  for (let index = 0; index < count; index++) {
    const frame = Math.round(index * frames / count);
    const file = join(work, `sheet-${index}.png`);
    await capture(frame * 1000 / FPS, file);
    const label = Buffer.from(`<svg width="${tile.width}" height="28"><rect width="100%" height="100%" fill="#0E0E0E"/><text x="10" y="19" font-family="monospace" font-size="15" fill="#FBF8F2">${key} · ${(frame / FPS).toFixed(2)} s</text></svg>`);
    const input = await sharp(file).resize(tile.width, tile.height).extend({ bottom: 28, background: '#0E0E0E' }).composite([{ input: label, top: tile.height, left: 0 }]).png().toBuffer();
    tiles.push({ input, left: (index % 3) * tile.width, top: Math.floor(index / 3) * (tile.height + 28) });
  }
  mkdirSync(SHEETS, { recursive: true });
  const out = join(SHEETS, `${key}-sheet.png`);
  await sharp({ create: { width: tile.width * 3, height: (tile.height + 28) * 4, channels: 3, background: '#0E0E0E' } }).composite(tiles).png().toFile(out);
  for (const index of [0, 6]) await capture(Math.round(index * frames / count) * 1000 / FPS, join(SHEETS, `${key}-frame-${index}.png`));
  console.log(`${key}: contact sheet at ${out}`);
}

function posterOf(file, format) {
  const resized = sharp(file).resize(WIDTH, HEIGHT, { kernel: 'lanczos3' });
  return (format === 'jpeg' ? resized.jpeg({ quality: 85, mozjpeg: true }) : resized.png({ compressionLevel: 9, adaptiveFiltering: true })).toBuffer();
}

async function difference(a, b) {
  const [left, right] = await Promise.all([a, b].map(file => sharp(file).raw().toBuffer()));
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

function removeStale(directory, key, keep) {
  const pattern = new RegExp(`^${key}-[0-9a-f]{10}\\.(png|jpg|mp4)$`);
  for (const name of readdirSync(directory)) {
    if (name !== keep && pattern.test(name) && statSync(join(directory, name)).isFile()) unlinkSync(join(directory, name));
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

// The same digest tests/lib/og-media.test.ts recomputes from each entry's inputs.
function sourceHash(inputs) {
  const digest = createHash('sha256');
  for (const input of inputs) digest.update(`${input}\0`).update(readFileSync(join(ROOT, input))).update('\0');
  return { inputs, hash: digest.digest('hex').slice(0, 16) };
}

function readManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeManifest(entries) {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map(key => [key, entries[key]]));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
