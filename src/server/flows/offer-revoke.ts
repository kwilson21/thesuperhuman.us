// Revoking the client's offer link (POST /api/owner/requests/[id]/software, action revoke): the request is read and must be
// open, then its link row is read (F7, #316) and the rule decides (src/server/rules/offer-revoke.ts: the link the page
// showed is live, then it is not still sending, with the window read after the link), and one batch closes the link,
// retires signing and writes the audit. A batch its guard refused is answered by the reads after it: the page's link still
// live, then a live link made in the last 20 seconds (src/server/rules/offer-refused-batch.ts). No outside effect, so a
// failed store is the plain OffersStoreFailed. It builds no response text.
import * as Effect from "effect/Effect";
import { readLinkRow, revokeOfferLink } from "../offers-store";
import { afterRefusedRevoke } from "../rules/offer-refused-batch";
import { revokeFront, revokeLink } from "../rules/offer-revoke";
import type { RevokeCommand } from "../software-offer-input";
import {
	answerRefusedBatch,
	findRequest,
	type OfferAction,
} from "./offer-request";

/** The link the owner's page showed, to close. */
export type RevokeAction = OfferAction & {
	readonly command: RevokeCommand;
};

/** Closes the client's offer link. */
export const closeOfferLink = (action: RevokeAction) =>
	Effect.gen(function* () {
		const request = yield* findRequest(action.requestId);

		yield* revokeFront.decide(null, { request });

		const now = action.now();
		const link = yield* readLinkRow(action.requestId);

		const write = yield* revokeLink.decide(
			{
				expectedLinkCreatedAt: action.command.expectedLinkCreatedAt,
				now,
				since: action.sendingSince(),
				actor: action.actor,
			},
			{ request, link },
		);

		yield* revokeOfferLink(write, action.sendingSince()).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(
					afterRefusedRevoke,
					action,
					action.command.expectedLinkCreatedAt,
				),
			),
		);
	});
