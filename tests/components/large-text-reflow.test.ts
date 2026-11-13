import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const work = read("src/pages/work.astro");
const diagram = read("src/components/WorkDiagram.astro");
const footer = read("src/components/Footer.astro");
const global = read("src/styles/global.css");
const design = read("design.md");

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
	expect(diagram.match(/@media/g)?.length).toBe(2);
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
	expect(footer).toContain("padding: 3rem min(1.25rem, 6.25vw) 1.75rem;");
	expect(global).not.toContain("@container");
	expect(footer).not.toContain("@container");
});

it("updates the design note to the rem threshold and the enlarged-text case", () => {
	expect(design).toContain(
		"At 23.75rem (380px at the default text size) and below a button label may wrap",
	);
	expect(design).not.toContain("At 380px wide and below");
});
