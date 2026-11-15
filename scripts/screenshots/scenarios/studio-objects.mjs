// The hero's desk objects as links, with their frosted glass labels: pointing at
// the monitor, the headphones and the controller, keyboard focus on the notebook, and the
// one-word pins a touch screen shows. Captures run with reduced motion, so each scene shows its
// finished frame.
const desktop = [
	["monitor", "hover", "Pointing at the monitor"],
	["headphones", "hover", "Pointing at the headphones"],
	["controller", "hover", "Pointing at the controller"],
	["notebook", "focus", "Keyboard focus on the notebook"],
];

export default {
	title: "Studio objects",
	async run({ capture }) {
		const images = [];

		for (const [id, how, caption] of desktop) {
			const file = await capture({
				file: `studio-${id}-${how}-desktop.png`,
				path: "/",
				viewport: "desktop",
				selector: ".studio-art",
				prepare: async (page) => {
					if (how === "hover")
						await page.locator(`[data-studio-object="${id}"]`).hover();
					else {
						// Reach it from the link before it with Tab, so the focus ring shows as it does for a keyboard user.
						await page.locator('[data-studio-object="headphones"]').focus();
						await page.keyboard.press("Tab");
					}
				},
			});

			images.push({ file, caption });
		}

		const phone = await capture({
			file: "studio-touch-phone.png",
			path: "/",
			viewport: "phone",
			selector: ".studio-art",
			prepare: async (page) => {
				// A touch screen has no hover, so the objects show their one-word pins.
				const cdp = await page.context().newCDPSession(page);
				await cdp.send("Emulation.setTouchEmulationEnabled", {
					enabled: true,
					maxTouchPoints: 5,
				});
			},
		});

		images.push({
			file: phone,
			caption: "A touch screen: one-word glass pins at each object's edge",
		});

		return [{ title: "The desk's objects", images }];
	},
};
