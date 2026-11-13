const assert = require("node:assert/strict");
const path = require("node:path");

const playwrightPath = process.env.PW_SKILL_DIR
	? path.join(process.env.PW_SKILL_DIR, "node_modules/playwright")
	: "playwright";

const { chromium } = require(playwrightPath);

const targetUrl = process.env.TARGET_URL || "http://127.0.0.1:4321";
const VIEWPORT_WIDTH = 375;

// The root font size is doubled, as a visitor with a 32px default text size sees it. Each
// rule is in rem, so the layout has to reflow instead of pushing past the phone's edge.
async function openWork(browser, rootSize) {
	const page = await browser.newPage({
		viewport: { width: VIEWPORT_WIDTH, height: 812 },
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
		const large = await openWork(browser, "200%");

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

		await large.close();

		const normal = await openWork(browser, null);

		const flowsInRow = await normal.evaluate(() =>
			[...document.querySelectorAll(".diagram-flow")].map((flow) => {
				const parts = [...flow.children];

				const columns = getComputedStyle(flow)
					.gridTemplateColumns.split(" ")
					.filter(Boolean).length;

				const inRow = parts.every(
					(part, index) =>
						index === 0 ||
						part.getBoundingClientRect().left >=
							parts[index - 1].getBoundingClientRect().right - 0.5,
				);

				return { columns, inRow };
			}),
		);

		assert.ok(flowsInRow.length > 0, "/work has no diagram flow");

		for (const flow of flowsInRow) {
			assert.equal(
				flow.columns,
				3,
				"diagram flow is not three columns at the default size",
			);
			assert.equal(
				flow.inRow,
				true,
				"diagram flow parts are not on one row at the default size",
			);
		}

		await normal.close();
	} finally {
		await browser.close();
	}

	console.log("text scale browser checks: PASS");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
