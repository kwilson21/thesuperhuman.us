// The offer board's sequence (docs/plans/2026-11-offer-board.md, section 5): read the request and the owner's count,
// reserve one suggestion (decided by src/server/rules/offer-board.ts, guarded in the store, three tries), read the
// owner's market research for this kind of work, ask the model, and read its reply as untrusted data. It builds no
// response text; the route maps every refusal.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	cardRefs,
	keptRefs,
	type OfferBoardRequest,
	type OfferReply,
	readOfferReply,
} from "../../lib/offer-board";
import type { MarketRange } from "../../lib/pricing-reference";
import { decideAndSave } from "../guarded-save";
import {
	type OfferBrief,
	readOfferRequest,
	reserveOfferBudget,
} from "../offer-board-store";
import { readPricing } from "../pricing-store";
import { reserveOfferSuggestion } from "../rules/offer-board";
import { OfferModel } from "../services";

/** The model answered something that is not a list of cards. */
export class OfferReplyUnreadable extends Data.TaggedError(
	"OfferReplyUnreadable",
) {}

export type OfferSuggestion = {
	/** The request's id. */
	readonly id: string;
	readonly request: OfferBoardRequest;
	readonly now: Date;
};

export type OfferAnswer = OfferReply & {
	/** The shown cards the reply kept (its keep list) or named in a card left out, so the page does not withdraw them. */
	readonly refs: readonly string[];
};

export const suggestOffer = (asked: OfferSuggestion) =>
	Effect.gen(function* () {
		const { id, request, now } = asked;
		const day = now.toISOString().slice(0, 10);
		let brief: OfferBrief | null = null;

		yield* decideAndSave({
			facts: readOfferRequest(id, day).pipe(
				Effect.tap((read) =>
					Effect.sync(() => {
						brief = read.brief;
					}),
				),
				Effect.map((read) => read.facts),
			),
			decide: (facts) =>
				reserveOfferSuggestion
					.decide({ day }, facts)
					.pipe(Effect.map(Option.some)),
			save: reserveOfferBudget,
		});

		// The rule refused a request without a brief of a kind it prices, so there is one here.
		if (!brief)
			return yield* Effect.die("the rule passed a request with no brief");
		const read: OfferBrief = brief;

		// The research grounds the model's figure. Without it (never saved, or the store failed) the board still works.
		const pricing = yield* readPricing.pipe(
			Effect.map(Option.some),
			Effect.catchTag("PricingStoreFailed", () =>
				Effect.succeed(Option.none()),
			),
		);

		const ranges: MarketRange[] = Option.isSome(pricing)
			? [...(pricing.value.market?.ranges ?? [])].filter(
					(range) => range.kind === read.kind && range.highUsd > 0,
				)
			: [];

		const model = yield* OfferModel;
		const raw = yield* model.suggest({ brief: read, request, ranges });
		const reply = readOfferReply(raw);

		if (!reply) return yield* Effect.fail(new OfferReplyUnreadable());

		// A reply may name only cards the request showed it; a ref it made up is dropped, and the card counts as new.
		const shown = new Set(request.cards.map((card) => card.ref));

		const cards = reply.cards.map((card) =>
			shown.has(card.ref) ? card : { ...card, ref: "" },
		);

		const answer: OfferAnswer = {
			...reply,
			cards,
			refs: [...new Set([...cardRefs(raw), ...keptRefs(raw)])].filter(
				(ref) => shown.has(ref) && !cards.some((card) => card.ref === ref),
			),
		};

		return answer;
	});
