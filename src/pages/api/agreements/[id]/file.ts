import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { agreementHeaders, agreementText } from "~/lib/agreement-access";
import { loggedAnswer } from "~/server/agreement-answers";
import { downloadSignedCopy } from "~/server/flows/agreement-download";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/[id]/file";

const unavailable = () =>
	agreementText("Signed copy unavailable. Contact Kazon.", 500);

const failed = loggedAnswer(ROUTE, unavailable);

export const GET: APIRoute = async ({ locals, request, params }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, [
		"MUSIC_DB",
		"AUDIO",
	]);

	if (!bindings.ok) return agreementText("Unavailable", 503);

	return runRoute(
		bindings.services,
		downloadSignedCopy({
			id: params.id ?? "",
			request,
			now: () => new Date(),
		}).pipe(
			Effect.map(
				({ bytes }) =>
					new Response(bytes, {
						headers: {
							...agreementHeaders,
							"content-type": "application/pdf",
							"content-disposition":
								'attachment; filename="signed-agreement.pdf"',
							"x-content-type-options": "nosniff",
						},
					}),
			),
			Effect.catchTags({
				SignInFirst: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 401)),
				AgreementNotFound: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 404)),
				CopyNotReady: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 409)),
				CopyMissing: () => Effect.succeed(agreementText("Not found", 404)),
				CopyIntegrity: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 503)),
				// The bucket read failing is logged once, like the bytes, the store and the digest failing, and answers the same fixed 500.
				CopyReadFailed: (failure) => failed(failure.failure),
				// Reading the bytes, the store and the digest failing are logged and answer the same fixed 500.
				CopyBytesFailed: (failure) => failed(failure.failure),
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		{ route: ROUTE, answer: unavailable },
	);
};
