import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { loadMusicCatalog } from "~/lib/music-content";
import {
	musicFailed,
	musicRequest,
	musicUnavailable,
} from "~/lib/music-request";
import { submitInterest } from "~/server/flows/music-interest";
import { readInterestInput } from "~/server/music-input";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveOwnerAlert,
	liveTurnstile,
} from "~/server/services";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request);

	if (body instanceof Response) return body;
	const read = readInterestInput(body);

	if (!read.ok)
		return Response.json({ ok: false, errors: read.errors }, { status: 400 });
	const input = read.value;
	const catalog = await loadMusicCatalog();

	if (!catalog.releases.some((r) => r.id === input.releaseId))
		return Response.json({ ok: false }, { status: 404 });
	const env = locals.runtime.env;
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);

	if (!bindings.ok || !env.TURNSTILE_SECRET_KEY) return musicUnavailable();

	return runRoute(
		Context.merge(
			Context.merge(bindings.services, liveTurnstile(env.TURNSTILE_SECRET_KEY)),
			liveOwnerAlert(env),
		),
		submitInterest({
			input,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			Effect.map(() =>
				Response.json(
					{ ok: true },
					{ headers: { "cache-control": "no-store" } },
				),
			),
			Effect.catchTags({
				TooManyInterests: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 429 }),
					),
				VerificationExpired: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 403 }),
					),
				MusicStoreFailed: () => Effect.succeed(musicFailed()),
				RateLimitStoreFailed: () => Effect.succeed(musicFailed()),
			}),
		),
		// A defect is the route's own fixed sentence, logged once without what was sent.
		{ route: "/api/music-interest", answer: musicFailed },
	);
};
