import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { agreementJson, issueAgreementLink } from "~/lib/agreement-access";
import { canonicalAgreementRequest } from "~/lib/agreement-host";
import { linkSettings } from "~/server/rules/agreement-link";
import {
	nativeAgreementRoute,
	agreementRequest,
} from "~/lib/agreement-request";

export const prerender = false;

function noRecipient(env: Env, request: Request) {
	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	if (linkSettings(env) === null)
		return agreementJson(
			{ ok: false, error: "Agreement sign-in is temporarily unavailable." },
			503,
		);

	return agreementJson(
		{ ok: false, error: "Enter a valid email address." },
		400,
	);
}

const post: APIRoute = async ({ request, locals, params }) => {
	const body = await agreementRequest(request, 4096);

	if (body instanceof Response) return body;

	const input = z
		.object({ turnstileToken: z.string().min(1).max(2048) })
		.safeParse(body);

	if (!input.success)
		return agreementJson(
			{ ok: false, error: "Complete the security check." },
			400,
		);

	// A request with no token (an empty one counts as none) has no recipient to send to. It is answered as the archive
	// path answered it before that path was removed: the same checks come first, then the 400.
	if (!params.token) return noRecipient(locals.runtime.env, request);

	try {
		const response = await issueAgreementLink(
			locals.runtime.env,
			request,
			input.data,
			params.token,
		);

		if (
			response.ok &&
			request.headers
				.get("content-type")
				?.startsWith("application/x-www-form-urlencoded")
		) {
			return new Response(null, {
				status: 303,
				headers: {
					location: `/offer/${params.token}/sign?email=sent`,
					"cache-control": "private, no-store",
				},
			});
		}

		return response;
	} catch {
		return agreementJson(
			{ ok: false, error: "Agreement sign-in is temporarily unavailable." },
			503,
		);
	}
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/offer/${context.params.token}/sign`,
);
