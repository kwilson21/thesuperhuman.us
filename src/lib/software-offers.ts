import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import {
	choiceField,
	FieldsRefused,
	type Issue,
	type KindSentences,
	type RawValue,
	receivedKind,
	stringField,
} from "./fields";
import type { OwnerRequest } from "./owner-model";
import { leaf, optional, type Reader, readWith, refined } from "./readers";
import { softwarePathLabel, softwarePaths } from "./software-inquiry";
import { isText } from "./type-guards";

// The terms of a software offer, read with Effect Schema value by value and put together with the readers of
// src/lib/readers.ts, as the Zod 3 schema they replace read them (tests/server/validators-differential.test.ts holds them to
// its frozen copy). Every issue is kept, with its path and sentence, in the order Zod found it; validateOfferTerms shows
// the last sentence for each path. The rules, as Zod had them:
// - A missing value, a value of the wrong kind and a payment mode that is not one STOP that value and every object and
//   list that holds it, so the checks across fields (the estimate against the total) never run. Each says "This answer is
//   required.", or "Choose a payment mode." for the payment mode: the sentences validateOfferTerms always gave them.
// - Any other failure (too long, a control character, more than one line, a blank answer, a number that is not whole or
//   is out of range, a list of the wrong length) is reported and reading goes on with the value: every check of a text or
//   a number runs, and the checks across fields run on what was read.
// - A key the terms do not name is dropped. An optional key the terms hold as undefined is kept as undefined.

const answerRequired = "This answer is required.";

const choosePaymentMode = "Choose a payment mode.";

/** What a missing value, or one of the wrong kind, says. */
const wrongKind: KindSentences = {
	missing: answerRequired,
	wrongType: () => answerRequired,
};

/** A check that passes when `test` holds and gives `sentence` when it does not. */
const holds = <A>(test: (value: A) => boolean, sentence: string) =>
	Schema.makeFilter((value: A) => (test(value) ? true : sentence));

/** Text that was a string: trimmed, as every failed check leaves it. Anything else was stopped. */
const keepText = (_sentence: string, raw: RawValue) =>
	Predicate.isString(raw) ? { value: raw.trim() } : undefined;

/** The checks every text has: at most `max` characters once trimmed, and no control character or lone surrogate. */
const textChecks = (max: number) => [
	holds(
		(value: string) => value.length <= max,
		`Keep this under ${max} characters.`,
	),
	holds(
		(value: string) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value),
		"Remove control characters.",
	),
];

/** Text that may be blank or run over several lines. */
const text = (max: number): Reader<string> =>
	leaf(stringField(wrongKind, ...textChecks(max)), keepText);

/** An answer on one line that is not blank. */
const answer = (max: number): Reader<string> =>
	leaf(
		stringField(
			wrongKind,
			...textChecks(max),
			holds((value: string) => !/[\r\n]/.test(value), "Use one line."),
			holds((value: string) => value.length > 0, answerRequired),
		),
		keepText,
	);

/** A number that is not NaN. */
const isNumber = (raw: RawValue): raw is number =>
	Predicate.isNumber(raw) && !Number.isNaN(raw);

/** A check on a number: `holds(...)`. */
type NumberCheck = Parameters<typeof Schema.Number.check>[0];

/** A number (NaN is not one) read by every check, in order; a failed check does not stop it. */
const amount = (first: NumberCheck, ...rest: readonly NumberCheck[]) =>
	leaf(
		Schema.Unknown.check(
			Schema.makeFilter((raw: RawValue) =>
				isNumber(raw) ? true : answerRequired,
			),
		).pipe(
			Schema.decodeTo(Schema.Number.check(first, ...rest), {
				decode: SchemaGetter.transform((raw: RawValue) =>
					// The filter above refused anything that is not a number.
					isNumber(raw) ? raw : Number.NaN,
				),
				encode: SchemaGetter.transform((value: number) => value),
			}),
		),
		(_sentence, raw) => (isNumber(raw) ? { value: raw } : undefined),
	);

/** A whole number (-0 is one; Infinity is not). */
const whole = (sentence: string) =>
	holds((value: number) => Number.isInteger(value), sentence);

const cents = amount(
	whole("Use whole cents."),
	holds((value: number) => value >= 100, "The fee must be at least $1."),
	holds(
		(value: number) => value <= 100_000_000,
		"The amount must be $1,000,000 or less.",
	),
);

const estimateCents = amount(
	whole("Use whole cents."),
	holds((value: number) => value >= 0, "Use a non-negative amount."),
	holds(
		(value: number) => value <= Number.MAX_SAFE_INTEGER,
		"Use a safe whole-cent amount.",
	),
);

const percent = amount(
	whole("Use a whole percentage."),
	holds((value: number) => value >= 51, "Use a percentage from 51 to 95."),
	holds((value: number) => value <= 95, "Use a percentage from 51 to 95."),
);

/**
 * A list of `element`, with `fewer` when it holds under `min` items and `more` when it holds over `max`; neither stops
 * it. Every position is read, a hole as undefined (Zod read `[...list]`); one stopped item stops the list.
 */
function list<T>(
	element: Reader<T>,
	length: {
		readonly min: number;
		readonly fewer: string;
		readonly max: number;
		readonly more: string;
	},
): Reader<T[]> {
	return (raw, path) => {
		if (!Array.isArray(raw))
			return { stopped: true, issues: [{ path, message: answerRequired }] };

		const issues: Issue[] = [];

		if (raw.length < length.min) issues.push({ path, message: length.fewer });

		if (raw.length > length.max) issues.push({ path, message: length.more });

		const values: T[] = [];
		let stopped = false;

		for (let index = 0; index < raw.length; index += 1) {
			const read = element(raw[index], [...path, index]);

			for (const issue of read.issues) issues.push(issue);

			if (read.stopped) stopped = true;
			else values.push(read.value);
		}

		return stopped ? { stopped, issues } : { stopped, value: values, issues };
	};
}

/** Lines of text, each a one-line answer, from one up to `count`. */
const lines = (max: number, count: number) =>
	list(answer(max), {
		min: 1,
		fewer: "Add at least one line.",
		max: count,
		more: `Add no more than ${count} lines.`,
	});

/**
 * An object with these fields, read in the order written, each from the value's key of that name (an inherited key too,
 * as Zod read `value[key]`). A key the readers do not name is dropped, and a field that reads as undefined is kept only
 * when the value has the key (Zod's `key in value`). A value that is not an object, or any stopped field, stops it.
 */
function fields<T>(
	readers: {
		readonly [K in keyof T]-?: Reader<T[K]>;
	},
): Reader<T> {
	return (raw, path) => {
		if (receivedKind(raw) !== "object" || !Predicate.isObject(raw))
			return { stopped: true, issues: [{ path, message: answerRequired }] };

		const issues: Issue[] = [];
		const values: [string, RawValue][] = [];
		let stopped = false;

		// SAFETY: Object.keys lists the readers' own keys, and the readers have one key for each key of T and no other.
		for (const name of Object.keys(readers) as (keyof T & string)[]) {
			const read = readers[name](raw[name], [...path, name]);

			for (const issue of read.issues) issues.push(issue);

			if (read.stopped) stopped = true;
			else if (read.value !== undefined || name in raw)
				values.push([name, read.value]);
		}

		// SAFETY: each value was read by the reader of its key, and a key is left out only when its reader read undefined.
		const value = Object.fromEntries(values) as T;

		return stopped ? { stopped, issues } : { stopped, value, issues };
	};
}

export type OfferTerms = {
	outcome: string;
	summary: string;
	milestones: {
		name: string;
		deliverables: string[];
		acceptance: string[];
		feeCents: number;
		checkpoint?: { label: string; cancellationPercent: number } | undefined;
	}[];
	clientInputs: string;
	exclusions: string;
	timing: string;
	paymentMode: "standard" | "invoice";
	projectRange?: { lowCents: number; highCents: number } | undefined;
};

type Milestone = OfferTerms["milestones"][number];

export const offerTotal = (terms: Pick<OfferTerms, "milestones">) =>
	terms.milestones.reduce((sum, milestone) => sum + milestone.feeCents, 0);

const termsReader = refined(
	fields<OfferTerms>({
		outcome: answer(120),
		summary: answer(300),
		milestones: list(
			fields<Milestone>({
				name: answer(80),
				deliverables: lines(200, 8),
				acceptance: lines(300, 5),
				feeCents: cents,
				checkpoint: optional(
					fields<NonNullable<Milestone["checkpoint"]>>({
						label: answer(120),
						cancellationPercent: percent,
					}),
				),
			}),
			{
				min: 1,
				fewer: "Add at least one milestone.",
				max: 3,
				more: "Add no more than 3 milestones.",
			},
		),
		clientInputs: text(1000),
		exclusions: text(1000),
		timing: text(500),
		paymentMode: leaf(
			choiceField(["standard", "invoice"], {
				missing: choosePaymentMode,
				wrongType: () => choosePaymentMode,
				notOneOf: () => choosePaymentMode,
			}),
			() => undefined,
		),
		projectRange: optional(
			fields<NonNullable<OfferTerms["projectRange"]>>({
				lowCents: estimateCents,
				highCents: estimateCents,
			}),
		),
	}),
	// These two issues carry their path as one dotted step ("projectRange.highCents") where Zod had two; every reader of
	// issue paths joins the steps with ".", so the error keys are the same.
	(value, issue) => {
		if (
			value.projectRange &&
			value.projectRange.lowCents > value.projectRange.highCents
		)
			issue(
				"projectRange.highCents",
				"The high estimate must be at least the low estimate.",
			);

		if (value.projectRange && value.projectRange.lowCents < offerTotal(value))
			issue(
				"projectRange.lowCents",
				"The estimate must be at least the offer total.",
			);
	},
);

/** The terms, or every issue found reading them, each with its path and sentence, in the order found. */
export function readOfferTerms(input: RawValue) {
	return readWith(termsReader, input);
}

/**
 * What `parseOfferTerms` throws: a `FieldsRefused`, so the review route refuses it as a validator's error and the failure
 * log leaves out its message (which holds only the readers' paths and fixed sentences, though Zod's could quote a
 * received value). Its name, which `logUnexpected` logs, says what failed.
 */
class OfferTermsRefused extends FieldsRefused {
	constructor(issues: readonly Issue[]) {
		super(issues);
		this.name = "OfferTermsRefused";
	}
}

/** Stored terms as they read, or a thrown `OfferTermsRefused`: how the project, invoice, review and sign code read them. */
export function parseOfferTerms(input: RawValue): OfferTerms {
	const read = readOfferTerms(input);

	if (!read.ok) throw new OfferTermsRefused(read.issues);

	return read.value;
}

/** `input` is whatever arrived, parsed from JSON; the reader is the only code that reads it. */
export function validateOfferTerms(input: RawValue) {
	const read = readOfferTerms(input);

	if (read.ok) {
		const errors: Record<string, string> = {};
		read.value.milestones.forEach((milestone, index) => {
			const normalized = milestone.deliverables.map((line) =>
				line.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase(),
			);

			if (new Set(normalized).size !== normalized.length)
				errors[`milestones.${index}.deliverables`] =
					"Each deliverable needs to be different.";
		});

		return Object.keys(errors).length
			? { ok: false as const, errors }
			: { ok: true as const, value: read.value };
	}

	return {
		ok: false as const,
		errors: Object.fromEntries(
			read.issues.map((issue) => [issue.path.join("."), issue.message]),
		),
	};
}

export const paymentSchedules = {
	standard:
		"50% of each milestone before it starts, the balance on delivery, due within 15 days.",
	invoice:
		"Each milestone is invoiced on delivery, due within 30 days. The next milestone starts after the previous one is paid.",
} as const;

export const formatUSD = (cents: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: cents % 100 ? 2 : 0,
	}).format(cents / 100);

export type SoftwareOffer = {
	agreement_details_json?: string | null;
	msa_template_id?: string | null;
	sow_template_id?: string | null;
	contractor_snapshot_json?: string | null;
	recipient_email_snapshot?: string | null;
	reused_msa_id?: string | null;
	id: string;
	request_id: string;
	version: number;
	status: "draft" | "sent" | "superseded" | "withdrawn";
	terms_json: string;
	created_at: string;
	updated_at: string;
	sent_at: string | null;
	sent_by: string | null;
};

export async function listSoftwareOffers(db: D1Database, id: string) {
	return (
		await db
			.prepare(
				"SELECT * FROM software_offers WHERE request_id=? ORDER BY version DESC",
			)
			.bind(id)
			.all<SoftwareOffer>()
	).results;
}

// Explicit allowlist: client rendering never receives the owner record or audit data.
export function clientOffer(
	request: OwnerRequest,
	offer: SoftwareOffer,
	offers: SoftwareOffer[] = [],
) {
	let input: unknown;

	try {
		input = JSON.parse(offer.terms_json);
	} catch {
		return null;
	}

	const terms = readOfferTerms(input);

	if (!terms.ok) return null;

	return {
		name: request.name,
		company: isText(request.details.company) ? request.details.company : "",
		path: softwarePathLabel(request.serviceId) ?? softwarePaths.workflow,
		version: offer.version,
		replacesVersion: offers
			.filter(
				(previous) =>
					previous.version < offer.version &&
					previous.sent_at &&
					["sent", "superseded"].includes(previous.status),
			)
			.sort((a, b) => b.version - a.version)[0]?.version,
		terms: terms.value,
	};
}

export type ClientOffer = NonNullable<ReturnType<typeof clientOffer>>;

export async function hashOfferToken(token: string) {
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
		),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}

export function newOfferToken() {
	return btoa(
		String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
	)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

export async function getLinkedOffer(db: D1Database, token: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

	return db
		.prepare(`SELECT o.* FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id
    JOIN owner_requests r ON r.id=o.request_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND o.status='sent'
    AND r.kind='software' AND r.status NOT IN ('withdrawn','resolved') AND r.email<>''`)
		.bind(await hashOfferToken(token))
		.first<SoftwareOffer>();
}

export const offerSendingMessage =
	"An offer is still being sent. Try again in a moment.";

/** The start of the sending window: a live link made after it (compared as text) means an offer is still being sent. */
export const offerSendingSince = () =>
	new Date(Date.now() - 20_000).toISOString();

// The fixed answers of the owner's software request actions (POST /api/owner/requests/[id]/software). The owner's page
// shows `message`, and every answer of that route is private. A refusal's own sentence is the route's; what is here is
// answered for a failure, which is no refusal.

const offersAnswer = (message: string, status: number) =>
	Response.json(
		{ ok: false, message },
		{ status, headers: { "cache-control": "private, no-store" } },
	);

/** A dependency this deployment does not have (the mail settings, the attachment bucket): a deliberate 503. */
export const offersUnavailable = () =>
	offersAnswer("Software offers are temporarily unavailable.", 503);

/** A store that failed unexpectedly, or a defect: 500, because nothing is known to be unavailable. */
export const offersFailed = () =>
	offersAnswer("The change could not be saved. Please try again.", 500);

/** A store that failed after the client email (a question's record, a decline's resolve, a send's live-link check). */
export const offersFailedAfterEmail = () =>
	offersAnswer(
		"The email was sent, but saving failed. Reload before you try again.",
		500,
	);

/** A store that failed after the draft was saved, while an attachment the draft removed was being cleaned up. */
export const offersFailedAfterDraft = () =>
	offersAnswer(
		"The draft was saved, but an attachment could not be cleaned up. Reload before you try again.",
		500,
	);

/** A store that failed after a client email that was refused or may not have gone out, in a send's live-link check. */
export const offersCheckFailedAfterFailedEmail = () =>
	offersAnswer(
		"The offer was saved, but the email may not have been sent and the link could not be checked. Reload before you try again.",
		500,
	);

const recentLiveLink =
	"SELECT 1 FROM software_offer_links WHERE request_id=? AND revoked_at IS NULL AND created_at>?";

export function offerSendingGuard(db: D1Database, requestId: string) {
	return db
		.prepare(
			`SELECT CASE WHEN NOT EXISTS(${recentLiveLink}) THEN 1 ELSE json_extract('Offer still sending','$') END`,
		)
		.bind(requestId, offerSendingSince());
}

export async function offerIsSending(db: D1Database, requestId: string) {
	return Boolean(
		await db
			.prepare(recentLiveLink)
			.bind(requestId, offerSendingSince())
			.first(),
	);
}
