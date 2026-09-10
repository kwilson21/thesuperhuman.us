import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const checker = resolve('scripts/check-asset-qa.mjs');
const roots: string[] = [];
function fixture(outcome = 'ready for production') {
  const root = mkdtempSync(join(tmpdir(), 'website-asset-qa-')); roots.push(root);
  mkdirSync(join(root, 'src/assets/site'), { recursive: true });
  mkdirSync(join(root, 'docs/asset-reviews'), { recursive: true });
  const content = Buffer.from('reviewed image bytes');
  writeFileSync(join(root, 'src/assets/site/art.webp'), content);
  const record = { outcome, files: [{ path: 'src/assets/site/art.webp', sha256: createHash('sha256').update(content).digest('hex') }] };
  writeFileSync(join(root, 'docs/asset-reviews/art.md'), '```json\n' + JSON.stringify(record) + '\n```');
  return root;
}
const run = (cwd: string) => spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
describe('production image QA gate', () => {
  it('accepts a reviewed file whose exact bytes match', () => { expect(run(fixture()).status).toBe(0); });
  it('rejects a replacement even when its filename is unchanged', () => {
    const root = fixture(); writeFileSync(join(root, 'src/assets/site/art.webp'), 'replacement');
    const result = run(root); expect(result.status).toBe(1); expect(result.stderr).toContain('hash mismatch');
  });
  it('rejects a generated asset without a review record', () => {
    const root = fixture(); writeFileSync(join(root, 'src/assets/site/new.webp'), 'new');
    const result = run(root); expect(result.status).toBe(1); expect(result.stderr).toContain('no review record');
  });
  it('rejects an asset whose visual review still needs revision', () => {
    const result = run(fixture('needs revision')); expect(result.status).toBe(1); expect(result.stderr).toContain('not ready for production');
  });
});
