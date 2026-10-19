import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';
import { softwareSheet } from '../../src/data/services';
import { audioPath } from '../../src/lib/host-routing';

const layout = readFileSync(new URL('../../src/layouts/ServiceSheet.astro', import.meta.url), 'utf8');

describe('software service sheet', () => {
  it('lists the three paths in order, each opening its own intake', () => {
    expect(softwareSheet.rows.map(row => row.id)).toEqual(['website', 'web-app', 'workflow']);
    expect(softwareSheet.rows.map(row => row.title)).toEqual(['Website design', 'Web app', 'Workflow automation']);
    expect(softwareSheet.rows.map(row => row.path)).toEqual([
      '/software/start?path=website',
      '/software/start?path=webapp',
      '/software/start?path=workflow',
    ]);
    expect(softwareSheet.hero.path).toBe('/work#lyft');
    expect(audioPath('thesuperhuman.us', softwareSheet.audioServicesPath)).toBe('/audio/services');
    expect(audioPath('audio.thesuperhuman.us', softwareSheet.audioServicesPath)).toBe('/services');
  });

  it('routes each evidence link to its intended destination', () => {
    const [website, webApp, workflow] = softwareSheet.rows;
    expect(website.evidence.map(item => item.links.map(link => ('path' in link ? link.path : link.url)))).toEqual([['/building/personal-website']]);
    expect(webApp.evidence.map(item => item.title)).toEqual(['Tally', 'Kaillera Next']);
    expect(webApp.evidence[0].links).toEqual([
      { label: 'Try the demo', url: 'https://tally-demo.thesuperhuman.us' },
      { label: 'Explore the project', path: '/building/tally' },
    ]);
    expect(webApp.evidence[1].meta).toBe('In development · playable demo build');
    expect(webApp.evidence[1].links).toEqual([{ label: 'Explore the project', path: '/building/kaillera-next' }]);
    expect(workflow.evidence[0].links).toEqual([{ label: 'Read the work story', path: '/work#skupos', context: 'about Skupos' }]);
    expect(workflow.historyPath).toBe('/work');
    for (const target of ['href(row.path)', 'href(link.path)', 'link.url', 'href(row.historyPath)', 'href(lyft.path)']) {
      expect(layout.split(`href={${target}}`).length - 1).toBe(1);
    }
  });

  it('preserves approved path copy, the kicker and the website door anchor', async () => {
    expect(softwareSheet.title).toBe('Let’s build something useful.');
    expect(softwareSheet.kicker).toBe('Websites & software');
    expect(softwareSheet.introduction).toBe('A website, a web app, or a task your team repeats. We’ll choose a clear first milestone together.');
    expect(softwareSheet.steps.map(step => step.title)).toEqual(['Share the situation', 'Review the first milestone', 'Agree, then begin']);
    expect(softwareSheet.steps[0].description).toBe('Tell me what you want to build, or what happens today.');
    const [website, webApp, workflow] = softwareSheet.rows;
    expect(workflow.detail).toBe('I build a tool or connect the systems you already use so your team can do a repeated task with fewer manual steps.');
    expect(webApp.detail).toBe('I build a first version that lets people try the most important part of your idea.');
    const { doors } = await import('../../src/data/work-with-me');
    expect(website.detail).toBe(doors.find(door => door.id === 'website')!.line);
    const nav = readFileSync(new URL('../../src/components/SiteNav.astro', import.meta.url), 'utf8');
    expect(nav).toContain("mainHref('/services#website')");
    expect(nav).not.toContain('door-website');
    expect(doors.some(door => `door-${door.id}` === 'door-website')).toBe(true);
    const data = readFileSync(new URL('../../src/data/services.ts', import.meta.url), 'utf8');
    for (const removed of ['Quoted after your brief', 'Start a project brief', 'Illustrated workflow', 'Nothing starts until', 'Communication is async.', 'Fixed price · agreed in writing before work begins', 'Make a workflow easier', 'Tell me what happens today or what you want people to try.']) expect(data).not.toContain(removed);
  });

  it('renders each row from the rows list with the shared anatomy, open by default', () => {
    expect(layout).toContain('sheet.rows.map(');
    expect(layout.match(/<details class="service-offer" id=\{row\.id\} open>/g)).toHaveLength(1);
    expect(layout).not.toContain('sheet.workflow');
    expect(layout).not.toContain('sheet.idea');
    expect(layout).toContain('class="row-visual"');
    expect(layout).toContain('class="site-button row-button"');
    expect(layout).toContain('<WorkDiagram kind="bonus" />');
    expect(layout).toContain('lyft.figure.before');
    expect(layout).toContain('lyft.figure.after');
    expect(layout).toContain('<WorkDiagram kind="analyst" />');
    expect(layout).toContain("row.diagram === 'analyst'");
    expect(layout).toContain('role="list"');
    expect(layout).not.toContain('tally-visual');
    expect(layout).not.toContain('idea-');
    expect(layout).not.toContain('workflow-');
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
    expect(print).toContain('.path-evidence .row-detail');
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
