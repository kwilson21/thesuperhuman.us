// The market refresh (docs/plans/2026-11-market-refresh.md): when a search is due, which figures stand, the proposal they
// make, the live search and reader as the code calls them, and the daily run end to end over a memory KV. Every figure
// here is made up; the owner's research is never in the repository.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it, type Mock, vi } from "vitest";
import {
	type MarketReference,
	readMarketReference,
} from "~/lib/pricing-reference";
import { refreshMarket } from "~/server/flows/market-refresh";
import {
	ASK_KEY,
	LAST_KEY,
	PROPOSAL_PREFIX,
	proposalId,
	readProposalText,
} from "~/server/market-refresh-store";
import {
	MarketReader,
	MarketReaderFailed,
	MarketSearch,
	MarketSearchFailed,
	TAVILY_URL,
	liveMarketReader,
	liveMarketSearch,
	readReading,
} from "~/server/market-refresh-services";
import { PRICING_KEY } from "~/server/pricing-store";
import {
	type Checked,
	type Reading,
	type RefreshCell,
	type RefreshFacts,
	REFRESH_CELLS,
	type SearchResult,
	askServed,
	checkReading,
	DEFAULT_DEFINITIONS,
	dollarAmounts,
	proposeMarket,
	queryOf,
	rebaseProposal,
	startRefresh,
	statedAmounts,
	useProposal,
	workOf,
} from "~/server/rules/market-refresh";
import { ResumeStore } from "~/server/services";
import { fakeKv, partial } from "../helpers/doubles";

const NOW = "2026-11-23T07:23:00.000Z";

const research: MarketReference = {
	researchedOn: "2026-08-01",
	ranges: [
		{
			kind: "website",
			size: "small",
			definition: "A made-up small site.",
			lowUsd: 1_000,
			highUsd: 2_000,
			sourceIds: [1],
		},
		{
			kind: "webapp",
			size: "medium",
			definition: "A made-up medium app.",
			lowUsd: 10_000,
			highUsd: 20_000,
			sourceIds: [2],
		},
	],
	dayRate: { lowUsd: 500, highUsd: 900 },
	caveats: ["A made-up caveat."],
	sources: [
		{
			id: 1,
			title: "Made-up source one",
			url: "https://example.org/one",
			published: "2026-07-01",
			kind: "other",
		},
		{
			id: 2,
			title: "Made-up source two",
			url: "https://example.org/two",
			published: "",
			kind: "other",
		},
	],
};

const result = (
	content: string,
	url = "https://example.com/a",
): SearchResult => ({
	title: "A made-up page",
	url,
	content,
	published: "2026-10-01",
});

// ---- When a search is due ------------------------------------------------------------------------------------------

describe("startRefresh", () => {
	const facts = (over: Partial<RefreshFacts> = {}): RefreshFacts => ({
		askedAt: null,
		last: null,
		proposalWaiting: false,
		researchedOn: "2026-08-01",
		...over,
	});

	const starts = (over: Partial<RefreshFacts>, hasKey = true) =>
		Option.isSome(
			Effect.runSync(startRefresh.decide({ now: NOW, hasKey }, facts(over))),
		);

	it("never searches without the key, even when asked", () => {
		expect(starts({ askedAt: "2026-11-22T10:00:00.000Z" }, false)).toBe(false);
	});

	it("searches when the owner asked, even with a proposal waiting or a recent try", () => {
		expect(
			starts({
				askedAt: "2026-11-22T10:00:00.000Z",
				proposalWaiting: true,
				last: { at: "2026-11-22T07:23:00.000Z", result: "failed" },
				researchedOn: "2026-11-20",
			}),
		).toBe(true);
	});

	it("searches research 90 days old with nothing waiting and no try this week", () => {
		expect(starts({ researchedOn: "2026-08-25" })).toBe(true);
		expect(starts({ researchedOn: null })).toBe(true);
	});

	it("waits while the research is new, a proposal waits, or a search was tried this week", () => {
		expect(starts({ researchedOn: "2026-09-01" })).toBe(false);
		expect(starts({ proposalWaiting: true })).toBe(false);
		expect(
			starts({ last: { at: "2026-11-18T07:23:00.000Z", result: "failed" } }),
		).toBe(false);
		expect(
			starts({ last: { at: "2026-11-15T07:23:00.000Z", result: "failed" } }),
		).toBe(true);
	});

	it("writes the start as the last run", () => {
		expect(
			Effect.runSync(startRefresh.decide({ now: NOW, hasKey: true }, facts())),
		).toEqual(Option.some({ at: NOW, result: "started" }));
	});
});

describe("askServed", () => {
	it("clears only an ask made before the run started (verification/market-refresh.qnt, askNeverLost)", () => {
		expect(askServed("2026-11-23T07:00:00.000Z", NOW)).toBe(true);
		expect(askServed(NOW, NOW)).toBe(true);
		expect(askServed("2026-11-23T07:24:00.000Z", NOW)).toBe(false);
		expect(askServed(null, NOW)).toBe(false);
	});
});

// ---- Which figures stand -------------------------------------------------------------------------------------------

describe("dollarAmounts", () => {
	it.each([
		["Sites cost $1,500 to $5,000.", [1_500, 5_000]],
		["From $2k up to $7.5K", [2_000, 7_500]],
		["USD 3,000 or 4,000 USD", [3_000, 4_000]],
		["about 12,000 dollars", [12_000]],
		["$1.2M platforms", [1_200_000]],
		["$95/hr", [95]],
		["15 pages, 3 rounds, 2026", []],
		["$5k-$10k", [5_000, 10_000]],
		// A letter that starts a word is not a scale, and a year before "dollars" is not an amount.
		["A $15 kit", [15]],
		["$99 keyboard", [99]],
		["$12 kWh", [12]],
		["$5 MB", [5]],
		["priced in 2024 dollars", []],
	])("reads %s", (text, amounts) => {
		expect(dollarAmounts(text)).toEqual(amounts);
	});

	it.each([
		["$90 to $140 per hour", [true, true]],
		["$90/hr or $120 an hour", [true, true]],
		["$100 - $150/hr", [true, true]],
		["$800 to $1,200 per day", [false, false]],
		["$5,000 a project, $100 per hour", [false, true]],
	])("marks the amounts in %s given per hour", (text, perHour) => {
		expect(statedAmounts(text).map((amount) => amount.perHour)).toEqual(
			perHour,
		);
	});
});

describe("checkReading", () => {
	const small = { kind: "website", size: "small" } as const;

	const results = [
		result("Small business sites cost $1,500 to $5,000 in 2026."),
		result("A five page site runs $3k.", "https://example.com/b"),
		result("Plain $9,999 page.", "http://example.com/insecure"),
	];

	it("lets a reading stand when each end is a dollar amount in a cited result", () => {
		expect(
			checkReading(
				small,
				{ lowUsd: 1_500, highUsd: 5_000, perHour: false, sources: [1] },
				results,
			),
		).toEqual({ lowUsd: 1_500, highUsd: 5_000, cited: [results[0]] });
		expect(
			checkReading(
				small,
				{ lowUsd: 1_500, highUsd: 3_000, perHour: false, sources: [1, 2] },
				results,
			)?.cited,
		).toHaveLength(2);
	});

	it("refuses a figure no cited result states, or one only an uncited result states", () => {
		expect(
			checkReading(
				small,
				{ lowUsd: 1_500, highUsd: 6_000, perHour: false, sources: [1] },
				results,
			),
		).toBeNull();
		expect(
			checkReading(
				small,
				{ lowUsd: 1_500, highUsd: 3_000, perHour: false, sources: [1] },
				results,
			),
		).toBeNull();
	});

	it("refuses no sources, a source out of range, a link that is not https, and a low end above the high end", () => {
		const reading = { lowUsd: 1_500, highUsd: 5_000, perHour: false };

		expect(
			checkReading(small, { ...reading, sources: [] }, results),
		).toBeNull();
		expect(
			checkReading(small, { ...reading, sources: [7] }, results),
		).toBeNull();
		expect(
			checkReading(
				small,
				{ lowUsd: 9_999, highUsd: 9_999, perHour: false, sources: [3] },
				results,
			),
		).toBeNull();
		expect(
			checkReading(
				small,
				{ lowUsd: 5_000, highUsd: 1_500, perHour: false, sources: [1] },
				results,
			),
		).toBeNull();
	});

	it("refuses figures a cited result gives only inside words (the review of PR #378)", () => {
		expect(
			checkReading(
				small,
				{ lowUsd: 15_000, highUsd: 99_000, perHour: false, sources: [1] },
				[
					result(
						"Starter themes are $15 kits; premium is $99 keyboard-friendly.",
					),
				],
			),
		).toBeNull();
	});

	it("refuses a rate read per hour that the source gives per day, and one read per day that it gives per hour", () => {
		expect(
			checkReading(
				{ kind: "dayRate" },
				{ lowUsd: 800, highUsd: 1_200, perHour: true, sources: [1] },
				[result("Seniors charge $800 to $1,200 per day.")],
			),
		).toBeNull();
		expect(
			checkReading(
				{ kind: "dayRate" },
				{ lowUsd: 90, highUsd: 140, perHour: false, sources: [1] },
				[result("Seniors charge $90 to $140 per hour.")],
			),
		).toBeNull();
		expect(
			checkReading(
				{ kind: "dayRate" },
				{ lowUsd: 800, highUsd: 1_200, perHour: false, sources: [1] },
				[result("Seniors charge $800 to $1,200 per day.")],
			),
		).toMatchObject({ lowUsd: 800, highUsd: 1_200 });
	});

	it("does not cite a link longer than research holds", () => {
		expect(
			checkReading(
				small,
				{ lowUsd: 1_500, highUsd: 5_000, perHour: false, sources: [1] },
				[result("$1,500 to $5,000", `https://example.com/${"a".repeat(600)}`)],
			),
		).toBeNull();
	});

	it("turns a day rate stated per hour into a day of 8 hours, and refuses per-hour figures for a project", () => {
		const rates = [result("Senior freelancers charge $90 to $140 per hour.")];

		expect(
			checkReading(
				{ kind: "dayRate" },
				{ lowUsd: 90, highUsd: 140, perHour: true, sources: [1] },
				rates,
			),
		).toMatchObject({ lowUsd: 720, highUsd: 1_120 });
		expect(
			checkReading(
				small,
				{ lowUsd: 90, highUsd: 140, perHour: true, sources: [1] },
				rates,
			),
		).toBeNull();
	});
});

// ---- The proposal --------------------------------------------------------------------------------------------------

describe("proposeMarket", () => {
	const checked = (low: number, high: number, url: string): Checked => ({
		lowUsd: low,
		highUsd: high,
		cited: [result(`$${low} to $${high}`, url)],
	});

	it("proposes the checked figures, keeps the rest with their sources, and reads as research the page can import", () => {
		const proposal = proposeMarket(
			"001763882580000",
			NOW,
			research,
			new Map([
				["website small", checked(1_200, 2_400, "https://example.com/new")],
				["the day rate", checked(600, 1_000, "https://example.com/rate")],
			]),
		);

		expect(proposal?.market.researchedOn).toBe("2026-11-23");
		expect(proposal?.market.ranges).toEqual([
			{
				kind: "website",
				size: "small",
				definition: DEFAULT_DEFINITIONS.website.small,
				lowUsd: 1_200,
				highUsd: 2_400,
				sourceIds: [1],
			},
			{
				kind: "webapp",
				size: "medium",
				definition: "A made-up medium app.",
				lowUsd: 10_000,
				highUsd: 20_000,
				sourceIds: [2],
			},
		]);
		expect(proposal?.market.sources.map((source) => source.url)).toEqual([
			"https://example.com/new",
			"https://example.org/two",
			"https://example.com/rate",
		]);
		expect(proposal?.market.dayRate).toEqual({ lowUsd: 600, highUsd: 1_000 });
		expect(proposal?.changes).toContainEqual({
			cell: "webapp medium",
			before: { lowUsd: 10_000, highUsd: 20_000 },
			after: null,
			sourceIds: [],
		});
		expect(proposal?.market.caveats.join(" ")).toContain("webapp medium");
		expect(readMarketReference(proposal?.market).ok).toBe(true);
	});

	it("reserves the kept ranges' sources, and proposes a new figure only when all of its sources fit (60 at most)", () => {
		const many = Array.from({ length: 59 }, (_, index) => ({
			id: index + 1,
			title: `Made-up source ${index + 1}`,
			url: `https://example.org/${index + 1}`,
			published: "",
			kind: "other" as const,
		}));

		const full: MarketReference = {
			...research,
			ranges: [
				{ ...research.ranges[0], sourceIds: [1] },
				{
					...research.ranges[1],
					sourceIds: many.slice(1).map((source) => source.id),
				},
			],
			sources: many,
		};

		const twoNew: Checked = {
			lowUsd: 1_200,
			highUsd: 2_400,
			cited: [
				result("$1,200 to $2,400", "https://example.com/x"),
				result("$1,200 to $2,400", "https://example.com/y"),
			],
		};

		// Two new sources do not fit beside the 59 reserved ones: nothing new to propose.
		expect(
			proposeMarket("1", NOW, full, new Map([["website small", twoNew]])),
		).toBeNull();

		const oneNew = proposeMarket(
			"1",
			NOW,
			full,
			new Map([["website small", { ...twoNew, cited: [twoNew.cited[0]] }]]),
		);

		// The replaced range's old source was reserved but is no longer cited: 58 kept and the 1 new one.
		expect(oneNew?.market.sources).toHaveLength(59);
		expect(
			oneNew?.market.ranges.find((range) => range.kind === "webapp")?.sourceIds,
		).toHaveLength(58);
		expect(
			oneNew?.market.ranges.find((range) => range.kind === "website")
				?.sourceIds,
		).toHaveLength(1);
		expect(readMarketReference(oneNew?.market).ok).toBe(true);
	});

	it("names a source with no title by its link, within the length research holds", () => {
		const url = `https://example.com/${"a".repeat(400)}`;

		const proposal = proposeMarket(
			"1",
			NOW,
			null,
			new Map([
				[
					"website small",
					{
						lowUsd: 1,
						highUsd: 2,
						cited: [{ title: "", url, content: "", published: "" }],
					},
				],
			]),
		);

		expect(proposal?.market.sources[0]?.title).toBe(url.slice(0, 300));
		expect(readMarketReference(proposal?.market).ok).toBe(true);
	});

	it("proposes nothing when no cell has a new figure", () => {
		expect(proposeMarket("1", NOW, research, new Map())).toBeNull();
	});

	it("starts research from nothing when none is accepted", () => {
		const proposal = proposeMarket(
			"1",
			NOW,
			null,
			new Map([
				["workflow large", checked(20_000, 40_000, "https://example.com/w")],
			]),
		);

		expect(proposal?.market.ranges).toHaveLength(1);
		expect(proposal?.market.dayRate).toBeNull();
		expect(readMarketReference(proposal?.market).ok).toBe(true);
	});
});

describe("rebaseProposal", () => {
	const proposal = proposeMarket(
		"001763882580000",
		NOW,
		research,
		new Map([
			[
				"website small",
				{
					lowUsd: 1_200,
					highUsd: 2_400,
					cited: [result("$1,200 to $2,400", "https://example.com/new")],
				},
			],
		]),
	);

	// The owner saved research by hand after the search: a new medium app range, a new day rate and a new caveat.
	const saved: MarketReference = {
		...research,
		researchedOn: "2026-11-20",
		ranges: [
			research.ranges[0],
			{ ...research.ranges[1], lowUsd: 12_000, highUsd: 25_000 },
		],
		dayRate: { lowUsd: 700, highUsd: 1_100 },
	};

	it("changes only the figures the search found and keeps a save made after it (the review of PR #378)", () => {
		const rebased = proposal && rebaseProposal(proposal, saved);

		expect(rebased?.market.ranges).toEqual([
			expect.objectContaining({
				kind: "website",
				size: "small",
				lowUsd: 1_200,
				highUsd: 2_400,
			}),
			expect.objectContaining({
				kind: "webapp",
				size: "medium",
				lowUsd: 12_000,
				highUsd: 25_000,
			}),
		]);
		expect(rebased?.market.dayRate).toEqual({ lowUsd: 700, highUsd: 1_100 });
		expect(rebased?.changes).toContainEqual({
			cell: "webapp medium",
			before: { lowUsd: 12_000, highUsd: 25_000 },
			after: null,
			sourceIds: [],
		});
		expect(rebased?.market.sources.map((source) => source.url)).toEqual([
			"https://example.com/new",
			"https://example.org/two",
		]);
		expect(readMarketReference(rebased?.market).ok).toBe(true);
	});

	it("is the proposal itself over the research it was made from", () => {
		expect(proposal && rebaseProposal(proposal, research)).toEqual(proposal);
	});

	it("keeps no figure from research the owner cleared after the search", () => {
		const rebased = proposal && rebaseProposal(proposal, null);

		expect(rebased?.market.ranges).toHaveLength(1);
		expect(rebased?.market.dayRate).toBeNull();
	});
});

describe("useProposal", () => {
	const proposal = proposeMarket(
		"001763882580000",
		NOW,
		research,
		new Map([
			["website small", { lowUsd: 1, highUsd: 2, cited: [result("$1 $2")] }],
		]),
	);

	const rateOnly = proposeMarket(
		"001763882580000",
		NOW,
		research,
		new Map([
			["the day rate", { lowUsd: 600, highUsd: 900, cited: [result("$600")] }],
		]),
	);

	it("uses only the proposal the page showed, while it is stored (acceptedWasShown)", () => {
		expect(
			Effect.runSync(
				useProposal.decide(
					{ proposalId: "001763882580000" },
					{ stored: proposal, current: research },
				),
			).researchedOn,
		).toBe("2026-11-23");
		expect(
			Effect.runSync(
				Effect.flip(
					useProposal.decide(
						{ proposalId: "001763882599999" },
						{ stored: proposal, current: research },
					),
				),
			)._tag,
		).toBe("ProposalGone");
		expect(
			Effect.runSync(
				Effect.flip(
					useProposal.decide(
						{ proposalId: "001763882580000" },
						{ stored: null, current: research },
					),
				),
			)._tag,
		).toBe("ProposalGone");
	});

	it("refuses a day rate alone once the owner cleared the research it was proposed over", () => {
		expect(
			Effect.runSync(
				useProposal.decide(
					{ proposalId: "001763882580000" },
					{ stored: rateOnly, current: research },
				),
			).dayRate,
		).toEqual({ lowUsd: 600, highUsd: 900 });
		expect(
			Effect.runSync(
				Effect.flip(
					useProposal.decide(
						{ proposalId: "001763882580000" },
						{ stored: rateOnly, current: null },
					),
				),
			)._tag,
		).toBe("ProposalOutdated");
	});
});

describe("what a search sends", () => {
	it("asks only about the kind of work, in the repository's own words, never the stored research's text", () => {
		const query = queryOf(
			{ kind: "website", size: "small" },
			workOf({ kind: "website", size: "small" }),
		);

		expect(query).toContain(DEFAULT_DEFINITIONS.website.small);
		expect(query).not.toContain("A made-up small site.");
		expect(queryOf({ kind: "dayRate" }, "")).toContain("day rate");
		expect(REFRESH_CELLS).toHaveLength(10);
	});
});

// ---- The live services -----------------------------------------------------------------------------------------------

describe("liveMarketSearch", () => {
	it("sends the key as a bearer token and an advanced search of the past year, and reads the results", async () => {
		const calls: [RequestInfo | URL, RequestInit | undefined][] = [];

		const fetcher: typeof fetch = async (input, init) => {
			calls.push([input, init]);

			return new Response(
				JSON.stringify({
					results: [
						{
							title: "Costs",
							url: "https://example.com/c",
							content: "$1,000 to $2,000",
							published_date: "2026-10-05T00:00:00Z",
						},
					],
				}),
			);
		};

		const results = await Effect.runPromise(
			MarketSearch.use((search) => search.search("a query")).pipe(
				Effect.provideContext(liveMarketSearch("tvly-made-up", fetcher)),
			),
		);

		expect(results).toEqual([
			{
				title: "Costs",
				url: "https://example.com/c",
				content: "$1,000 to $2,000",
				published: "2026-10-05",
			},
		]);

		const [url, init] = calls[0] ?? [];

		expect(url).toBe(TAVILY_URL);
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer tvly-made-up",
		);
		expect(JSON.parse(String(init?.body))).toMatchObject({
			query: "a query",
			search_depth: "advanced",
			time_range: "year",
			include_published_date: true,
		});
	});

	it("fails with Tavily's status when it refuses", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(
				MarketSearch.use((search) => search.search("q")).pipe(
					Effect.provideContext(
						liveMarketSearch(
							"bad",
							async () => new Response("{}", { status: 432 }),
						),
					),
				),
			),
		);

		expect(failure).toEqual(new MarketSearchFailed({ status: 432 }));
	});
});

describe("the live reader", () => {
	it("reads a found figure, none, and fails on an answer it cannot read", async () => {
		expect(
			readReading({
				found: true,
				lowUsd: 1,
				highUsd: 2,
				perHour: false,
				sources: [1],
			}),
		).toEqual({ lowUsd: 1, highUsd: 2, perHour: false, sources: [1] });
		expect(
			readReading({ found: false, lowUsd: 0, highUsd: 0, sources: [] }),
		).toBeNull();
		expect(readReading("not json")).toBeUndefined();

		const run: Mock = vi.fn(async () => ({ response: "not json" }));
		const ai = partial<Ai>({ run });

		const failure = await Effect.runPromise(
			Effect.flip(
				MarketReader.use((reader) =>
					reader.read({ kind: "dayRate" }, "", []),
				).pipe(Effect.provideContext(liveMarketReader(ai))),
			),
		);

		expect(failure).toBeInstanceOf(MarketReaderFailed);
	});
});

// ---- The daily run -----------------------------------------------------------------------------------------------

/** A KV namespace in memory, with the members the refresh calls. */
function memoryKv(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));

	const kv = fakeKv({
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
		list: async ({ prefix }: { prefix: string }) => ({
			keys: [...store.keys()].flatMap((name) =>
				name.startsWith(prefix) ? [{ name }] : [],
			),
			list_complete: true,
		}),
	});

	return { kv, store };
}

const pricingWith = (market: MarketReference | null) =>
	JSON.stringify({
		version: 3,
		dayValueCents: null,
		contingencyPercent: 0,
		market,
		updatedAt: "2026-08-01T00:00:00.000Z",
	});

function run(
	initial: Record<string, string>,
	search: (
		query: string,
	) => Effect.Effect<readonly SearchResult[], MarketSearchFailed>,
	read: (
		cell: RefreshCell,
		work: string,
		results: readonly SearchResult[],
	) => Effect.Effect<Reading | null, MarketReaderFailed>,
	during?: (store: Map<string, string>) => void,
) {
	const { kv, store } = memoryKv(initial);
	let pending = during;

	const services = Context.make(ResumeStore, kv).pipe(
		Context.add(MarketSearch, {
			search: (query: string) => {
				// Something the owner does while the run is going (an ask), once.
				pending?.(store);
				pending = undefined;

				return search(query);
			},
		}),
		Context.add(MarketReader, { read }),
	);

	return Effect.runPromise(
		refreshMarket({ now: NOW, hasKey: true }).pipe(
			Effect.provideContext(services),
		),
	).then((outcome) => ({ outcome, store }));
}

const pages = [
	result(
		"Small sites cost $1,200 to $2,400; senior devs $100 to $150 per hour.",
	),
];

describe("the daily run", () => {
	it("does nothing when nothing is due, and searches nothing", async () => {
		const search = vi.fn(() => Effect.succeed(pages));

		const { outcome, store } = await run(
			{
				[PRICING_KEY]: pricingWith({ ...research, researchedOn: "2026-11-01" }),
			},
			search,
			() => Effect.succeed(null),
		);

		expect(outcome).toBe("idle");
		expect(search).not.toHaveBeenCalled();
		expect(store.has(LAST_KEY)).toBe(false);
	});

	it("searches every cell, saves the proposal, replaces older ones, and clears an ask made before it started", async () => {
		const search = vi.fn(() => Effect.succeed(pages));

		const { outcome, store } = await run(
			{
				[PRICING_KEY]: pricingWith(research),
				[ASK_KEY]: "2026-11-22T12:00:00.000Z",
				[`${PROPOSAL_PREFIX}000000000000001`]: "{}",
			},
			search,
			(cell) =>
				Effect.succeed(
					cell.kind === "dayRate"
						? { lowUsd: 100, highUsd: 150, perHour: true, sources: [1] }
						: cell.kind === "website" && cell.size === "small"
							? { lowUsd: 1_200, highUsd: 2_400, perHour: false, sources: [1] }
							: null,
				),
		);

		expect(outcome).toBe("proposal");
		expect(search).toHaveBeenCalledTimes(10);
		expect(store.has(`${PROPOSAL_PREFIX}000000000000001`)).toBe(false);

		const proposal = readProposalText(
			store.get(`${PROPOSAL_PREFIX}${proposalId(NOW)}`) ?? null,
		);

		expect(proposal?.market.dayRate).toEqual({ lowUsd: 800, highUsd: 1_200 });
		expect(
			proposal?.changes.find((change) => change.cell === "website small")
				?.after,
		).toEqual({
			lowUsd: 1_200,
			highUsd: 2_400,
		});
		expect(JSON.parse(store.get(LAST_KEY) ?? "{}")).toEqual({
			at: NOW,
			result: "proposal",
		});
		expect(store.has(ASK_KEY)).toBe(false);
	});

	it("sends Tavily and the model only the repository's definitions, never the stored research's own text", async () => {
		// Research whose definitions the owner wrote, standing in for text that could name a client.
		const owned: MarketReference = {
			...research,
			ranges: research.ranges.map((range) => ({
				...range,
				definition: `Owner text for ${range.kind} ${range.size}`,
			})),
		};

		const search = vi.fn((_query: string) => Effect.succeed(pages));
		const works: string[] = [];

		await run({ [PRICING_KEY]: pricingWith(owned) }, search, (_cell, work) => {
			works.push(work);

			return Effect.succeed(null);
		});

		const sent = [...search.mock.calls.flat(), ...works].join(" ");

		expect(search).toHaveBeenCalledTimes(10);
		expect(sent).not.toContain("Owner text");
		expect(sent).toContain(DEFAULT_DEFINITIONS.webapp.medium);
	});

	it("keeps an ask made after the run started for the next run (askNeverLost)", async () => {
		const later = "2026-11-23T07:30:00.000Z";

		const { store } = await run(
			{ [PRICING_KEY]: pricingWith(research) },
			() => Effect.succeed(pages),
			() => Effect.succeed(null),
			(kv) => kv.set(ASK_KEY, later),
		);

		expect(store.get(ASK_KEY)).toBe(later);
	});

	it("saves nothing when the search fails, with Tavily's status, and answers the ask it tried so it waits a week", async () => {
		const { outcome, store } = await run(
			{
				[PRICING_KEY]: pricingWith(research),
				[ASK_KEY]: "2026-11-22T12:00:00.000Z",
			},
			() => Effect.fail(new MarketSearchFailed({ status: 401 })),
			() => Effect.succeed(null),
		);

		expect(outcome).toBe("failed");
		expect(JSON.parse(store.get(LAST_KEY) ?? "{}")).toEqual({
			at: NOW,
			result: "failed",
			status: 401,
		});
		expect(store.has(ASK_KEY)).toBe(false);
		expect(
			[...store.keys()].some((key) => key.startsWith(PROPOSAL_PREFIX)),
		).toBe(false);

		// The next day nothing is asked and a search was tried this week: no search, so no credits spent.
		expect(
			Option.isNone(
				Effect.runSync(
					startRefresh.decide(
						{ now: "2026-11-24T07:23:00.000Z", hasKey: true },
						{
							askedAt: null,
							last: JSON.parse(store.get(LAST_KEY) ?? "{}"),
							proposalWaiting: false,
							researchedOn: research.researchedOn,
						},
					),
				),
			),
		).toBe(true);
	});

	it("keeps an ask made while a failing run was going (askNeverLost)", async () => {
		const later = "2026-11-23T07:30:00.000Z";

		const { store } = await run(
			{ [PRICING_KEY]: pricingWith(research) },
			() => Effect.fail(new MarketSearchFailed({ status: 0 })),
			() => Effect.succeed(null),
			(kv) => kv.set(ASK_KEY, later),
		);

		expect(store.get(ASK_KEY)).toBe(later);
	});

	it("counts a run the model could not read at all as failed, and one with nothing new as nothing new", async () => {
		const failed = await run(
			{
				[PRICING_KEY]: pricingWith(research),
				[ASK_KEY]: "2026-11-22T12:00:00.000Z",
			},
			() => Effect.succeed(pages),
			() => Effect.fail(new MarketReaderFailed()),
		);

		expect(failed.outcome).toBe("failed");
		expect(failed.store.has(ASK_KEY)).toBe(false);

		const quiet = await run(
			{ [PRICING_KEY]: pricingWith(research) },
			() => Effect.succeed(pages),
			() => Effect.succeed(null),
		);

		expect(quiet.outcome).toBe("nothing-new");
		expect(JSON.parse(quiet.store.get(LAST_KEY) ?? "{}").result).toBe(
			"nothing-new",
		);
	});
});
