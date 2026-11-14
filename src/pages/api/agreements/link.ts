import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { issueAgreementLink, agreementJson } from "~/lib/agreement-access";
import {
	nativeAgreementRoute,
	agreementRequest,
} from "~/lib/agreement-request";

import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/api/agreements/link";

const post: APIRoute = async ({ request, locals }) => {
	const body = await agreementRequest(request, 4096);

	if (body instanceof Response) return body;

	const input = z
		.object({
			email: z.string().max(320),
			turnstileToken: z.string().min(1).max(2048),
		})
		.safeParse(body);

	if (!input.success)
		return agreementJson(
			{ ok: false, error: "Complete the security check." },
			400,
		);

	try {
		const response = await issueAgreementLink(
			locals.runtime.env,
			request,
			input.data,
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
					location: "/agreements?email=sent",
					"cache-control": "private, no-store",
				},
			});
		}

		return response;
	} catch (error) {
		// An unexpected failure (a database, KV or mail error) is a 500 with the route's sentence, logged without its text.
		logUnexpected(ROUTE, error);

		return agreementJson(
			{ ok: false, error: "Agreement sign-in is temporarily unavailable." },
			500,
		);
	}
};

export const POST = nativeAgreementRoute(post, (context) => "/agreements");
