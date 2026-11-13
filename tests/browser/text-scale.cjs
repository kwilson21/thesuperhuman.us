const assert = require("node:assert/strict");
const path = require("node:path");

const playwrightPath = process.env.PW_SKILL_DIR
	? path.join(process.env.PW_SKILL_DIR, "node_modules/playwright")
	: "playwright";

const { chromium } = require(playwrightPath);

const targetUrl = process.env.TARGET_URL || "http://127.0.0.1:4321";
const artifactDir = process.env.PW_ARTIFACT_DIR || "/tmp";
const VIEWPORT_WIDTH = 375;

// The site pins the root font size to 16px, so text-only zoom cannot be simulated directly. The
// script doubles the root by style to stand in for it. The page is laid out by its content (flex
// wrapping, viewport-capped padding), so it must reflow without pushing past the phone's edge,
// and a word may break inside itself only when it cannot fit a line of its own.
let current = null;

async function openWork(browser, width, rootSize) {
	const page = await browser.newPage({
		viewport: { width, height: 812 },
		deviceScaleFactor: 1,
		reducedMotion: "reduce",
	});

	current = page;

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

		// A flow is stacked when its last text part starts at or below the bottom of its first text part.
		const flows = await large.evaluate(() =>
			[...document.querySelectorAll(".diagram-flow")].map((flow) => {
				const parts = [...flow.children];
				const text = parts.filter((part) => !part.hasAttribute("aria-hidden"));
				const first = text[0].getBoundingClientRect();
				const last = text[text.length - 1].getBoundingClientRect();

				return {
					stacked: last.top >= first.bottom,
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
			// The line a word must fit: the flow's width inside a diagram flow, otherwise the
			// content box of the element that holds the word.
			const lineWidth = (element) => {
				const box = element.closest(".diagram-flow") || element;
				const style = getComputedStyle(box);

				return (
					box.clientWidth -
					parseFloat(style.paddingLeft) -
					parseFloat(style.paddingRight)
				);
			};

			// Measures the word unbroken, in the same font as the element that holds it.
			const wordWidth = (element, word) => {
				const probe = document.createElement("span");

				probe.textContent = word;
				probe.style.cssText =
					"position:absolute;visibility:hidden;white-space:nowrap;";
				probe.style.font = getComputedStyle(element).font;
				element.append(probe);

				const width = probe.getBoundingClientRect().width;

				probe.remove();

				return width;
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

						const element = node.parentElement;

						// Only a word that would fit on a line of its own counts as broken.
						if (
							tops.size > 1 &&
							wordWidth(element, match[0]) <= lineWidth(element)
						)
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

			// On one row when the second text part starts to the right of the first part's right
			// edge while their vertical ranges overlap.
			const rows = await normal.evaluate(() =>
				[...document.querySelectorAll(".diagram-flow")].map((flow) => {
					const text = [...flow.children].filter(
						(part) => !part.hasAttribute("aria-hidden"),
					);

					const first = text[0].getBoundingClientRect();

					const second = text[text.length - 1].getBoundingClientRect();

					const overlaps =
						second.top < first.bottom && first.top < second.bottom;

					return overlaps && second.left > first.right;
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
	} catch (error) {
		await current
			?.screenshot({
				path: path.join(artifactDir, "_failure-text-scale.png"),
				fullPage: true,
			})
			.catch(() => {});

		throw error;
	} finally {
		await browser.close();
	}

	console.log("text scale browser checks: PASS");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
