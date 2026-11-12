import type { APIRoute } from "astro";
import { loadMusicCatalog } from "~/lib/music-content";
import { streamMusic } from "~/lib/music-media";

export const prerender = false;

const serve: APIRoute = async ({ params, request, locals }) => {
	const { recordings } = await loadMusicCatalog();
	const track = recordings.find((r) => r.id === params.id);
	const version = params.version;

	if (!track || !version || !isVersion(version))
		return new Response("Not found", { status: 404 });
	const asset = track.versions[version];

	if (!asset) return new Response("Not found", { status: 404 });

	return streamMusic(request, locals.runtime.env.AUDIO, asset);
};

const versions = ["master", "mix", "unmixed", "video"] as const;

function isVersion(value: string): value is (typeof versions)[number] {
	return versions.some((version) => version === value);
}

export const GET = serve;
export const HEAD = serve;
