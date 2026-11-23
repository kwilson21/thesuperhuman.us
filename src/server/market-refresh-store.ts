// Where the market refresh keeps its state (docs/plans/2026-11-market-refresh.md): the owner's ask, the last run and the
// proposals, as KV keys in RESUME_STORE beside the pricing record (src/server/pricing-store.ts), not in MUSIC_DB (a new
// table would change the digest every golden case records). A proposal is written once under its own key and never
// changed; using or discarding one removes that key only (verification/market-refresh.qnt). One function per operation;
// none decides anything. Any KV failure is a MarketRefreshStoreFailed, with no fields.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { readMarketReference } from "../lib/pricing-reference";
import type { LastRun, MarketProposal } from "./rules/market-refresh";
import { ResumeStore } from "./services";

/** When the owner asked for a search (ISO 8601). */
export const ASK_KEY = "pricing:refresh-asked";

/** The last run: when it started and how it ended. */
export const LAST_KEY = "pricing:refresh-last";

/** Each proposal's key is this prefix and its id, which is the time it was made in milliseconds (so newer sorts later). */
export const PROPOSAL_PREFIX = "pricing:proposal:";

/** A proposal's id: the time it was made, in milliseconds, padded so ids sort in time order. */
export const proposalId = (now: string) =>
	String(Date.parse(now)).padStart(15, "0");

/** KV failed. The error carries no text. */
export class MarketRefreshStoreFailed extends Data.TaggedError(
	"MarketRefreshStoreFailed",
) {}

const LastRunSchema = Schema.Struct({
	at: Schema.String,
	result: Schema.Literals(["started", "proposal", "nothing-new", "failed"]),
	status: Schema.optional(Schema.Number),
});

const FiguresSchema = Schema.NullOr(
	Schema.Struct({ lowUsd: Schema.Number, highUsd: Schema.Number }),
);

const ProposalSchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	basedOn: Schema.NullOr(Schema.String),
	market: Schema.Unknown,
	changes: Schema.Array(
		Schema.Struct({
			cell: Schema.String,
			before: FiguresSchema,
			after: FiguresSchema,
			sourceIds: Schema.Array(Schema.Number),
		}),
	),
});

const decodeLast = Schema.decodeUnknownOption(
	Schema.fromJsonString(LastRunSchema),
);

const decodeProposal = Schema.decodeUnknownOption(
	Schema.fromJsonString(ProposalSchema),
);

/** A stored proposal, read defensively: anything unreadable reads as none. */
export function readProposalText(text: string | null): MarketProposal | null {
	const decoded = decodeProposal(text);

	if (Option.isNone(decoded)) return null;

	const market = readMarketReference(decoded.value.market);

	return market.ok ? { ...decoded.value, market: market.value } : null;
}

/** The last run, read defensively. */
export function readLastText(text: string | null): LastRun | null {
	return Option.getOrNull(decodeLast(text));
}

/** The ask, read defensively: a date, or none. */
export const readAskText = (text: string | null) =>
	text !== null && Predicate.isString(text) && !Number.isNaN(Date.parse(text))
		? text
		: null;

/** The newest proposal's key, or null. */
async function newestKey(kv: KVNamespace): Promise<string | null> {
	const listed = await kv.list({ prefix: PROPOSAL_PREFIX });

	return (
		listed.keys
			.map((key) => key.name)
			.sort()
			.at(-1) ?? null
	);
}

/** What the owner's page shows (not an Effect program): the waiting proposal, the last run and the ask. */
export async function loadRefreshView(kv: KVNamespace) {
	const [key, last, asked] = await Promise.all([
		newestKey(kv),
		kv.get(LAST_KEY),
		kv.get(ASK_KEY),
	]);

	return {
		proposal: key ? readProposalText(await kv.get(key)) : null,
		last: readLastText(last),
		askedAt: readAskText(asked),
	};
}

const tried = <A>(work: (kv: KVNamespace) => Promise<A>) =>
	Effect.gen(function* () {
		const kv = yield* ResumeStore;

		return yield* Effect.tryPromise({
			try: () => work(kv),
			catch: () => new MarketRefreshStoreFailed(),
		});
	});

/** The ask, or null. */
export const readAsk = tried(async (kv) => readAskText(await kv.get(ASK_KEY)));

/** Stores the time of the owner's ask. */
export const writeAsk = (at: string) => tried((kv) => kv.put(ASK_KEY, at));

/** Removes the ask. */
export const clearAsk = tried((kv) => kv.delete(ASK_KEY));

/** The last run, or null. */
export const readLast = tried(async (kv) =>
	readLastText(await kv.get(LAST_KEY)),
);

/** Stores the last run. */
export const writeLast = (last: LastRun) =>
	tried((kv) => kv.put(LAST_KEY, JSON.stringify(last)));

/** The newest stored proposal, or null. */
export const readNewestProposal = tried(async (kv) => {
	const key = await newestKey(kv);

	return key ? readProposalText(await kv.get(key)) : null;
});

/** The proposal with this id, or null. */
export const readProposal = (id: string) =>
	tried(async (kv) =>
		readProposalText(await kv.get(`${PROPOSAL_PREFIX}${id}`)),
	);

/** Stores a new proposal under its own key. */
export const writeProposal = (proposal: MarketProposal) =>
	tried((kv) =>
		kv.put(`${PROPOSAL_PREFIX}${proposal.id}`, JSON.stringify(proposal)),
	);

/** Removes the proposal with this id, and only it. */
export const deleteProposal = (id: string) =>
	tried((kv) => kv.delete(`${PROPOSAL_PREFIX}${id}`));

/** Removes every proposal older than this id (a new proposal replaces them). */
export const deleteProposalsBefore = (id: string) =>
	tried(async (kv) => {
		const listed = await kv.list({ prefix: PROPOSAL_PREFIX });

		await Promise.all(
			listed.keys
				.map((key) => key.name)
				.filter((name) => name < `${PROPOSAL_PREFIX}${id}`)
				.map((name) => kv.delete(name)),
		);
	});
