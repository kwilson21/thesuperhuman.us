import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');

describe('package manager and Node pin', () => {
  it('uses pnpm and keeps package-lock.json out of the repository', () => {
    expect(existsSync(`${root}package-lock.json`)).toBe(false);
    expect(existsSync(`${root}pnpm-lock.yaml`)).toBe(true);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(pkg.engines.node).toBe('>=26');
  });

  it('pins Node to 26 in .nvmrc', () => {
    expect(read('.nvmrc').trim()).toBe('26');
  });

  it.each(['.github/workflows/validate.yml', '.github/workflows/screenshots.yml'])('%s installs with pnpm and reads Node from .nvmrc', path => {
    const workflow = read(path);
    expect(workflow).toContain('pnpm/action-setup@');
    expect(workflow).toContain('node-version-file: .nvmrc');
    expect(workflow).toContain('cache: pnpm');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).not.toMatch(/\bnpm (ci|run|test)\b|\bnpx\b|node-version: 22|cache: npm/);
  });

  it('keeps Dependabot on the npm ecosystem, which covers pnpm too', () => {
    expect(read('.github/dependabot.yml')).toContain('package-ecosystem: "npm"');
  });
});
