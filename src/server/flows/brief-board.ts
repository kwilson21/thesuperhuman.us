// The brief board's interpretation flow (docs/plans/2026-11-living-brief.md, sections 5 and 6). The order matters, as it
// does for the autocomplete: the visitor's pass is checked first, so a request without one counts against nothing; then
// the two Cloudflare rate limits (the visitor's and the site's, under the board's own keys), so a burst is refused
// before the database is asked; then one interpretation is reserved for the day within the rule's limits (read, decide,
// and save behind a guard, three tries in all); then the model is asked, and its answer is read as untrusted data. A
// reservation is not given back when the model fails: its time is spent either way. It builds no response text; the
// route maps each named failure.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	type BoardRequest,
	type ReplyCard,
	answerText,
	readReply,
	replyRefs,
} from "../../lib/brief-board";
import {
	suggestionVisitorHash,
	validSuggestionPass,
} from "../../lib/brief-suggestion-pass";
import {
	forgetOldBudgetDays,
	readBoardBudget,
	reserveBoardBudget,
} from "../brief-board-store";
import { decideAndSave } from "../guarded-save";
import {
	BOARD_SITE_SCOPE,
	boardVisitorScope,
	reserveInterpretation,
} from "../rules/brief-board";
import { BoardModel, BriefRateLimits } from "../services";

/** The visitor has no valid suggestion pass (the autocomplete's): the page renews it once and asks again. */
export class PassRequired extends Data.TaggedError("PassRequired") {}

/** A Cloudflare rate limit refused: too many requests in the last minute, from the visitor or the whole site. */
export class BoardTooFast extends Data.TaggedError("BoardTooFast") {}

/** The model answered something that is not a list of cards. */
export class BoardReplyUnreadable extends Data.TaggedError(
	"BoardReplyUnreadable",
) {}

export type Interpretation = {
	readonly request: BoardRequest;
	/** The address Cloudflare saw. */
	readonly ip: string;
	/** The suggestion pass cookie, as sent. */
	readonly pass: string | undefined;
	/** env.TURNSTILE_SECRET_KEY, which signs the pass and the visitor's daily hash. */
	readonly secret: string;
	/** The time of the request. */
	readonly now: Date;
};

const DAY_MS = 86_400_000;

export const interpretBrief = (asked: Interpretation) =>
	Effect.gen(function* () {
		const { request, ip, pass, secret, now } = asked;

		// Both helpers use only Web Crypto with an HMAC key; a rejection would be a bug, so a defect (500) is intended.
		if (!(yield* Effect.promise(() => validSuggestionPass(pass, secret, ip))))
			return yield* Effect.fail(new PassRequired());

		const hash = yield* Effect.promise(() =>
			suggestionVisitorHash(secret, ip, now.getTime()),
		);

		const visitorScope = boardVisitorScope(hash);
		const limits = yield* BriefRateLimits;

		if (
			!(yield* limits.allow("visitor", visitorScope)) ||
			!(yield* limits.allow("site", BOARD_SITE_SCOPE))
		)
			return yield* Effect.fail(new BoardTooFast());

		const day = now.toISOString().slice(0, 10);

		const previousDay = new Date(now.getTime() - DAY_MS)
			.toISOString()
			.slice(0, 10);

		const { decided } = yield* decideAndSave({
			facts: readBoardBudget(day, visitorScope, BOARD_SITE_SCOPE),
			decide: (facts) =>
				reserveInterpretation
					.decide({ day, previousDay, visitorScope }, facts)
					.pipe(Effect.map(Option.some)),
			save: reserveBoardBudget,
		});

		// The day's first reservation clears the counts of older days. Best effort: a failure leaves them for tomorrow's first.
		if (Option.isSome(decided) && decided.value.cleanBefore)
			yield* forgetOldBudgetDays(decided.value.cleanBefore).pipe(Effect.ignore);

		const model = yield* BoardModel;
		const raw = yield* model.interpret(request);
		const cards = readReply(raw, answerText(request.answers, request.path));

		if (cards === null) return yield* Effect.fail(new BoardReplyUnreadable());

		// A reply may name only cards the request showed it; a ref it made up is dropped, and the card counts as new.
		const shown = new Set(request.cards.map((card) => card.ref));

		return {
			cards: cards.map(
				(card): ReplyCard =>
					shown.has(card.ref) ? card : { ...card, ref: "" },
			),
			// The shown cards the reply named in a card left out above, so they are not withdrawn. A card the reply kept is
			// named by that card itself (in its own lane: a card moved to another lane is moved, not copied).
			refs: [...new Set(replyRefs(raw))].filter(
				(ref) => shown.has(ref) && !cards.some((card) => card.ref === ref),
			),
		};
	});
