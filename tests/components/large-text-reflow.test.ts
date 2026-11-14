import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const work = read("src/pages/work.astro");
const diagram = read("src/components/WorkDiagram.astro");
const footer = read("src/components/Footer.astro");
const global = read("src/styles/global.css");

it("lets the single-column story track shrink below its widest child", () => {
	expect(work).toContain(
		"@media(max-width: 800px) {\n    .selected-story { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }",
	);
	expect(work).not.toMatch(/grid-template-columns: 1fr;/);
});

it("wraps the diagram flow by content with flex, keeping the 1 : auto : 1.2 proportions", () => {
	expect(diagram).toContain(
		".diagram-flow { display: flex; flex-wrap: wrap; gap: .75rem;",
	);
	expect(diagram).toMatch(
		/\.diagram-flow > :first-child \{ flex: 1 1 calc\(1rem \+ 2px\); \}/,
	);
	expect(diagram).toMatch(
		/\.diagram-flow > :last-child \{ flex: 1\.2 1 calc\(1\.2 \* \(1rem \+ 2px\)\); \}/,
	);
	expect(diagram).toMatch(
		/\.diagram-flow > \[aria-hidden\] \{ flex: 0 0 auto; \}/,
	);
	expect(diagram).not.toContain("grid-template-columns");
});

it("lets a flow part wrap to a new line only by its content, with no query", () => {
	expect(diagram).not.toContain("@container");
	expect(diagram).not.toContain("max-width: 18rem");
	expect(diagram).not.toContain("rotate(90deg)");
});

it("breaks long words only as a last resort in the diagram and timeline text", () => {
	expect(diagram).toMatch(
		/\.diagram-flow > span:not\(\[aria-hidden\]\) \{[^}]*overflow-wrap: break-word;/,
	);
	expect(diagram).not.toContain("min-width: 0");
	expect(diagram).toMatch(/\.timeline h4 \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).toMatch(/\.timeline p \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).toMatch(/\.phase \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).not.toContain("overflow-wrap: anywhere");
});

it("caps the large button's side padding by the viewport, not by a query", () => {
	expect(global).toMatch(
		/\.site-button-large \{[^}]*padding-inline: min\(1\.75rem, 8\.75vw\);/,
	);
	expect(footer).toMatch(
		/\.closing-panel \{[^}]*padding: 3rem min\(1\.25rem, 6\.25vw\) 1\.75rem;/,
	);
	expect(global).not.toContain("@container");
	expect(footer).not.toContain("@container");
});

it("lets the closing panel's Get in touch button wrap its label, scoped to the footer", () => {
	expect(footer).toMatch(
		/\.closing-panel \.site-button-large \{[^}]*white-space: normal;[^}]*text-align: center;/,
	);
	expect(footer).not.toContain(".pinned-contact .site-button-large {");
});

it("keeps the global button rule and its 380px query unchanged, so other buttons do not wrap", () => {
	expect(global).toContain(
		"line-height: 1.4; white-space: nowrap; }\n  /* Reflow (WCAG 1.4.10): on the narrowest phones a long label may wrap instead of pushing past the gutter. */\n  @media (max-width: 380px) { .site-button { white-space: normal; text-align: center; } }",
	);
});

it("lets a long word in the page lede break only when it cannot fit a line", () => {
	expect(global).toMatch(
		/\.page-lede \{[^}]*overflow-wrap: break-word;[^}]*\}/,
	);
});

it("caps the footer's side gutter by the viewport, with a 24px floor below 320px, so the closing panel is wider at enlarged text", () => {
	expect(footer).toMatch(
		/\.compact-footer \{[^}]*padding-inline: min\(var\(--site-gutter\), max\(24px, 7\.5vw\)\);/,
	);
	expect(global).toContain("--site-gutter: clamp(1.5rem, 5vw, 3.5rem);");
	expect(global).toMatch(
		/\.site-shell \{[^}]*padding-inline: var\(--site-gutter\);/,
	);
});
