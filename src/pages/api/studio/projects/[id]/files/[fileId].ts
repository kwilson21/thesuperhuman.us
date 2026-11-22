import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { studioSessionFromRequest } from "~/lib/audio-client-access";
import {
	fileHidden,
	fileRangeRefused,
	fileSizeDiffers,
	fileUnavailable,
	privateAudioFailed,
	privateAudioUnavailable,
	projectFileBytes,
} from "~/lib/audio-project-answers";
import { clientPortalEnabled } from "~/lib/client-portal";
import { loggedAnswer } from "~/server/answers";
import { readProjectFile } from "~/server/flows/studio-project-file";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;
const ROUTE = "/api/studio/projects/[id]/files/[fileId]";

/** A failure of the database or of R2, logged once without what was sent, and answered with the route's fixed sentence. */
const failed = loggedAnswer(ROUTE, privateAudioFailed);

/** The stored object is another size than the file's row: logged once, with a fixed line, and answered 500. */
const sizeDiffers = loggedAnswer(ROUTE, fileSizeDiffers);

const serve: APIRoute = async ({ params, request, locals }) => {
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return fileHidden();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "AUDIO"]);

	if (!bindings.ok) return privateAudioUnavailable();
	const token = studioSessionFromRequest(request);

	if (!token || !params.id || !params.fileId) return fileHidden();
	const download = new URL(request.url).searchParams.get("download") === "1";

	const program = readProjectFile({
		requestId: params.id,
		fileId: params.fileId,
		token,
		download,
		method: request.method,
		range: request.headers.get("range"),
		now: () => new Date(),
	}).pipe(
		Effect.map((read) => projectFileBytes(read, download)),
		Effect.catchTags({
			FileHidden: () => Effect.succeed(fileHidden()),
			ObjectMissing: () => Effect.succeed(fileUnavailable()),
			ObjectSizeDiffers: () =>
				sizeDiffers(
					new Error("The stored object has another size than the file row."),
				),
			ProjectFileRangeRefused: (refused) =>
				Effect.succeed(fileRangeRefused(refused.file, download, refused.size)),
			ObjectStoreUnavailable: () => Effect.succeed(privateAudioUnavailable()),
			ObjectStoreFailed: (failure) => failed(failure.failure),
			AudioProjectStoreFailed: (failure) => failed(failure.failure),
			AgreementStoreFailed: (failure) => failed(failure.failure),
			HashFailed: (failure) => failed(failure.failure),
		}),
	);

	return runRoute(bindings.services, program, {
		route: ROUTE,
		answer: privateAudioFailed,
	});
};

export const GET = serve;
export const HEAD = serve;
