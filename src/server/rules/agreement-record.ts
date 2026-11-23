// The owner's records on one agreement (docs/plans/2026-11-signing-conversion.md, section 2, `endAgreement`,
// `holdAgreement`, `recordCopy`): ending an executed or abandoned agreement, which starts its ten-year retention (and
// terminates an MSA), putting any agreement on legal hold or taking it off, and recording a copy delivered outside the
// website. Decided from the agreement read by its id and the request's id (its status, kind, effective day, signing
// times and closed archive), and for an end from the date asked, today in New York (an input, from the flow's clock) and
// the offers that reuse the agreement as their MSA (their status, their request's status and a project of theirs), as
// the owner request route decides today (src/pages/api/owner/requests/[id]/agreement.ts, the `end`, `hold` and
// `record-alternate-copy` actions).
//
// An end decides in today's order, which that route's catch makes: AgreementNotFound, NotEndable, EndDateOutside, then
// MsaInUse, then DateDoesNotExist, then ArchiveClosed. Today a date that does not exist (or a stored signing time that is
// not a time, which fails before the range is compared) throws, and so does the batch on a closed archive (the cleanup
// lock, the raise-only trigger `software_agreement_cleanup_lock`, the only check of a closed archive today); the catch then
// reads the agreement's use as an MSA, whatever its kind, so an impossible date or a closed archive on an agreement an
// open offer reuses answers the MSA's sentence. Otherwise the use is read only for an MSA, before the batch. `endFront`
// says which: the flow reads the offers that reuse the agreement only when it answers `readsMsaUse`. The closed archive
// is read with the agreement and decided last, where the batch meets the lock.
//
// Re-checked at write time: an end by A13 (for an MSA, no open offer reuses it), A14 (the update changes the row only
// while it is executed or abandoned, `AGREEMENT_MOVES.END`; otherwise no row changes and the answer is still 200) and the
// cleanup lock; a hold by the cleanup lock; a copy record by nothing (an agreement deleted since the read fails the
// event's foreign key). After a refused end batch the route reads the MSA's use again and answers MsaInUse when an open
// offer reuses it now (`afterRefusedEnd`), otherwise its generic 409. An end writes no event; a hold writes
// `hold-changed` and a copy record `copy-delivered`, each with the owner's email and the time, no offer and no reason; the
// store draws the event's id as it builds the statement, as today.
import * as Data from "effect/Data";
import { validProjectDate } from "../../lib/project-dates";
import { AGREEMENT_MOVES } from "../machines/agreement-document";
import { alwaysWrites, term, unless } from "../terms";
import { CHANGED_OR_FAILED } from "./agreement-countersign";

/** 404 `{ok:false}`, with no sentence: no agreement has this id for this request (or the route has no id). */
export class AgreementNotFound extends Data.TaggedError("AgreementNotFound") {
	readonly say = "";
}

/** 409 `{ok:false}`, with no sentence: only an executed or abandoned agreement can be ended. */
export class NotEndable extends Data.TaggedError("NotEndable") {
	readonly say = "";
}

/** 409: the end date is before the day of signing, or after today, in New York. */
export class EndDateOutside extends Data.TaggedError("EndDateOutside") {
	readonly say = "Use an end date from signing through today.";
}

/** 409: an open offer reuses the agreement as its MSA. */
export class MsaInUse extends Data.TaggedError("MsaInUse") {
	readonly say =
		"An open offer uses this agreement. Withdraw that offer first.";
}

/**
 * 409 with the route's generic sentence: the end date is not a day of the calendar (February 30, month 13), or the
 * stored signing time is not a time. Today both throw, which the route answers with that sentence.
 */
export class DateDoesNotExist extends Data.TaggedError("DateDoesNotExist") {
	readonly say = CHANGED_OR_FAILED;
}

/**
 * 409 with the route's generic sentence: the agreement's archive was closed, so its end and hold are locked. Today the
 * cleanup lock raises in the batch, which the route answers with that sentence.
 */
export class ArchiveClosed extends Data.TaggedError("ArchiveClosed") {
	readonly say = CHANGED_OR_FAILED;
}

/** The agreement as stored, read by its id and the request's id; null when there is none. */
export type RecordAgreementRow = {
	readonly status: string;
	readonly kind: string;
	readonly effective_on: string;
	readonly client_signed_at: string | null;
	readonly executed_at: string | null;
	readonly archive_closed_at: string | null;
};

/** An offer whose `reused_msa_id` is the agreement, with its request's status and a project of the offer, as stored. */
export type ReusingOfferRow = {
	readonly status: string;
	readonly request_status: string;
	/** The offer id of a project of the offer, or null when it has none. */
	readonly project_offer_id: string | null;
};

const newYork = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

/** The day of `time` in New York, as YYYY-MM-DD: how the route reads today and the day of signing. */
export const newYorkDay = (time: Date) => newYork.format(time);

/** Whether an open offer reuses the agreement: a draft or sent offer of a request neither resolved nor withdrawn, with no project. */
const inUse = (offers: readonly ReusingOfferRow[]) =>
	offers.some(
		(offer) =>
			(offer.status === "draft" || offer.status === "sent") &&
			offer.request_status !== "resolved" &&
			offer.request_status !== "withdrawn" &&
			offer.project_offer_id === null,
	);

/**
 * The first day an end may take: the New York day of the execution, else of the client's signature, else the effective
 * day; null when the stored time is not a time (today `format` throws there).
 */
function earliestDay(agreement: RecordAgreementRow): string | null {
	const signed = agreement.executed_at ?? agreement.client_signed_at;

	if (!signed) return agreement.effective_on;
	const time = new Date(signed);

	return Number.isNaN(time.getTime()) ? null : newYorkDay(time);
}

/** What the owner asked: the agreement and the end date (YYYY-MM-DD, as the reader checked its pattern), and today in New York. */
export type EndRequest = {
	readonly agreementId: string;
	readonly endedOn: string;
	/** Today in New York, from `newYorkDay` over the flow's clock. */
	readonly today: string;
};

/** The facts an end reads: the agreement, and the offers that reuse it as their MSA (none read unless `readsMsaUse`). */
export type EndFacts = {
	readonly agreement: RecordAgreementRow | null;
	readonly reusingOffers: readonly ReusingOfferRow[];
};

type FoundGiven = { readonly agreement: RecordAgreementRow | null };

type EndFrontGiven = FoundGiven & {
	readonly endable: boolean;
	/** The first day an end may take; null when the stored signing time is not a time. */
	readonly earliest: string | null;
	readonly endedOn: string;
	readonly today: string;
	/** Whether today's code throws before the batch: a signing time that is not a time, or an end date that is not a day. */
	readonly throws: boolean;
	/** Whether today's code reaches its catch, which reads the use whatever the kind: it throws, or the lock raises. */
	readonly caught: boolean;
};

type UseGiven = { readonly inUse: boolean };

type EndGiven = EndFrontGiven &
	UseGiven & {
		readonly request: EndRequest;
	};

function endFrontGiven(
	request: EndRequest,
	agreement: RecordAgreementRow | null,
): EndFrontGiven {
	const earliest = agreement === null ? null : earliestDay(agreement);

	const inRange =
		earliest !== null &&
		!(request.endedOn < earliest || request.endedOn > request.today);

	const throws =
		earliest === null || (inRange && !validProjectDate(request.endedOn));

	return {
		agreement,
		endable:
			agreement !== null &&
			AGREEMENT_MOVES.END.some((status) => status === agreement.status),
		earliest,
		endedOn: request.endedOn,
		today: request.today,
		throws,
		caught:
			throws || (agreement !== null && agreement.archive_closed_at !== null),
	};
}

const found = unless(
	term(
		"the request has an agreement with this id",
		(given: FoundGiven) => given.agreement !== null,
	),
	() => new AgreementNotFound(),
);

const endable = unless(
	term(
		"the agreement is executed or abandoned",
		(given: EndFrontGiven) => given.endable,
	),
	() => new NotEndable(),
);

const withinSigningAndToday = unless(
	term(
		"the end date is from the day of signing through today in New York (not compared when the signing time is not a time)",
		(given: EndFrontGiven) =>
			given.earliest === null ||
			!(given.endedOn < given.earliest || given.endedOn > given.today),
	),
	() => new EndDateOutside(),
);

const notInUse = unless(
	term(
		"no open offer reuses the agreement, where its use is read: for an MSA, or whatever its kind once today's code would reach its catch",
		(given: EndGiven) =>
			!((given.agreement?.kind === "msa" || given.caught) && given.inUse),
	),
	() => new MsaInUse(),
);

const dateExists = unless(
	term(
		"the end date is a day of the calendar, and the signing time a time",
		(given: EndFrontGiven) => !given.throws,
	),
	() => new DateDoesNotExist(),
);

const archiveOpen = unless(
	term(
		"the agreement's archive is not closed",
		(given: FoundGiven) => given.agreement?.archive_closed_at === null,
	),
	() => new ArchiveClosed(),
);

/** Before the offers that reuse the agreement are read: found, endable, within range; and whether to read them. */
export const endFront = alwaysWrites({
	name: "end: an executed or abandoned agreement, within the days it may end",
	given: (request: EndRequest, facts: Pick<EndFacts, "agreement">) =>
		endFrontGiven(request, facts.agreement),
	refusals: [found, endable, withinSigningAndToday],
	writes: (given) => ({
		readsMsaUse: given.agreement?.kind === "msa" || given.caught,
	}),
	writesText:
		"whether the offers that reuse the agreement are read next: for an MSA, or once today's code would reach its catch",
});

/** The end's update, and A13 for an MSA. */
export type EndWrite = {
	readonly agreementId: string;
	readonly endedOn: string;
	/** Noon UTC on the end date, ten years on (a February 29 lands on March 1). */
	readonly retainUntil: string;
	/** The MSA's termination day; null leaves `terminated_at` as it is (a SOW). */
	readonly terminatedOn: string | null;
	/** Whether A13 runs first: the agreement is an MSA. */
	readonly guardsMsaUse: boolean;
};

/** The whole end. */
export const endAgreement = alwaysWrites({
	name: "end an executed or abandoned agreement",
	given: (request: EndRequest, facts: EndFacts): EndGiven => ({
		...endFrontGiven(request, facts.agreement),
		request,
		inUse: inUse(facts.reusingOffers),
	}),
	refusals: [
		found,
		endable,
		withinSigningAndToday,
		notInUse,
		dateExists,
		archiveOpen,
	],
	writes: (given): EndWrite => {
		const end = new Date(`${given.endedOn}T12:00:00Z`);
		const msa = given.agreement?.kind === "msa";
		end.setUTCFullYear(end.getUTCFullYear() + 10);

		return {
			agreementId: given.request.agreementId,
			endedOn: given.endedOn,
			retainUntil: end.toISOString(),
			terminatedOn: msa ? given.endedOn : null,
			guardsMsaUse: msa,
		};
	},
	writesText:
		"ended_at, retain_until and, for an MSA, terminated_at, in one batch after A13 for an MSA; no event",
});

/**
 * After a refused end batch: the offers that reuse the agreement read again, whatever its kind. One that is open now
 * answers MsaInUse; otherwise nothing here, and the route answers its generic 409, as today's catch does.
 */
export const afterRefusedEnd = alwaysWrites({
	name: "explain a refused end by an open offer that reuses the agreement now",
	given: (
		_request: null,
		facts: Pick<EndFacts, "reusingOffers">,
	): UseGiven => ({ inUse: inUse(facts.reusingOffers) }),
	refusals: [
		unless(
			term(
				"no open offer reuses the agreement",
				(given: UseGiven) => !given.inUse,
			),
			() => new MsaInUse(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the refused batch's own answer stands",
});

/** A hold: the agreement, whether it is held, the owner's email and the route's time. */
export type HoldRequest = {
	readonly agreementId: string;
	readonly held: boolean;
	readonly actor: string;
	readonly at: string;
};

/** The hold's update and its `hold-changed` event. */
export type HoldWrite = {
	readonly agreementId: string;
	readonly legalHold: 0 | 1;
	readonly actor: string;
	readonly at: string;
	readonly event: "hold-changed";
};

/** Put an agreement on legal hold, or take it off, whatever its status (today's hold reads no status). */
export const holdAgreement = alwaysWrites({
	name: "put an agreement on legal hold, or take it off",
	given: (
		request: HoldRequest,
		facts: { readonly agreement: RecordAgreementRow | null },
	) => ({ request, agreement: facts.agreement }),
	refusals: [found, archiveOpen],
	writes: (given): HoldWrite => ({
		agreementId: given.request.agreementId,
		legalHold: given.request.held ? 1 : 0,
		actor: given.request.actor,
		at: given.request.at,
		event: "hold-changed",
	}),
	writesText: "legal_hold, and the hold-changed event, in one batch",
});

/** A copy delivered outside the website: the agreement, the recipient's role, how, the owner's email and the route's time. */
export type CopyRecordRequest = {
	readonly agreementId: string;
	readonly role: "client" | "contractor";
	readonly method: string;
	readonly actor: string;
	readonly at: string;
};

/** The copy row's alternate delivery (a row that does not exist changes nothing) and its `copy-delivered` event. */
export type CopyRecordWrite = CopyRecordRequest & {
	readonly event: "copy-delivered";
};

/** Record a copy of the agreement delivered outside the website, whatever its status or archive (today's reads neither). */
export const recordCopy = alwaysWrites({
	name: "record a copy delivered outside the website",
	given: (
		request: CopyRecordRequest,
		facts: { readonly agreement: RecordAgreementRow | null },
	) => ({ request, agreement: facts.agreement }),
	refusals: [found],
	writes: (given): CopyRecordWrite => ({
		...given.request,
		event: "copy-delivered",
	}),
	writesText:
		"the copy row's alternate delivery and method, and the copy-delivered event, in one batch",
});
