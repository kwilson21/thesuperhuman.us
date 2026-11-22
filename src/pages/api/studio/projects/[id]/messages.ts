import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	checkYourMessage,
	messageNotSaved,
	noStudioSession,
	portalOff,
	projectHidden,
	sentence,
	studioMessagesUnavailable,
	writeNotAccepted,
} from "~/lib/audio-project-answers";
import { studioSessionFromRequest } from "~/lib/audio-client-access";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readStudioMessageCommand } from "~/server/audio-project-input";
import {
	answerLatestReview,
	markOwnerMessageReadByClient,
	sendClientMessage,
} from "~/server/flows/audio-project-messages";
import type { AgreementStoreFailed } from "~/server/agreement-store";
import type { HashFailed } from "~/server/agreement-services";
import type { AudioProjectStoreFailed } from "~/server/audio-project-store";
import type {
	ChangesNeedNotes,
	ClientRateLimited,
	MessageNotAccepted,
	MessageTextInvalid,
	ProjectHidden,
	ReviewNotAnswerable,
} from "~/server/rules/audio-project-messages";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, type MusicDb } from "~/server/services";

export const prerender = false;
const ROUTE = "/api/studio/projects/[id]/messages";

/** Everything an action of this route can end in besides its answer. */
type Ended =
	| ProjectHidden
	| MessageTextInvalid
	| ChangesNeedNotes
	| ClientRateLimited
	| ReviewNotAnswerable
	| MessageNotAccepted
	| AudioProjectStoreFailed
	| AgreementStoreFailed
	| HashFailed;

/** A failure of the database or of hashing the token, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, messageNotSaved);

export const POST: APIRoute = async ({ params, request, locals }) => {
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return studioMessagesUnavailable();
	const token = studioSessionFromRequest(request);

	if (!token || !params.id) return noStudioSession();
	const body = await musicRequest(request, 8192);

	if (body instanceof Response) return body;
	const command = readStudioMessageCommand(body);

	if (!command.ok) return checkYourMessage();
	const id = params.id;
	const input = command.value;
	const now = () => new Date();

	const program = ((): Effect.Effect<Response, Ended, MusicDb> => {
		switch (input.action) {
			case "read":
				return markOwnerMessageReadByClient({
					id,
					token,
					messageId: input.messageId,
					now,
				}).pipe(Effect.map(() => Response.json({ ok: true })));
			case "respond":
				return answerLatestReview({
					id,
					token,
					reviewId: input.reviewId,
					decision: input.decision,
					body: input.body,
					now,
				}).pipe(Effect.map((message) => Response.json({ ok: true, message })));
			case "send":
				return sendClientMessage({ id, token, body: input.body, now }).pipe(
					Effect.map((message) => Response.json({ ok: true, message })),
				);
		}
	})();

	return runRoute(
		bindings.services,
		program.pipe(
			Effect.catchTags({
				ProjectHidden: () => Effect.succeed(projectHidden()),
				MessageTextInvalid: (refusal) =>
					Effect.succeed(sentence(refusal.say, 400)),
				ChangesNeedNotes: (refusal) =>
					Effect.succeed(sentence(refusal.say, 400)),
				ClientRateLimited: (refusal) =>
					Effect.succeed(sentence(refusal.say, 429)),
				ReviewNotAnswerable: (refusal) =>
					Effect.succeed(sentence(refusal.say, 409)),
				MessageNotAccepted: () => Effect.succeed(writeNotAccepted()),
				AudioProjectStoreFailed: (failure) => failed(failure.failure),
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's fixed sentence, logged once.
		{ route: ROUTE, answer: messageNotSaved },
	);
};
