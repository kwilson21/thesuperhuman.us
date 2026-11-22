import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	checkFileDetails,
	invalidFilePart,
	ownerAccessRequired,
	partNotUploaded,
	partUploadUnavailable,
	sentence,
	uploadNotSaved,
	uploadSaveUnavailable,
	uploadsPortalOff,
	uploadsUnavailable,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import type {
	AudioProjectStoreFailed,
	ObjectStoreFailed,
} from "~/server/audio-project-store";
import type { UploadGone } from "~/server/rules/audio-project-uploads";
import { readPartQuery, readUploadCommand } from "~/server/audio-project-input";
import {
	abortUpload,
	finishUpload,
	putUploadPart,
	startUpload,
} from "~/server/flows/audio-project-uploads";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;
const ROUTE = "/api/owner/projects/[id]/uploads";

/** A failure of the database or of R2, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, uploadNotSaved);

const partFailed = loggedAnswer(ROUTE, partNotUploaded);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return ownerAccessRequired();
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return uploadsPortalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "AUDIO"]);

	if (!bindings.ok || !params.id) return uploadsUnavailable();
	const body = await musicRequest(request, 34_000);

	if (body instanceof Response) return body;
	const command = readUploadCommand(body);

	if (!command.ok) return checkFileDetails();
	const requestId = params.id;
	const input = command.value;

	const gone = {
		UploadGone: (refusal: UploadGone) =>
			Effect.succeed(sentence(refusal.say, 404)),
	};

	const unsaved = {
		ObjectStoreUnavailable: () => Effect.succeed(uploadSaveUnavailable()),
		ObjectStoreFailed: (failure: ObjectStoreFailed) => failed(failure.failure),
		AudioProjectStoreFailed: (failure: AudioProjectStoreFailed) =>
			failed(failure.failure),
	};

	const program =
		input.action === "start"
			? startUpload({
					requestId,
					version: input.version,
					displayName: input.displayName,
					mediaType: input.mediaType,
					byteSize: input.byteSize,
					now: () => new Date(),
					newId: () => crypto.randomUUID(),
				}).pipe(
					Effect.map((started) =>
						Response.json({
							ok: true,
							uploadId: started.id,
							partSize: started.partSize,
						}),
					),
					Effect.catchTags({
						UploadNotReady: (refusal) =>
							Effect.succeed(sentence(refusal.say, 409)),
						...unsaved,
					}),
				)
			: input.action === "abort"
				? abortUpload({ requestId, uploadId: input.uploadId }).pipe(
						Effect.map(() => Response.json({ ok: true })),
						Effect.catchTags({ ...gone, ...unsaved }),
					)
				: finishUpload({
						requestId,
						uploadId: input.uploadId,
						parts: input.action === "complete" ? input.parts : null,
						peaks: input.action === "complete" ? (input.peaks ?? null) : null,
						now: () => new Date(),
					}).pipe(
						Effect.map((fileId) => Response.json({ ok: true, fileId })),
						Effect.catchTags({
							...gone,
							UploadNotFinishable: (refusal) =>
								Effect.succeed(sentence(refusal.say, 409)),
							UploadSizeMismatch: (refusal) =>
								Effect.succeed(sentence(refusal.say, 409)),
							...unsaved,
						}),
					);

	return runRoute(bindings.services, program, {
		route: ROUTE,
		answer: uploadNotSaved,
	});
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return ownerAccessRequired();
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return uploadsPortalOff();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "AUDIO"]);

	if (!bindings.ok || !params.id) return uploadsUnavailable();
	const url = new URL(request.url);

	const query = readPartQuery(
		url.searchParams.get("uploadId"),
		url.searchParams.get("part"),
		request.body !== null,
	);

	if (!query.ok || request.body === null) return invalidFilePart();

	const program = putUploadPart({
		requestId: params.id,
		uploadId: query.value.uploadId,
		part: query.value.part,
		contentLength: request.headers.get("content-length"),
		body: request.body,
	}).pipe(
		Effect.map((part) => Response.json({ ok: true, part })),
		Effect.catchTags({
			UploadGone: (refusal) => Effect.succeed(sentence(refusal.say, 404)),
			UploadNotReady: (refusal) => Effect.succeed(sentence(refusal.say, 409)),
			PartWrongSize: (refusal) => Effect.succeed(sentence(refusal.say, 400)),
			PartNotUploadable: (refusal) =>
				Effect.succeed(sentence(refusal.say, 409)),
			ObjectStoreUnavailable: () => Effect.succeed(partUploadUnavailable()),
			ObjectStoreFailed: (failure) => partFailed(failure.failure),
			AudioProjectStoreFailed: (failure) => partFailed(failure.failure),
		}),
	);

	return runRoute(bindings.services, program, {
		route: ROUTE,
		answer: partNotUploaded,
	});
};
