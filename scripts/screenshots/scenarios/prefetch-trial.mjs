// Opt-in diagnostics only. These images do not prove requests or latency gains.
export default {
	title: "Public navigation prefetch trial",
	async run({ capture }) {
		const images = [];

		for (const viewport of ["desktop", "phone"]) {
			images.push({
				file: await capture({
					file: `prefetch-trial-${viewport}.png`,
					path: "/?prefetch=foresight",
					viewport,
					selector: "#prefetch-trial",
					prepare: async (page) => {
						await page.locator("#prefetch-trial").waitFor({ state: "visible" });
					},
				}),
				caption:
					"Explicit prediction trial; normal links and form flows are unchanged",
			});
		}

		return [{ title: "Prediction trial", images }];
	},
};
