import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	agreementJson,
	signingReviewDocumentUnavailable,
	signingReviewFailed,
	signingReviewUnavailable,
} from "~/lib/agreement-access";
import {
	agreementRequest,
	nativeAgreementResponse,
	nativeAgreementRoute,
} from "~/lib/agreement-request";
import { readSigningReviewInput } from "~/server/agreement-input";
import { loggedAnswer } from "~/server/answers";
import {
	readReviewDocument,
	reviewSigningDocuments,
} from "~/server/flows/signing-review";
import { REVIEW_FAILED } from "~/server/rules/signing-review";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

/** A fault of the site (a read, a batch, a hash, or the code failing for no reason a request explains): 500, logged. */
const failed = loggedAnswer(
	signingReviewFailed.route,
	signingReviewFailed.answer,
);

/** A refusal with its own sentence, as a 409. */
const conflict = (refusal: { readonly say: string }) =>
	Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 409));

/** Stored data a reader refused, a project started, a signed agreement, or a batch another request changed: one 409. */
const notReviewed = () =>
	Effect.succeed(agreementJson({ ok: false, error: REVIEW_FAILED }, 409));

export const GET: APIRoute = async ({ request, locals, params, url }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, ["MUSIC_DB"]);

	if (!bindings.ok) return signingReviewDocumentUnavailable();

	return runRoute(
		bindings.services,
		readReviewDocument({
			token: params.token,
			request,
			documentId: url.searchParams.get("document"),
			now: () => new Date(),
		}).pipe(
			Effect.map(
				(document) =>
					new Response(document.text, {
						headers: {
							"content-type": "text/plain; charset=utf-8",
							"content-disposition": `attachment; filename="${document.kind}-review.txt"`,
							"cache-control": "private, no-store",
							"referrer-policy": "no-referrer",
							"x-content-type-options": "nosniff",
						},
					}),
			),
			Effect.catchTags({
				SessionMissing: () => Effect.succeed(agreementJson({ ok: false }, 401)),
				DocumentNotFound: () =>
					Effect.succeed(agreementJson({ ok: false }, 404)),
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		signingReviewFailed,
	);
};

const post: APIRoute = async ({ request, locals, params }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, ["MUSIC_DB"]);

	if (!bindings.ok) return signingReviewUnavailable();

	const body = await agreementRequest(request);

	if (body instanceof Response) return body;

	const input = readSigningReviewInput(body);

	const response = await runRoute(
		bindings.services,
		reviewSigningDocuments({
			token: params.token,
			request,
			// A body the reader refused carries no nonce, which the nonce check refuses (403), after the session's 401.
			body: input.ok
				? { nonce: input.value.csrf_nonce, values: input.value.values }
				: { nonce: undefined, values: undefined },
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			// The body in today's key order: ok, each document's id, kind, hash and text, then the reused MSA's id, text and hash.
			Effect.map((answer) =>
				agreementJson({
					ok: true,
					documents: answer.documents.map((document) => ({
						id: document.id,
						kind: document.kind,
						hash: document.hash,
						text: document.text,
					})),
					reused_msa: answer.reused_msa && {
						id: answer.reused_msa.id,
						text: answer.reused_msa.text,
						hash: answer.reused_msa.hash,
					},
				}),
			),
			Effect.catchTags({
				SessionMissing: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 401)),
				CsrfMismatch: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 403)),
				// The client's details do not resolve (the draft step cannot refuse values the front resolved).
				DraftRefused: (refusal) =>
					Effect.succeed(
						agreementJson(
							{ ok: false, error: refusal.say, errors: refusal.errors },
							400,
						),
					),
				SigningStarted: notReviewed,
				AlreadySigned: notReviewed,
				StoredDataRefused: notReviewed,
				GuardRefused: notReviewed,
				SaveKeptChanging: notReviewed,
				DetailsRefused: conflict,
				SignatureSaved: conflict,
				MsaMismatch: conflict,
				TemplatesUnavailable: conflict,
				RenderRefused: conflict,
				PendingMsaElsewhere: conflict,
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect (stored text that is not JSON, a contractor snapshot that is missing, a bug) is the fixed 500, logged.
		signingReviewFailed,
	);

	return nativeAgreementResponse(
		request,
		response,
		`/offer/${params.token}/sign?review=1`,
	);
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/offer/${context.params.token}/sign`,
);
