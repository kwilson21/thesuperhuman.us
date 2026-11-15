import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	briefCopyFailed,
	briefCopyUnavailable,
	musicRequest,
} from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readBriefCopyInput } from "~/server/brief-copy-input";
import { type CopyDelivery, resendBriefCopy } from "~/server/flows/brief-copy";
import { CANNOT_SEND } from "~/server/rules/brief-copy";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, liveClientCopyMail } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/owner/requests/[id]/brief-copy";

/** What the owner is told for what the provider did with the copy. */
const answerDelivery = (delivery: CopyDelivery) => {
	switch (delivery.outcome) {
		case "sent":
			return Response.json({ ok: true });
		// No mail key or address on this deployment: unavailable, and nothing was asked of the provider.
		case "unconfigured":
			return briefCopyUnavailable();
		// The provider refused the copy or did not answer. What was recorded is on the request.
		case "refused":
		case "uncertain":
			return briefCopyFailed();
	}
};

/** The copy cannot be sent here: the request, its copy or a lost claim does not allow it. */
const cannotSend = (say: string) =>
	Effect.succeed(Response.json({ ok: false, error: say }, { status: 409 }));

/** A failure of the database, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, briefCopyFailed);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;
	const bindings = env ? bindingsOrUnavailable(env, ["MUSIC_DB"]) : undefined;

	if (!env || !bindings?.ok)
		return Response.json({ ok: false }, { status: 503 });
	const body = await musicRequest(request, 1024);

	if (body instanceof Response) return body;
	const input = readBriefCopyInput(body);

	if (!input.ok) return Response.json({ ok: false }, { status: 400 });

	return runRoute(
		Context.merge(bindings.services, liveClientCopyMail(env)),
		resendBriefCopy({
			// A request with no id is no such request. (Astro never routes one here: the segment is not empty.)
			id: params.id ?? "",
			confirmedNotSent: input.value.confirmedNotSent ?? false,
			now: () => new Date(),
		}).pipe(
			Effect.map(answerDelivery),
			Effect.catchTags({
				NoSuchSoftwareRequest: () =>
					Effect.succeed(Response.json({ ok: false }, { status: 404 })),
				BriefCopyRequestClosed: (refusal) => cannotSend(refusal.say),
				BriefCopyNoAddress: (refusal) => cannotSend(refusal.say),
				BriefCopyNotDue: (refusal) => cannotSend(refusal.say),
				// The claim was lost to another sender three times in a row.
				SaveKeptChanging: () => cannotSend(CANNOT_SEND),
				IntakeReadFailed: (failure) => failed(failure.failure),
				CopyClaimFailed: (failure) => failed(failure.failure),
				CopyNotBuilt: (failure) => failed(failure.failure),
				CopyNotRecorded: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's fixed sentence, logged once.
		{ route: ROUTE, answer: briefCopyFailed },
	);
};
