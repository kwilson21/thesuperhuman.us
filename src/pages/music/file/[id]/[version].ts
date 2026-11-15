import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { mediaFailed, mediaUnavailable } from "~/lib/media-answers";
import { loggedAnswer } from "~/server/answers";
import { readMusicFile } from "~/server/flows/music-file";
import { readVersion } from "~/server/media-input";
import { runRoute } from "~/server/run";
import { liveMediaObjects } from "~/server/services";

export const prerender = false;

const ROUTE = "/music/file/[id]/[version]";

/** A failure the route logs once, without what it carries beyond the cause, and answers with its fixed 500. */
const failed = loggedAnswer(ROUTE, mediaFailed);

const text = (say: string, status: number) => new Response(say, { status });

const serve: APIRoute = ({ params, request, locals }) =>
	runRoute(
		Context.empty(),
		// The bucket is read inside the program, so a request with no runtime fails as a defect the route logs once.
		Effect.suspend(() =>
			readMusicFile({
				id: params.id,
				version: readVersion(params.version),
				method: request.method,
				range: request.headers.get("range"),
			}).pipe(
				Effect.map(({ type, size, slice, body }) => {
					const headers = new Headers({
						"content-type": type,
						"accept-ranges": "bytes",
						"content-length": String(slice?.length ?? size),
						"cache-control": "public, max-age=3600, s-maxage=3600",
						"x-content-type-options": "nosniff",
						"content-disposition": "inline",
					});

					if (slice)
						headers.set(
							"content-range",
							`bytes ${slice.offset}-${slice.offset + slice.length - 1}/${size}`,
						);

					return body === null
						? new Response(null, { headers })
						: new Response(body, { status: slice ? 206 : 200, headers });
				}),
				Effect.catchTags({
					MusicFileNotFound: (refusal) =>
						Effect.succeed(text(refusal.say, 404)),
					MusicFileWithheld: (refusal) =>
						Effect.succeed(text(refusal.say, 404)),
					MusicObjectMissing: (refusal) =>
						Effect.succeed(text(refusal.say, 404)),
					RangeOutsideFile: (refusal) =>
						Effect.succeed(
							new Response(null, {
								status: 416,
								headers: { "content-range": `bytes */${refusal.size}` },
							}),
						),
					MediaBucketNotBound: () => Effect.succeed(mediaUnavailable()),
					MediaObjectFailed: (failure) => failed(failure.failure),
					MediaCatalogFailed: (failure) => failed(failure.failure),
				}),
				Effect.provideContext(liveMediaObjects(locals.runtime.env.AUDIO)),
			),
		),
		{ route: ROUTE, answer: mediaFailed },
	);

export const GET = serve;
export const HEAD = serve;
