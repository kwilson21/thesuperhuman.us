// The answer to a refused batch: one of its compare-and-set guards refused it (another request changed what this one
// read), and the route reads fresh facts to say which change it was, in the order it always has
// (docs/plans/2026-11-offers-conversion.md, section 2, "After a refused batch"):
//   fit:                              RequestChanged
//   question, its reservation:        ProjectStarted, RequestChanged
//   decline, its first batch; send:   OfferStillSending, ProjectStarted, RequestChanged
//   revoke:                           LinkChanged, OfferStillSending, RequestChanged
//   draft:                            ProjectStarted, DraftChanged with the open draft's updated_at read again
//   question or decline, after the client email: ProjectStarted, OfferStillSending (decline only), EmailSentButChanged
// Each read is made only when the refusals before it did not answer, so no read runs ahead of a decision that comes
// before it: each rule answers either the next fact to read or the refusal, and the flow reads that fact and asks again.
// A guard refusal is never retried (src/server/guarded-save.ts, (c)). The same reads answer the refusals that name a
// condition only a guard checked before (AgreementSigned, AudioProjectExists, LinkNotRevoked, AttachmentNotUsable), the
// stored data that could not be read where a batch was built (StoredTermsUnreadable, AttachmentsUnreadable, MsaNotFound),
// a draft whose version kept being taken (SaveKeptChanging), and a decline that finds an offer left after its email
// (OfferLeftAfterEmail, F10), as they were all answered before. The facts are what the flow read; a read that fails is
// the flow's fixed answer, not a refusal.
import * as Data from "effect/Data";
import type { SoftwareOffer } from "../../lib/software-offers";
import { offerAllows } from "../machines/offer-version";
import { alwaysWrites, type Refusal, term, unless } from "../terms";
import { DraftChanged } from "./offer-draft";
import { LinkChanged } from "./offer-revoke";
import {
	OfferStillSending,
	ProjectStarted,
	proved,
	RequestChanged,
} from "./software-request";

/** The client email went out, but recording it was refused, and nothing else explains why. */
export class EmailSentButChanged extends Data.TaggedError(
	"EmailSentButChanged",
) {
	readonly say =
		"The client email was sent, but the request changed before it could be recorded. Reload before taking another action.";
}

/** The facts read after a refused batch so far; a fact not read yet is absent. */
export type RefusedBatchReads = {
	/** Revoke: the link with the page's created_at is still live. */
	readonly linkLive?: boolean;
	/** A live link of the request was made in the last 20 seconds. */
	readonly sending?: boolean;
	readonly projectStarted?: boolean;
	/** Draft: every offer version, read again. */
	readonly offers?: readonly SoftwareOffer[];
};

/** A fact read after a refused batch. */
export type RefusedBatchRead = keyof RefusedBatchReads;

const linkStillLive = unless(
	term(
		"the link the page showed is still live, or that is not read yet",
		(given: RefusedBatchReads) => given.linkLive !== false,
	),
	() => new LinkChanged(),
);

const notStillSending = unless(
	term(
		"no live link was made in the last 20 seconds, or that is not read yet",
		(given: RefusedBatchReads) => given.sending !== true,
	),
	() => new OfferStillSending(),
);

const noProjectYet = unless(
	term(
		"no project has started, or that is not read yet",
		(given: RefusedBatchReads) => given.projectStarted !== true,
	),
	() => new ProjectStarted(),
);

/** The last refusal: while a read is left, the rule goes on to it; once every read is made, `refuse` answers. */
const readsLeft = <E extends Refusal>(
	reads: readonly RefusedBatchRead[],
	refuse: (given: RefusedBatchReads) => E,
) =>
	unless(
		term(
			`a read after the refused batch is still to be made (${reads.join(", ")})`,
			(given: RefusedBatchReads) =>
				reads.some((read) => given[read] === undefined),
		),
		refuse,
	);

/** The next fact to read: the first of `reads` not read yet. */
const nextRead =
	(reads: readonly RefusedBatchRead[]) =>
	(given: RefusedBatchReads): RefusedBatchRead =>
		proved(reads.find((read) => given[read] === undefined));

const SENDING_FIRST = ["sending", "projectStarted"] as const;

export const afterRefusedFit = alwaysWrites({
	name: "answer a refused fit batch",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [readsLeft([], () => new RequestChanged())],
	writes: nextRead([]),
	writesText: "the next fact to read (none: the answer is RequestChanged)",
});

export const afterRefusedQuestion = alwaysWrites({
	name: "answer a refused question reservation",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		noProjectYet,
		readsLeft(["projectStarted"], () => new RequestChanged()),
	],
	writes: nextRead(["projectStarted"]),
	writesText: "the next fact to read",
});

/** A refused send batch, or a refused first batch of a decline. */
export const afterRefusedSendOrDecline = alwaysWrites({
	name: "answer a refused send batch or decline first batch",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		notStillSending,
		noProjectYet,
		readsLeft(SENDING_FIRST, () => new RequestChanged()),
	],
	writes: nextRead(SENDING_FIRST),
	writesText: "the next fact to read",
});

export const afterRefusedRevoke = alwaysWrites({
	name: "answer a refused revoke batch",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		linkStillLive,
		notStillSending,
		readsLeft(["linkLive", "sending"], () => new RequestChanged()),
	],
	writes: nextRead(["linkLive", "sending"]),
	writesText: "the next fact to read",
});

export const afterRefusedDraft = alwaysWrites({
	name: "answer a refused draft batch",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		noProjectYet,
		readsLeft(
			["projectStarted", "offers"],
			(given) =>
				new DraftChanged({
					updatedAt:
						given.offers?.find((offer) => offerAllows(offer.status, "SAVE"))
							?.updated_at ?? null,
				}),
		),
	],
	writes: nextRead(["projectStarted", "offers"]),
	writesText: "the next fact to read",
});

/** A refused record of a question, after its client email went out. */
export const afterRefusedQuestionRecord = alwaysWrites({
	name: "answer a refused question record, after the client email",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		noProjectYet,
		readsLeft(["projectStarted"], () => new EmailSentButChanged()),
	],
	writes: nextRead(["projectStarted"]),
	writesText: "the next fact to read",
});

/** A refused resolve of a decline, or an offer left after its email (F10), once its client email went out. */
export const afterRefusedResolve = alwaysWrites({
	name: "answer a refused decline resolve, after the client email",
	given: (_request: null, facts: RefusedBatchReads) => facts,
	refusals: [
		noProjectYet,
		notStillSending,
		readsLeft(["projectStarted", "sending"], () => new EmailSentButChanged()),
	],
	writes: nextRead(["projectStarted", "sending"]),
	writesText: "the next fact to read",
});
