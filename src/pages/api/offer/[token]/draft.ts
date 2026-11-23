import type { APIRoute } from "astro";
import { agreementRequest } from "~/lib/agreement-request";
import {
	agreementSession,
	agreementJson,
	signingEnabled,
} from "~/lib/agreement-access";
import { getLinkedOffer } from "~/lib/software-offers";
import { saveAgreementDraft } from "~/lib/agreement-draft";
import { readDraft } from "~/lib/agreement-draft-fields";
import { classifyFailure, logUnexpected } from "~/server/failure";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
	const db = locals.runtime.env.MUSIC_DB;
	const body = await agreementRequest(request);

	if (body instanceof Response) return body;

	try {
		const offer =
			db && params.token ? await getLinkedOffer(db, params.token) : null;

		const session =
			db && offer
				? await agreementSession(db, request, "agreement", offer.id)
				: null;

		if (!db || !offer || !session || !(await signingEnabled(db)))
			return agreementJson(
				{
					ok: false,
					error:
						"Open a fresh email link to keep going. Your saved details will be here.",
				},
				401,
			);
		// SAFETY: this names the two body fields the route reads; csrf_nonce is compared to the session value and values goes to readDraft, so neither is used unchecked. The cast does not check that the body is an object: a JSON null body reads as an empty one, so it carries no nonce and gets the 403 the review route gives it.
		const input = (body ?? {}) as { csrf_nonce?: unknown; values?: unknown };

		if (input.csrf_nonce !== session.csrf_nonce)
			return agreementJson({ ok: false, error: "Reload and try again." }, 403);
		const parsed = readDraft(input.values);

		if (!parsed.ok)
			return agreementJson(
				{
					ok: false,
					error: "Check the highlighted details.",
					errors: parsed.errors,
				},
				400,
			);

		await saveAgreementDraft(db, offer, session, parsed.value);

		return agreementJson({ ok: true });
	} catch (error) {
		// A guard of the draft batch raised: since the read, the offer stopped being open for signing, the session ended or
		// an agreement was signed. 409, as before.
		if (classifyFailure(error).kind === "stale")
			return agreementJson(
				{
					ok: false,
					error:
						"Your details could not be saved. Check the fields and try again.",
				},
				409,
			);

		// Anything else (a read or the batch that failed) is a fault of the site: 500, logged once without what was sent.
		logUnexpected("Agreement draft", error);

		return agreementJson(
			{
				ok: false,
				error: "Your details could not be saved. Try again in a moment.",
			},
			500,
		);
	}
};
