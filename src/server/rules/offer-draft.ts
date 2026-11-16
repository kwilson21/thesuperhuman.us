// Saving the owner's draft offer: a new version, or the open draft updated. Its reads come between its decisions, so the
// rule is staged, each stage deciding on what was read so far, in the order the route has always answered
// (docs/plans/2026-11-offers-conversion.md, section 2):
//   1. the request and whether a project started: ProjectStarted, RequestClosed, RequestResolved (draftFront);
//   2. every offer version, with the terms the flow read (`validateOfferTerms`) after them: TermsInvalid, then
//      DraftChanged when the page's updated_at is not the open draft's (null when none is open) (chooseDraft); a draft is
//      open when its status allows SAVE, by the machine (`offerVersion`); a new version is numbered newest plus one;
//   3. after the metadata of the attachments the draft removes is read: the attachments the details name, as the flow
//      read them (`namedAttachmentsOf`): AttachmentsUnreadable (draftAttachments);
//   4. the named attachments' metadata rows and closed archives, and the MSA the draft reuses, read just before the batch,
//      where only the batch checked them before: AttachmentNotUsable, then MsaNotFound (saveDraft), which writes the batch.
// Every try of `decideAndSave` (src/server/guarded-save.ts) reads and decides from stage 1 again: the batch's unique
// indexes (one version number per request, one open draft) back stage 2's numbering, so their violation is
// ChangedSinceRead, three tries in all (F7, #316). Re-checked at write time by G1 (the request as read), G2 (no project),
// G7 (the open draft's status and the page's updated_at, and the update's own `status IN` the SAVE list) and G11 per
// named attachment (its row unchanged, in no closed archive, or a closed archive whose manifest cannot be read); the
// reused MSA by the foreign key. A refused batch, and the refusals of stages 3 and 4, are answered by the reads in src/server/rules/offer-refused-batch.ts. After the batch, each
// removed attachment the batch deleted has its R2 object removed (attachmentsToClean).
import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import { parseAgreementAttachments } from "../../lib/agreement-fields";
import { FieldsRefused } from "../../lib/fields";
import type { OfferTerms, SoftwareOffer } from "../../lib/software-offers";
import {
	OFFER_MOVES,
	type OfferMove,
	offerAllows,
} from "../machines/offer-version";
import type { DraftCommand } from "../software-offer-input";
import { alwaysWrites, term, unless } from "../terms";
import {
	type AttachmentsRead,
	AttachmentNotUsable,
	attachmentsUsable,
	type NamedAttachment,
	noProjectStarted,
	type ProjectRead,
	type Requested,
	type RequestRead,
	RequestResolved,
	requestOpen,
	requestRead,
	statusAllows,
	writeTime,
} from "./software-request";

const DRAFT_CHANGED =
	"The saved draft changed since this page loaded. Save again to keep what’s on screen, or reload to see the saved version.";

/** The terms do not read: 400 with `errors`, by field path. */
export class TermsInvalid extends Data.TaggedError("TermsInvalid")<{
	readonly errors: Readonly<Record<string, string>>;
}> {
	readonly say = "Check the offer terms.";
}

/** The open draft is not the one the page saved over: 409 with the open draft's updated_at, or null when none is open. */
export class DraftChanged extends Data.TaggedError("DraftChanged")<{
	readonly updatedAt: string | null;
}> {
	readonly say = DRAFT_CHANGED;
}

/** The attachments the details name do not read (F5). Answered as a refused batch is: a changed draft. */
export class AttachmentsUnreadable extends Data.TaggedError(
	"AttachmentsUnreadable",
) {
	readonly say = DRAFT_CHANGED;
}

/** The MSA the draft confirms it reuses does not exist (F5; the foreign key refused it). Answered as a refused batch is. */
export class MsaNotFound extends Data.TaggedError("MsaNotFound") {
	readonly say = DRAFT_CHANGED;
}

/** Stage 1: no project has started, and the request is open and allows DRAFT. */
export const draftFront = alwaysWrites({
	name: "draft: no project has started, and the request is open and not resolved",
	given: (_request: null, facts: Requested & ProjectRead) => facts,
	refusals: [
		noProjectStarted,
		requestOpen("DRAFT"),
		statusAllows("DRAFT", () => new RequestResolved()),
	],
	writes: () => ({}),
	writesText: "nothing: the offers are read next",
});

/** The terms the flow read with `validateOfferTerms`. */
export type TermsRead =
	| { readonly ok: true; readonly value: OfferTerms }
	| { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

export type ChooseDraftRequest = {
	readonly terms: TermsRead;
	readonly expectedUpdatedAt: string | null;
	readonly now: string;
};

/** The offer versions of the request, as stored. */
export type OffersRead = { readonly offers: readonly SoftwareOffer[] };

type ChooseGiven = {
	readonly terms: TermsRead;
	readonly expected: string | null;
	readonly open: SoftwareOffer | null;
	readonly newest: number;
	readonly now: string;
};

/** The version a draft saves: the open draft, or a new one numbered after the newest. */
export type DraftChoice = {
	/** The open draft's id and updated_at (G7), or null for a new version. */
	readonly open: { readonly id: string; readonly updatedAt: string } | null;
	readonly version: number;
	readonly termsJson: string;
	/** The write time: the time read, or one millisecond after the open draft's updated_at. */
	readonly at: string;
};

/** Stage 2: the terms read, and the page saved over the open draft (or over none). */
export const chooseDraft = alwaysWrites({
	name: "choose the version a draft saves",
	given: (command: ChooseDraftRequest, facts: OffersRead): ChooseGiven => ({
		terms: command.terms,
		expected: command.expectedUpdatedAt,
		open:
			facts.offers.find((offer) => offerAllows(offer.status, "SAVE")) ?? null,
		newest: Math.max(0, ...facts.offers.map((offer) => offer.version)),
		now: command.now,
	}),
	refusals: [
		unless(
			term("the terms read", (given: ChooseGiven) => given.terms.ok),
			(given) =>
				new TermsInvalid({ errors: given.terms.ok ? {} : given.terms.errors }),
		),
		unless(
			term(
				"the page saved over the open draft's updated_at, or over none when no draft is open",
				(given: ChooseGiven) =>
					(given.open?.updated_at ?? null) === given.expected,
			),
			(given) =>
				new DraftChanged({ updatedAt: given.open?.updated_at ?? null }),
		),
	],
	writes: (given): DraftChoice => ({
		open:
			given.open === null
				? null
				: { id: given.open.id, updatedAt: given.open.updated_at },
		version: given.open?.version ?? given.newest + 1,
		termsJson: JSON.stringify(given.terms.ok ? given.terms.value : null),
		at: writeTime(given.now, given.open?.updated_at ?? null),
	}),
	writesText:
		"the version to save, the terms as stored and the write time; the flow makes a new id only for a new version",
});

/** What the flow read of the attachments the details name: none (no details, or null), the list, or that it does not read. */
export type NamedRead =
	| null
	| { readonly ok: true; readonly attachments: readonly NamedAttachment[] }
	| { readonly ok: false };

/**
 * The attachments `agreementDetails` names, read where the route read them (while its batch was built): only when the
 * details are given and not null, from their `attachments` (a value that has none names none). Pure; for the flow.
 */
export function namedAttachmentsOf(
	details: DraftCommand["agreementDetails"],
): NamedRead {
	if (details === undefined || details === null) return null;

	const listed =
		Predicate.isObject(details) && "attachments" in details
			? details.attachments
			: undefined;

	try {
		return { ok: true, attachments: parseAgreementAttachments(listed) };
	} catch (error) {
		if (error instanceof FieldsRefused) return { ok: false };

		throw error;
	}
}

/** Stage 3: the attachments the details name read. */
export const draftAttachments = alwaysWrites({
	name: "draft: the attachments the details name read",
	given: (_request: null, facts: { readonly named: NamedRead }) => facts.named,
	refusals: [
		unless(
			term(
				"the details name no attachments, or attachments that read",
				(named: NamedRead) => named === null || named.ok,
			),
			() => new AttachmentsUnreadable(),
		),
	],
	writes: (named) => (named !== null && named.ok ? named.attachments : []),
	writesText: "the attachments to guard (none when the details name none)",
});

/** A removed attachment's metadata row, every column, kept to put it back if its R2 object cannot be removed. */
export type RemovedAttachment = {
	readonly id: string;
	readonly request_id: string;
	readonly filename: string;
	readonly version: string;
	readonly document_date: string;
	readonly object_key: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly created_at: string;
	readonly created_by: string;
};

/** The MSA a draft reuses: the command's id when it confirms the reuse, otherwise none. */
export const reusedMsaOf = (
	command: Pick<DraftCommand, "reusedMsaId" | "confirmMsaReuse">,
) => (command.confirmMsaReuse ? (command.reusedMsaId ?? null) : null);

export type SaveDraftRequest = Pick<
	DraftCommand,
	"agreementDetails" | "reusedMsaId" | "confirmMsaReuse"
> & {
	/** The open draft's id, or the new id the flow made for a new version. */
	readonly id: string;
	readonly actor: string;
};

export type SaveDraftFacts = Requested & {
	readonly chosen: DraftChoice;
	readonly attachments: readonly NamedAttachment[];
	readonly named: AttachmentsRead;
	readonly removed: readonly RemovedAttachment[];
	/** Whether the reused MSA's row exists; null when the draft reuses none, so none was read. */
	readonly reusedMsaFound: boolean | null;
};

type SaveGiven = SaveDraftFacts & { readonly command: SaveDraftRequest };

/** How the draft is saved: the open draft updated (G7, and SAVE's status list), or a new version inserted. */
export type DraftSave =
	| {
			readonly kind: "update";
			readonly expectedUpdatedAt: string;
			readonly move: OfferMove;
	  }
	| { readonly kind: "insert"; readonly version: number };

/**
 * The draft batch: G1 over `request`, G2, the save, G11 per attachment, the details set or cleared (null leaves them as
 * they are), the reused MSA set or cleared (null leaves it), the audit, and each removed attachment's metadata row deleted
 * when nothing names it (the statement's own `NOT EXISTS`, which decides which rows it deletes and refuses nothing).
 */
export type DraftWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	readonly id: string;
	readonly version: number;
	readonly save: DraftSave;
	readonly termsJson: string;
	readonly attachments: readonly NamedAttachment[];
	readonly details: { readonly json: string | null } | null;
	readonly reusedMsa: { readonly id: string | null } | null;
	readonly removed: readonly RemovedAttachment[];
	readonly audit: "offer-draft-saved";
};

/** Stage 4: the named attachments usable, and the reused MSA there; what `decideAndSave` asks on each try. */
export const saveDraft = alwaysWrites({
	name: "save the owner's draft offer",
	given: (command: SaveDraftRequest, facts: SaveDraftFacts): SaveGiven => ({
		command,
		...facts,
	}),
	refusals: [
		unless(
			term(
				"each named attachment has its metadata row, unchanged, in no closed archive, and every closed archive reads",
				(given: SaveGiven) => attachmentsUsable(given.attachments, given.named),
			),
			() => new AttachmentNotUsable(),
		),
		unless(
			term(
				"the draft reuses no MSA, or one that exists",
				(given: SaveGiven) =>
					reusedMsaOf(given.command) === null || given.reusedMsaFound === true,
			),
			() => new MsaNotFound(),
		),
	],
	writes: (given): DraftWrite => ({
		request: requestRead(given.request),
		at: given.chosen.at,
		actor: given.command.actor,
		id: given.command.id,
		version: given.chosen.version,
		save:
			given.chosen.open === null
				? { kind: "insert", version: given.chosen.version }
				: {
						kind: "update",
						expectedUpdatedAt: given.chosen.open.updatedAt,
						move: OFFER_MOVES.SAVE,
					},
		termsJson: given.chosen.termsJson,
		attachments: given.attachments,
		details:
			given.command.agreementDetails === undefined
				? null
				: {
						json:
							given.command.agreementDetails === null
								? null
								: JSON.stringify(given.command.agreementDetails),
					},
		reusedMsa:
			given.command.confirmMsaReuse === undefined
				? null
				: { id: reusedMsaOf(given.command) },
		removed: given.removed,
		audit: "offer-draft-saved",
	}),
	writesText:
		"the draft inserted or updated, its details and reused MSA, the audit offer-draft-saved and each removed attachment's row deleted when nothing names it, in one batch",
});

/** After the batch: the removed rows it deleted (the keys its delete returned), each to have its R2 object removed. */
export const attachmentsToClean = alwaysWrites({
	name: "clean up the removed attachments the draft's batch deleted",
	given: (
		_request: null,
		facts: {
			readonly removed: readonly RemovedAttachment[];
			readonly deletedKeys: readonly string[];
		},
	) => facts,
	refusals: [],
	writes: (given) =>
		given.removed.filter((row) => given.deletedKeys.includes(row.object_key)),
	writesText:
		"each deleted row whose R2 object is removed, and put back with the cleanup pending when that fails",
});
