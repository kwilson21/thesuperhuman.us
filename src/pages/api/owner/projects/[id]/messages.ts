import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	checkYourMessage,
	messageNotSaved,
	ownerMessagesUnavailable,
	portalOff,
	projectHidden,
	sentence,
	writeNotAccepted,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readOwnerMessageCommand } from "~/server/audio-project-input";
import {
	markClientMessageReadByOwner,
	sendOwnerMessage,
} from "~/server/flows/audio-project-messages";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/messages";

/** A failure of the database, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, messageNotSaved);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return ownerMessagesUnavailable();

	if (!params.id) return projectHidden();
	const body = await musicRequest(request, 8192);

	if (body instanceof Response) return body;
	const command = readOwnerMessageCommand(body);

	if (!command.ok) return checkYourMessage();
	const id = params.id;
	const input = command.value;

	const program =
		input.action === "read"
			? markClientMessageReadByOwner({
					id,
					messageId: input.messageId,
					now: () => new Date(),
				}).pipe(Effect.map(() => Response.json({ ok: true })))
			: sendOwnerMessage({
					id,
					ownerEmail: locals.owner.email,
					body: input.body,
					now: () => new Date(),
				}).pipe(Effect.map((message) => Response.json({ ok: true, message })));

	return runRoute(
		bindings.services,
		program.pipe(
			Effect.catchTags({
				ProjectHidden: () => Effect.succeed(projectHidden()),
				MessageTextInvalid: (refusal) =>
					Effect.succeed(sentence(refusal.say, 400)),
				MessageNotAccepted: () => Effect.succeed(writeNotAccepted()),
				AudioProjectStoreFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's fixed sentence, logged once.
		{ route: ROUTE, answer: messageNotSaved },
	);
};
