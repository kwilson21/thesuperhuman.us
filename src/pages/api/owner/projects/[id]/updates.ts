import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	checkUpdate,
	portalOff,
	projectUpdatesUnavailable,
	sentence,
	updateNotSaved,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readUpdateCommand } from "~/server/audio-project-input";
import {
	retryProjectUpdateEmail,
	saveProjectUpdate,
} from "~/server/flows/audio-project-updates";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveStudioNoticeMail,
} from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/updates";

/** A failure of the database, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, updateNotSaved);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);
	const ctx = locals.runtime.ctx;

	if (!bindings.ok || !ctx || !params.id) return projectUpdatesUnavailable();
	const body = await musicRequest(request, 8192);

	if (body instanceof Response) return body;
	const command = readUpdateCommand(body);

	if (!command.ok) return checkUpdate();
	const requestId = params.id;
	const input = command.value;

	const services = Context.merge(
		bindings.services,
		Context.merge(liveStudioNoticeMail(env), liveBackground(ctx)),
	);

	const program =
		input.action === "retry_email"
			? retryProjectUpdateEmail({
					requestId,
					updateId: input.updateId,
					confirmedNotSent: input.confirmedNotSent ?? false,
					now: () => new Date(),
				}).pipe(
					Effect.map(() => Response.json({ ok: true })),
					Effect.catchTags({
						NoticeNotQueueable: (refusal) =>
							Effect.succeed(sentence(refusal.say, 409)),
						AudioProjectStoreFailed: (failure) => failed(failure.failure),
					}),
				)
			: saveProjectUpdate({
					requestId,
					ownerEmail: locals.owner.email,
					command: input,
					now: () => new Date(),
				}).pipe(
					Effect.map((update) => Response.json({ ok: true, update })),
					Effect.catchTags({
						ProjectCannotTakeUpdate: (refusal) =>
							Effect.succeed(sentence(refusal.say, 409)),
						AudioProjectStoreFailed: (failure) => failed(failure.failure),
					}),
				);

	return runRoute(services, program, {
		route: ROUTE,
		answer: updateNotSaved,
	});
};
