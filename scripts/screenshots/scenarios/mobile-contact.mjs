// The shared mobile action survives Home's filled buttons, hands off to the footer and returns.
// Contact itself is already the destination and must not offer a sticky link back to itself.
import assert from "node:assert/strict";

const pinned = "[data-pinned-contact]";

const waitForPinned = (page, visible) =>
	page.waitForFunction(
		({ selector, visible }) => {
			const bar = document.querySelector(selector);

			if (!bar) return false;
			const style = getComputedStyle(bar);

			return (
				(style.display !== "none" &&
					style.visibility !== "hidden" &&
					Number(style.opacity) > 0) === visible
			);
		},
		{ selector: pinned, visible },
	);

const waitForDock = (page) =>
	page.waitForFunction(() => {
		const proxy = document.querySelector("[data-pinned-contact]");
		const slot = document.querySelector("[data-closing-button]");

		if (innerWidth > 600) return !slot.hasAttribute("inert");
		const action = proxy.querySelector("a").getBoundingClientRect();
		const target = slot.getBoundingClientRect();

		return (
			proxy.hasAttribute("data-docked") &&
			Math.abs(action.top - target.top) < 1 &&
			Math.abs(action.width - target.width) < 1 &&
			slot.hasAttribute("inert")
		);
	});

export default {
	title: "Mobile contact and footer handoff",
	async run({ capture }) {
		const images = [];
		images.push({
			file: await capture({
				file: "contact-pinned-home-phone.png",
				path: "/",
				viewport: "phone",
				prepare: async (page) => {
					for (const width of [320, 375, 414, 768]) {
						await page.setViewportSize({ width, height: 844 });
						await page.evaluate(() => window.scrollTo(0, 0));
						await waitForPinned(page, width <= 600);

						if (width <= 600) {
							const bounds = await page
								.locator("[data-pinned-contact] a, [data-closing-button]")
								.evaluateAll((elements) =>
									elements.map((element) => ({
										x: element.getBoundingClientRect().x,
										width: element.getBoundingClientRect().width,
									})),
								);

							assert.ok(Math.abs(bounds[0].x - bounds[1].x) < 1);
							assert.ok(Math.abs(bounds[0].width - bounds[1].width) < 1);
						}

						await page.locator(".hire-section").scrollIntoViewIfNeeded();
						await waitForPinned(page, width <= 600);
						assert.ok(
							await page.evaluate(
								() => document.documentElement.scrollWidth <= innerWidth + 1,
							),
							`Home must not overflow at ${width}px`,
						);

						if (width <= 600) {
							const dockScroll = await page.evaluate(() => {
								const slot = document
									.querySelector("[data-closing-button]")
									.getBoundingClientRect();

								const action = document
									.querySelector("[data-pinned-contact] a")
									.getBoundingClientRect();

								return scrollY + slot.top - action.top;
							});

							// Read geometry synchronously in the same task as large scroll jumps.
							// A JS/rAF-positioned proxy lags here; native sticky must already agree.
							await page.evaluate((dockY) => {
								for (const jump of [-300, 180, -160, 240, -8, 8, -300]) {
									scrollTo(0, dockY + jump);

									const action = document
										.querySelector("[data-pinned-contact] a")
										.getBoundingClientRect();

									const target = document
										.querySelector("[data-closing-button]")
										.getBoundingClientRect();

									if (
										Math.abs(
											action.top -
												Math.min(target.top, innerHeight - 16 - action.height),
										) > 1
									)
										throw new Error(
											`Contact action lagged rapid scroll by ${action.top - Math.min(target.top, innerHeight - 16 - action.height)}px`,
										);
								}
							}, dockScroll);

							for (const step of [-8, -2, 2, 8, 2, -2, -8]) {
								await page.evaluate((y) => scrollTo(0, y), dockScroll + step);
								await page.waitForFunction(() => {
									const slot = document
										.querySelector("[data-closing-button]")
										.getBoundingClientRect();

									const action = document
										.querySelector("[data-pinned-contact] a")
										.getBoundingClientRect();

									const bottom = innerHeight - 16;

									return (
										Math.abs(
											action.top - Math.min(slot.top, bottom - action.height),
										) < 1
									);
								});
							}
						}

						await page.locator(".compact-footer").scrollIntoViewIfNeeded();
						await waitForDock(page);
						await page.evaluate(() => window.scrollTo(0, 0));
						await waitForPinned(page, width <= 600);
					}

					await page.setViewportSize({ width: 390, height: 844 });

					for (const reducedMotion of ["reduce", "no-preference"]) {
						await page.emulateMedia({ reducedMotion });
						await page.evaluate(() => window.scrollTo(0, 0));
						await waitForPinned(page, true);

						const duration = await page
							.locator(pinned)
							.evaluate(
								(element) =>
									getComputedStyle(element, "::before").transitionDuration,
							);

						assert.equal(
							duration.split(",").every((value) => parseFloat(value) === 0),
							reducedMotion === "reduce",
						);
						await page.locator(".compact-footer").scrollIntoViewIfNeeded();
						await waitForDock(page);
						assert.equal(
							await page.locator("[data-closing-button]").getAttribute("inert"),
							"",
						);
						await page.evaluate(() => window.scrollTo(0, 0));
						await waitForPinned(page, true);
						assert.equal(
							await page.locator(pinned).getAttribute("inert"),
							null,
						);
					}

					await page.emulateMedia({ reducedMotion: "reduce" });
					await page.locator(".hire-section").scrollIntoViewIfNeeded();
					await waitForPinned(page, true);
					assert.equal(
						await page.locator("main a.site-button[href='/contact']").count(),
						0,
					);
				},
			}),
			caption: "Get in touch stays available over Home's project choices",
		});

		for (const [name, path] of [
			["home", "/"],
			["services", "/services"],
			["audio", "/audio"],
		]) {
			images.push({
				file: await capture({
					file: `contact-footer-${name}-phone.png`,
					path,
					viewport: "phone",
					selector: ".compact-footer",
					prepare: async (page) => {
						await page.locator(".compact-footer").scrollIntoViewIfNeeded();
						await waitForDock(page);
						assert.equal(
							await page.locator("footer [data-closing-button]").count(),
							1,
						);
						await page.evaluate(() => window.scrollTo(0, 0));
						await waitForPinned(page, true);
						await page.locator(".compact-footer").scrollIntoViewIfNeeded();
						await waitForDock(page);
					},
				}),
				caption: `${name}: the footer replaces the pinned action, including after scrolling back`,
			});
		}

		images.push({
			file: await capture({
				file: "contact-quiet-phone.png",
				path: "/contact",
				viewport: "phone",
				prepare: async (page) => {
					assert.equal(await page.locator(pinned).count(), 0);
					assert.equal(await page.locator("[data-closing-button]").count(), 0);
				},
			}),
			caption: "The contact switchboard has no redundant contact action",
		});

		return [{ title: "Contact stays available until the footer", images }];
	},
};
