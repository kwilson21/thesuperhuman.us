import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

it('routes the homepage hero CTA to the software intake and preserves other CTAs', () => {
  const home = read('../../src/pages/index.astro');
  const hero = read('../../src/components/Hero.astro');
  const workWithMe = read('../../src/data/work-with-me.ts');
  const siteNav = read('../../src/components/SiteNav.astro');
  const footer = read('../../src/components/Footer.astro');

  expect(hero).toContain('<a class="site-button" href="/software/start">Start a software project</a>');
  expect(home).toContain('<WorkWithMe />');
  expect(workWithMe).toContain("href: '/software/start?path=website', label: 'Plan your website'");
  expect(workWithMe).toContain("href: '/software/start', label: 'Discuss your project'");
  expect(workWithMe).toContain("line: 'I build web apps people can try, or a tool that makes a task your team repeats easier.'");
  expect(workWithMe).toContain('Each button starts the relevant intake.');
  expect(workWithMe).not.toContain('Each button starts the relevant intake or contact path.');
  expect(siteNav).toContain('href={mainHref(\'/services\')} aria-current={onHub ? \'page\' : undefined}>Work with me</a>');
  expect(footer).toContain('const hireHref = mainHref(\'/services\');');
  expect(footer).toContain('<a href={hireHref}>Work with me</a>');
});
