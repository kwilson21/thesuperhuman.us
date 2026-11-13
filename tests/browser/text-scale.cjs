const assert = require("node:assert/strict");
const path = require("node:path");

const playwrightPath = process.env.PW_SKILL_DIR
	? path.join(process.env.PW_SKILL_DIR, "node_modules/playwright")
	: "playwright";

const { chromium } = require(playwrightPath);

const targetUrl = process.env.TARGET_URL || "http://127.0.0.1:4321";
const artifactDir = process.env.PW_ARTIFACT_DIR || "/tmp";

// Enlarged-text widths: the narrow phones (320, 360), the common ones (375, 390, 414) and the
// widest phone the site targets (430).
const LARGE_WIDTHS = [320, 360, 375, 390, 414, 430];

// The closing label's line budget at a 200% root. From 375px the label fits two lines. The
// narrowest phones need more lines: 320px is 224px of text beside a 48px gutter, and 360px
// is 264px. Both are measured on /work after the closing panel fix; see the release record.
const LABEL_LINES_MAX = { 320: 3, 360: 2, 375: 2, 390: 2, 414: 2, 430: 2 };

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

// Enlarged text at one phone width: no sideways scroll, the closing label inside its button
// (label and arrow boxes within the button, the button within the panel), the pinned contact
// button within the viewport, flows stacked and no split words.
async function checkLargeText(browser, width) {
	const large = await openWork(browser, width, "200%");

	const scrollWidth = await large.evaluate(
		() => document.documentElement.scrollWidth,
	);

	assert.ok(
		scrollWidth <= width,
		`/work scrolls sideways at ${width}px with a 200% root: scrollWidth ${scrollWidth}`,
	);

	const closing = await large.evaluate(() => {
		const button = document.querySelector("[data-closing-button]");

		if (!button) return null;

		const box = (rect) => ({
			left: rect.left,
			right: rect.right,
			top: rect.top,
			bottom: rect.bottom,
		});

		const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		const tops = new Set();
		const labelRects = [];
		let node;

		while ((node = walker.nextNode())) {
			if (node.parentElement && node.parentElement.tagName === "SPAN") continue;
			range.selectNodeContents(node);

			for (const rect of range.getClientRects()) {
				if (rect.height > 0) {
					tops.add(Math.round(rect.top));
					labelRects.push(box(rect));
				}
			}
		}

		const arrow = button.querySelector("span[aria-hidden]");
		const arrowBox = arrow ? box(arrow.getBoundingClientRect()) : null;
		const panel = button.closest(".closing-panel");

		return {
			lines: tops.size,
			labelRects,
			arrowBox,
			buttonBox: box(button.getBoundingClientRect()),
			panelBox: panel ? box(panel.getBoundingClientRect()) : null,
		};
	});

	assert.notEqual(closing, null, "/work has no closing panel button");

	const maxLines = LABEL_LINES_MAX[width];

	assert.ok(
		closing.lines <= maxLines,
		`the closing panel button label takes ${closing.lines} lines at ${width}px with a 200% root (limit ${maxLines})`,
	);

	const within = (inner, outer) =>
		inner.left >= outer.left - 0.5 &&
		inner.right <= outer.right + 0.5 &&
		inner.top >= outer.top - 0.5 &&
		inner.bottom <= outer.bottom + 0.5;

	for (const rect of closing.labelRects)
		assert.ok(
			within(rect, closing.buttonBox),
			`the closing label leaves its button at ${width}px with a 200% root`,
		);

	if (closing.arrowBox)
		assert.ok(
			within(closing.arrowBox, closing.buttonBox),
			`the closing arrow leaves its button at ${width}px with a 200% root`,
		);

	assert.ok(closing.panelBox, "the closing button is not in the closing panel");
	assert.ok(
		within(closing.buttonBox, closing.panelBox),
		`the closing button leaves its panel at ${width}px with a 200% root`,
	);

	// The pinned contact bar is shown only on scroll; the check reveals it to measure the layout.
	const pinned = await large.evaluate(() => {
		const bar = document.querySelector("[data-pinned-contact]");

		if (!bar) return null;

		bar.hidden = false;

		const button = bar.querySelector(".site-button");
		const rect = button.getBoundingClientRect();

		return {
			left: rect.left,
			right: rect.right,
			viewport: document.documentElement.clientWidth,
		};
	});

	assert.ok(pinned, "/work has no pinned contact bar");
	assert.ok(
		pinned.left >= 0 && pinned.right <= pinned.viewport,
		`the pinned contact button leaves the viewport at ${width}px with a 200% root`,
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
		assert.equal(
			flow.stacked,
			true,
			`a diagram flow does not stack at ${width}px with a 200% root`,
		);
		assert.equal(
			flow.overflow,
			false,
			`a diagram flow part overflows at ${width}px with a 200% root`,
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

	assert.deepEqual(
		splitWords,
		[],
		`words break inside themselves at ${width}px with a 200% root`,
	);

	await large.close();
}

(async () => {
	const browser = await chromium.launch({ headless: true });

	try {
		for (const width of LARGE_WIDTHS) await checkLargeText(browser, width);

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
