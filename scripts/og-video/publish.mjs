#!/usr/bin/env node
// Trusted half of the link-preview CI (.github/workflows/link-previews-publish.yml runs main's copy).
// Checks the artifact the render job uploaded, which came from pull request code, copies the files
// it allows into the pull request's checkout, and brings the asset record up to date.
//
// Env: INCOMING (the artifact), TARGET (the pull request checkout), SHEETS_OUT (checked contact
// sheets), PR_NUMBER, RUN_ID. Writes scenes=<names> to $GITHUB_OUTPUT. Node built-ins only.
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFiles, withNote } from './record.mjs';

const MB = 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Path, first bytes and size limit of every file the render job may hand over.
const KINDS = [
  { path: /^public\/og\/[a-z0-9-]+-[0-9a-f]{10}\.png$/, magic: PNG, max: 600 * 1024 },
  { path: /^public\/og\/[a-z0-9-]+-[0-9a-f]{10}\.jpg$/, magic: [0xff, 0xd8, 0xff], max: 600 * 1024 },
  { path: /^public\/og\/raw\/[a-z0-9-]+-[0-9a-f]{10}\.mp4$/, ftyp: true, max: 2.5 * MB },
  { path: /^src\/data\/og-media\.json$/, json: true, max: 256 * 1024 },
  { path: /^scripts\/og-video\/site-tokens\.css$/, css: true, max: 4096 },
];
const SCENE = /^[a-z0-9-]{1,80}$/;
const SAFE_INPUT = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;
const TOKEN_LINE = /^(\/\*[^*]{0,200}\*\/|:root \{|  --[a-z-]{1,40}: [A-Za-z0-9#.,%() -]{1,80};|\})$/;

export function check(path, bytes) {
  const kind = KINDS.find(candidate => candidate.path.test(path));
  if (!kind) return 'is not a file the render job may change';
  if (bytes.length > kind.max) return `is larger than ${kind.max} bytes`;
  if (kind.magic && !kind.magic.every((byte, index) => bytes[index] === byte)) return 'does not start like its file type';
  if (kind.ftyp && bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return 'is not an MP4 file';
  if (kind.css && !bytes.toString('utf8').trimEnd().split('\n').every(line => TOKEN_LINE.test(line))) return 'has a line the token generator does not write';
  if (kind.json) {
    let manifest;
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { return 'is not JSON'; }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'is not a manifest';
    for (const [scene, entry] of Object.entries(manifest)) {
      if (!SCENE.test(scene)) return `names an unexpected scene ${scene}`;
      if (!/^\/og\/[a-z0-9-]+-[0-9a-f]{10}\.(png|jpg)$/.test(entry?.image) || !/^\/og\/[a-z0-9-]+-[0-9a-f]{10}\.mp4$/.test(entry?.video)) return `has unexpected files for ${scene}`;
      if (!Array.isArray(entry.inputs) || !entry.inputs.every(input => typeof input === 'string' && SAFE_INPUT.test(input))) return `has unexpected inputs for ${scene}`;
    }
  }
  return null;
}

function walk(directory, base = directory) {
  return readdirSync(directory).flatMap(name => {
    const full = join(directory, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`${relative(base, full)} is a symbolic link`);
    return stat.isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { INCOMING, TARGET, SHEETS_OUT, PR_NUMBER, RUN_ID } = process.env;
  if (!INCOMING || !TARGET || !SHEETS_OUT || !/^\d+$/.test(PR_NUMBER ?? '') || !/^\d+$/.test(RUN_ID ?? '')) throw new Error('Missing or unexpected environment.');
  const changes = JSON.parse(readFileSync(join(INCOMING, 'changes.json'), 'utf8'));
  const scenes = Array.isArray(changes.scenes) ? changes.scenes : [];
  if (!scenes.length || !scenes.every(scene => SCENE.test(scene) && existsSync(join(TARGET, 'scripts/og-video/scenes', `${scene}.html`)))) throw new Error('The artifact names no scenes, or a scene the pull request does not have.');
  const deleted = Array.isArray(changes.deleted) ? changes.deleted : [];
  if (!deleted.every(path => typeof path === 'string' && KINDS.slice(0, 3).some(kind => kind.path.test(path)))) throw new Error('The artifact deletes a file that is not a preview.');
  const files = existsSync(join(INCOMING, 'files')) ? walk(join(INCOMING, 'files')) : [];
  for (const path of files) {
    const problem = check(path, readFileSync(join(INCOMING, 'files', path)));
    if (problem) throw new Error(`${path} ${problem}.`);
  }
  for (const path of files) {
    mkdirSync(dirname(join(TARGET, path)), { recursive: true });
    copyFileSync(join(INCOMING, 'files', path), join(TARGET, path));
  }
  for (const path of deleted) rmSync(join(TARGET, path), { force: true });
  // Every file the manifest names must now be in the pull request.
  const manifest = JSON.parse(readFileSync(join(TARGET, 'src/data/og-media.json'), 'utf8'));
  for (const entry of Object.values(manifest)) {
    for (const file of [`public${entry.image}`, `public${entry.video.replace('/og/', '/og/raw/')}`]) {
      if (!existsSync(join(TARGET, file))) throw new Error(`The manifest names ${file}, which the artifact did not provide.`);
    }
  }
  const recordPath = join(TARGET, 'docs/asset-reviews/link-previews.md');
  const note = `CI render (Link previews workflow run ${RUN_ID}, PR #${PR_NUMBER}): ${scenes.join(', ')}. Rendered by GitHub Actions, which checked fonts, overflow, loop seams and file limits. Visual review: the owner looks at the contact sheets in the pull request description before merging (owner decision, October 22, 2026).`;
  writeFileSync(recordPath, withNote(withFiles(readFileSync(recordPath, 'utf8'), manifest, path => readFileSync(join(TARGET, path))), note));
  mkdirSync(SHEETS_OUT, { recursive: true });
  for (const scene of scenes) {
    const sheet = join(INCOMING, 'sheets', `${scene}-sheet.png`);
    if (!existsSync(sheet) || lstatSync(sheet).isSymbolicLink()) continue;
    const bytes = readFileSync(sheet);
    if (bytes.length <= 15 * MB && PNG.every((byte, index) => bytes[index] === byte)) copyFileSync(sheet, join(SHEETS_OUT, `${scene}-sheet.png`));
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scenes=${scenes.join(' ')}\n`);
  console.log(`Applied ${files.length} files and ${deleted.length} deletions for ${scenes.join(' ')}.`);
}
