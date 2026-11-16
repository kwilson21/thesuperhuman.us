// POST /api/software/brief/board: one interpretation of a brief for the living brief's board
// (docs/plans/2026-11-living-brief.md). The flow is src/server/flows/brief-board.ts; this maps each of its refusals to an
// answer the page acts on by its `reason`:
//   200 { ok, cards, refs }           the reply, read as untrusted data, and the shown cards it named
//   400 { ok: false }                 a request the page never sends
//   403 { reason: "pass" }            no valid suggestion pass: the page renews it once and asks again
//   409 { reason: "busy" }            the day's count kept changing under three tries
//   429 { reason: "limit", error }    the visitor's or the site's limit for today: the page stops asking
//   429 { reason: "busy" }            a per-minute rate limit: the page tries later
//   503 { reason: "off" }             switched off, a binding or secret missing, or a local preview: the page stops asking
//   503 { reason: "busy" }            a rate limit binding failing, the model failing or timing out, or an unreadable
//                                     reply: the page tries later
//   500 { error }                     the store failed, or a defect: the fixed sentence, logged once without the request
import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { suggestionPassCookie } from "~/lib/brief-suggestion-pass";
import { musicRequest } from "~/lib/music-request";
import { readBoardInput } from "~/server/brief-board-input";
import { liveBoardModel } from "~/server/brief-board-model";
import { interpretBrief } from "~/server/flows/brief-board";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, liveBriefRateLimits } from "~/server/services";

export const prerender = false;

const noStore = { "cache-control": "no-store" };

/** Interpretation is not available on this deployment. */
export const boardOff = () =>
	Response.json(
		{ ok: false, reason: "off" },
		{ status: 503, headers: noStore },
	);

/** A known dependency is busy or failed; the page tries again later. */
export const boardBusy = (status = 503) =>
	Response.json({ ok: false, reason: "busy" }, { status, headers: noStore });

/** The store failed, or a defect: the route's fixed sentence. */
export const boardFailed = () =>
	Response.json(
		{ ok: false, error: "Suggestions could not be made just now." },
		{ status: 500, headers: noStore },
	);

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

export const POST: APIRoute = async ({ request, locals }) => {
	// 7,000 characters of answers and cards (CONTENT_MAX) in a script of three bytes a character, and the JSON around them.
	const body = await musicRequest(request, 32768);

	if (body instanceof Response) return body;
	const env = locals.runtime?.env;
	const ip = request.headers.get("cf-connecting-ip");

	// Local previews never call Workers AI, as the autocomplete's route does not, even with a proxy binding.
	if (
		!env ||
		env.SOFTWARE_BOARD_ENABLED !== "true" ||
		!env.AI ||
		!env.BRIEF_SUGGEST_RATE_LIMIT ||
		!env.BRIEF_SUGGEST_SITE_LIMIT ||
		!env.TURNSTILE_SECRET_KEY ||
		!ip ||
		LOCAL.includes(new URL(request.url).hostname)
	)
		return boardOff();

	const read = readBoardInput(body);

	if (!read.ok)
		return Response.json({ ok: false }, { status: 400, headers: noStore });

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return boardOff();

	const pass = request.headers
		.get("cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${suggestionPassCookie}=`))
		?.slice(suggestionPassCookie.length + 1);

	return runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				liveBriefRateLimits(
					env.BRIEF_SUGGEST_RATE_LIMIT,
					env.BRIEF_SUGGEST_SITE_LIMIT,
				),
			),
			liveBoardModel(env.AI),
		),
		interpretBrief({
			request: read.value,
			ip,
			pass,
			secret: env.TURNSTILE_SECRET_KEY,
			now: new Date(),
		}).pipe(
			Effect.map(({ cards, refs }) =>
				Response.json({ ok: true, cards, refs }, { headers: noStore }),
			),
			Effect.catchTags({
				PassRequired: () =>
					Effect.succeed(
						Response.json(
							{ ok: false, reason: "pass" },
							{ status: 403, headers: noStore },
						),
					),
				BoardDailyLimit: (refusal) =>
					Effect.succeed(
						Response.json(
							{ ok: false, reason: "limit", error: refusal.say },
							{ status: 429, headers: noStore },
						),
					),
				SaveKeptChanging: () => Effect.succeed(boardBusy(409)),
				BoardTooFast: () => Effect.succeed(boardBusy(429)),
				RateLimiterFailed: () => Effect.succeed(boardBusy()),
				BoardModelFailed: () => Effect.succeed(boardBusy()),
				BoardModelTimedOut: () => Effect.succeed(boardBusy()),
				BoardReplyUnreadable: () => Effect.succeed(boardBusy()),
				BoardStoreFailed: () => Effect.succeed(boardFailed()),
			}),
		),
		// A defect is the route's fixed sentence, logged once without what was sent.
		{ route: "/api/software/brief/board", answer: boardFailed },
	);
};
