// What the offer board's route reads before anything runs (docs/plans/2026-11-offer-board.md, section 5): the board's
// cards as context and the offer as drafted in the page, without fees, decoded with Effect Schema. The brief itself is
// read from the database, so the page cannot change what the model sees of it. Anything else is a 400.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { RawValue } from "../lib/fields";
import {
	ACCEPTANCE_MAX,
	DELIVERABLES_MAX,
	ITEM_MAX,
	OFFER_CONTENT_MAX,
	OFFER_CONTEXT_MAX,
	OFFER_LANES,
	type OfferBoardRequest,
} from "../lib/offer-board";

const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));

const OfferBoardRequestSchema = Schema.Struct({
	cards: Schema.Array(
		Schema.Struct({
			ref: Schema.String.check(Schema.isPattern(/^c\d{1,6}$/)),
			lane: Schema.Literals(OFFER_LANES),
			text: text(400),
			state: Schema.Literals(["open", "yours", "avoid"]),
		}),
	).check(Schema.isMaxLength(OFFER_CONTEXT_MAX)),
	draft: Schema.Struct({
		outcome: text(120),
		summary: text(300),
		milestones: Schema.Array(
			Schema.Struct({
				name: text(80),
				deliverables: Schema.Array(text(ITEM_MAX)).check(
					Schema.isMaxLength(DELIVERABLES_MAX),
				),
				acceptance: Schema.Array(text(ITEM_MAX)).check(
					Schema.isMaxLength(ACCEPTANCE_MAX),
				),
			}),
		).check(Schema.isMaxLength(3)),
		clientInputs: text(1000),
		exclusions: text(1000),
		timing: text(500),
	}),
});

const decodeRequest = Schema.decodeUnknownResult(OfferBoardRequestSchema);

export function readOfferBoardInput(
	body: RawValue,
): { ok: true; value: OfferBoardRequest } | { ok: false } {
	const read = decodeRequest(body);

	if (Result.isFailure(read)) return { ok: false };
	const { cards, draft } = read.success;
	const refs = new Set(cards.map((card) => card.ref));

	const size =
		JSON.stringify(draft).length +
		cards.reduce((sum, card) => sum + card.text.length, 0);

	if (refs.size !== cards.length || size > OFFER_CONTENT_MAX)
		return { ok: false };

	return { ok: true, value: { cards, draft } };
}
