import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');
const workflows = ['.github/workflows/validate.yml', '.github/workflows/screenshots.yml'];

describe('package manager and Node pin', () => {
  it('uses pnpm and keeps package-lock.json out of the repository', () => {
    expect(existsSync(`${root}package-lock.json`)).toBe(false);
    expect(existsSync(`${root}pnpm-lock.yaml`)).toBe(true);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('derives engines.node from the .nvmrc pin', () => {
    const nodeMajor = read('.nvmrc').trim();
    expect(nodeMajor).toMatch(/^\d+$/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines.node).toBe(`>=${nodeMajor}`);
  });

  it.each(workflows)('%s installs with pnpm and reads Node from .nvmrc', path => {
    const workflow = read(path);
    expect(workflow).toContain('pnpm/action-setup@');
    expect(workflow).toContain('node-version-file: .nvmrc');
    expect(workflow).toContain('cache: pnpm');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).not.toMatch(/^\s*node-version:/m);
    expect(workflow).not.toMatch(/\bnpm (ci|run|test|install|i|exec)\b|\bnpx\b|cache: npm/);
  });

  it.each(workflows)('%s pins pnpm/action-setup to a full commit SHA', path => {
    expect(read(path)).toMatch(/pnpm\/action-setup@[0-9a-f]{40}\b/);
  });

  it.each(workflows)('%s installs pnpm before setup-node', path => {
    // setup-node's `cache: pnpm` needs pnpm installed first.
    const workflow = read(path);
    const pnpmStep = workflow.indexOf('pnpm/action-setup@');
    const setupNodeStep = workflow.indexOf('actions/setup-node@');
    expect(pnpmStep).toBeGreaterThanOrEqual(0);
    expect(setupNodeStep).toBeGreaterThanOrEqual(0);
    expect(pnpmStep).toBeLessThan(setupNodeStep);
  });

  it.each(workflows)('%s checks out without persisting credentials', path => {
    expect(read(path)).toMatch(/actions\/checkout@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+persist-credentials: false/);
  });
});
