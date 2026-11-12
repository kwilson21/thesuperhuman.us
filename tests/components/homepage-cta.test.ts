import { readFileSync } from "node:fs";
import { it } from "vitest";
import { expectSource } from "../helpers/source-text";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");

it("routes the homepage hero CTA to the software intake and preserves other CTAs", () => {
	const home = read("../../src/pages/index.astro");
	const hero = read("../../src/components/Hero.astro");
	const workWithMe = read("../../src/data/work-with-me.ts");
	const siteNav = read("../../src/components/SiteNav.astro");
	const footer = read("../../src/components/Footer.astro");

	expectSource(hero).toContain(
		'<a class="site-button" href="/software/start">Start a project</a>',
	);
	expectSource(home).toContain("<WorkWithMe />");
	expectSource(workWithMe).toContain(
		"href: '/software/start?path=website', label: 'Plan your website'",
	);
	expectSource(workWithMe).toContain(
		"href: '/software/start', label: 'Discuss your project'",
	);
	expectSource(workWithMe).toContain(
		"line: 'I build web apps people can try, or a tool that makes a task your team repeats easier.'",
	);
	expectSource(workWithMe).toContain("Each button starts the relevant intake.");
	expectSource(workWithMe).not.toContain(
		"Each button starts the relevant intake or contact path.",
	);
	expectSource(siteNav).toContain(
		"href={mainHref('/services')} aria-current={onHub ? 'page' : undefined}>Work with me</a>",
	);
	expectSource(footer).toContain("const hireHref = mainHref('/services');");
	expectSource(footer).toContain("<a href={hireHref}>Work with me</a>");
});
