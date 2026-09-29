import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { softwareSheet } from '../../src/data/services';
import { audioPath } from '../../src/lib/host-routing';

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
    expect(softwareSheet.startPath).toBe('/software/start');
    expect(layout).toContain('href={href(sheet.startPath)}');
    expect(layout).toContain('href={href(lyft.path)}');
    expect(layout).toContain('href={href(sheet.historyPath)}');
    expect(layout).toContain('href={href(sheet.projectPath)}');
    expect(layout).toContain('href={audioPath(host, sheet.audioPath)}');
    expect(audioPath('thesuperhuman.us', softwareSheet.audioPath)).toBe('/audio/services');
    expect(audioPath('audio.thesuperhuman.us', softwareSheet.audioPath)).toBe('/services');
  });

  it('uses shared service anatomy and expands both fit rows by default', () => {
    expect(layout.match(/<details class="service-offer" open>/g)).toHaveLength(2);
    expect(layout).toContain('<WorkDiagram kind="bonus" />');
    expect(layout).toContain('lyftBonus.before');
    expect(layout).toContain('lyftBonus.after');
    expect(layout).toContain('tally-transactions.webp');
    expect(layout).toContain('role="list"');
    for (const source of [layout, readFileSync(new URL('../../src/pages/audio/services.astro', import.meta.url), 'utf8')]) {
      expect(source).toContain("import '~/styles/service-pages.css'");
      expect(source).toContain('services-page');
    }
  });

  it('hides software links and illustrations in print and keeps expanded text', () => {
    const print = layout.slice(layout.indexOf('@media print'));
    expect(print).toContain('.sheet-software a');
    expect(print).toContain('.sheet-software :global(.work-diagram)');
    expect(print).toContain('content-visibility: visible');
    expect(print).toContain('display: grid !important');
    expect(print).toContain('font-size: 10.5pt');
    expect(print).toContain('font-size: 9pt; margin-top: 8pt');
    expect(print).toContain('font-size: 8pt; margin-top: 8pt');
  });

  it('removes the former offering, working and contact blocks', () => {
    for (const old of ['sheet-offerings', 'sheet-working', 'sheet-contact', 'Discuss your project', 'sheet-paths', 'sheet-path', 'sheet-steps', 'A clear first step.']) {
      expect(layout).not.toContain(old);
    }
    expect(readFileSync(new URL('../../src/data/services.ts', import.meta.url), 'utf8')).not.toContain('7+ years in software engineering');
    expect(layout).toContain('<section id="software"');
  });
});
