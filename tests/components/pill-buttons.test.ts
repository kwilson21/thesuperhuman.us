import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const global = read("src/styles/global.css");

const rgb = (hex: string) =>
	[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const token = (name: string) => {
	const match = global.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));

	if (!match) throw new Error(`--${name} not found in global.css`);

	return rgb(match[1]);
};

const luminance = (channels: number[]) => {
	const [r, g, b] = channels.map((c) => {
		const s = c / 255;

		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

it("declares the panel and radius tokens", () => {
	expect(global).toContain(
		"--panel: color-mix(in srgb, var(--rule) 50%, var(--paper));",
	);
	expect(global).toContain("--radius-panel: 32px;");
	expect(global).toContain("--radius-button: 999px;");
});

it("makes the shared button a pill that defaults to one line", () => {
	const css = global.slice(
		global.indexOf(".site-button {"),
		global.indexOf("}", global.indexOf(".site-button {")) + 1,
	);

	expect(css).toContain("border-radius: var(--radius-button);");
	expect(css).toContain("padding: .55rem 1.5rem;");
	expect(css).toContain("white-space: nowrap;");
	expect(css).toContain("min-height: 44px;");
	expect(css).toContain("max-width: 100%;");
});

it("adds the large size used in the closing panel", () => {
	expect(global).toMatch(
		/\.site-button-large \{[^}]*min-height: 52px;[^}]*font-size: 1\.0625rem;[^}]*padding-inline: 1\.75rem;/,
	);
});

it("keeps text and the focus ring readable on the panel", () => {
	const paper = token("paper");
	const ruleColour = token("rule");
	const panel = paper.map((c, i) => (c + ruleColour[i]) / 2);

	const ratio = (name: string) => {
		const [l, d] = [luminance(panel), luminance(token(name))].sort(
			(a, b) => b - a,
		);

		return (l + 0.05) / (d + 0.05);
	};

	expect(ratio("ink")).toBeGreaterThanOrEqual(15);
	expect(ratio("muted")).toBeGreaterThanOrEqual(7);
	expect(ratio("accent")).toBeGreaterThanOrEqual(3);
});

it("draws the door art with the panel token", () => {
	expect(read("src/components/WorkWithMe.astro")).toContain(
		"background: var(--panel);",
	);
});

it("uses the button radius token on every pill in the inventory", () => {
	const studio = read("src/styles/studio.css");
	expect(studio).toMatch(
		/\.studio-button \{[^}]*border-radius: var\(--radius-button\);/,
	);
	expect(read("src/styles/owner.css")).toMatch(
		/\.owner-primary-action\{[^}]*border-radius:var\(--radius-button\)/,
	);
	expect(read("src/styles/owner.css")).toMatch(
		/\.owner-filters button,\.request-work button,\.audience-list button\{[^}]*border-radius:var\(--radius-button\)/,
	);
	expect(read("src/styles/audio-intake.css")).toMatch(
		/\.intake-actions \[data-back\]\{[^}]*border-radius:var\(--radius-button\)/,
	);
	expect(read("src/pages/owner/requests/[id].astro")).toMatch(
		/\.rail-actions button \{[^}]*border-radius: var\(--radius-button\);/,
	);
});

it("raises the inline padding on pill rows whose label touched the curve", () => {
	expect(read("src/styles/owner.css")).toMatch(
		/\.owner-primary-action\{[^}]*padding:\.65rem 1\.25rem;/,
	);
	expect(read("src/pages/owner/requests/[id].astro")).toMatch(
		/\.rail-actions button \{[^}]*padding: \.45rem 1\.25rem;/,
	);
	expect(read("src/components/WorkWithMe.astro")).toMatch(
		/\.door-button \{[^}]*padding: \.45rem 1\.5rem;/,
	);
});

it("lets studio button labels wrap, because some are typed by the owner", () => {
	const match = read("src/styles/studio.css").match(
		/\.studio-button \{[^}]*\}/,
	);

	expect(match, ".studio-button rule").not.toBeNull();
	expect(match![0]).toContain("max-width: 100%;");
	expect(match![0]).toContain("overflow-wrap: anywhere;");
	expect(match![0]).toContain("border-radius: var(--radius-button);");
	expect(match![0]).not.toContain("white-space: nowrap");
	expect(read("docs/design-concepts/2026-11-12/button-inventory.md")).toContain(
		"Labels may wrap, because some are typed by the owner; the rule sets `max-width: 100%`.",
	);
});

it("keeps pill labels on one line", () => {
	expect(read("src/styles/owner.css")).toMatch(
		/\.owner-filters button,[^{]*\{[^}]*white-space:nowrap/,
	);
	expect(read("src/pages/owner/requests/[id].astro")).toMatch(
		/\.rail-actions button \{[^}]*white-space: nowrap;/,
	);
	expect(read("src/styles/audio-intake.css")).toMatch(
		/\.intake-actions \[data-back\]\{[^}]*white-space:nowrap/,
	);
});

it("keeps text-style buttons and fields square", () => {
	const studio = read("src/styles/studio.css");
	const match = studio.match(/\.studio-quiet \{[^}]*\}/);
	expect(match, ".studio-quiet rule").not.toBeNull();
	expect(match![0]).not.toContain("border-radius");
	expect(global).not.toMatch(
		/\.site-form (input|textarea|select)[^{]*\{[^}]*var\(--radius-button\)/,
	);
});

it("allows narrow-phone button labels and door text to shrink", () => {
	expect(global).toMatch(
		/@media \(max-width: 23\.75rem\) \{ \.site-button \{ white-space: normal; text-align: center; \} \}/,
	);
	expect(global).not.toContain("max-width: 380px");
	const doors = read("src/components/WorkWithMe.astro");
	expect(doors).not.toMatch(/grid-template-columns: \d+px 1fr;/);
	expect(doors).toContain("minmax(0, 1fr)");
});

it("lets owner primary action labels wrap within the rail", () => {
	const match = read("src/styles/owner.css").match(
		/\.owner-primary-action\{[^}]*\}/,
	);

	expect(match, ".owner-primary-action rule").not.toBeNull();
	expect(match![0]).toContain("max-width:100%");
	expect(match![0]).not.toContain("white-space:nowrap");
});

it("records the shared pill token, owner wrapping and inherited danger button in the inventory", () => {
	const inventory = read("docs/design-concepts/2026-11-12/button-inventory.md");
	expect(inventory).toContain(
		"Pill through `--radius-button` in `src/styles/global.css`.",
	);
	expect(inventory).toContain(
		"Labels may wrap; the rule sets `max-width: 100%`.",
	);
	expect(inventory).toContain("| `.intake-actions [data-back]` |");
	expect(inventory).toContain("| `.rail-actions button.danger` |");
	expect(inventory).not.toContain("—");
});

it("gives the owner next-step link the pill shape and lets its stored label wrap", () => {
	const match = read("src/components/AudioProjectUpdates.astro").match(
		/\.next-step-link \{[^}]*\}/,
	);

	expect(match, ".next-step-link rule").not.toBeNull();
	expect(match![0]).toContain("border-radius: var(--radius-button);");
	expect(match![0]).toContain("max-width: 100%;");
	expect(match![0]).toContain("overflow-wrap: anywhere;");
	expect(match![0]).toContain("padding: .5rem 1.25rem;");
	expect(match![0]).not.toContain("white-space: nowrap");
});

it("centres the owner primary action arrow beside its label in the pill", () => {
	const match = read("src/styles/owner.css").match(
		/\.owner-primary-action\{[^}]*\}/,
	);

	expect(match, ".owner-primary-action rule").not.toBeNull();
	expect(match![0]).toContain("justify-content:center;");
	expect(match![0]).toContain("gap:.6rem;");
	expect(match![0]).not.toContain("space-between");
	expect(match![0]).not.toContain("gap:2rem");
});
