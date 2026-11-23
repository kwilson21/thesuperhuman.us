// The market refresh (docs/plans/2026-11-market-refresh.md) on /owner/pricing: a proposal a web search made, waiting for
// the owner to use or discard it, beside the research it would replace (none in the preview). Every figure and source is
// made up; no search runs and nothing is saved.
const at = "2026-11-12T07:23:00.000Z";

const source = (id, title, url) => ({
	id,
	title,
	url,
	published: "2026-10-01",
	kind: "web search",
});

const proposal = {
	id: "001794468180000",
	createdAt: at,
	basedOn: null,
	market: {
		researchedOn: "2026-11-12",
		ranges: [
			{
				kind: "website",
				size: "small",
				definition:
					"A brochure site of about 1 to 5 pages with a contact form.",
				lowUsd: 1200,
				highUsd: 2400,
				sourceIds: [1],
			},
			{
				kind: "workflow",
				size: "small",
				definition: "One automation or integration between two systems.",
				lowUsd: 600,
				highUsd: 1800,
				sourceIds: [2],
			},
		],
		dayRate: { lowUsd: 800, highUsd: 1200 },
		caveats: [
			"Found by an automatic web search on 2026-11-12. Each new figure appears in the text of a source it cites.",
		],
		sources: [
			source(
				1,
				"A made-up guide to small site prices",
				"https://example.com/sites",
			),
			source(
				2,
				"A made-up automation price list",
				"https://example.com/automation",
			),
			source(
				3,
				"A made-up survey of developer rates",
				"https://example.com/rates",
			),
		],
	},
	changes: [
		{
			cell: "website small",
			before: null,
			after: { lowUsd: 1200, highUsd: 2400 },
			sourceIds: [1],
		},
		{
			cell: "workflow small",
			before: null,
			after: { lowUsd: 600, highUsd: 1800 },
			sourceIds: [2],
		},
		{
			cell: "the day rate",
			before: null,
			after: { lowUsd: 800, highUsd: 1200 },
			sourceIds: [3],
		},
	],
};

export default {
	title: "Market refresh",
	async run({ capture, kvPut }) {
		kvPut(
			"RESUME_STORE",
			`pricing:proposal:${proposal.id}`,
			JSON.stringify(proposal),
		);
		kvPut(
			"RESUME_STORE",
			"pricing:refresh-last",
			JSON.stringify({ at, result: "proposal" }),
		);

		const images = [];

		for (const viewport of ["desktop", "phone"]) {
			const file = await capture({
				file: `market-refresh-${viewport}.png`,
				path: "/owner/pricing",
				viewport,
				owner: true,
				prepare: async (page) => {
					await page
						.getByRole("button", { name: "Use these figures" })
						.waitFor();
					await page
						.getByRole("heading", { name: "New figures from the web" })
						.scrollIntoViewIfNeeded();
				},
			});

			images.push({
				file,
				caption: `Proposed market figures waiting on Pricing, ${viewport}`,
			});
		}

		return [{ title: "Market refresh", images }];
	},
};
