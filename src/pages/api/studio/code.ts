import type { APIRoute } from "astro";
import { z } from "zod";
import {
	clientPortalEnabled,
	discardUndeliveredCode,
	issueClientCode,
	newPendingNonce,
	normalizeClientEmail,
	pendingSignInCookie,
	pendingSignInFromRequest,
	takeStudioAllowance,
} from "~/lib/audio-client-access";
import { sendAudioMessage } from "~/lib/audio-resend";
import { musicRequest } from "~/lib/music-request";
import { verifyTurnstile } from "~/lib/turnstile";
import { studioCodeEmail } from "~/lib/client-emails";

// A code request issues a code bound to the browser that asked (the pending sign-in cookie, see audio-client-access.ts).
// Two requests from one browser at the same moment (two tabs) each get a code and an email, and the later cookie wins, so
// the earlier tab's email will not open there. That is accepted: the email allowance (3 per five minutes) bounds it and
// the browser's earlier code is deleted by whichever request commits last.
export const prerender = false;

const inputSchema = z.object({
	email: z.string().max(320),
	turnstileToken: z.string().min(1).max(2048),
});

const generic = {
	ok: true,
	message: "If this email has a studio project, a sign-in code is on its way.",
};

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	if (!clientPortalEnabled(env))
		return new Response("Not found", { status: 404 });

	if (
		!env?.MUSIC_DB ||
		!env.TURNSTILE_SECRET_KEY ||
		!env.AUDIO_CLIENT_CODE_KEY ||
		!env.RESEND_API_KEY ||
		!env.CONTACT_FROM_EMAIL
	)
		return Response.json(
			{ ok: false, error: "Studio sign-in is temporarily unavailable." },
			{ status: 503 },
		);
	const body = await musicRequest(request, 4096);

	if (body instanceof Response) return body;
	const parsed = inputSchema.safeParse(body);

	if (!parsed.success)
		return Response.json(
			{ ok: false, error: "Enter your email and complete the security check." },
			{ status: 400 },
		);
	const email = normalizeClientEmail(parsed.data.email);

	if (!email)
		return Response.json(
			{ ok: false, error: "Enter a valid email address." },
			{ status: 400 },
		);
	const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";

	try {
		if (
			!(await takeStudioAllowance(
				env.MUSIC_DB,
				"code-ip",
				ip,
				10,
				env.AUDIO_CLIENT_CODE_KEY,
			))
		)
			return Response.json(
				{
					ok: false,
					error: "Please wait a few minutes before asking for another code.",
				},
				{ status: 429 },
			);

		if (
			!(await verifyTurnstile(
				parsed.data.turnstileToken,
				env.TURNSTILE_SECRET_KEY,
				ip,
			))
		) {
			return Response.json(
				{ ok: false, error: "Please complete the security check again." },
				{ status: 403 },
			);
		}

		if (
			!(await takeStudioAllowance(
				env.MUSIC_DB,
				"code-email",
				email,
				3,
				env.AUDIO_CLIENT_CODE_KEY,
			))
		)
			return Response.json(
				{
					ok: false,
					error: "Please wait a few minutes before asking for another code.",
				},
				{ status: 429 },
			);

		// A browser that sent its cookie gets that same value back whether or not a code is issued, so a refused or lost
		// request cannot replace the cookie of a code another request of the same browser just emailed, and the answer does not
		// show whether the address has a project. A browser with no cookie gets the new code's value, or a fresh random one.
		const pending = pendingSignInFromRequest(request);

		const issued = await issueClientCode(
			env.MUSIC_DB,
			email,
			env.AUDIO_CLIENT_CODE_KEY,
			new Date(),
			pending,
		);

		if (issued) {
			const { code, nonce } = issued;

			locals.runtime.ctx.waitUntil(
				(async () => {
					const sent = await sendAudioMessage({
						apiKey: env.RESEND_API_KEY,
						payload: {
							from: env.CONTACT_FROM_EMAIL,
							to: [email],
							subject: "Your studio sign-in code",
							...studioCodeEmail(code),
						},
					});

					// Discard only a confirmed rejection. After a timeout or provider error the email may still
					// arrive, so that code stays usable until it expires.
					if (!sent.ok && !sent.uncertain)
						await discardUndeliveredCode(
							env.MUSIC_DB!,
							email,
							code,
							nonce,
							env.AUDIO_CLIENT_CODE_KEY!,
						);
				})().catch(() => {
					// Keep private details out of logs. The next request can issue a fresh code.
					console.error("Studio code delivery or cleanup failed.");
				}),
			);
		}

		// Every answer sets the same cookie value whether or not a code was issued.
		return Response.json(generic, {
			headers: {
				"set-cookie": pendingSignInCookie(
					pending ?? issued?.nonce ?? newPendingNonce(),
					new URL(request.url).protocol === "https:",
				),
			},
		});
	} catch {
		return Response.json(
			{ ok: false, error: "Studio sign-in is temporarily unavailable." },
			{ status: 503 },
		);
	}
};
