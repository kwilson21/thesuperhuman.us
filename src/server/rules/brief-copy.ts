// The decisions on the client's copy of a software brief: whether the copy may be claimed (and so sent) by the public form,
// when the brief is stored, and by the owner, who resends it, and whether a claim that could not be written is recorded as a
// failure. The facts are the request as the store read it (src/server/intake-store.ts `readCopyFacts`) and its details text as
// stored. Every condition the claim used to hold in its WHERE clause is decided here, from those plain columns; the store's
// claim re-checks only that the row is still the one that was read (status, address and details text), and a claim that
// lost that check reads and is judged again (src/server/guarded-save.ts, three tries). The copy's status moves as the
// request's own record says: no status or "failed" can be claimed; "uncertain" (the provider may have sent it) only by the
// owner, who confirmed, once a minute has passed since that attempt; "sent" never. verification/brief-copy.qnt models it.
import * as Data from "effect/Data";
import { isObject, isText } from "../../lib/type-guards";
import type { OwnerRequest } from "../../lib/owner-model";
import { alwaysWrites, rule, term, unless } from "../terms";

/** What the store read for the copy: the request, and its details exactly as stored (the text the claim compares). */
export type CopyFacts = {
	readonly request: OwnerRequest;
	readonly detailsJson: string;
};

/** No software request has this id. */
export class NoSuchSoftwareRequest extends Data.TaggedError(
	"NoSuchSoftwareRequest",
) {
	readonly say = "There is no such software request.";
}

/**
 * The stored details of a software request are JSON but not an object, so a copy claimed on them could not be recorded.
 * Nothing is sent for it. The route logs it as a failure and answers its fixed sentence.
 */
export class BriefCopyDetailsNotObject extends Data.TaggedError(
	"BriefCopyDetailsNotObject",
) {
	readonly say = "Stored details are not a JSON object.";
}

/** The sentence every refusal to send the copy again gives the owner, and a claim lost three times in a row. */
export const CANNOT_SEND = "This brief copy cannot be sent again here.";

/** The request is resolved or withdrawn: its copy is not sent. */
export class BriefCopyRequestClosed extends Data.TaggedError(
	"BriefCopyRequestClosed",
) {
	readonly say = CANNOT_SEND;
}

/** The request holds no address to send the copy to. */
export class BriefCopyNoAddress extends Data.TaggedError("BriefCopyNoAddress") {
	readonly say = CANNOT_SEND;
}

/** The copy was sent, is held for the owner to confirm, or has a status nobody writes. */
export class BriefCopyNotDue extends Data.TaggedError("BriefCopyNotDue") {
	readonly say = CANNOT_SEND;
}

/** How long an uncertain copy is held before the owner may confirm it was not sent and send it again. */
const HOLD_MS = 60_000;

type Found = { readonly found: CopyFacts | null };

type Attempt = { readonly at: string; readonly heldUntil: string };

type Given = Found & Attempt & { readonly confirmedNotSent: boolean };

const isSoftwareRequest = term(
	"a software request is stored under the id",
	(given: Found) => given.found?.request.kind === "software",
);

const detailsAreObject = term(
	"the stored details of a software request are a JSON object",
	(given: Found) =>
		given.found === null ||
		given.found.request.kind !== "software" ||
		(isObject(given.found.request.details) &&
			!Array.isArray(given.found.request.details)),
);

const isOpen = term(
	"the request is neither resolved nor withdrawn",
	(given: Found) =>
		given.found !== null &&
		given.found.request.status !== "resolved" &&
		given.found.request.status !== "withdrawn",
);

const hasAddress = term(
	"the request has an address to send to",
	(given: Found) => given.found !== null && given.found.request.email !== "",
);

/** The status the copy has recorded: nothing, or what the last attempt left. A null in the details is nothing. */
const statusOf = (found: CopyFacts) =>
	found.request.details.clientCopyStatus ?? null;

const hasNoStatus = term(
	"no copy status is recorded",
	(given: Found) => given.found !== null && statusOf(given.found) === null,
);

const mayBeSentAgain = term(
	"the copy has no status or failed, or it is uncertain, the owner confirmed it was not sent, and a minute has passed since the attempt",
	(given: Given) => {
		if (given.found === null) return false;
		const status = statusOf(given.found);

		if (status === null || status === "failed") return true;
		const attempted = given.found.request.details.clientCopyAttemptedAt;

		return (
			status === "uncertain" &&
			given.confirmedNotSent &&
			isText(attempted) &&
			attempted <= given.heldUntil
		);
	},
);

/**
 * What a claim writes: the instant of this attempt, and the request as it was read, with its details text, which the claim
 * compares (status, address and details) and the copy is built from.
 */
export type ClaimWrite = {
	readonly at: string;
	readonly request: OwnerRequest;
	readonly detailsJson: string;
};

const claimOf = (given: Given): ClaimWrite => {
	// SAFETY: the refusals (or nothingToDoIf) of every rule that writes this fail when no software request is stored, so `found` is the stored request here.
	const found = given.found as CopyFacts;

	return {
		at: given.at,
		request: found.request,
		detailsJson: found.detailsJson,
	};
};

const attemptOf = (at: string): Attempt => ({
	at,
	heldUntil: new Date(Date.parse(at) - HOLD_MS).toISOString(),
});

/**
 * The owner resends the copy: the request must exist and be a software request (404), be open, have an address and have a
 * copy that may be sent again. Every refusal but the first answers the same sentence.
 */
export const resendCopy = alwaysWrites({
	name: "Resend the client's copy of a brief",
	given: (
		request: { readonly at: string; readonly confirmedNotSent: boolean },
		facts: Found,
	): Given => ({
		...facts,
		...attemptOf(request.at),
		confirmedNotSent: request.confirmedNotSent,
	}),
	refusals: [
		unless(isSoftwareRequest, () => new NoSuchSoftwareRequest()),
		unless(detailsAreObject, () => new BriefCopyDetailsNotObject()),
		unless(isOpen, () => new BriefCopyRequestClosed()),
		unless(hasAddress, () => new BriefCopyNoAddress()),
		unless(mayBeSentAgain, () => new BriefCopyNotDue()),
	],
	writes: claimOf,
	writesText: "the claim of the copy, with the instant of this attempt",
});

/**
 * The public form sends the first copy of a brief it just stored: the copy is claimed only while the request is an open
 * software request with an address and no status. Anything else is another sender's, so there is nothing to do.
 */
export const firstCopy = rule({
	name: "Send the first copy of a brief",
	given: (request: { readonly at: string }, facts: Found): Given => ({
		...facts,
		...attemptOf(request.at),
		confirmedNotSent: false,
	}),
	nothingToDoIf: term(
		"the copy is not this sender's to claim (another sender has it, or no open software request with an address holds it) and its details can be recorded",
		(given: Given) =>
			detailsAreObject.holds(given) &&
			!(
				isSoftwareRequest.holds(given) &&
				isOpen.holds(given) &&
				hasAddress.holds(given) &&
				hasNoStatus.holds(given)
			),
	),
	refusals: [unless(detailsAreObject, () => new BriefCopyDetailsNotObject())],
	writes: claimOf,
	writesText: "the claim of the copy, with the instant of this attempt",
});

/**
 * What a failed claim records: which request, and either its details as they were read, which the write compares, or, when
 * the request could not be read at all, only that no copy status is recorded yet.
 */
export type DetailsFailureWrite = {
	readonly id: string;
	readonly expected: string;
};

export type UnreadFailureWrite = {
	readonly id: string;
	readonly expected: null;
};

export type FailureWrite = DetailsFailureWrite | UnreadFailureWrite;

/**
 * A claim that could not be written is recorded as a failure only on a copy that has no status: a status already there is
 * another sender's and stays. When the request was read, the write compares the details as they were read. When the read
 * itself failed (`read` is false) nothing is known, so the write holds only while no status is recorded.
 */
export const unclaimedFailure = rule({
	name: "Record a copy whose claim could not be written",
	given: (
		request: { readonly id: string; readonly read: boolean },
		facts: Found,
	) => ({ ...facts, ...request }),
	nothingToDoIf: term(
		"the request was read and a copy status is already recorded, or there is no stored request",
		(given: Found & { readonly read: boolean }) =>
			given.read && !hasNoStatus.holds(given),
	),
	refusals: [],
	writes: (given): FailureWrite =>
		given.found === null
			? { id: given.id, expected: null }
			: { id: given.found.request.id, expected: given.found.detailsJson },
	writesText:
		"the failure of the copy, over the details as they were read, or over a copy with no status when they were not read",
});
