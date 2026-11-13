import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const work = read("src/pages/work.astro");
const diagram = read("src/components/WorkDiagram.astro");
const design = read("design.md");

it("lets the single-column story track shrink below its widest child", () => {
	expect(work).toContain(
		"@media(max-width: 800px) {\n    .selected-story { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }",
	);
	expect(work).not.toMatch(/grid-template-columns: 1fr;/);
});

it("lets the diagram flow tracks shrink and stacks it in rem", () => {
	expect(diagram).toContain(
		".diagram-flow { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.2fr);",
	);
	expect(diagram).toMatch(
		/@media \(max-width: 18rem\) \{[^}]*\.diagram-flow \{ grid-template-columns: minmax\(0, 1fr\);/,
	);
});

it("points the flow arrow down when the flow is stacked", () => {
	expect(diagram).toMatch(
		/@media \(max-width: 18rem\) \{[^@]*\.diagram-flow > \[aria-hidden\] \{[^}]*transform: rotate\(90deg\);/,
	);
	expect(diagram).toContain('<span aria-hidden="true">→</span>');
});

it("breaks long words only as a last resort in the diagram and timeline text", () => {
	expect(diagram).toMatch(
		/\.diagram-flow > span:not\(\[aria-hidden\]\) \{[^}]*min-width: 0;[^}]*overflow-wrap: break-word;/,
	);
	expect(diagram).toMatch(/\.timeline h4 \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).toMatch(/\.timeline p \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).toMatch(/\.phase \{[^}]*overflow-wrap: break-word;/);
	expect(diagram).not.toContain("overflow-wrap: anywhere");
});

it("updates the design note to the rem threshold and the enlarged-text case", () => {
	expect(design).toContain(
		"At 23.75rem (380px at the default text size) and below a button label may wrap",
	);
	expect(design).not.toContain("At 380px wide and below");
});
