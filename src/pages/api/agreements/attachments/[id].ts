import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { agreementHeaders } from "~/lib/agreement-access";
import { logUnexpected } from "~/server/failure";
import { downloadAttachment } from "~/server/flows/agreement-attachment";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/attachments/[id]";

const text = (body: string, status: number) =>
	new Response(body, { status, headers: agreementHeaders });

const unavailable = () => text("Unavailable", 500);

export const GET: APIRoute = async ({ locals, request, params }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, [
		"MUSIC_DB",
		"AUDIO",
	]);

	if (!bindings.ok) return text("Unavailable", 503);

	return runRoute(
		bindings.services,
		downloadAttachment({ id: params.id!, request }).pipe(
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
				VerifyFirst: (refusal) => Effect.succeed(text(refusal.say, 401)),
				AttachmentNotFound: () => Effect.succeed(text("Not found", 404)),
				AttachmentIntegrity: (refusal) =>
					Effect.succeed(text(refusal.say, 503)),
				AttachmentReadFailed: (refusal) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, refusal.failure);

						return unavailable();
					}),
			}),
		),
		{ route: ROUTE, answer: unavailable },
	);
};
