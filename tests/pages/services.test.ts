import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';
import { softwareSheet } from '../../src/data/services';
import { audioPath } from '../../src/lib/host-routing';

const layout = readFileSync(new URL('../../src/layouts/ServiceSheet.astro', import.meta.url), 'utf8');

describe('software service sheet', () => {
  it('routes each path and evidence link to its intended destination', () => {
    expect(softwareSheet.workflow.path).toBe('/software/start?path=workflow');
    expect(softwareSheet.idea.path).toBe('/software/start?path=idea');
    expect(softwareSheet.hero.path).toBe('/work#lyft');
    expect(softwareSheet.workflow.evidence.path).toBe('/work#skupos');
    expect(softwareSheet.workflow.historyPath).toBe('/work');
    expect(softwareSheet.idea.projectPath).toBe('/building/tally');
    expect(softwareSheet.idea.demoUrl).toBe('https://tally-demo.thesuperhuman.us');
    for (const target of ['href(sheet.workflow.path)', 'href(sheet.idea.path)', 'href(lyft.path)', 'href(sheet.workflow.evidence.path)', 'href(sheet.workflow.historyPath)', 'href(sheet.idea.projectPath)', 'sheet.idea.demoUrl']) {
      expect(layout.split(`href={${target}}`).length - 1).toBe(1);
    }
    expect(audioPath('thesuperhuman.us', softwareSheet.audioServicesPath)).toBe('/audio/services');
    expect(audioPath('audio.thesuperhuman.us', softwareSheet.audioServicesPath)).toBe('/services');
  });

  it('preserves approved path copy and the website door anchor', async () => {
    expect(softwareSheet.title).toBe('Let’s build something useful.');
    expect(softwareSheet.introduction).toBe('Make a workflow easier, or bring an idea to life. We’ll choose a clear first milestone together.');
    expect(softwareSheet.workflow.title).toBe('Make a workflow easier');
    expect(softwareSheet.workflow.detail).toBe('I build a tool or connect the systems you already use so your team can do a repeated task with fewer manual steps.');
    expect(softwareSheet.idea.title).toBe('Bring an idea to life');
    expect(softwareSheet.idea.detail).toBe('I build a first version that lets people try the most important part of your idea.');
    expect(softwareSheet.steps.map(step => step.title)).toEqual(['Share the situation', 'Review the first milestone', 'Agree, then begin']);
    const { doors } = await import('../../src/data/work-with-me');
    const nav = readFileSync(new URL('../../src/components/SiteNav.astro', import.meta.url), 'utf8');
    expect(nav).toContain('/services#door-website');
    expect(doors.some(door => `door-${door.id}` === 'door-website')).toBe(true);
    const data = readFileSync(new URL('../../src/data/services.ts', import.meta.url), 'utf8');
    for (const removed of ['Quoted after your brief', 'Start a project brief', 'Illustrated workflow', 'Nothing starts until', 'Communication is async.', 'Fixed price · agreed in writing before work begins']) expect(data).not.toContain(removed);
  });

  it('uses shared service anatomy and expands both fit rows by default', () => {
    expect(layout.match(/<details class="service-offer" open>/g)).toHaveLength(2);
    expect(layout).toContain('<WorkDiagram kind="bonus" />');
    expect(layout).toContain('lyft.figure.before');
    expect(layout).toContain('lyft.figure.after');
    expect(layout).toContain('<WorkDiagram kind="analyst" />');
    expect(layout).toContain('role="list"');
    for (const source of [layout, readFileSync(new URL('../../src/pages/audio/services.astro', import.meta.url), 'utf8')]) {
      expect(source).toContain("import '~/styles/service-pages.css'");
      expect(source).toContain('services-page');
    }
  });

  it('expands closed rows for print and restores their previous state', () => {
    const rows = [{ open: false }, { open: true }];
    const handlers: Record<string, () => void> = {};
    const script = layout.match(/<script>([\s\S]*?)<\/script>/)![1]
      .replace(/import .*?;\n/, '').replace('runMotion();', '');
    runInNewContext(transpileModule(script, {}).outputText, {
      document: { querySelector: () => null, querySelectorAll: () => rows },
      window: { addEventListener: (event: string, handler: () => void) => { handlers[event] = handler; } },
    });
    handlers.beforeprint();
    expect(rows.map(row => row.open)).toEqual([true, true]);
    handlers.afterprint();
    expect(rows.map(row => row.open)).toEqual([false, true]);
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
    for (const old of ['sheet-offerings', 'sheet-working', 'sheet-contact', 'Discuss your project', 'sheet-paths', 'sheet-steps', 'A clear first step.']) {
      expect(layout).not.toContain(old);
    }
    expect(readFileSync(new URL('../../src/data/services.ts', import.meta.url), 'utf8')).not.toContain('7+ years in software engineering');
    expect(layout).toContain('<section id="software"');
  });
});
