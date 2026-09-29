import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { softwareSheet } from '../../src/data/services';

const layout = readFileSync(new URL('../../src/layouts/ServiceSheet.astro', import.meta.url), 'utf8');

describe('software service sheet', () => {
  it('routes each path and evidence link to its intended destination', () => {
    expect(softwareSheet.workflow.path).toBe('/software/start?path=workflow');
    expect(softwareSheet.idea.path).toBe('/software/start?path=idea');
    expect(softwareSheet.evidence.map(item => item.path)).toEqual(['/work#lyft', '/work#skupos']);
    expect(softwareSheet.historyPath).toBe('/work');
    expect(softwareSheet.projectPath).toBe('/building/tally');
    expect(softwareSheet.demoUrl).toBe('https://tally-demo.thesuperhuman.us');
    expect(layout).toContain('href={href(item.path)}');
    expect(layout).toContain('href={sheet.demoUrl} target="_blank" rel="noopener"');
    expect(layout).toContain('href={href(sheet.workflow.path)}');
    expect(layout).toContain('href={href(sheet.idea.path)}');
  });

  it('removes the former offering, working and contact blocks', () => {
    for (const old of ['sheet-offerings', 'sheet-working', 'sheet-contact', 'Discuss your project']) {
      expect(layout).not.toContain(old);
    }
    expect(readFileSync(new URL('../../src/data/services.ts', import.meta.url), 'utf8')).not.toContain('7+ years in software engineering');
    expect(layout).toContain('<section id="software"');
  });
});
