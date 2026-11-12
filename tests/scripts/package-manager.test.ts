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
    expect(workflow).not.toMatch(/\bnpm (ci|run|test)\b|\bnpx\b|cache: npm/);
  });

  it.each(workflows)('%s pins pnpm/action-setup to the v6.1.1 commit', path => {
    expect(read(path)).toContain('pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1');
    expect(read(path)).not.toContain('9bbca1e9dc2902adb87e8780fe5c98796985a62d');
  });

  it.each(workflows)('%s checks out without persisting credentials', path => {
    expect(read(path)).toMatch(/actions\/checkout@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+persist-credentials: false/);
  });
});
