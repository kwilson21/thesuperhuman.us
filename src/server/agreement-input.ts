// The edge for the agreement routes: what a body must hold, the session cookie's token, and the attachments an offer's
// stored details pin.
//
// POST /api/agreements/link: what a client's body must hold. A body that is not an object, or whose email
// is not text of at most 320 characters, or whose security-check token is not text of 1 to 2048 characters, is refused
// with the one sentence the route gives for any of them. The reader keeps every value as it arrived (the email is not
// trimmed here: the issuing flow normalises it). The differential test in tests/server/agreement-link-input.test.ts holds
// this reader to the Zod schema it replaced.
//
// The signing routes' bodies and the owner's agreements command are read at the end of this file; the comment there
// says how.
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { type Contractor, readContractor } from "../lib/agreement-fields";
import { versionLabelPattern } from "../lib/agreement-version-label";
import {
	fieldOf,
	type RawValue,
	receivedKind,
	stringField,
	uuidPattern,
} from "../lib/fields";
import { readAtEdge } from "./edge";

const AgreementLinkBody = Schema.Struct({
	email: Schema.String.check(
		Schema.isMaxLength(320, { message: "Invalid email." }),
	),
	turnstileToken: Schema.String.check(
		Schema.isMinLength(1, { message: "Complete the security check." }),
		Schema.isMaxLength(2048, { message: "Complete the security check." }),
	),
});

export type AgreementLinkInput = typeof AgreementLinkBody.Type;

/** Reads a link request body. `body` is whatever the visitor sent, parsed from JSON (or the form's fields). */
export const readAgreementLinkInput = <Body>(body: Body) =>
	readAtEdge(AgreementLinkBody, body);

/** The cookie's token of a signing or archive session: 43 URL-safe characters, or null when the request has none. */
export function sessionTokenOf(
	request: Request,
	purpose: "agreement" | "archive",
): string | null {
	const name =
		purpose === "archive" ? "agreement_archive" : "agreement_session";

	return (
		request.headers
			.get("cookie")
			?.match(
				new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`),
			)?.[1] ?? null
	);
}

/** One attachment an offer's details pin: where the file is kept and the digest it must have. */
const PinnedAttachment = Schema.Struct({
	key: Schema.String,
	sha256: Schema.String,
});

export type PinnedAttachment = typeof PinnedAttachment.Type;

const StoredDetails = Schema.fromJsonString(Schema.Json);

/**
 * Reads the attachments an offer's stored agreement details pin (`$.attachments`), serving only the exact shape the two
 * writers store (`JSON.stringify` of details whose `attachments` `parseAgreementAttachments` checked): a plain object with
 * a list of attachment objects, written compactly. No details pins nothing. Text that is not JSON is unreadable: the
 * statement this replaces (`json_each` over the column) raised on it, and the route answered its fixed 500, so the rule
 * refuses it the same way. A JSON5 spelling is not JSON to this reader and gets that same answer, although SQLite 3.42 and
 * later read JSON5, so the SQL it replaces may have served such details (the SQLite version D1 runs was not checked). No
 * writer produces such text, so B is stricter only for an unreachable input. Anything that parses but is not that exact
 * shape pins nothing and is refused as an unpinned
 * attachment: details that are not a plain object, attachments that are not a list, an entry that is not an object with a
 * text key and a text digest, and text that is not what `JSON.stringify` writes for its own value (which is how a
 * duplicate key or odd spacing shows itself; SQLite and JavaScript read those differently, so B refuses
 * where the SQL it replaces may have served). These inputs are unreachable through the writers.
 */
export function readPinnedAttachments(
	stored: string | null,
):
	| { readonly ok: true; readonly pins: readonly PinnedAttachment[] }
	| { readonly ok: false } {
	if (stored === null) return { ok: true, pins: [] };
	const details = Schema.decodeUnknownResult(StoredDetails)(stored);

	if (Result.isFailure(details)) return { ok: false };
	const root = details.success;

	// A text that does not read back as itself has a duplicate key, another spelling or other spacing.
	if (JSON.stringify(root) !== stored) return { ok: true, pins: [] };

	const listed = Predicate.isObject(root)
		? Object.entries(root).find(([name]) => name === "attachments")?.[1]
		: undefined;

	const entries: readonly unknown[] = Array.isArray(listed) ? listed : [];
	const read = Schema.decodeUnknownOption(PinnedAttachment);

	return {
		ok: true,
		pins: entries.flatMap((entry) => {
			const pin = read(entry);

			return Option.isSome(pin) ? [pin.value] : [];
		}),
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// The signing area's bodies: POST /api/offer/[token]/link, /review and /sign, and the owner's POST /api/owner/agreements.
// Each reader accepts and refuses every body as the Zod 3 schema (`astro/zod`) it replaces did, with the same value;
// tests/server/validators-differential.test.ts holds each to a frozen copy of that schema. A refusal carries no sentence:
// each route answers one sentence for any refusal, at the point it answers it today, so the reader is called where the
// route parses today and its answer is used there. The link: 400 "Complete the security check.", once the body is read and
// before the token, the host and the settings are looked at. The review: 403 "Reload and try again.", after its 401, the
// answer a nonce that is not the session's gets too. The sign: 400 "Agree to sign electronically after reviewing the
// agreement.", after its 401 and before the nonce's 403. The owner's command: 400 "Check required fields and limits.",
// after the owner and database checks and the body. What the values keep, as Zod 3 kept them:
// - a body, and each signed document, is read only when Zod 3 called it an object (`receivedKind`): an array, null, a
//   date, a map, a set, a promise and a function are refused;
// - only the schema's own fields, in the order written below; any other key is left out;
// - a field that may be left out (the review's `values`, the retention manifest, the labels, a publish's `confirmed`) is
//   in the value when the body has the key, even set to `undefined`, and not when the body lacks it; `values` and
//   `manifest` are the very values the body held;
// - text is measured in UTF-16 units; the version label and the source revision are trimmed before they are checked, the
//   nonce, the token, the document's id and hash and the template text are not;
// - a document id is checked with Zod 3's UUID pattern (`uuidPattern`, which asks for no version);
// - the versions are converted with `Number()`, as Zod 3's `coerce.number()` did, so "", null, false, [] and [0] read as
//   0, true as 1 and " 3 " as 3, and must then be whole (`Number.isInteger`) and at least 0 (`expectedCurrentVersion`,
//   where -0 stays -0) or above 0 (`version`). A value `Number()` cannot convert (a symbol, or an object whose `toString`
//   and `valueOf` give no primitive, which a JSON body can hold) made Zod throw a TypeError; the reader throws too
//   (Schema's Error, whose cause holds that TypeError as its defect), whatever the other fields hold, so the handler
//   throws as it does today;
// - the contractor's details of `config` are read by `readContractor` (src/lib/agreement-fields.ts), as the Zod
//   transform read them, and the value is what it reads.

/** A value Zod 3 called an object, then read as `struct`. */
const zodObject = <S extends Schema.Top>(struct: S) =>
	Schema.Unknown.check(
		Schema.makeFilter((raw: RawValue) => receivedKind(raw) === "object"),
	).pipe(Schema.decodeTo(struct));

/** Text that is not empty, as it arrived. */
const filled = Schema.String.check(Schema.isMinLength(1));

const SigningLinkBody = zodObject(
	Schema.Struct({
		turnstileToken: Schema.String.check(
			Schema.isMinLength(1),
			Schema.isMaxLength(2048),
		),
	}),
);

/** The signing link's body, read: the security check's token. */
export type SigningLinkInput = typeof SigningLinkBody.Type;

/** Reads the body of POST /api/offer/[token]/link. `body` is what `agreementRequest` parsed (JSON, or a form's fields). */
export function readSigningLinkInput<Body>(
	body: Body,
): { ok: true; value: SigningLinkInput } | { ok: false } {
	const read = readAtEdge(SigningLinkBody, body);

	return read.ok ? { ok: true, value: read.value } : { ok: false };
}

const SigningReviewBody = zodObject(
	Schema.Struct({
		csrf_nonce: filled,
		values: Schema.optionalKey(Schema.Unknown),
	}),
);

/** The review's body, read: the nonce, and the client's details as they arrived (`resolveClientDetails` reads them). */
export type SigningReviewInput = typeof SigningReviewBody.Type;

/** Reads the body of POST /api/offer/[token]/review. `body` is what `agreementRequest` parsed. */
export function readSigningReviewInput<Body>(
	body: Body,
): { ok: true; value: SigningReviewInput } | { ok: false } {
	const read = readAtEdge(SigningReviewBody, body);

	return read.ok ? { ok: true, value: read.value } : { ok: false };
}

/** One document the client signs: its id and the SHA-256 of the text they reviewed. */
const SignedDocument = zodObject(
	Schema.Struct({
		id: Schema.String.check(Schema.isPattern(uuidPattern)),
		hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
	}),
);

const SigningSignBody = zodObject(
	Schema.Struct({
		csrf_nonce: filled,
		documents: Schema.Array(SignedDocument).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(2),
		),
		consent: Schema.Literal(true),
	}),
);

/** The sign route's body, read: the nonce, one or two documents, and the consent. */
export type SigningSignInput = typeof SigningSignBody.Type;

/** Reads the body of POST /api/offer/[token]/sign. `body` is what `agreementRequest` parsed. */
export function readSigningSignInput<Body>(
	body: Body,
): { ok: true; value: SigningSignInput } | { ok: false } {
	const read = readAtEdge(SigningSignBody, body);

	return read.ok ? { ok: true, value: read.value } : { ok: false };
}

/** The sentences are never shown (the route has one sentence for any refusal), so each says the same. */
const unread = { missing: "Required", wrongType: () => "Required" };

/** Text, trimmed, then checked. */
const trimmed = (...checks: Parameters<typeof Schema.String.check>) =>
	stringField(unread, ...checks);

/** Zod 3's `coerce.number()`: the value converted with `Number()`, then a number that passes `check`. */
const coercedNumber = (check: (value: number) => boolean) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(Schema.Number.check(Schema.makeFilter(check)), {
			decode: SchemaGetter.transform((raw: RawValue) => Number(raw)),
			encode: SchemaGetter.transform((value: number) => value),
		}),
	);

/** The current version a save expects: a whole number of 0 or more. */
const expectedVersion = coercedNumber(
	(value) => Number.isInteger(value) && value >= 0,
);

const templateKind = Schema.Literals(["msa", "sow"]);

const templateText = Schema.String.check(Schema.isMaxLength(102400));

const accessCleanup = Schema.Struct({
	action: Schema.Literal("access-cleanup"),
	confirmed: Schema.Literal(true),
});

const retentionPreview = Schema.Struct({
	action: Schema.Literal("retention-preview"),
});

const retentionApply = Schema.Struct({
	action: Schema.Literal("retention-apply"),
	confirmed: Schema.Literal(true),
	manifest: Schema.optionalKey(Schema.Unknown),
});

const preview = Schema.Struct({
	action: Schema.Literal("preview"),
	kind: templateKind,
	text: templateText,
	expectedCurrentVersion: expectedVersion,
	versionLabel: Schema.optional(trimmed(Schema.isMaxLength(40))),
	sourceRevision: Schema.optional(trimmed(Schema.isMaxLength(120))),
});

const publish = Schema.Struct({
	action: Schema.Literal("publish"),
	kind: templateKind,
	text: templateText,
	expectedCurrentVersion: expectedVersion,
	versionLabel: trimmed(Schema.isPattern(versionLabelPattern)),
	sourceRevision: Schema.optional(trimmed(Schema.isMaxLength(120))),
	confirmed: Schema.optional(Schema.Boolean),
});

const templateVersion = Schema.Struct({
	action: Schema.Literal("template-version"),
	kind: templateKind,
	version: coercedNumber((value) => Number.isInteger(value) && value > 0),
});

const setting = Schema.Struct({
	action: Schema.Literal("setting"),
	enabled: Schema.Boolean,
	confirmed: Schema.Literal(true),
});

const config = Schema.Struct({
	action: Schema.Literal("config"),
	values: fieldOf<Contractor>((raw) => {
		const read = readContractor(raw);

		return read.ok
			? { value: read.value }
			: { say: "Invalid contractor details." };
	}),
	expectedCurrentVersion: expectedVersion,
});

/** The reader of each action, by the action's name. */
const ownerCommands = {
	"access-cleanup": accessCleanup,
	"retention-preview": retentionPreview,
	"retention-apply": retentionApply,
	preview,
	publish,
	"template-version": templateVersion,
	setting,
	config,
};

export type AccessCleanupCommand = typeof accessCleanup.Type;

export type RetentionPreviewCommand = typeof retentionPreview.Type;

/** The retention apply: the manifest as it arrived (the apply checks it against a fresh scan before any delete). */
export type RetentionApplyCommand = typeof retentionApply.Type;

export type TemplatePreviewCommand = typeof preview.Type;

export type TemplatePublishCommand = typeof publish.Type;

export type TemplateVersionCommand = typeof templateVersion.Type;

export type SigningSettingCommand = typeof setting.Type;

export type ContractorConfigCommand = typeof config.Type;

/** The owner's command on POST /api/owner/agreements, read. */
export type OwnerAgreementsCommand =
	| AccessCleanupCommand
	| RetentionPreviewCommand
	| RetentionApplyCommand
	| TemplatePreviewCommand
	| TemplatePublishCommand
	| TemplateVersionCommand
	| SigningSettingCommand
	| ContractorConfigCommand;

/**
 * Reads the owner's command on POST /api/owner/agreements (not the request route's `readOwnerAgreementAction`). `body` is
 * what `agreementRequest` parsed. Like the Zod discriminated union: a body Zod 3 did not call an object is refused, and so
 * is one whose `action` (read as the union read it, `body.action`) names none of the eight actions.
 */
export function readOwnerAgreementsCommand<Body>(
	body: Body,
): { ok: true; value: OwnerAgreementsCommand } | { ok: false } {
	if (receivedKind(body) !== "object" || !Predicate.isObject(body))
		return { ok: false };

	const named = "action" in body ? body.action : undefined;

	const reader = Object.entries(ownerCommands).find(
		([action]) => action === named,
	)?.[1];

	if (!reader) return { ok: false };

	// Every field is read, as Zod read every key of the object, so a version `Number()` cannot convert throws even when a
	// field before it already failed.
	const read = Schema.decodeUnknownResult(reader, { errors: "all" })(body);

	return Result.isSuccess(read)
		? { ok: true, value: read.success }
		: { ok: false };
}
