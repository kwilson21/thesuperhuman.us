// The edge for POST /api/agreements/link: what a client's body must hold. A body that is not an object, or whose email
// is not text of at most 320 characters, or whose security-check token is not text of 1 to 2048 characters, is refused
// with the one sentence the route gives for any of them. The reader keeps every value as it arrived (the email is not
// trimmed here: the issuing flow normalises it). The differential test in tests/server/agreement-link-input.test.ts holds
// this reader to the Zod schema it replaced.
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
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
 * Reads the attachments an offer's stored agreement details pin (`$.attachments`). No details, no `attachments`, or an
 * entry that is not a key and a digest pins nothing. Text that is not JSON is unreadable: the statement this replaces
 * (`json_each` over the column) raised on it, and the route answered its fixed 500, so the rule refuses it the same way.
 * A list pins its entries; an object pins its members' values, as `json_each` visits them.
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

	const listed = Predicate.isObject(root)
		? Object.entries(root).find(([name]) => name === "attachments")?.[1]
		: undefined;

	const entries: readonly unknown[] = Array.isArray(listed)
		? listed
		: Predicate.isObject(listed)
			? Object.values(listed)
			: Predicate.isNullish(listed)
				? []
				: [listed];

	const read = Schema.decodeUnknownOption(PinnedAttachment);

	return {
		ok: true,
		pins: entries.flatMap((entry) => {
			const pin = read(entry);

			return Option.isSome(pin) ? [pin.value] : [];
		}),
	};
}
