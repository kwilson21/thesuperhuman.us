import { afterAll, beforeAll, expect, it } from "vitest";
import { bundleAstro } from "../helpers/render-astro";

// Home's waveform edge as the server renders it: the resting frame the browser redraws from the same peaks.

let bundle: Awaited<ReturnType<typeof bundleAstro>>;

beforeAll(async () => {
	bundle = await bundleAstro({ edge: "src/components/home/SignalEdge.astro" });
}, 60_000);

afterAll(() => bundle?.remove());

it("hands the browser the recording's peaks it drew, one bar each", async () => {
	const html = await bundle.render("edge", {
		props: { peaks: [0.25, 1, 0.5] },
	});

	expect(html).toContain('data-bars="3"');
	expect(html).toContain('data-peaks="0.25,1,0.5"');
});

it("draws its own phrase at 110 bars when given no recording", async () => {
	const html = await bundle.render("edge", { props: {} });

	expect(html).toContain('data-bars="110"');
	expect(html).not.toContain("data-peaks");
});
