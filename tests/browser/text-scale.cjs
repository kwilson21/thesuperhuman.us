const assert = require("node:assert/strict");
const path = require("node:path");

const playwrightPath = process.env.PW_SKILL_DIR
	? path.join(process.env.PW_SKILL_DIR, "node_modules/playwright")
	: "playwright";

const { chromium } = require(playwrightPath);

const targetUrl = process.env.TARGET_URL || "http://127.0.0.1:4321";
const VIEWPORT_WIDTH = 375;

// The root font size is doubled, as a visitor with a 32px default text size sees it. The page
// is laid out by its content (flex wrapping, viewport-capped padding), so it must reflow without
// pushing past the phone's edge, and no word may break inside itself.
async function openWork(browser, width, rootSize) {
	const page = await browser.newPage({
		viewport: { width, height: 812 },
		deviceScaleFactor: 1,
		reducedMotion: "reduce",
	});

	await page.goto(new URL("/work", targetUrl).href, {
		waitUntil: "domcontentloaded",
	});
	await page.locator("h1").first().waitFor();
	await page.evaluate(() => document.fonts.ready);

	if (rootSize) {
		await page.evaluate((size) => {
			document.documentElement.style.fontSize = size;
		}, rootSize);
	}

	return page;
}

(async () => {
	const browser = await chromium.launch({ headless: true });

	try {
		const large = await openWork(browser, VIEWPORT_WIDTH, "200%");

		const scrollWidth = await large.evaluate(
			() => document.documentElement.scrollWidth,
		);

		assert.ok(
			scrollWidth <= VIEWPORT_WIDTH,
			`/work scrolls sideways at ${VIEWPORT_WIDTH}px with a 200% root: scrollWidth ${scrollWidth}`,
		);

		const labelLines = await large.evaluate(() => {
			const button = document.querySelector("[data-closing-button]");

			if (!button) return null;

			const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
			const range = document.createRange();
			const tops = new Set();
			let node;

			while ((node = walker.nextNode())) {
				if (node.parentElement && node.parentElement.tagName === "SPAN")
					continue;
				range.selectNodeContents(node);

				for (const rect of range.getClientRects()) {
					if (rect.height > 0) tops.add(Math.round(rect.top));
				}
			}

			return tops.size;
		});

		assert.notEqual(labelLines, null, "/work has no closing panel button");
		assert.ok(
			labelLines <= 2,
			`the closing panel button label takes ${labelLines} lines at a 200% root`,
		);

		const flows = await large.evaluate(() =>
			[...document.querySelectorAll(".diagram-flow")].map((flow) => {
				const parts = [...flow.children];

				const tops = parts.map((part) =>
					Math.round(part.getBoundingClientRect().top),
				);

				return {
					stacked: new Set(tops).size > 1,
					overflow: parts.some((part) => part.scrollWidth > part.clientWidth),
				};
			}),
		);

		assert.ok(flows.length > 0, "/work has no diagram flow");

		for (const flow of flows) {
			assert.equal(flow.stacked, true, "a diagram flow does not stack at 200%");
			assert.equal(
				flow.overflow,
				false,
				"a diagram flow part overflows at 200%",
			);
		}

		const splitWords = await large.evaluate(() => {
			// Measures the word unbroken, in the same font, against the box's text width.
			const fitsInBox = (box, word) => {
				const style = getComputedStyle(box);

				const available =
					box.clientWidth -
					parseFloat(style.paddingLeft) -
					parseFloat(style.paddingRight);

				const probe = document.createElement("span");

				probe.textContent = word;
				probe.style.cssText =
					"position:absolute;visibility:hidden;white-space:nowrap;";
				probe.style.font = style.font;
				box.append(probe);

				const width = probe.getBoundingClientRect().width;

				probe.remove();

				return width <= available;
			};

			const roots = [
				...document.querySelectorAll(
					".work-diagram, .diagram-flow, .closing-panel [data-closing-button]",
				),
			];

			const found = [];

			for (const root of roots) {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let node;

				while ((node = walker.nextNode())) {
					const re = /\S+/g;
					let match;

					while ((match = re.exec(node.textContent || ""))) {
						if (match[0].includes("-")) continue;

						const range = document.createRange();
						range.setStart(node, match.index);
						range.setEnd(node, match.index + match[0].length);

						const tops = new Set(
							[...range.getClientRects()].flatMap((rect) =>
								rect.width > 0 ? [Math.round(rect.top)] : [],
							),
						);

						// Only a word that would fit on a line of its own counts as broken.
						if (tops.size > 1 && fitsInBox(node.parentElement, match[0]))
							found.push(match[0]);
					}
				}
			}

			return found;
		});

		assert.deepEqual(splitWords, [], "words break inside themselves at 200%");

		await large.close();

		for (const width of [390, 1280]) {
			const normal = await openWork(browser, width, null);

			const rows = await normal.evaluate(() =>
				[...document.querySelectorAll(".diagram-flow")].map((flow) => {
					const tops = [...flow.children].flatMap((part) =>
						part.hasAttribute("aria-hidden")
							? []
							: [Math.round(part.getBoundingClientRect().top)],
					);

					return tops.every((top) => Math.abs(top - tops[0]) <= 1);
				}),
			);

			assert.ok(rows.length > 0, "/work has no diagram flow");

			for (const onOneRow of rows) {
				assert.equal(
					onOneRow,
					true,
					`diagram flow parts are not on one row at ${width}px`,
				);
			}

			await normal.close();
		}
	} finally {
		await browser.close();
	}

	console.log("text scale browser checks: PASS");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
