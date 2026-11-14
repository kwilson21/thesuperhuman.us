import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { musicRequest } from "~/lib/music-request";
import { checkTurnstile } from "~/lib/turnstile";
import {
	createSuggestionPass,
	suggestionPassCookie,
} from "~/lib/brief-suggestion-pass";
import { logUnexpected } from "~/server/failure";

export const prerender = false;
const ROUTE = "/api/software/brief/pass";
const schema = z.object({ token: z.string().min(1).max(2048) }).strict();

export const POST: APIRoute = async ({ request, locals }) => {
	const headers = new Headers({ "cache-control": "no-store" });

	try {
		const env = locals.runtime?.env;
		const ip = request.headers.get("cf-connecting-ip");

		if (
			!env?.TURNSTILE_SECRET_KEY ||
			env.SOFTWARE_SUGGESTIONS_ENABLED !== "true" ||
			!ip
		)
			return Response.json({ ok: false }, { headers });
		const parsed = schema.safeParse(await musicRequest(request, 4096));

		if (!parsed.success) return Response.json({ ok: false }, { headers });
		const check = await checkTurnstile(
			parsed.data.token,
			env.TURNSTILE_SECRET_KEY,
			ip,
		);

		// A captcha service that cannot answer is an outage: the pass is not granted, and the answer says the service is unavailable.
		if (check === "unavailable")
			return Response.json({ ok: false }, { status: 503, headers });

		if (check === "refused") return Response.json({ ok: false }, { headers });
		headers.set(
			"set-cookie",
			`${suggestionPassCookie}=${await createSuggestionPass(env.TURNSTILE_SECRET_KEY, ip)}; Path=/api/software/brief; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`,
		);

		return Response.json({ ok: true }, { headers });
	} catch (error) {
		logUnexpected(ROUTE, error);

		return Response.json({ ok: false }, { status: 500, headers });
	}
};
