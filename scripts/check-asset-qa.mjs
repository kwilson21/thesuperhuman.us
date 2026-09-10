import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';

// The review documents are the inventory. No separate approval manifest.
const assetRoot = 'src/assets/site';
const reviewRoot = 'docs/asset-reviews';
const errors = [];
const reviewed = new Set();
try {
  for (const name of readdirSync(reviewRoot).filter(name => name.endsWith('.md'))) {
    const document = readFileSync(join(reviewRoot, name), 'utf8');
    const block = document.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!block) { errors.push(`${name}: missing machine-readable review`); continue; }
    let record;
    try { record = JSON.parse(block[1]); }
    catch { errors.push(`${name}: invalid review JSON`); continue; }
    if (record.outcome !== 'ready for production') errors.push(`${name}: not ready for production`);
    if (!Array.isArray(record.files) || !record.files.length) { errors.push(`${name}: no reviewed files`); continue; }
    for (const file of record.files) {
      if (typeof file.path !== 'string' || !file.path.startsWith(`${assetRoot}/`) || posix.normalize(file.path) !== file.path || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        errors.push(`${name}: invalid asset path or SHA-256`); continue;
      }
      if (reviewed.has(file.path)) errors.push(`${file.path}: duplicate review record`);
      reviewed.add(file.path);
      try {
        const hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        if (hash !== file.sha256) errors.push(`${file.path}: hash mismatch; review the changed image`);
      } catch { errors.push(`${file.path}: reviewed file missing`); }
    }
  }
  for (const file of readdirSync(assetRoot, { recursive: true }).filter(name => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(name))) {
    const path = `${assetRoot}/${file}`;
    if (!reviewed.has(path)) errors.push(`${path}: no review record`);
  }
} catch (error) { errors.push(`Cannot read asset QA inventory: ${error.message}`); }
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Asset QA passed: ${reviewed.size} production files match their visual review records.`);
