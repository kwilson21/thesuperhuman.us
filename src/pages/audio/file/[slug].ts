import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const prerender = false;

type RangeRequest =
	| { kind: "none" }
	| { kind: "malformed" }
	| { kind: "bytes"; start: number; endRaw: number | null };

type RangeParse =
	| { kind: "none" }
	| { kind: "malformed" }
	| { kind: "unsatisfiable" }
	| { kind: "ok"; offset: number; length: number };

function parseRangeRequest(header: string | null): RangeRequest {
	if (!header) return { kind: "none" };
	const match = /^bytes=(\d+)-(\d*)$/.exec(header);

	if (!match) return { kind: "malformed" };
	const start = parseInt(match[1], 10);
	const endRaw = match[2] ? parseInt(match[2], 10) : null;

	if (Number.isNaN(start) || (endRaw !== null && Number.isNaN(endRaw)))
		return { kind: "malformed" };

	return { kind: "bytes", start, endRaw };
}

function resolveRange(request: RangeRequest, size: number): RangeParse {
	if (request.kind !== "bytes") return request;
	const { start, endRaw } = request;
	const end = endRaw !== null ? endRaw : size - 1;

	if (start > end || end >= size) return { kind: "unsatisfiable" };

	return { kind: "ok", offset: start, length: end - start + 1 };
}

export const GET: APIRoute = async (context) => {
	const slug = context.params.slug;

	if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
		return new Response("not found", { status: 404 });
	}

	const collection = await getCollection("audio-tracks");

	const entry = collection.find((e) => e.id === slug);

	if (!entry) return new Response("not found", { status: 404 });

	const env = context.locals.runtime.env;
	const key = entry.data.file;

	if (key.startsWith("studio/") || key.startsWith("software/"))
		return new Response("not found", { status: 404 });

	const rangeHeader = context.request.headers.get("range");
	const rangeRequest = parseRangeRequest(rangeHeader);

	// For no Range or malformed Range, fetch the full file in a single R2 op.
	// The object's .size property gives us the content-length without a prior head().
	if (rangeRequest.kind === "none" || rangeRequest.kind === "malformed") {
		const full = await env.AUDIO.get(key);

		if (!full) return new Response("not found", { status: 404 });

		return new Response(full.body, {
			status: 200,
			headers: {
				"content-type": "audio/mpeg",
				"accept-ranges": "bytes",
				"content-length": String(full.size),
				"cache-control": "public, max-age=31536000, immutable",
				"content-disposition": `inline; filename="${slug}.mp3"`,
			},
		});
	}

	// For a syntactically valid bytes=N-M range, head() first to get size for bounds check.
	const head = await env.AUDIO.head(key);

	if (!head) return new Response("not found", { status: 404 });
	const size = head.size;

	const range = resolveRange(rangeRequest, size);

	if (range.kind === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: {
				"content-range": `bytes */${size}`,
				"accept-ranges": "bytes",
			},
		});
	}

	// range.kind === 'ok' (resolveRange only returns 'ok' or 'unsatisfiable' from a 'bytes' shape)
	if (range.kind !== "ok") return new Response("not found", { status: 404 });

	const partial = await env.AUDIO.get(key, {
		range: { offset: range.offset, length: range.length },
	});

	if (!partial) return new Response("not found", { status: 404 });

	return new Response(partial.body, {
		status: 206,
		headers: {
			"content-type": "audio/mpeg",
			"accept-ranges": "bytes",
			"content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
			"content-length": String(range.length),
			"cache-control": "public, max-age=31536000, immutable",
			"content-disposition": `inline; filename="${slug}.mp3"`,
		},
	});
};
