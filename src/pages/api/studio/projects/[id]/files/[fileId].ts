import type { APIRoute } from "astro";
import { studioSessionFromRequest } from "~/lib/audio-client-access";
import { clientPortalEnabled } from "~/lib/client-portal";
import {
	clientProjectFile,
	recordProjectFileAccess,
	sizeMismatchResponse,
	streamClientProjectFile,
} from "~/lib/audio-project-files";
import { logUnexpected } from "~/server/failure";

export const prerender = false;
const ROUTE = "/api/studio/projects/[id]/files/[fileId]";

const hidden = () =>
	new Response("File not found", {
		status: 404,
		headers: { "cache-control": "private, no-store" },
	});

const serve: APIRoute = async ({ params, request, locals }) => {
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env)) return hidden();

	if (!env.MUSIC_DB || !env.AUDIO)
		return new Response("Private audio is temporarily unavailable", {
			status: 503,
			headers: { "cache-control": "private, no-store" },
		});
	const token = studioSessionFromRequest(request);

	if (!token || !params.id || !params.fileId) return hidden();
	const download = new URL(request.url).searchParams.get("download") === "1";

	try {
		const file = await clientProjectFile(
			env.MUSIC_DB,
			params.id,
			params.fileId,
			token,
		);

		if (!file || (download && !file.downloadable)) return hidden();

		const response = await streamClientProjectFile(
			request,
			env.AUDIO,
			file,
			download,
		);

		if (response === "size-mismatch") {
			logUnexpected(
				ROUTE,
				new Error("The stored object has another size than the file row."),
			);

			return sizeMismatchResponse();
		}

		if (
			request.method === "GET" &&
			(response.status === 200 || response.status === 206)
		) {
			await recordProjectFileAccess(env.MUSIC_DB, file.id, token, download);
		}

		return response;
	} catch (error) {
		logUnexpected(ROUTE, error);

		return new Response("Private audio is temporarily unavailable", {
			status: 500,
			headers: { "cache-control": "private, no-store" },
		});
	}
};

export const GET = serve;
export const HEAD = serve;
