import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	checkInvitation,
	invitationNotQueued,
	portalOff,
	projectInvitationsUnavailable,
	sentence,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readInvitationCommand } from "~/server/audio-project-input";
import {
	deliverInBackground,
	deliverInvitation,
	queueProjectInvitation,
} from "~/server/flows/audio-project-notices";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveStudioNoticeMail,
} from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/invitation";

/** A failure of the database, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, invitationNotQueued);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);
	const ctx = locals.runtime.ctx;

	if (!bindings.ok || !params.id || !ctx)
		return projectInvitationsUnavailable();
	const body = await musicRequest(request, 1024);

	if (body instanceof Response) return body;
	const command = readInvitationCommand(body);

	if (!command.ok) return checkInvitation();
	const requestId = params.id;

	const program = queueProjectInvitation({
		requestId,
		confirmedNotSent: command.value.confirmedNotSent ?? false,
		now: () => new Date(),
	}).pipe(
		Effect.andThen(
			deliverInBackground(
				deliverInvitation({ requestId, now: () => new Date() }),
				"Studio invitation email state is uncertain.",
			),
		),
		Effect.map(() => Response.json({ ok: true })),
		Effect.catchTags({
			NoticeNotQueueable: (refusal) =>
				Effect.succeed(sentence(refusal.say, 409)),
			AudioProjectStoreFailed: (failure) => failed(failure.failure),
		}),
	);

	return runRoute(
		Context.merge(
			bindings.services,
			Context.merge(liveStudioNoticeMail(env), liveBackground(ctx)),
		),
		program,
		{ route: ROUTE, answer: invitationNotQueued },
	);
};
