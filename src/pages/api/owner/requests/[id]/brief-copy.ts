import type { APIRoute } from "astro";
import { z } from "zod";
import { musicRequest } from "~/lib/music-request";
import { getOwnerRequest } from "~/lib/owner-requests";
import { deliverSoftwareBriefCopyDetailed } from "~/lib/software-brief-copy";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/api/owner/requests/[id]/brief-copy";

const schema = z.object({
	action: z.literal("send"),
	confirmedNotSent: z.boolean().optional(),
});

/** A failure of the database or of the mail provider: the route's fixed sentence, whatever was raised. */
const failed = () =>
	Response.json(
		{
			ok: false,
			error: "The brief copy could not be sent. Please try again.",
		},
		{ status: 500 },
	);

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
	const env = locals.runtime?.env;

	if (!env?.MUSIC_DB || !params.id)
		return Response.json({ ok: false }, { status: 503 });
	const body = await musicRequest(request, 1024);

	if (body instanceof Response) return body;
	const parsed = schema.safeParse(body);

	if (!parsed.success) return Response.json({ ok: false }, { status: 400 });

	try {
		const saved = await getOwnerRequest(env.MUSIC_DB, params.id);

		if (!saved || saved.kind !== "software")
			return Response.json({ ok: false }, { status: 404 });

		// Stored details are a JSON object. Anything else cannot record that a copy was claimed, so no email is sent for it.
		if (
			saved.details === null ||
			typeof saved.details !== "object" ||
			Array.isArray(saved.details)
		) {
			logUnexpected(ROUTE, new Error("Stored details are not a JSON object."));

			return failed();
		}

		const delivery = await deliverSoftwareBriefCopyDetailed(
			env.MUSIC_DB,
			saved,
			env,
			true,
			parsed.data.confirmedNotSent,
		);

		switch (delivery.kind) {
			case "sent":
				return Response.json({ ok: true });
			case "notClaimed":
				return Response.json(
					{ ok: false, error: "This brief copy cannot be sent again here." },
					{ status: 409 },
				);
			// No mail key or address on this deployment: unavailable, and nothing was asked of the provider.
			case "unconfigured":
				return Response.json(
					{
						ok: false,
						error: "The brief copy could not be sent. Please try again.",
					},
					{ status: 503 },
				);
			// The provider refused the copy or did not answer. What was recorded is on the request.
			case "refused":
			case "uncertain":
				return failed();
			case "unexpected":
				logUnexpected(ROUTE, delivery.failure);

				return failed();
		}
	} catch (failure) {
		logUnexpected(ROUTE, failure);

		return failed();
	}
};
