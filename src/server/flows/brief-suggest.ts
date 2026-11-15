// A brief suggestion: the visitor has typed three words or more and asks what comes next. The order is the one the route
// has always used, and it matters: the pass is checked before anything is counted; the visitor's minute limit is counted
// before the site's, and the site's before the budget is read; the budget is reserved for the visitor, then for the site,
// with a cleanup of old days started once the site's reservation is the first of the day; the model is asked last, with a
// 1200 ms limit. Every refusal is decided by a rule and answered quietly. A store, limiter, signing or reply failure is a
// named error the route logs (the cause, as it always was) and answers 500; a model failure answers 503, logged as a fixed
// line, never with the model's own text.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import {
	suggestionVisitorHash,
	validSuggestionPass,
} from "../../lib/brief-suggestion-pass";
import { clearOldDays, readSiteCount, reserve } from "../brief-suggest-store";
import { logUnexpected } from "../failure";
import {
	askForSuggestion,
	requirePass,
	SITE_DAILY_CAP,
	suggestionFromReply,
	VISITOR_DAILY_CAP,
	withinMinuteLimits,
	withinSiteBudget,
} from "../rules/brief-suggest";
import { Assistant, Background, MusicDb, SuggestLimits } from "../services";

const ROUTE = "/api/software/brief/suggest";

/** The model's time, in milliseconds: a reply after this is no reply. */
const MODEL_TIMEOUT_MS = 1200;

/** A signing (HMAC) call failed. */
export class SuggestSigningFailed extends Data.TaggedError(
	"SuggestSigningFailed",
)<{
	readonly raised: unknown;
}> {}

/** The model answered with something that is not a reply object (the route logs the cause and answers 500). */
export class ReplyUnreadable extends Data.TaggedError("ReplyUnreadable")<{
	readonly raised: unknown;
}> {}

export type SuggestAnswer =
	| { readonly kind: "empty" }
	| { readonly kind: "passRequired" }
	| { readonly kind: "modelUnavailable" }
	| { readonly kind: "suggestion"; readonly suggestion: string };

export type SuggestSubmission = {
	readonly text: string;
	/** The JSON of the reader's value: the model's prompt. */
	readonly content: string;
	readonly ip: string | null;
	/** The pass cookie the visitor sent, or undefined. */
	readonly cookie: string | undefined;
	readonly secret: string;
	/** The time in milliseconds, read once when the request starts. */
	readonly now: () => number;
};

/** Whether a rule allowed the request; a refusal is an answer, not a failure. */
const allowed = <A, E>(decision: Effect.Effect<A, E>) =>
	Effect.map(Effect.result(decision), Result.isSuccess);

/** The reply's text, read as the route always read it: a missing or non-string response is empty, and a value that cannot have a field is a failure. */
const replyText = <Reply>(reply: Reply) => {
	if (!reply) return Effect.succeed("");

	// A truthy primitive cannot have a field: the route's `in` check threw on it, and that is a failure.
	if (!Predicate.isObject(reply))
		return Effect.fail(
			new ReplyUnreadable({
				raised: new TypeError("The model reply is not an object"),
			}),
		);

	const text = Predicate.hasProperty(reply, "response") ? reply.response : "";

	return Effect.succeed(Predicate.isString(text) ? text.trim() : "");
};

/** The old days' cleanup as a background task: it runs after the response, and a failure is logged as the route always logged it. */
const cleanup = (previousDay: string, db: D1Database) => () => {
	try {
		return clearOldDays(db, previousDay).then(
			() => undefined,
			(cause: Error) => logUnexpected(ROUTE, cause),
		);
	} catch (cause) {
		logUnexpected(ROUTE, cause);

		return Promise.resolve();
	}
};

export const suggest = (submission: SuggestSubmission) =>
	Effect.gen(function* () {
		const now = submission.now();
		const day = new Date(now).toISOString().slice(0, 10);
		const previousDay = new Date(now - 86400000).toISOString().slice(0, 10);

		const asked = yield* Effect.result(
			askForSuggestion.decide(
				{
					text: submission.text,
					content: submission.content,
					ip: submission.ip,
				},
				{},
			),
		);

		if (Result.isFailure(asked)) return { kind: "empty" } as const;
		const ip = asked.success.ip;

		const valid = yield* Effect.tryPromise({
			try: () => validSuggestionPass(submission.cookie, submission.secret, ip),
			catch: (cause) => new SuggestSigningFailed({ raised: cause }),
		});

		if (!(yield* allowed(requirePass.decide({ valid }, {}))))
			return { kind: "passRequired" } as const;

		const hash = yield* Effect.tryPromise({
			try: () => suggestionVisitorHash(submission.secret, ip, now),
			catch: (cause) => new SuggestSigningFailed({ raised: cause }),
		});

		const limits = yield* SuggestLimits;
		const visitor = yield* limits.visitor(hash);
		const site = visitor ? yield* limits.site("site") : false;

		if (!(yield* allowed(withinMinuteLimits.decide({ visitor, site }, {}))))
			return { kind: "empty" } as const;

		const siteCount = yield* readSiteCount(day);

		if (!(yield* allowed(withinSiteBudget.decide({ siteCount }, {}))))
			return { kind: "empty" } as const;

		const background = yield* Background;
		const db = yield* MusicDb;

		for (const [scope, cap] of [
			[hash, VISITOR_DAILY_CAP],
			["site", SITE_DAILY_CAP],
		] as const) {
			const reserved = yield* reserve(day, scope, cap);

			if (reserved === null) return { kind: "empty" } as const;

			if (scope === "site" && reserved === 1)
				yield* background.schedule(cleanup(previousDay, db));
		}

		const assistant = yield* Assistant;

		const reply = yield* Effect.result(
			assistant.complete(submission.content, MODEL_TIMEOUT_MS),
		);

		if (Result.isFailure(reply)) {
			yield* Effect.sync(() =>
				logUnexpected(ROUTE, new Error("Workers AI call failed")),
			);

			return { kind: "modelUnavailable" } as const;
		}

		// A timeout reads as no reply, as the route always read it: the empty suggestion follows.
		const answer =
			reply.success.kind === "answered" ? reply.success.value : undefined;

		const raw = yield* replyText(answer);

		const words = yield* Effect.result(
			suggestionFromReply.decide({ reply: raw, text: submission.text }, {}),
		);

		if (Result.isFailure(words)) return { kind: "empty" } as const;

		return { kind: "suggestion", suggestion: words.success } as const;
	});
