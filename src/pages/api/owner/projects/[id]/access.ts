import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	accessNotClosed,
	checkAccessCommand,
	portalOff,
	projectAccessUnavailable,
	sentence,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readAccessCommand } from "~/server/audio-project-input";
import { revokeProjectAccess } from "~/server/flows/audio-project-access";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/access";

/** A failure of the database, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, accessNotClosed);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok || !params.id) return projectAccessUnavailable();
	const body = await musicRequest(request, 1024);

	if (body instanceof Response) return body;

	if (!readAccessCommand(body).ok) return checkAccessCommand();

	const program = revokeProjectAccess({
		requestId: params.id,
		ownerEmail: locals.owner.email,
		now: () => new Date(),
		newId: () => crypto.randomUUID(),
	}).pipe(
		Effect.map(() => Response.json({ ok: true })),
		Effect.catchTags({
			AccessAlreadyClosed: (refusal) =>
				Effect.succeed(sentence(refusal.say, 409)),
			AudioProjectStoreFailed: (failure) => failed(failure.failure),
		}),
	);

	return runRoute(bindings.services, program, {
		route: ROUTE,
		answer: accessNotClosed,
	});
};
