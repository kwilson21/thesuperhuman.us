import { describe, expect, it, vi } from "vitest";
import {
	countVisibleWidgets,
	createRequestTracker,
	SETTLE_CAP_MS,
	settle,
	WIDGET_STABLE_MS,
	widgetBoxes,
	waitForWidgetBoxes,
} from "../../scripts/screenshots/settle.mjs";

// A clock the test moves by hand. `pause` moves it too, so the waits are exact.
function fakeClock() {
	let now = 0;

	return {
		now: () => now,
		pause: async (ms: number) => {
			now += ms;
		},
	};
}

// The fake page's evaluate, typed loosely on purpose: the widget functions are the only ones these tests use.
type PageScript = () => string | number | boolean;

type PageReading = string | number | boolean | undefined;
type Evaluate = (script: PageScript) => Promise<PageReading>;

// SAFETY: the fakes implement only the page methods the code under test calls (evaluate, waitForFunction).
const asPage = (page: { evaluate: Evaluate; waitForFunction?: unknown }) =>
	page as never;

// A page whose drawn widget reports the next box in `boxes` on each read, then keeps the last one.
function boxPage(boxes: string[]) {
	let read = 0;

	return {
		evaluate: vi.fn(async (script: PageScript) => {
			if (script === widgetBoxes) {
				const box = boxes[Math.min(read, boxes.length - 1)];

				read += 1;

				return box;
			}

			return 1;
		}),
	};
}

const waitOptions = (clock: ReturnType<typeof fakeClock>) => ({
	left: () => SETTLE_CAP_MS - clock.now(),
	pause: clock.pause,
	now: clock.now,
});

describe("waitForWidgetBoxes", () => {
	it("holds when the box is the same for the whole stability window", async () => {
		const clock = fakeClock();

		await expect(
			waitForWidgetBoxes(asPage(boxPage(["300x80"])), waitOptions(clock)),
		).resolves.toBe(true);
		expect(clock.now()).toBeGreaterThanOrEqual(WIDGET_STABLE_MS);
	});

	it("waits past a resize, and only holds once the new box has been still for the window", async () => {
		const clock = fakeClock();
		// Narrow (wrapped text), then full width after two more reads, then still.
		const page = boxPage(["120x300", "120x300", "300x80", "300x80"]);

		await expect(
			waitForWidgetBoxes(asPage(page), waitOptions(clock)),
		).resolves.toBe(true);
		expect(clock.now()).toBeGreaterThanOrEqual(WIDGET_STABLE_MS);
	});

	it("gives up at the cap when the box never holds still", async () => {
		const clock = fakeClock();
		let reads = 0;

		const page = {
			evaluate: vi.fn(async (script: PageScript) => {
				if (script === widgetBoxes) {
					reads += 1;

					return `${reads}x80`;
				}

				return 1;
			}),
		};

		await expect(
			waitForWidgetBoxes(asPage(page), waitOptions(clock)),
		).resolves.toBe(false);
		expect(clock.now()).toBeGreaterThanOrEqual(SETTLE_CAP_MS);
	});

	it("is part of settle, which reports the cap as a size reason when the box never settles", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		let reads = 0;

		const page = {
			evaluate: vi.fn(async (script: PageScript) => {
				if (script === countVisibleWidgets) return 1;

				if (script === widgetBoxes) {
					reads += 1;

					return `${reads}x80`;
				}

				return true;
			}),
			waitForFunction: vi.fn(async () => true),
		};

		await expect(
			settle(asPage(page), tracker, { pause: clock.pause }),
		).resolves.toBe("cap: turnstile size");
	});
});

describe("widgetBoxes", () => {
	it("reads the widget's container and every element inside it, so a resize of the iframe counts too", () => {
		const inner = { getBoundingClientRect: () => ({ width: 10, height: 20 }) };

		const widget = {
			getClientRects: () => [{}],
			querySelectorAll: () => [inner],
			getBoundingClientRect: () => ({ width: 300, height: 80 }),
		};

		// Runs the in-page function against a fake widget tree.
		const value = new Function(
			"document",
			`return (${widgetBoxes.toString()})();`,
		)({ querySelectorAll: () => [widget] });

		expect(value).toBe("300x80|10x20");
	});
});
