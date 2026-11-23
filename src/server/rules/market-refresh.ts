// The market refresh (docs/plans/2026-11-market-refresh.md): whether the daily run searches, which figures a search may
// propose, and the proposal they make. It decides from facts read first (the owner's ask, the last run, whether a
// proposal is waiting, the accepted research's date, whether the Tavily key is set) and the run's time, and from what the
// search and the model answered; it reads no clock, store or network. Nothing re-checks the start at write time: one
// daily run writes the marker, and the owner's ask is cleared only when it was made before the run started
// (verification/market-refresh.qnt, askNeverLost). Using a proposal goes through `savePricing` (./pricing.ts) with the
// version the owner's page read, and refuses a proposal a newer search replaced (acceptedWasShown).
import * as Data from "effect/Data";
import {
	MARKET_USD_MAX,
	type MarketRange,
	type MarketReference,
	type MarketSource,
	PRICING_KINDS,
	PRICING_SIZES,
	type PricingKind,
	type PricingSize,
} from "../../lib/pricing-reference";
import { alwaysWrites, rule, term, unless } from "../terms";

/** Days after which accepted research is searched again. */
export const REFRESH_AFTER_DAYS = 90;

/** Days a failing scheduled search waits before it tries again (an ask from the owner does not wait). */
export const RETRY_AFTER_DAYS = 7;

/** Most results a search cell may cite. */
export const CITED_MAX = 3;

/** The last run: when it started and how it ended ("started" while it runs, or if it never finished). */
export type LastRun = {
	readonly at: string;
	readonly result: "started" | "proposal" | "nothing-new" | "failed";
	/** A failed search: Tavily's HTTP status, or 0 when it gave no answer. */
	readonly status?: number;
};

export type RefreshFacts = {
	/** When the owner asked for a search, ISO 8601; null when no ask is waiting. */
	readonly askedAt: string | null;
	readonly last: LastRun | null;
	/** A proposal is stored that the owner has neither used nor discarded. */
	readonly proposalWaiting: boolean;
	/** The accepted research's date, YYYY-MM-DD; null when there is none. */
	readonly researchedOn: string | null;
};

export type RefreshStart = {
	/** When the run starts, ISO 8601. */
	readonly now: string;
	/** The Tavily key is set. */
	readonly hasKey: boolean;
};

type StartGiven = RefreshStart & RefreshFacts;

const daysSince = (from: string, now: string) =>
	(Date.parse(now) - Date.parse(from)) / 86_400_000;

const due = (g: StartGiven) =>
	g.hasKey &&
	(g.askedAt !== null ||
		(!g.proposalWaiting &&
			(g.researchedOn === null ||
				daysSince(`${g.researchedOn}T00:00:00.000Z`, g.now) >=
					REFRESH_AFTER_DAYS) &&
			(g.last === null || daysSince(g.last.at, g.now) >= RETRY_AFTER_DAYS)));

const notDue = term<StartGiven>(
	"no search is due: the key is not set, or the owner has not asked and the research is new, a proposal is waiting or a search was tried this week",
	(g) => !due(g),
);

/** Whether the daily run searches; when it does, the marker it writes first (so a failing search waits a week). */
export const startRefresh = rule({
	name: "Start a search for new market figures",
	given: (request: RefreshStart, facts: RefreshFacts): StartGiven => ({
		...request,
		...facts,
	}),
	nothingToDoIf: notDue,
	refusals: [],
	writes: (g): LastRun => ({ at: g.now, result: "started" }),
	writesText: "the time the search started, as the last run",
});

/** Whether the run clears the owner's ask: only one made before the run started (a later one waits for the next run). */
export const askServed = (askedAt: string | null, startedAt: string) =>
	askedAt !== null && Date.parse(askedAt) <= Date.parse(startedAt);

// ---- What a search may propose ------------------------------------------------------------------------------------

/** A cell of the research: a kind of work and size, or the senior day rate. */
export type RefreshCell =
	| { readonly kind: PricingKind; readonly size: PricingSize }
	| { readonly kind: "dayRate" };

/** Every cell a search covers, in the order the run searches them. */
export const REFRESH_CELLS: readonly RefreshCell[] = [
	...PRICING_KINDS.flatMap((kind) =>
		PRICING_SIZES.map((size) => ({ kind, size })),
	),
	{ kind: "dayRate" },
];

export const cellName = (cell: RefreshCell) =>
	cell.kind === "dayRate" ? "the day rate" : `${cell.kind} ${cell.size}`;

/** What each kind and size means when the accepted research does not say (the search asks about this). */
export const DEFAULT_DEFINITIONS: Record<
	PricingKind,
	Record<PricingSize, string>
> = {
	website: {
		small: "A brochure site of about 1 to 5 pages with a contact form.",
		medium:
			"About 5 to 15 pages with a custom design and an editing setup such as a blog.",
		large:
			"A site with custom features beyond pages, such as a small store, bookings or memberships.",
	},
	webapp: {
		small: "A single-purpose internal tool or dashboard with a few screens.",
		medium:
			"An MVP or internal app with accounts, roles, several workflows and one or two integrations.",
		large:
			"A multi-role product with payments, several integrations, reporting and an admin area.",
	},
	workflow: {
		small: "One automation or integration between two systems.",
		medium:
			"Several connected automations, or one data pipeline with multiple sources.",
		large:
			"A multi-source data platform or ETL system with orchestration, monitoring and dashboards.",
	},
};

/** A search result as the search service gives it. */
export type SearchResult = {
	readonly title: string;
	readonly url: string;
	readonly content: string;
	/** YYYY-MM-DD, or "" when the search found no date. */
	readonly published: string;
};

/** What the model read from a cell's results: the figures as the results state them, and the results that state them. */
export type Reading = {
	readonly lowUsd: number;
	readonly highUsd: number;
	/** Day rate only: the results gave a rate per hour, which code turns into a day of 8 hours. */
	readonly perHour: boolean;
	/** 1-based numbers of the results that state the figures. */
	readonly sources: readonly number[];
};

/** A figure that passed the check, with the results it came from. */
export type Checked = {
	readonly lowUsd: number;
	readonly highUsd: number;
	readonly cited: readonly SearchResult[];
};

const DOLLARS =
	/(?:\$\s?|\bUSD\s?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?([kK]|[mM](?![a-z]))?|(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?([kK])?\s?(?:USD|US dollars|dollars)\b/g;

/** What "k" and "m" after an amount multiply it by. */
const SCALES = new Map([
	["k", 1_000],
	["m", 1_000_000],
]);

/** Every dollar amount a text states, in whole dollars: "$5,000", "$5k", "$2.5K", "USD 5,000", "5,000 dollars". */
export function dollarAmounts(text: string): number[] {
	const amounts: number[] = [];

	for (const match of text.matchAll(DOLLARS)) {
		const whole = match[1] ?? match[4] ?? "";
		const part = match[2] ?? match[5] ?? "";
		const scale = (match[3] ?? match[6] ?? "").toLowerCase();

		const value =
			Number(`${whole.replaceAll(",", "")}${part ? `.${part}` : ""}`) *
			(SCALES.get(scale) ?? 1);

		if (Number.isFinite(value)) amounts.push(Math.round(value));
	}

	return amounts;
}

/** Hours in the day the board's day rate counts. */
const HOURS_A_DAY = 8;

/**
 * Whether a reading stands: both ends are whole dollars, the low end is not above the high end, and each end appears as a
 * dollar amount in the text of a result the reading cites (the November research's rule that each figure is re-read in
 * its source). An hourly day rate is checked as stated, then made a day of 8 hours. Null when it does not stand.
 */
export function checkReading(
	cell: RefreshCell,
	reading: Reading,
	results: readonly SearchResult[],
): Checked | null {
	const cited = [...new Set(reading.sources)]
		.flatMap((index) => {
			const result = Number.isInteger(index) ? results[index - 1] : undefined;

			return result?.url.startsWith("https://") ? [result] : [];
		})
		.slice(0, CITED_MAX);

	const max = cell.kind === "dayRate" ? 100_000 : MARKET_USD_MAX;

	if (
		cited.length === 0 ||
		!Number.isInteger(reading.lowUsd) ||
		!Number.isInteger(reading.highUsd) ||
		reading.lowUsd < 1 ||
		reading.lowUsd > reading.highUsd ||
		(cell.kind !== "dayRate" && reading.perHour)
	)
		return null;

	const stated = new Set(
		cited.flatMap((result) => dollarAmounts(result.content)),
	);

	if (!stated.has(reading.lowUsd) || !stated.has(reading.highUsd)) return null;

	const scale = cell.kind === "dayRate" && reading.perHour ? HOURS_A_DAY : 1;
	const lowUsd = reading.lowUsd * scale;
	const highUsd = reading.highUsd * scale;

	return highUsd > max ? null : { lowUsd, highUsd, cited };
}

// ---- The proposal -------------------------------------------------------------------------------------------------

/** One cell of a proposal, for the owner's page: the figures before and after, or kept when the search found none. */
export type ProposalChange = {
	readonly cell: string;
	readonly before: { readonly lowUsd: number; readonly highUsd: number } | null;
	readonly after: { readonly lowUsd: number; readonly highUsd: number } | null;
	/** The proposal's source ids the new figures came from (none when kept). */
	readonly sourceIds: readonly number[];
};

export type MarketProposal = {
	readonly id: string;
	readonly createdAt: string;
	/** The accepted research's date the search started from, or null. */
	readonly basedOn: string | null;
	readonly market: MarketReference;
	readonly changes: readonly ProposalChange[];
};

/** Most sources a research record holds (readMarketReference). */
const SOURCES_MAX = 60;

const day = (iso: string) => iso.slice(0, 10);

/** The research's range for a kind and size, if it has one. */
const rangeOf = (
	market: MarketReference | null,
	kind: PricingKind,
	size: PricingSize,
) =>
	market?.ranges.find((range) => range.kind === kind && range.size === size) ??
	null;

/**
 * The proposal a search makes: a whole research record (the shape /owner/pricing imports) with each cell's checked
 * figures, or the accepted research's own where the search found none, the sources of both renumbered from 1, and
 * caveats saying how it was made. Null when no cell has a new figure: there is nothing to propose.
 */
export function proposeMarket(
	id: string,
	now: string,
	current: MarketReference | null,
	found: ReadonlyMap<string, Checked | null>,
): MarketProposal | null {
	const sources: MarketSource[] = [];
	const idOf = new Map<string, number>();

	const addSource = (source: Omit<MarketSource, "id">) => {
		const known = idOf.get(source.url);

		if (known !== undefined) return known;

		if (sources.length >= SOURCES_MAX) return null;
		const next = sources.length + 1;

		sources.push({ ...source, id: next });
		idOf.set(source.url, next);

		return next;
	};

	const cited = (checked: Checked) =>
		checked.cited.flatMap((result) => {
			const sourceId = addSource({
				title: result.title.slice(0, 300) || result.url,
				url: result.url.slice(0, 600),
				published: result.published,
				kind: "web search",
			});

			return sourceId === null ? [] : [sourceId];
		});

	const changes: ProposalChange[] = [];
	const ranges: MarketRange[] = [];

	for (const kind of PRICING_KINDS)
		for (const size of PRICING_SIZES) {
			const name = cellName({ kind, size });
			const accepted = rangeOf(current, kind, size);
			const checked = found.get(name) ?? null;

			if (checked) {
				const sourceIds = cited(checked);

				ranges.push({
					kind,
					size,
					definition: accepted?.definition ?? DEFAULT_DEFINITIONS[kind][size],
					lowUsd: checked.lowUsd,
					highUsd: checked.highUsd,
					sourceIds,
				});
				changes.push({
					cell: name,
					before: accepted && {
						lowUsd: accepted.lowUsd,
						highUsd: accepted.highUsd,
					},
					after: { lowUsd: checked.lowUsd, highUsd: checked.highUsd },
					sourceIds,
				});
			} else if (accepted) {
				const sourceIds = accepted.sourceIds.flatMap((sourceId) => {
					const source = current?.sources.find((each) => each.id === sourceId);
					const kept = source && addSource({ ...source });

					return kept ? [kept] : [];
				});

				ranges.push({ ...accepted, sourceIds });
				changes.push({
					cell: name,
					before: { lowUsd: accepted.lowUsd, highUsd: accepted.highUsd },
					after: null,
					sourceIds: [],
				});
			}
		}

	const rate = found.get(cellName({ kind: "dayRate" })) ?? null;
	const rateSources = rate ? cited(rate) : [];

	changes.push({
		cell: cellName({ kind: "dayRate" }),
		before: current?.dayRate ?? null,
		after: rate && { lowUsd: rate.lowUsd, highUsd: rate.highUsd },
		sourceIds: rateSources,
	});

	if (!changes.some((change) => change.after !== null) || ranges.length === 0)
		return null;

	const kept = changes.flatMap((change) =>
		change.after === null && change.before !== null ? [change.cell] : [],
	);

	const caveats = [
		`Found by an automatic web search on ${day(now)}. Each new figure appears in the text of a source it cites; no one weighed the sources as a hand-checked research would, and many are vendor or agency pages.`,
		...(rate
			? [
					`The day rate comes from ${rateSources.map((sourceId) => `source ${sourceId}`).join(", ")}; a rate per hour counts as 8 hours.`,
				]
			: []),
		...(kept.length > 0 && current
			? [
					`Kept from the research of ${current.researchedOn}, which the search found no checked figure for: ${kept.join(", ")}. That research's caveats are not carried over; its sources for the kept figures are.`,
				]
			: []),
	];

	return {
		id,
		createdAt: now,
		basedOn: current?.researchedOn ?? null,
		market: {
			researchedOn: day(now),
			ranges,
			dayRate: rate
				? { lowUsd: rate.lowUsd, highUsd: rate.highUsd }
				: (current?.dayRate ?? null),
			caveats,
			sources,
		},
		changes,
	};
}

// ---- Using a proposal ---------------------------------------------------------------------------------------------

export class ProposalGone extends Data.TaggedError("ProposalGone") {
	readonly say =
		"These figures were replaced by a newer search or discarded. Reload to see what is waiting.";
}

/** Using a proposal: only the one the owner's page showed, while it is still stored. */
export const useProposal = alwaysWrites({
	name: "Use the proposed market figures",
	given: (
		request: { readonly proposalId: string },
		stored: MarketProposal | null,
	) => ({ ...request, stored }),
	refusals: [
		unless(
			term<{ proposalId: string; stored: MarketProposal | null }>(
				"the proposal the owner's page showed is still stored",
				(g) => g.stored?.id === g.proposalId,
			),
			() => new ProposalGone(),
		),
	],
	writes: (g): MarketReference => {
		// SAFETY: the refusal above holds only when the stored proposal is the one asked for, so it is not null here.
		const proposal = g.stored as MarketProposal;

		return proposal.market;
	},
	writesText: "the proposal's research, for the versioned save",
});

// ---- What a search asks ----------------------------------------------------------------------------------------

/** What a cell's search and reading are about: the accepted research's definition, or the default. */
export const workOf = (cell: RefreshCell, current: MarketReference | null) =>
	cell.kind === "dayRate"
		? "A senior independent software developer's day rate."
		: (rangeOf(current, cell.kind, cell.size)?.definition ??
			DEFAULT_DEFINITIONS[cell.kind][cell.size]);

/** A cell's search query: fixed text about the kind of work, never anything about a client. */
export const queryOf = (cell: RefreshCell, work: string) =>
	cell.kind === "dayRate"
		? "senior freelance software developer day rate or rate per hour in the United States"
		: `how much does an independent developer in the United States charge as a fixed price for this project: ${work}`.slice(
				0,
				400,
			);
