import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { mediaFailed, mediaUnavailable } from "~/lib/media-answers";
import { renderedVideos } from "~/lib/og-media";
import { logUnexpected } from "~/server/failure";
import { readOgVideo } from "~/server/flows/og-video";
import { runRoute } from "~/server/run";
import { liveOgAssets } from "~/server/services";

export const prerender = false;

const ROUTE = "/og/[name].mp4";

const IMMUTABLE = "public, max-age=31536000, immutable";

const notFound = (say: string) => new Response(say, { status: 404 });

// In astro dev the platform proxy's ASSETS reads ./dist, which lags behind a fresh render; the dev
// server itself serves public/og/raw/. Production reads the ASSETS binding; with none bound the video is unavailable.
const serve: APIRoute = ({ params, request, locals }) =>
	runRoute(
		liveOgAssets(import.meta.env.DEV ? globalThis : locals.runtime?.env.ASSETS),
		readOgVideo({
			name: params.name,
			videos: renderedVideos(),
			requestUrl: request.url,
			method: request.method,
			range: request.headers.get("range"),
		}).pipe(
			Effect.map(({ bytes, size, slice }) => {
				const headers = new Headers({
					"content-type": "video/mp4",
					"accept-ranges": "bytes",
					"content-length": String(slice?.length ?? size),
					"cache-control": IMMUTABLE,
				});

				if (slice)
					headers.set(
						"content-range",
						`bytes ${slice.offset}-${slice.offset + slice.length - 1}/${size}`,
					);

				if (request.method === "HEAD") return new Response(null, { headers });

				return new Response(
					slice
						? bytes.slice(slice.offset, slice.offset + slice.length)
						: bytes,
					{ status: slice ? 206 : 200, headers },
				);
			}),
			Effect.catchTags({
				OgVideoNotFound: (refusal) => Effect.succeed(notFound(refusal.say)),
				OgVideoMissing: (refusal) => Effect.succeed(notFound(refusal.say)),
				RangeOutsideFile: (refusal) =>
					Effect.succeed(
						new Response(null, {
							status: 416,
							headers: { "content-range": `bytes */${refusal.size}` },
						}),
					),
				AssetsNotBound: () => Effect.succeed(mediaUnavailable()),
				AssetsAnswered: (failure) =>
					Effect.sync(() => {
						logUnexpected(
							ROUTE,
							new Error(`The static assets answered ${failure.status}`),
						);

						return mediaFailed();
					}),
				AssetsFailed: (failure) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return mediaFailed();
					}),
			}),
		),
		{ route: ROUTE, answer: mediaFailed },
	);

export const GET = serve;
export const HEAD = serve;
