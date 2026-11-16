// The fit review (POST /api/owner/requests/[id]/software, action fit): the request is read, the rule decides
// (src/server/rules/offer-fit.ts: closed, resolved, then a stale page), and one batch saves the review, the request's
// updated_at and the audit. A batch its guard refused is answered RequestChanged (no read follows it, as before). No outside
// effect, so a failed store is the plain OffersStoreFailed. It builds no response text.
import * as Effect from "effect/Effect";
import { saveFit } from "../offers-store";
import { reviewFit } from "../rules/offer-fit";
import { afterRefusedFit } from "../rules/offer-refused-batch";
import type { FitCommand } from "../software-offer-input";
import {
	answerRefusedBatch,
	findRequest,
	type OfferAction,
} from "./offer-request";

/** The fit review the owner sent. */
export type FitAction = OfferAction & {
	readonly command: FitCommand;
};

/** Saves the fit review; answers the time it was saved at. */
export const reviewSoftwareFit = (action: FitAction) =>
	Effect.gen(function* () {
		const request = yield* findRequest(action.requestId);

		const write = yield* reviewFit.decide(
			{
				label: action.command.label,
				note: action.command.note,
				expectedRequestUpdatedAt: action.command.expectedRequestUpdatedAt,
				now: action.now(),
				actor: action.actor,
			},
			{ request },
		);

		yield* saveFit(write).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(afterRefusedFit, action),
			),
		);

		return write.at;
	});
