// Which attachment a signing session may download. An attachment is shown only when the offer the session signs pins it
// (its key and digest appear in the offer's stored agreement details) and the attachment belongs to that offer's request.
// This is the authorization of the route, and it is decided here from plain columns: the attachment's row, the offer's
// request and its stored details. Every other case, an unknown id included, is the same refusal, so the answer does not
// tell the visitor which ids exist. Pure.
import * as Data from "effect/Data";
import { readPinnedAttachments } from "../agreement-input";
import { alwaysWrites, term, unless } from "../terms";

/** The attachment as stored. */
export type StoredAttachment = {
	readonly request_id: string;
	readonly object_key: string;
	readonly sha256: string;
};

/** The offer the signing session names, as stored. */
export type StoredOffer = {
	readonly request_id: string;
	readonly agreement_details_json: string | null;
};

export type AttachmentFacts = {
	readonly attachment: StoredAttachment | null;
	readonly offer: StoredOffer | null;
};

/** The attachment is not one this session may download, or its object is not in the bucket. */
export class AttachmentNotFound extends Data.TaggedError("AttachmentNotFound") {
	readonly say = "Not found";
}

/** The offer's stored details are not JSON. The statement this replaces failed on them, and the route answered its 500. */
export class AttachmentDetailsUnreadable extends Data.TaggedError(
	"AttachmentDetailsUnreadable",
) {
	readonly say = "Unavailable";
}

type AttachmentGiven =
	| { readonly kind: "other-request" }
	| { readonly kind: "unreadable" }
	| { readonly kind: "unpinned" }
	| { readonly kind: "pinned"; readonly row: StoredAttachment };

function attachmentGiven(
	_request: null,
	facts: AttachmentFacts,
): AttachmentGiven {
	const { attachment, offer } = facts;

	if (
		attachment === null ||
		offer === null ||
		attachment.request_id !== offer.request_id
	)
		return { kind: "other-request" };

	// Only an attachment of the offer's own request has its details read, as the join did before the pin was checked.
	const read = readPinnedAttachments(offer.agreement_details_json);

	if (!read.ok) return { kind: "unreadable" };

	return read.pins.some(
		(pin) =>
			pin.key === attachment.object_key && pin.sha256 === attachment.sha256,
	)
		? { kind: "pinned", row: attachment }
		: { kind: "unpinned" };
}

/** Whether the session's offer pins this attachment. Unknown, another request's and unpinned all refuse the same way. */
export const decideAttachment = alwaysWrites({
	name: "let a signing session download an attachment its offer pins",
	given: attachmentGiven,
	refusals: [
		unless(
			term(
				"the attachment belongs to the offer's request",
				(given: AttachmentGiven) => given.kind !== "other-request",
			),
			() => new AttachmentNotFound(),
		),
		unless(
			term(
				"the offer's stored details are readable",
				(given: AttachmentGiven) => given.kind !== "unreadable",
			),
			() => new AttachmentDetailsUnreadable(),
		),
		unless(
			term(
				"the offer's details pin the attachment's key and digest",
				(given: AttachmentGiven) => given.kind === "pinned",
			),
			() => new AttachmentNotFound(),
		),
	],
	writes: (given) => (given.kind === "pinned" ? given.row : null),
	writesText: "the pinned attachment's key and digest",
});

/** The bytes are not the digest the row names. */
export class AttachmentIntegrity extends Data.TaggedError(
	"AttachmentIntegrity",
) {
	readonly say =
		"This file couldn’t be verified, so I’ve held it back. Please let me know before you sign.";
}

/** The bytes have the digest the attachment's row names. */
export const intactAttachment = alwaysWrites({
	name: "hand over an attachment whose bytes match its digest",
	given: (
		request: { readonly bytesSha256: string },
		facts: { readonly sha256: string },
	) => ({ stored: facts.sha256, actual: request.bytesSha256 }),
	refusals: [
		unless(
			term(
				"the bytes have the attachment's digest",
				(given: { stored: string; actual: string }) =>
					given.stored === given.actual,
			),
			() => new AttachmentIntegrity(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the bytes are handed over",
});
