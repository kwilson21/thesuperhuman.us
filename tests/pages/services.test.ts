import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { softwareSheet } from '../../src/data/services';

const layout = readFileSync(new URL('../../src/layouts/ServiceSheet.astro', import.meta.url), 'utf8');

describe('software service sheet', () => {
  it('routes each path and evidence link to its intended destination', () => {
    expect(softwareSheet.workflow.path).toBe('/software/start?path=workflow');
    expect(softwareSheet.idea.path).toBe('/software/start?path=idea');
    for (const path of ['/work#lyft', '/work#skupos', '/work', '/building/tally']) {
      expect(layout).toContain(`href={href('${path}')}`);
    }
    expect(layout).toContain('href="https://tally-demo.thesuperhuman.us" rel="noopener"');
    expect(layout).toContain('href={href(sheet.workflow.path)}');
    expect(layout).toContain('href={href(sheet.idea.path)}');
  });

  it('removes the former offering, working and contact blocks', () => {
    for (const old of ['sheet-offerings', 'sheet-working', 'sheet-contact', 'Discuss your project', '7+ years in software engineering']) {
      expect(layout).not.toContain(old);
    }
    expect(layout).toContain('<section id="software"');
  });
});
