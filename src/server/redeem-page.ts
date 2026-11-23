// The redeem the two verify pages run (src/pages/offer/[token]/verify.astro with its offer token, and
// src/pages/agreements/verify.astro with none), as a route: the host checked, the database asked for, the flow
// (src/server/flows/signing-redeem.ts) run through `runRoute`, and every outcome answered with the Response the pages have
// always mapped: 404 `{ok:false}` for another host, 401 "This link has expired." for every refusal (no database, a key
// that names no usable link, a guard of the batch that raised), 200 `{ok:true}` for a GET, and for a POST the 303 to the
// offer's signing page or the archive with the two-hour session cookie. A store failure, a failed hash or a defect is
// logged once under the page's label and answers 500 "This link could not be opened.", which the pages render as the
// failure page (B1, B2 and Q2 of docs/plans/2026-11-signing-conversion.md). The golden corpora that follow an emailed
// link (tests/golden/areas/agreement-access.ts, `verify`) record this Response.
import * as Effect from "effect/Effect";
import {
	agreementJson,
	archiveVerifyFailed,
	redeemExpired,
	sessionCookie,
	signingVerifyFailed,
} from "../lib/agreement-access";
import {
	agreementHeaders,
	canonicalAgreementRequest,
} from "../lib/agreement-host";
import { newOfferToken } from "../lib/software-offers";
import { loggedAnswer } from "./answers";
import { redeemAgreementLink } from "./flows/signing-redeem";
import { runRoute } from "./run";
import { bindingsOrUnavailable } from "./services";

/**
 * The verify page's answer for `key` (the query's on a GET, the form's on a POST) and the page's offer token (none on
 * the archive page).
 */
export async function redeemLinkPage(
	env: Env,
	request: Request,
	key: string,
	token: string | undefined,
): Promise<Response> {
	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return redeemExpired();

	const failure = token ? signingVerifyFailed : archiveVerifyFailed;
	const failed = loggedAnswer(failure.route, failure.answer);
	const expired = () => Effect.succeed(redeemExpired());

	return runRoute(
		bindings.services,
		redeemAgreementLink({
			key,
			token,
			method: request.method,
			now: () => new Date(),
			newToken: newOfferToken,
		}).pipe(
			Effect.map((answer) =>
				answer.method === "GET"
					? agreementJson({ ok: true })
					: new Response(null, {
							status: 303,
							headers: {
								...agreementHeaders,
								location: answer.location,
								"set-cookie": sessionCookie(
									answer.sessionToken,
									new URL(request.url).protocol === "https:",
									answer.purpose,
								),
							},
						}),
			),
			Effect.catchTags({
				LinkExpired: expired,
				// A guard of the batch raised: another tab used the link first (A5), or a signing link's offer stopped being
				// open for signing (A1). The expired page, as for any other refusal.
				GuardRefused: expired,
				AgreementStoreFailed: (cause) => failed(cause.failure),
				HashFailed: (cause) => failed(cause.failure),
			}),
		),
		failure,
	);
}
