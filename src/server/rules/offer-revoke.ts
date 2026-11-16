// Revoking the client's offer link: the owner closes the link the page showed. Decided from the request as read (its
// email) and the request's link row (its created_at and revoked_at), read before the batch (F7, #316), with the start of
// the sending window the flow read from the clock: refused when the request has no email (revoke is allowed from every
// status, by the machine), then when the link is not live or is not the one the page showed (LinkChanged), then when it
// was made in the last 20 seconds (OfferStillSending), in the order the lookups after a refused batch gave them before.
// Writes, in one batch at the time as read: signing retired, the link with that created_at revoked, and the audit
// `offer-link-revoked` with no note. Re-checked at write time by G1 (the request as read), G5 (no live link made in the
// last 20 seconds) and G10 (the link with the page's created_at is still live, and the update's own `revoked_at IS
// NULL`); a refused batch is answered by the reads in src/server/rules/offer-refused-batch.ts.
import * as Data from "effect/Data";
import type { RevokeCommand } from "../software-offer-input";
import { alwaysWrites, term, unless } from "../terms";
import {
	OfferStillSending,
	type Requested,
	type RequestRead,
	requestOpen,
	requestRead,
	retireSigning,
	type SigningRetired,
} from "./software-request";

export class LinkChanged extends Data.TaggedError("LinkChanged") {
	readonly say =
		"The client link changed since this page loaded. Reload to see the current link.";
}

/** The request's link row (`software_offer_links`, one per request), as stored. */
export type LinkRow = {
	readonly created_at: string;
	readonly revoked_at: string | null;
};

export type RevokeRequest = Pick<RevokeCommand, "expectedLinkCreatedAt"> & {
	readonly now: string;
	/** The start of the sending window: the time read less 20 seconds, as ISO text. */
	readonly since: string;
	readonly actor: string;
};

type RevokeGiven = Requested & {
	readonly command: RevokeRequest;
	readonly link: LinkRow | null;
};

/** The revoke batch: G1 over `request`, signing retired, G5, G10 and the revoke of the page's link, and the audit. */
export type RevokeWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	readonly linkCreatedAt: string;
	readonly signing: SigningRetired;
	readonly audit: { readonly action: "offer-link-revoked"; readonly note: "" };
};

/**
 * Before the link is read: the request is open (it has an email; revoke is allowed from every status). The route has
 * always answered RequestClosed before it read the link, so the flow asks this first and reads the link only after it;
 * `revokeLink` checks it again with the rest.
 */
export const revokeFront = alwaysWrites({
	name: "revoke: the request is open",
	given: (_request: null, facts: Requested) => facts,
	refusals: [requestOpen("REVOKE")],
	writes: () => ({}),
	writesText: "nothing: the request's link is read next",
});

export const revokeLink = alwaysWrites({
	name: "close the client's offer link",
	given: (
		command: RevokeRequest,
		facts: Requested & { readonly link: LinkRow | null },
	): RevokeGiven => ({ command, ...facts }),
	refusals: [
		requestOpen("REVOKE"),
		unless(
			term(
				"the request's link is live and has the created_at the page showed",
				(given: RevokeGiven) =>
					given.link !== null &&
					given.link.revoked_at === null &&
					given.link.created_at === given.command.expectedLinkCreatedAt,
			),
			() => new LinkChanged(),
		),
		unless(
			term(
				"the link was made at least 20 seconds ago",
				(given: RevokeGiven) =>
					given.link === null || !(given.link.created_at > given.command.since),
			),
			() => new OfferStillSending(),
		),
	],
	writes: (given): RevokeWrite => ({
		request: requestRead(given.request),
		at: given.command.now,
		actor: given.command.actor,
		linkCreatedAt: given.command.expectedLinkCreatedAt,
		signing: retireSigning(given.command.now),
		audit: { action: "offer-link-revoked", note: "" },
	}),
	writesText:
		"signing retired, the page's link revoked and the audit offer-link-revoked, in one batch at the time as read",
});
