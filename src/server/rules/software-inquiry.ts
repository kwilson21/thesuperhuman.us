// The decisions on a software brief once the visitor has passed the limits: whether the brief is stored, and what a brief
// already stored under the same submission id means for this visitor. The id is made by the form when it opens, so a second
// submission with the same id is a retry (or a clash with someone else's id), and the visitor is answered with what is
// already stored instead of a second request. The facts are read by the flow (src/server/inquiry-store.ts).
import type { OwnerRequest } from "../../lib/owner-model";
import { alwaysWrites, rule, term, unless } from "../terms";
import { TooManyRequests } from "./intake-limits";

/** Another visitor's brief is stored under this submission id: 409. */
export class SubmissionIdTaken {
	readonly _tag = "SubmissionIdTaken";
	readonly say = "";
}

/** What the store holds under the submission id (a brief the form sent before), or nothing. */
export type StoredBrief = OwnerRequest | null;

/**
 * A brief is stored when nothing is stored under its submission id and its address is within the request limit. A brief
 * already stored is not stored twice and is not counted against the limit: there is nothing to do, and the flow answers
 * with the stored one.
 */
export const storeBrief = rule({
	name: "Store a software brief",
	given: (
		request: { readonly requestAllowed: boolean },
		facts: { readonly stored: StoredBrief },
	) => ({ ...request, ...facts }),
	nothingToDoIf: term(
		"a brief is already stored under this submission id",
		(given: { readonly stored: StoredBrief }) => given.stored !== null,
	),
	refusals: [
		unless(
			term(
				"the address is within its request limit",
				(given: { readonly requestAllowed: boolean }) => given.requestAllowed,
			),
			() => new TooManyRequests(),
		),
	],
	writes: () => true,
	writesText: "the brief, as an owner request",
});

/** The stored brief is answered to the visitor who sent it, and never to anyone else. */
export const answerStoredBrief = alwaysWrites({
	name: "Answer a stored brief to the visitor who sent it",
	given: (
		request: { readonly email: string },
		facts: { readonly stored: OwnerRequest },
	) => ({ ...request, ...facts }),
	refusals: [
		unless(
			term(
				"the stored brief is from the same address",
				(given: { readonly email: string; readonly stored: OwnerRequest }) =>
					given.stored.email.toLowerCase() === given.email.toLowerCase(),
			),
			() => new SubmissionIdTaken(),
		),
	],
	writes: (given) => given.stored,
	writesText: "the stored brief",
});
