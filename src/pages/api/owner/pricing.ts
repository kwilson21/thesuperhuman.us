// The owner's pricing reference (docs/plans/2026-11-offer-board.md, section 4), saved from /owner/pricing. Owner only
// (the Access check every /api/owner/ route has, in src/middleware.ts).
//   200 { ok, version }      saved
//   400 { ok: false, error } a value or the research is not readable, with the reason
//   409 { ok: false, error } saved from another page since this one loaded
//   500 / 503                the store failed, or is not bound
import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
import { readPricingInput } from "~/server/pricing-input";
import { readPricing, writePricing } from "~/server/pricing-store";
import { savePricing } from "~/server/rules/pricing";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const noStore = { "cache-control": "private, no-store" };

/** The route's fixed answer for a store failure or a defect: never the error's own text. */
const pricingFailed = () =>
	Response.json(
		{ ok: false, error: "Your pricing could not be saved. Try again." },
		{ status: 500, headers: noStore },
	);

export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.owner)
		return Response.json({ ok: false }, { status: 403, headers: noStore });

	// The research file with its sources and caveats, and the JSON around it.
	const body = await musicRequest(request, 96 * 1024);

	if (body instanceof Response) return body;
	const read = readPricingInput(body);

	if (!read.ok)
		return Response.json(
			{ ok: false, error: read.error },
			{ status: 400, headers: noStore },
		);
	const bindings = bindingsOrUnavailable(locals.runtime.env, ["RESUME_STORE"]);

	if (!bindings.ok)
		return Response.json(
			{ ok: false, error: "Saving is unavailable right now." },
			{ status: 503, headers: noStore },
		);

	return runRoute(
		bindings.services,
		Effect.gen(function* () {
			const stored = yield* readPricing;

			const next = yield* savePricing.decide(
				{ ...read.value, now: new Date().toISOString() },
				stored,
			);

			yield* writePricing(next);

			return Response.json(
				{ ok: true, version: next.version },
				{ headers: noStore },
			);
		}).pipe(
			Effect.catchTags({
				PricingChanged: (refusal) =>
					Effect.succeed(
						Response.json(
							{ ok: false, error: refusal.say },
							{ status: 409, headers: noStore },
						),
					),
				PricingStoreFailed: () => Effect.succeed(pricingFailed()),
			}),
		),
		{ route: "/api/owner/pricing", answer: pricingFailed },
	);
};
