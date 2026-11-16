import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { suggestionPassCookie } from "~/lib/brief-suggestion-pass";
import { suggest } from "~/server/flows/brief-suggest";
import { loggedAnswer } from "~/server/answers";
import { readBody, readSuggestInput } from "~/server/brief-input";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveAssistant,
	liveBackground,
	liveSuggestLimits,
} from "~/server/services";

export const prerender = false;

const ROUTE = "/api/software/brief/suggest";

const noStore = { "cache-control": "no-store" };

/** Nothing to suggest, said the same way every time: no reason is given. */
const empty = () => Response.json({ suggestion: "" }, { headers: noStore });

/** A store, limiter, signing or reply failure: the same empty body, with 500 so the failure is not taken for a quiet answer. */
const failedAnswer = () =>
	Response.json({ suggestion: "" }, { status: 500, headers: noStore });

const failed = loggedAnswer(ROUTE, failedAnswer);

/** The model did not answer usefully: the same empty body, with 503 (a known unavailable dependency). */
const modelUnavailable = () =>
	Response.json({ suggestion: "" }, { status: 503, headers: noStore });

/** The words to show after the visitor's text. */
const suggestion = (words: string) =>
	Response.json({ suggestion: words }, { headers: noStore });

/** No valid pass: the form is asked to get one. */
const passRequired = () =>
	Response.json({ suggestion: "", passRequired: true }, { headers: noStore });

/** The pass cookie's value, when the visitor sent one. */
const passCookie = (request: Request) =>
	request.headers
		.get("cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${suggestionPassCookie}=`))
		?.slice(suggestionPassCookie.length + 1);

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	// Local previews never call Workers AI, even when a proxy binding exists.
	if (
		!env?.AI ||
		!env.MUSIC_DB ||
		!env.BRIEF_SUGGEST_RATE_LIMIT ||
		!env.BRIEF_SUGGEST_SITE_LIMIT ||
		!env.TURNSTILE_SECRET_KEY ||
		env.SOFTWARE_SUGGESTIONS_ENABLED !== "true" ||
		["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
	)
		return empty();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return empty();

	return runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				liveSuggestLimits({
					visitor: env.BRIEF_SUGGEST_RATE_LIMIT,
					site: env.BRIEF_SUGGEST_SITE_LIMIT,
				}),
			),
			Context.merge(liveAssistant(env.AI), liveBackground(locals.runtime?.ctx)),
		),
		Effect.gen(function* () {
			const read = readSuggestInput(yield* readBody(request, 16000));

			if (!read.ok) return empty();

			return yield* suggest({
				text: read.value.text,
				content: JSON.stringify(read.value),
				ip: request.headers.get("cf-connecting-ip"),
				cookie: passCookie(request),
				secret: env.TURNSTILE_SECRET_KEY,
				now: () => Date.now(),
			}).pipe(Effect.map(suggestion));
		}).pipe(
			Effect.catchTags({
				// Each refusal says nothing to the visitor: the same empty suggestion, whatever the reason.
				TooFewWords: () => Effect.succeed(empty()),
				PromptTooLong: () => Effect.succeed(empty()),
				NoAddress: () => Effect.succeed(empty()),
				VisitorMinuteLimit: () => Effect.succeed(empty()),
				SiteMinuteLimit: () => Effect.succeed(empty()),
				SiteDailyCap: () => Effect.succeed(empty()),
				BudgetSpent: () => Effect.succeed(empty()),
				NoReply: () => Effect.succeed(empty()),
				UnusableReply: () => Effect.succeed(empty()),
				PassRequired: () => Effect.succeed(passRequired()),
				ModelUnavailable: () => Effect.succeed(modelUnavailable()),
				BodyReadFailed: (failure) => failed(failure.failure),
				SuggestLimitFailed: (failure) => failed(failure.failure),
				BudgetStoreFailed: (failure) => failed(failure.failure),
				SuggestSigningFailed: (failure) => failed(failure.failure),
				ReplyUnreadable: (failure) => failed(failure.failure),
			}),
		),
		{ route: ROUTE, answer: failedAnswer },
	);
};
