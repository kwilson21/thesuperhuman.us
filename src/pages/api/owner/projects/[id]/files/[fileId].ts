import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	checkFileAction,
	fileNotPublished,
	filePublicationUnavailable,
	filePublishUnavailable,
	portalOff,
	sentence,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { readFileCommand } from "~/server/audio-project-input";
import {
	publishProjectFile,
	revokeProjectFile,
} from "~/server/flows/audio-project-files";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveStudioNoticeMail,
} from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/files/[fileId]";

/** A failure of the database or of R2, logged once without what was sent, and answered with the route's fixed sentence. The revoke says it too. */
const failed = loggedAnswer(ROUTE, fileNotPublished);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return portalOff();
	const ctx = locals.runtime.ctx;
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);
	const db = env.MUSIC_DB;

	if (!bindings.ok || !db || !ctx || !params.id || !params.fileId)
		return filePublicationUnavailable();
	const body = await musicRequest(request, 8192);

	if (body instanceof Response) return body;
	const command = readFileCommand(body);

	if (!command.ok) return checkFileAction();
	const requestId = params.id;
	const fileId = params.fileId;
	const ownerEmail = locals.owner.email;

	const notices = Context.merge(liveStudioNoticeMail(env), liveBackground(ctx));

	const logged = {
		AudioProjectStoreFailed: (failure: { readonly failure: unknown }) =>
			failed(failure.failure),
	};

	if (command.value.action === "revoke") {
		const program = revokeProjectFile({
			requestId,
			fileId,
			ownerEmail,
			note: command.value.note,
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			Effect.map(() => Response.json({ ok: true })),
			Effect.catchTags({
				FileNotRevocable: (refusal) =>
					Effect.succeed(sentence(refusal.say, 409)),
				// The retries ran out: the other files or the stage moved on every read. A lost race answers 409.
				SaveKeptChanging: () =>
					Effect.succeed(
						sentence(
							"This file cannot be revoked here. A shared file needs a short note to the client.",
							409,
						),
					),
				...logged,
			}),
		);

		return runRoute(Context.merge(bindings.services, notices), program, {
			route: ROUTE,
			answer: fileNotPublished,
		});
	}

	// A publish reads the object's size from R2, so the bucket is needed from here; a revoke needs none.
	const withBucket = bindingsOrUnavailable(env, ["MUSIC_DB", "AUDIO"]);

	if (!withBucket.ok) return filePublicationUnavailable();

	const program = publishProjectFile({
		requestId,
		fileId,
		ownerEmail,
		note: command.value.note,
		downloadable: command.value.downloadable,
		now: () => new Date(),
		newId: () => crypto.randomUUID(),
	}).pipe(
		Effect.map((updateId) => Response.json({ ok: true, updateId })),
		Effect.catchTags({
			FileNotPublishable: (refusal) =>
				Effect.succeed(sentence(refusal.say, 409)),
			// The retries ran out: the live review files moved on every read. A lost race answers 409.
			SaveKeptChanging: () =>
				Effect.succeed(
					sentence(
						"This file cannot be published yet. Check the project and payment state.",
						409,
					),
				),
			ObjectStoreUnavailable: () => Effect.succeed(filePublishUnavailable()),
			ObjectStoreFailed: (failure) => failed(failure.failure),
			...logged,
		}),
	);

	return runRoute(Context.merge(withBucket.services, notices), program, {
		route: ROUTE,
		answer: fileNotPublished,
	});
};
