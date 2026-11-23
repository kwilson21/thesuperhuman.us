// The market refresh's owner actions (docs/plans/2026-11-market-refresh.md, section 1), from /owner/pricing. Owner only
// (the Access check every /api/owner/ route has, in src/middleware.ts).
//   ask      stores the time of the ask; the next daily run searches                        200 { ok }
//   use      the proposal the page showed, laid over the research as it is now, is saved      200 { ok, version }
//            through the versioned save
//   discard  removes the proposal the page showed, and only it                               200 { ok }
//   400 { ok: false, error } a request the page never sends
//   409 { ok: false, error } the proposal was replaced or discarded, no longer makes research over the current one, or
//                            the pricing was saved from another page
//   500 / 503                the store failed, or is not bound
import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
import {
	deleteProposal,
	readProposal,
	writeAsk,
} from "~/server/market-refresh-store";
import { readRefreshInput } from "~/server/pricing-refresh-input";
import { readPricing, writePricing } from "~/server/pricing-store";
import { useProposal } from "~/server/rules/market-refresh";
import { savePricing } from "~/server/rules/pricing";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";

export const prerender = false;

const noStore = { "cache-control": "private, no-store" };

/** The route's fixed answer for a store failure or a defect: never the error's own text. */
const refreshFailed = () =>
	Response.json(
		{ ok: false, error: "That did not go through. Try again." },
		{ status: 500, headers: noStore },
	);

const conflict = (error: string) =>
	Effect.succeed(
		Response.json({ ok: false, error }, { status: 409, headers: noStore }),
	);

export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.owner)
		return Response.json({ ok: false }, { status: 403, headers: noStore });

	const body = await musicRequest(request, 4 * 1024);

	if (body instanceof Response) return body;
	const read = readRefreshInput(body);

	if (!read)
		return Response.json(
			{ ok: false, error: "That request is not one this page sends." },
			{ status: 400, headers: noStore },
		);
	const bindings = bindingsOrUnavailable(locals.runtime.env, ["RESUME_STORE"]);

	if (!bindings.ok)
		return Response.json(
			{ ok: false, error: "The pricing store is unavailable right now." },
			{ status: 503, headers: noStore },
		);

	const now = new Date().toISOString();

	const program = Effect.gen(function* () {
		if (read.action === "ask") {
			yield* writeAsk(now);

			return Response.json({ ok: true }, { headers: noStore });
		}

		if (read.action === "discard") {
			yield* deleteProposal(read.proposalId);

			return Response.json({ ok: true }, { headers: noStore });
		}

		const pricing = yield* readPricing;

		const market = yield* useProposal.decide(
			{ proposalId: read.proposalId },
			{
				stored: yield* readProposal(read.proposalId),
				current: pricing.market,
			},
		);

		const next = yield* savePricing.decide(
			{
				expectedVersion: read.expectedVersion,
				change: { part: "market", market },
				now,
			},
			pricing,
		);

		yield* writePricing(next);
		yield* deleteProposal(read.proposalId);

		return Response.json(
			{ ok: true, version: next.version },
			{ headers: noStore },
		);
	});

	return runRoute(
		bindings.services,
		program.pipe(
			Effect.catchTags({
				ProposalGone: (refusal) => conflict(refusal.say),
				ProposalOutdated: (refusal) => conflict(refusal.say),
				PricingChanged: (refusal) => conflict(refusal.say),
				MarketRefreshStoreFailed: () => Effect.succeed(refreshFailed()),
				PricingStoreFailed: () => Effect.succeed(refreshFailed()),
			}),
		),
		{ route: "/api/owner/pricing-refresh", answer: refreshFailed },
	);
};
