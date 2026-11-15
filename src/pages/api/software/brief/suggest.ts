import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
import { suggestionPassCookie } from "~/lib/brief-suggestion-pass";
import { suggest } from "~/server/flows/brief-suggest";
import { logUnexpected } from "~/server/failure";
import { readSuggestInput } from "~/server/brief-input";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveAssistant,
	liveBackground,
	liveSuggestLimits,
} from "~/server/services";
import type { SuggestAnswer } from "~/server/flows/brief-suggest";

export const prerender = false;

const ROUTE = "/api/software/brief/suggest";

const noStore = { "cache-control": "no-store" };

/** Nothing to suggest, said the same way every time: no reason is given. */
const empty = () => Response.json({ suggestion: "" }, { headers: noStore });

/** A store, limiter, signing or reply failure: the same empty body, with 500 so the failure is not taken for a quiet answer. */
const failedAnswer = () =>
	Response.json({ suggestion: "" }, { status: 500, headers: noStore });

/** The model did not answer usefully: the same empty body, with 503 (a known unavailable dependency). */
const modelUnavailable = () =>
	Response.json({ suggestion: "" }, { status: 503, headers: noStore });

const answerResponse = (answer: SuggestAnswer) => {
	switch (answer.kind) {
		case "empty":
			return empty();
		case "passRequired":
			return Response.json(
				{ suggestion: "", passRequired: true },
				{ headers: noStore },
			);
		case "modelUnavailable":
			return modelUnavailable();
		case "suggestion":
			return Response.json(
				{ suggestion: answer.suggestion },
				{ headers: noStore },
			);
	}
};

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
	const read = readSuggestInput(await musicRequest(request, 16000));

	if (!read.ok) return empty();
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
		suggest({
			text: read.value.text,
			content: JSON.stringify(read.value),
			ip: request.headers.get("cf-connecting-ip"),
			cookie: passCookie(request),
			secret: env.TURNSTILE_SECRET_KEY,
			now: () => Date.now(),
		}).pipe(
			Effect.map(answerResponse),
			Effect.catchTags({
				SuggestLimitFailed: (failure) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return failedAnswer();
					}),
				BudgetStoreFailed: (failure) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return failedAnswer();
					}),
				SuggestSigningFailed: (failure) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return failedAnswer();
					}),
				ReplyUnreadable: (failure) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return failedAnswer();
					}),
			}),
		),
		{ route: ROUTE, answer: failedAnswer },
	);
};
