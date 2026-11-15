import type { APIRoute } from "astro";
import { mediaFailed, mediaUnavailable } from "~/lib/media-answers";
import { loadMusicCatalog } from "~/lib/music-content";
import { streamMusic } from "~/lib/music-media";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/music/file/[id]/[version]";

const serve: APIRoute = async ({ params, request, locals }) => {
	try {
		const { recordings } = await loadMusicCatalog();
		const track = recordings.find((r) => r.id === params.id);
		const version = params.version;

		if (!track || !version || !isVersion(version))
			return new Response("Not found", { status: 404 });
		const asset = track.versions[version];

		if (!asset) return new Response("Not found", { status: 404 });
		const bucket = locals.runtime.env.AUDIO;

		if (!bucket) return mediaUnavailable();

		return await streamMusic(request, bucket, asset);
	} catch (error) {
		logUnexpected(ROUTE, error);

		return mediaFailed();
	}
};

const versions = ["master", "mix", "unmixed", "video"] as const;

function isVersion(value: string): value is (typeof versions)[number] {
	return versions.some((version) => version === value);
}

export const GET = serve;
export const HEAD = serve;
