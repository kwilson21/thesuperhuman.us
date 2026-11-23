import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import {
	agreementJson,
	signingDraftFailed,
	signingDraftUnavailable,
} from "~/lib/agreement-access";
import { agreementRequest } from "~/lib/agreement-request";
import { loggedAnswer } from "~/server/answers";
import { draftBody, saveSigningFormDraft } from "~/server/flows/signing-draft";
import { AlreadySigned } from "~/server/rules/signing-draft";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const failed = loggedAnswer(
	signingDraftFailed.route,
	signingDraftFailed.answer,
);

/** A project started, an agreement signed, or a guard of the batch that raised: the one 409 the route has always given. */
const notSaved = () =>
	Effect.succeed(
		agreementJson({ ok: false, error: new AlreadySigned().say }, 409),
	);

export const POST: APIRoute = async ({ request, locals, params }) => {
	const body = await agreementRequest(request);

	if (body instanceof Response) return body;

	const bindings = bindingsOrUnavailable(locals.runtime.env, ["MUSIC_DB"]);

	if (!bindings.ok) return signingDraftUnavailable();

	return runRoute(
		bindings.services,
		saveSigningFormDraft({
			token: params.token,
			request,
			body: draftBody(body),
			now: () => new Date(),
		}).pipe(
			Effect.as(agreementJson({ ok: true })),
			Effect.catchTags({
				SessionMissing: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 401)),
				CsrfMismatch: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 403)),
				DraftRefused: (refusal) =>
					Effect.succeed(
						agreementJson(
							{ ok: false, error: refusal.say, errors: refusal.errors },
							400,
						),
					),
				SigningStarted: notSaved,
				AlreadySigned: notSaved,
				// A guard of the batch raised: since the read, the offer stopped being open for signing, the session ended or
				// an agreement was signed.
				GuardRefused: notSaved,
				// A read or the batch that failed is a fault of the site: 500, logged once without what was sent.
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect (a value that reads once but not twice, a bug) is the same fixed 500, logged once.
		signingDraftFailed,
	);
};
