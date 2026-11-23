import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	agreementJson,
	signingSignFailed,
	signingSignUnavailable,
} from "~/lib/agreement-access";
import {
	agreementRequest,
	nativeAgreementResponse,
	nativeAgreementRoute,
} from "~/lib/agreement-request";
import { siteOrigin } from "~/lib/site-origin.mjs";
import { readSigningSignInput } from "~/server/agreement-input";
import { liveAgreementMail } from "~/server/agreement-services";
import { loggedAnswer } from "~/server/answers";
import { signSigningDocuments } from "~/server/flows/signing-sign";
import { SIGNING_CHANGED } from "~/server/rules/signing-sign";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

/** A read or the signing batch that failed for no reason a request explains: 500, logged once without what was sent. */
const failed = loggedAnswer(signingSignFailed.route, signingSignFailed.answer);

/** Every refusal of the signature: the documents or the details changed, another session signed, a guard refused. */
const changed = () =>
	Effect.succeed(agreementJson({ ok: false, error: SIGNING_CHANGED }, 409));

/** A refusal of the front checks, with its own sentence. */
const said = (status: number) => (refusal: { readonly say: string }) =>
	Effect.succeed(agreementJson({ ok: false, error: refusal.say }, status));

const post: APIRoute = async ({ request, locals, params }) => {
	const env = locals.runtime.env;
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return signingSignUnavailable();

	const body = await agreementRequest(request);

	if (body instanceof Response) return body;

	const input = readSigningSignInput(body);

	// The notices go out only when the mail is configured (a Resend key and a sender), as they always have.
	const services =
		env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL
			? Context.merge(bindings.services, liveAgreementMail(env.RESEND_API_KEY))
			: bindings.services;

	const response = await runRoute(
		services,
		signSigningDocuments({
			token: params.token,
			request,
			body: input.ok
				? {
						nonce: input.value.csrf_nonce,
						documents: input.value.documents,
					}
				: null,
			from: env.CONTACT_FROM_EMAIL ?? "",
			origin: siteOrigin(env.SITE_ORIGIN),
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			Effect.map((receipt) => agreementJson({ ok: true, receipt_id: receipt })),
			Effect.catchTags({
				SessionMissing: said(401),
				ConsentMissing: said(400),
				CsrfMismatch: said(403),
				DocumentsChanged: changed,
				StoredDataRefused: changed,
				SignedElsewhere: changed,
				DetailsChanged: changed,
				NameNotPrintable: changed,
				EvidenceTooLong: changed,
				SigningOff: changed,
				OfferUnavailable: changed,
				SigningStarted: changed,
				SessionNotOpen: changed,
				GuardRefused: changed,
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect (a bug) is the same fixed 500, logged once.
		signingSignFailed,
	);

	return nativeAgreementResponse(
		request,
		response,
		`/offer/${params.token}/sign`,
	);
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/offer/${context.params.token}/sign`,
);
