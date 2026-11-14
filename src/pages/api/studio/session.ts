import type { APIRoute } from "astro";
import { z } from "zod";
import {
	clientPortalEnabled,
	completeClientCode,
	hashValue,
	normalizeClientEmail,
	pendingSignInFromRequest,
	studioSessionCookie,
	takeStudioAllowance,
} from "~/lib/audio-client-access";
import { musicRequest } from "~/lib/music-request";

export const prerender = false;

const inputSchema = z.object({
	email: z.string().max(320),
	code: z.string().regex(/^\d{8}$/),
});

// One answer for a wrong, expired, used or never-issued code and for a browser that did not ask for the code, so it does
// not show which it was or whether the address has a project.
const notThisBrowser = () =>
	Response.json(
		{
			ok: false,
			error:
				"That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here.",
		},
		{ status: 401 },
	);

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env))
		return new Response("Not found", { status: 404 });

	if (!env?.MUSIC_DB || !env.AUDIO_CLIENT_CODE_KEY) {
		return Response.json(
			{ ok: false, error: "Studio sign-in is temporarily unavailable." },
			{ status: 503 },
		);
	}

	const body = await musicRequest(request, 4096);

	if (body instanceof Response) return body;
	const parsed = inputSchema.safeParse(body);
	const email = parsed.success ? normalizeClientEmail(parsed.data.email) : null;

	if (!parsed.success || !email)
		return Response.json(
			{ ok: false, error: "Check the email and eight-digit code." },
			{ status: 400 },
		);
	const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
	const pending = pendingSignInFromRequest(request);

	// A code only works in the browser that asked for it. Without that browser's cookie nothing is looked up, charged or
	// counted, so someone who only knows the address cannot use up anyone's attempts or allowances.
	if (!pending) return notThisBrowser();

	try {
		const allowed =
			(await takeStudioAllowance(
				env.MUSIC_DB,
				"session-ip",
				ip,
				20,
				env.AUDIO_CLIENT_CODE_KEY,
			)) &&
			(await takeStudioAllowance(
				env.MUSIC_DB,
				"session-requester",
				`${email}:${await hashValue(pending)}`,
				10,
				env.AUDIO_CLIENT_CODE_KEY,
			));

		if (!allowed)
			return Response.json(
				{ ok: false, error: "Too many attempts. Please wait a few minutes." },
				{ status: 429 },
			);

		const token = await completeClientCode(
			env.MUSIC_DB,
			email,
			parsed.data.code,
			pending,
			env.AUDIO_CLIENT_CODE_KEY,
		);

		if (!token) return notThisBrowser();

		const secure = new URL(request.url).protocol === "https:";
		const headers = new Headers();
		headers.append("set-cookie", studioSessionCookie(token, secure));
		// The pending cookie is left to expire (Max-Age, reset by each code request): a browser that holds codes for two addresses
		// needs it for the second sign-in. A used code cannot be used again, and the cookie is HttpOnly, random and useless without a code.

		return Response.json({ ok: true }, { headers });
	} catch {
		return Response.json(
			{ ok: false, error: "Studio sign-in is temporarily unavailable." },
			{ status: 503 },
		);
	}
};
