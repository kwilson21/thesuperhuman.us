import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { agreementHeaders } from "~/lib/agreement-access";
import { downloadSignedCopy } from "~/server/flows/agreement-download";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/[id]/file";

const text = (body: string, status: number) =>
	new Response(body, { status, headers: agreementHeaders });

const unavailable = () => text("Signed copy unavailable. Contact Kazon.", 500);

export const GET: APIRoute = async ({ locals, request, params }) => {
	const bindings = bindingsOrUnavailable(locals.runtime.env, [
		"MUSIC_DB",
		"AUDIO",
	]);

	if (!bindings.ok) return text("Unavailable", 503);

	return runRoute(
		bindings.services,
		downloadSignedCopy({
			id: params.id!,
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
				SignInFirst: (refusal) => Effect.succeed(text(refusal.say, 401)),
				AgreementNotFound: () => Effect.succeed(text("Not found", 404)),
				CopyNotReady: (refusal) => Effect.succeed(text(refusal.say, 409)),
				CopyMissing: () => Effect.succeed(text("Not found", 404)),
				CopyIntegrity: (refusal) => Effect.succeed(text(refusal.say, 503)),
				// The bucket read failing answers the fixed 500 without a log line, as the route has always done.
				CopyReadFailed: () => Effect.succeed(unavailable()),
			}),
		),
		{ route: ROUTE, answer: unavailable },
	);
};
