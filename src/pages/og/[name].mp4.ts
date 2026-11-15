import type { APIRoute } from "astro";
import { mediaFailed } from "~/lib/media-answers";
import { serveOgVideo } from "~/lib/og-media";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/og/[name].mp4";

// In astro dev the platform proxy's ASSETS reads ./dist, which lags behind a fresh render; the dev
// server itself serves public/og/raw/. Production reads the ASSETS binding; with none bound the video is unavailable.
const serve: APIRoute = async ({ params, request, locals }) => {
	try {
		return await serveOgVideo(
			request,
			params.name,
			import.meta.env.DEV ? globalThis : locals.runtime?.env.ASSETS,
		);
	} catch (error) {
		logUnexpected(ROUTE, error);

		return mediaFailed();
	}
};

export const GET = serve;
export const HEAD = serve;
