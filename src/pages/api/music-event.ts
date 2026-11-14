import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { loadMusicCatalog } from "~/lib/music-content";
import { musicRequest } from "~/lib/music-request";
import { recordPlayback } from "~/server/flows/music-event";
import {
	musicFailed,
	musicUnavailable,
	readEventInput,
	readVisitor,
} from "~/server/music-input";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

/** The answer for a playback event that cannot be stored as reported: the player does not retry a 409. */
const conflict = () =>
	Effect.succeed(Response.json({ ok: false }, { status: 409 }));

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request);

	if (body instanceof Response) return body;
	const read = readEventInput(body);

	if (!read.ok) return Response.json({ ok: false }, { status: 400 });

	const env = locals.runtime.env;

	if (env.MUSIC_EVENTS_ENABLED === "false")
		return new Response(null, {
			status: 204,
			headers: { "cache-control": "no-store" },
		});
	const input = read.value;
	const catalog = await loadMusicCatalog();
	const release = catalog.releases.find((r) => r.id === input.releaseId);
	const recording = catalog.recordings.find((r) => r.id === input.recordingId);

	if (
		!release?.tracks.includes(input.recordingId) ||
		!recording ||
		(input.medium === "video" &&
			!recording.versions.video &&
			!recording.youtubeId)
	)
		return Response.json({ ok: false }, { status: 404 });
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);

	if (!bindings.ok) return musicUnavailable();

	return runRoute(
		bindings.services,
		recordPlayback({
			// The recording's own length from the catalog, never the player's.
			input: { ...input, mediaDurationSeconds: Math.round(recording.duration) },
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			visitor: readVisitor(request),
			now: () => new Date(),
		}).pipe(
			Effect.map(() =>
				Response.json(
					{ ok: true },
					{ headers: { "cache-control": "no-store" } },
				),
			),
			Effect.catchTags({
				TooManyPlaybacks: () =>
					Effect.succeed(Response.json({ ok: false }, { status: 429 })),
				PlaybackIdReused: conflict,
				PlaybackOutOfSequence: conflict,
				ListenNotEarned: conflict,
				CompletionNotEarned: conflict,
				PlaybackHasNoStart: conflict,
				ProgressSkipped: conflict,
				FasterThanServerTime: conflict,
				SaveKeptChanging: conflict,
				MusicStoreFailed: () => Effect.succeed(musicFailed()),
				RateLimitStoreFailed: () => Effect.succeed(musicFailed()),
			}),
		),
	);
};
