// What the brief board's route reads from a request before anything runs: the path, its written answers (only the boxes
// that path sends, src/lib/brief-board.ts `boardAnswerKeys`) and the board's cards as context, decoded with Effect Schema.
// The whole of it must fit the prompt the cost table in the plan assumes (6,000 characters) and hold enough words to
// interpret. Anything else is a 400; the page never sends it.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
	ANSWER_MAX,
	type BoardRequest,
	CONTEXT_MAX,
	LANES,
	answerText,
	boardAnswerKeys,
	textLimits,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";

/** The most characters of answers and card text one request may carry. */
export const BOARD_CONTENT_MAX = 6000;

/** The fewest words of answers worth interpreting; the page waits for as many. */
export const BOARD_MIN_WORDS = 6;

/** The request as the page sends it. Server only: Array and Record schemas stay out of the browser bundle. */
const BoardRequestSchema = Schema.Struct({
	path: Schema.Literals(["website", "webapp", "workflow"]),
	answers: Schema.Record(
		Schema.String.check(Schema.isMaxLength(20)),
		Schema.String.check(Schema.isMaxLength(2000)),
	),
	cards: Schema.Array(
		Schema.Struct({
			ref: Schema.String.check(Schema.isMaxLength(12)),
			lane: Schema.Literals(LANES),
			text: Schema.String.check(
				Schema.isMaxLength(textLimits.questions + ANSWER_MAX + 12),
			),
			state: Schema.Literals(["open", "yours", "avoid"]),
		}),
	).check(Schema.isMaxLength(CONTEXT_MAX)),
});

const decodeRequest = Schema.decodeUnknownResult(BoardRequestSchema);

export function readBoardInput(
	body: RawValue,
): { ok: true; value: BoardRequest } | { ok: false } {
	const read = decodeRequest(body);

	if (Result.isFailure(read)) return { ok: false };

	const { path, cards } = read.success;

	const answers = Object.fromEntries(
		boardAnswerKeys[path].map((key) => [
			key,
			Object.hasOwn(read.success.answers, key) ? read.success.answers[key] : "",
		]),
	);

	const text = answerText(answers, path);
	const refs = new Set(cards.map((card) => card.ref));

	const size =
		text.length + cards.reduce((sum, card) => sum + card.text.length, 0);

	if (
		size > BOARD_CONTENT_MAX ||
		text.split(/\s+/).filter(Boolean).length < BOARD_MIN_WORDS ||
		refs.size !== cards.length ||
		cards.some((card) => !/^c\d{1,6}$/.test(card.ref))
	)
		return { ok: false };

	return { ok: true, value: { path, answers, cards } };
}
