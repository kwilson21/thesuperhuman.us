// The offer board's suggestions (docs/plans/2026-11-offer-board.md, section 5). Owner only (the Access check every
// /api/owner/ route has, in src/middleware.ts).
//   200 { ok, cards, refs, size, sizeReason, figureUsd, figureReason }
//   400 a request the page never sends · 404 no such software request · 409 it can no longer take an offer, or the
//   count changed three times · 429 today's limit · 503 the model failed, timed out or answered nothing readable, or
//   a binding is missing · 500 the store failed (the route's fixed sentence)
import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
import { suggestOffer } from "~/server/flows/offer-board";
import { readOfferBoardInput } from "~/server/offer-board-input";
import { liveOfferModel } from "~/server/offer-board-model";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const noStore = { "cache-control": "private, no-store" };

const say = (status: number, error: string) =>
	Response.json({ ok: false, error }, { status, headers: noStore });

/** The fixed answer for a store failure or a defect: never the error's own text. */
const offerFailed = () =>
	say(500, "The offer board could not suggest anything just now. Try again.");

const offerBusy = () =>
	say(
		503,
		"The AI couldn’t answer just now. Your draft is unchanged; press Suggest to try again.",
	);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner)
		return Response.json({ ok: false }, { status: 403, headers: noStore });

	const body = await musicRequest(request, 64 * 1024);

	if (body instanceof Response) return body;
	const read = readOfferBoardInput(body);

	if (!read.ok || !params.id)
		return Response.json({ ok: false }, { status: 400, headers: noStore });
	const env = locals.runtime.env;
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok || !env.AI)
		return say(503, "The offer board is unavailable here.");

	return runRoute(
		Context.merge(bindings.services, liveOfferModel(env.AI)),
		suggestOffer({ id: params.id, request: read.value, now: new Date() }).pipe(
			Effect.map((answer) =>
				Response.json({ ok: true, ...answer }, { headers: noStore }),
			),
			Effect.catchTags({
				OfferRequestMissing: (refusal) => Effect.succeed(say(404, refusal.say)),
				OfferNotOfferable: (refusal) => Effect.succeed(say(409, refusal.say)),
				OfferDailyLimit: (refusal) => Effect.succeed(say(429, refusal.say)),
				SaveKeptChanging: () =>
					Effect.succeed(
						say(409, "Several suggestions were asked for at once. Try again."),
					),
				BoardModelFailed: () => Effect.succeed(offerBusy()),
				BoardModelTimedOut: () => Effect.succeed(offerBusy()),
				OfferReplyUnreadable: () => Effect.succeed(offerBusy()),
				OfferStoreFailed: () => Effect.succeed(offerFailed()),
			}),
		),
		{ route: "/api/owner/requests/[id]/offer-board", answer: offerFailed },
	);
};
