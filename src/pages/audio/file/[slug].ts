import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { mediaFailed, mediaUnavailable } from "~/lib/media-answers";
import { loggedAnswer } from "~/server/answers";
import { readAudioFile } from "~/server/flows/audio-file";
import { readSlug } from "~/server/media-input";
import { runRoute } from "~/server/run";
import { liveMediaObjects } from "~/server/services";

export const prerender = false;

const ROUTE = "/audio/file/[slug]";

/** A failure the route logs once, without what it carries beyond the cause, and answers with its fixed 500. */
const failed = loggedAnswer(ROUTE, mediaFailed);

const notFound = (say: string) => new Response(say, { status: 404 });

export const GET: APIRoute = ({ params, request, locals }) => {
	const slug = readSlug(params.slug);

	return runRoute(
		// The bucket is read when the first read starts, after the file is found, as the route always has.
		liveMediaObjects(() => locals.runtime.env.AUDIO),
		readAudioFile({ slug, range: request.headers.get("range") }).pipe(
			Effect.map(({ size, slice, body }) => {
				const headers = new Headers({
					"content-type": "audio/mpeg",
					"accept-ranges": "bytes",
					"content-length": String(slice?.length ?? size),
					"cache-control": "public, max-age=31536000, immutable",
					"content-disposition": `inline; filename="${slug}.mp3"`,
				});

				if (slice)
					headers.set(
						"content-range",
						`bytes ${slice.offset}-${slice.offset + slice.length - 1}/${size}`,
					);

				return new Response(body, { status: slice ? 206 : 200, headers });
			}),
			Effect.catchTags({
				AudioFileNotFound: (refusal) => Effect.succeed(notFound(refusal.say)),
				AudioObjectMissing: (refusal) => Effect.succeed(notFound(refusal.say)),
				AudioRangeOutsideFile: (refusal) =>
					Effect.succeed(
						new Response(null, {
							status: 416,
							headers: {
								"content-range": `bytes */${refusal.size}`,
								"accept-ranges": "bytes",
							},
						}),
					),
				MediaBucketNotBound: () => Effect.succeed(mediaUnavailable()),
				MediaObjectFailed: (failure) => failed(failure.failure),
				MediaCatalogFailed: (failure) => failed(failure.failure),
			}),
		),
		{ route: ROUTE, answer: mediaFailed },
	);
};
