import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { agreementText } from "~/lib/agreement-access";
import { agreementHeaders } from "~/lib/agreement-host";
import { loggedAnswer } from "~/server/answers";
import { downloadAttachment } from "~/server/flows/agreement-attachment";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/attachments/[id]";

const unavailable = () => agreementText("Unavailable", 500);

const failed = loggedAnswer(ROUTE, unavailable);

export const GET: APIRoute = async ({ locals, request, params }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, [
		"MUSIC_DB",
		"AUDIO",
	]);

	if (!bindings.ok) return agreementText("Unavailable", 503);

	return runRoute(
		bindings.services,
		downloadAttachment({
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
								'attachment; filename="agreement-attachment.pdf"',
							"x-content-type-options": "nosniff",
						},
					}),
			),
			Effect.catchTags({
				VerifyFirst: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 401)),
				AttachmentNotFound: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 404)),
				AttachmentIntegrity: (refusal) =>
					Effect.succeed(agreementText(refusal.say, 503)),
				AttachmentReadFailed: (failure) => failed(failure.failure),
				AttachmentDetailsUnreadable: () => failed(new Error("malformed JSON")),
				AgreementStoreFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		{ route: ROUTE, answer: unavailable },
	);
};
