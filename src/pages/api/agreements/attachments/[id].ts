import type { APIRoute } from "astro";
import { agreementSession, agreementHeaders } from "~/lib/agreement-access";
import { hashBytes } from "~/lib/agreement-artifacts";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/api/agreements/attachments/[id]";

// The same 404 for an unknown attachment, one of another request, and one whose stored object is missing, so a
// verified visitor cannot tell them apart.
const notFound = () =>
	new Response("Not found", { status: 404, headers: agreementHeaders });

const unavailable = () =>
	new Response("Unavailable", { status: 500, headers: agreementHeaders });

export const GET: APIRoute = async ({ locals, request, params }) => {
	const env = locals.runtime.env,
		db = env.MUSIC_DB;

	// A missing binding answers 503 before any read, as in src/lib/agreement-download.ts.
	if (!db || !env.AUDIO)
		return new Response("Unavailable", {
			status: 503,
			headers: agreementHeaders,
		});

	try {
		const session = await agreementSession(db, request);

		if (!session)
			return new Response("Verify email first.", {
				status: 401,
				headers: agreementHeaders,
			});

		const row = await db
			.prepare(
				`SELECT a.object_key,a.sha256 FROM software_agreement_attachments a JOIN software_offers o ON o.request_id=a.request_id WHERE a.id=? AND o.id=? AND EXISTS(SELECT 1 FROM json_each(o.agreement_details_json,'$.attachments') WHERE json_extract(value,'$.key')=a.object_key AND json_extract(value,'$.sha256')=a.sha256)`,
			)
			.bind(params.id, session.offer_id)
			.first<{ object_key: string; sha256: string }>();

		if (!row) return notFound();

		const object = await env.AUDIO.get(row.object_key);

		if (!object) return notFound();
		const bytes = await object.arrayBuffer();

		if ((await hashBytes(bytes)) !== row.sha256)
			return new Response(
				"This file couldn’t be verified, so I’ve held it back. Please let me know before you sign.",
				{ status: 503, headers: agreementHeaders },
			);

		return new Response(bytes, {
			headers: {
				...agreementHeaders,
				"content-type": "application/pdf",
				"content-disposition":
					'attachment; filename="agreement-attachment.pdf"',
				"x-content-type-options": "nosniff",
			},
		});
	} catch (error) {
		logUnexpected(ROUTE, error);

		return unavailable();
	}
};
