import type { APIRoute } from "astro";
import { z } from "astro/zod";
import {
	agreementSession,
	agreementJson,
	signingEnabled,
} from "~/lib/agreement-access";
import {
	nativeAgreementRoute,
	agreementRequest,
	nativeAgreementResponse,
} from "~/lib/agreement-request";
import { StoreRejected, stored } from "~/lib/reader-message";
import { getLinkedOffer } from "~/lib/software-offers";
import { deliverAgreementNotifications } from "~/lib/agreement-artifacts";
import { signAgreements, offerAgreements } from "~/lib/software-agreements";
import { classifyFailure, logUnexpected } from "~/server/failure";

export const prerender = false;

const post: APIRoute = async ({ request, locals, params }) => {
	const db = locals.runtime.env.MUSIC_DB;

	if (!db) return agreementJson({ ok: false }, 503);
	const body = await agreementRequest(request);

	if (body instanceof Response) return body;

	const input = z
		.object({
			csrf_nonce: z.string().min(1),
			documents: z
				.array(
					z.object({
						id: z.string().uuid(),
						hash: z.string().regex(/^[a-f0-9]{64}$/),
					}),
				)
				.min(1)
				.max(2),
			consent: z.literal(true),
		})
		.safeParse(body);

	try {
		const offer = params.token
				? await stored(getLinkedOffer(db, params.token))
				: null,
			session = offer
				? await stored(agreementSession(db, request, "agreement", offer.id))
				: null;

		if (!(await stored(signingEnabled(db))) || !session)
			return agreementJson(
				{
					ok: false,
					error:
						"Open a fresh email link to keep going. Your saved details will be here.",
				},
				401,
			);

		if (!input.success)
			return agreementJson(
				{
					ok: false,
					error: "Agree to sign electronically after reviewing the agreement.",
				},
				400,
			);

		if (input.data.csrf_nonce !== session.csrf_nonce)
			return agreementJson({ ok: false, error: "Reload and try again." }, 403);

		const receipt_id = await signAgreements(
			db,
			offer!,
			session,
			input.data.documents,
			request,
		);

		// The signatures are saved. The read of the agreements for the notices is part of the notices step, so neither
		// changes the answer; the owner's retry-copy sends notices that did not go out.
		try {
			const sow = (await offerAgreements(db, offer!.id)).find(
				(d) => d.kind === "sow",
			);

			if (sow) await deliverAgreementNotifications(locals.runtime.env, sow.id);
		} catch {
			/* Saved signatures survive a failed read or notification. */
		}

		return nativeAgreementResponse(
			request,
			agreementJson({ ok: true, receipt_id }),
			`/offer/${params.token}/sign`,
		);
	} catch (error) {
		// A read or the signing batch that the database rejected for no reason a request explains (not a guard, not a unique
		// index) is a fault of the site: 500, logged once without what was sent.
		if (
			error instanceof StoreRejected &&
			classifyFailure(error.failure).kind === "unexpected"
		) {
			logUnexpected("Agreement signing", error.failure);

			return agreementJson(
				{
					ok: false,
					error: "Your signature could not be saved. Try again in a moment.",
				},
				500,
			);
		}

		// Every refusal: the documents or the details changed, another session signed, a guard or a unique index refused the
		// batch, the evidence or the stored values were refused.
		return agreementJson(
			{
				ok: false,
				error: "The reviewed agreement changed. Reload and review it again.",
			},
			409,
		);
	}
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/offer/${context.params.token}/sign`,
);
