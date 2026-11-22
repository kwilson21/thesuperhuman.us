import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const css = read("src/styles/global.css");
const footer = read("src/components/Footer.astro");
const sheet = read("src/layouts/ServiceSheet.astro");

it("opts labelled icons into optical spacing without changing text-only buttons", () => {
	expect(css).toMatch(
		/\.site-button \{[^}]*min-height: 44px;[^}]*padding: \.55rem 1\.5rem;/,
	);
	expect(css).toContain(
		".site-button-trailing { padding-inline-end: var(--space-4); gap: var(--space-2); }",
	);
	expect(css).toContain(
		".site-button-leading { padding-inline-start: var(--space-4); gap: var(--space-2); }",
	);
	expect(css).toContain(".site-button-icon { flex-shrink: 0; }");
	expect(read("src/components/ContactForm.astro")).not.toContain(
		"site-button-trailing",
	);
});

it("uses identical optical treatment for the floating and footer action without changing docking", () => {
	expect(
		footer.match(/class="site-button site-button-large site-button-trailing"/g),
	).toHaveLength(2);
	expect(
		footer.match(
			/<span class="site-button-icon" aria-hidden="true">→<\/span>/g,
		),
	).toHaveLength(2);
	expect(footer).toContain("--contact-action-max: 15rem;");
	expect(footer).toContain("position: sticky;");
	expect(css).toMatch(/\.site-button-large \{[^}]*min-height: 52px;/);
	expect(css).toContain(
		".site-button-large.site-button-trailing { padding-inline-end: min(var(--space-5), 6.25vw); }",
	);
});

it("treats print and forward actions according to their icon side", () => {
	expect(sheet).toContain(
		'class="site-button site-button-trailing row-button"',
	);
	expect(sheet).toContain(
		'class="site-button site-button-outline site-button-leading" data-print-sheet',
	);
	expect(sheet).toContain(
		'<svg class="site-button-icon" width="18" height="18"',
	);
	expect(sheet).not.toContain(".site-button { gap:");
});
