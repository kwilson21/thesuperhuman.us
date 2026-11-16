// The edge for the two public music routes: what a listener's JSON body must hold, and the sentence each field gives when
// it does not, plus who is playing, read from the request. Effect Schema readers that answer as the Zod 3 schemas they
// replaced did (the differential test for the music bodies holds them to a frozen copy of those schemas): the same sentences, the same trimming, the error keys in field order,
// and a field's LAST failing check as its sentence. The routes' answers for an unavailable or failing store are in
// src/lib/music-request.ts, next to `musicRequest`, which reads the raw body before these readers run.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { emailPattern, uuidPattern } from "../lib/fields";
import { musicIdMaxLength, musicIdPattern } from "../lib/music-catalog";
import { MERCHANDISE_KEYS } from "../lib/music-merchandise";
import type { Visitor } from "./rules/visitor";
import {
	type FieldValues,
	type RawValue,
	bodyKinds,
	choiceField,
	fieldOf,
	receivedKind,
	readFields,
	stringField,
} from "./edge";

const tooLong = (max: number) =>
	`String must contain at most ${max} character(s)`;

const expected = (what: string) => ({
	missing: "Required",
	wrongType: (received: string) => `Expected ${what}, received ${received}`,
});

/** A release, recording, campaign, channel or creative id: a lower-case slug, as it arrived (not trimmed). */
const idField = stringField(
	{ ...expected("string"), trim: false },
	Schema.isPattern(musicIdPattern, { message: "Invalid" }),
	Schema.isMaxLength(musicIdMaxLength, { message: tooLong(musicIdMaxLength) }),
);

const uuidField = stringField(
	{ ...expected("string"), trim: false },
	Schema.isPattern(uuidPattern, { message: "Invalid uuid" }),
);

/** A whole number from `least` to `most`. Any other value, a fraction or a string included, is refused. */
const wholeNumber = (least: number, most: number) =>
	fieldOf<number>((raw) =>
		Predicate.isNumber(raw) &&
		Number.isInteger(raw) &&
		raw >= least &&
		raw <= most
			? { value: raw }
			: { say: "Invalid" },
	);

/** An id that may be left out. A value that is present must be an id. */
const optionalId = idField;

const eventFields = {
	releaseId: idField,
	recordingId: idField,
	sessionId: uuidField,
	playthroughId: uuidField,
	eventId: uuidField,
	sequence: wholeNumber(1, 10_000),
	medium: choiceField(["audio", "video"], {
		...expected("'audio' | 'video'"),
		notOneOf: () => "Invalid",
	}),
	event: choiceField(["start", "progress", "listen30", "complete", "replay"], {
		...expected("event"),
		notOneOf: () => "Invalid",
	}),
	accumulatedSeconds: wholeNumber(0, 86_400),
	mediaDurationSeconds: wholeNumber(0, 86_400),
	campaignId: optionalId,
	channel: optionalId,
	creative: optionalId,
};

/** The campaign, channel and creative are the player's own words and may be missing; every other field is read and present. */
export type EventInput = Omit<
	FieldValues<typeof eventFields>,
	"campaignId" | "channel" | "creative"
> & {
	readonly campaignId?: string | undefined;
	readonly channel?: string | undefined;
	readonly creative?: string | undefined;
};

/**
 * Reads a playback event body. The route answers `{ ok: false }` for any refusal, so the sentences are not shown to
 * anyone. The campaign, channel and creative may be missing; a value that is present must be an id.
 */
export const readEventInput = <Body>(body: Body) =>
	readFields(eventFields, body, {
		defaults: {
			campaignId: undefined,
			channel: undefined,
			creative: undefined,
		},
	});

const INTEREST_KINDS = ["song", "merchandise", "both"] as const;

const joined = (values: readonly string[]) =>
	values.map((value) => `'${value}'`).join(" | ");

const MERCHANDISE_SENTENCE = joined(MERCHANDISE_KEYS);

/** What the merchandise field says of one choice it was sent, or nothing when it is one of the four. */
function choiceSentence(item: RawValue): string | undefined {
	if (!Predicate.isString(item))
		return `Expected ${MERCHANDISE_SENTENCE}, received ${receivedKind(item)}`;

	return MERCHANDISE_KEYS.some((key) => key === item)
		? undefined
		: `Invalid enum value. Expected ${MERCHANDISE_SENTENCE}, received '${item}'`;
}

/** The merchandise chosen: a choice that is not one of the four gives its sentence (the last bad one), which wins over the sentence for more than four. */
const merchandiseField = fieldOf<(typeof MERCHANDISE_KEYS)[number][]>((raw) => {
	if (!Array.isArray(raw))
		return { say: `Expected array, received ${receivedKind(raw)}` };

	const bad = raw.flatMap((item) => choiceSentence(item) ?? []);

	if (bad.length > 0) return { say: bad.at(-1) ?? "" };

	if (raw.length > 4) return { say: "Array must contain at most 4 element(s)" };

	return {
		value: raw.flatMap((item) =>
			MERCHANDISE_KEYS.filter((key) => key === item),
		),
	};
});

const emailField = fieldOf<string>((raw) => {
	if (raw === undefined) return { say: "Required" };

	if (!Predicate.isString(raw))
		return { say: `Expected string, received ${receivedKind(raw)}` };

	// The address is made lower case before it is checked, so the pattern and the length see the lower-case text.
	const text = raw.trim().toLowerCase();

	if (text.length > 120) return { say: tooLong(120) };

	return emailPattern.test(text) ? { value: text } : { say: "Invalid email" };
});

const interestFields = {
	releaseId: idField,
	email: emailField,
	interest: choiceField(INTEREST_KINDS, {
		...expected(joined(INTEREST_KINDS)),
		notOneOf: (received) =>
			`Invalid enum value. Expected ${joined(INTEREST_KINDS)}, received '${received}'`,
	}),
	merchandise: merchandiseField,
	suggestion: stringField(
		expected("string"),
		Schema.isMaxLength(500, { message: tooLong(500) }),
	),
	cityRegion: stringField(
		expected("string"),
		Schema.isMaxLength(120, { message: tooLong(120) }),
	),
	consent: fieldOf<true>((raw) =>
		raw === true
			? { value: true }
			: {
					say: "Check the box to confirm I may email you about your selection.",
				},
	),
	turnstileToken: stringField(
		{ ...expected("string"), trim: false },
		Schema.isMinLength(1, {
			message: "Complete the verification and try again.",
		}),
		Schema.isMaxLength(2048, { message: tooLong(2048) }),
	),
};

export type InterestInput = FieldValues<typeof interestFields>;

/** Whether a field's value is of the wrong type or kind (a value that cannot be read as the field at all, not one that only fails a length or pattern). */
function stops(body: { readonly [name: string]: RawValue }) {
	const text = (raw: RawValue) => Predicate.isString(raw);
	const optionalText = (raw: RawValue) => raw === undefined || text(raw);

	return (
		!text(body.releaseId) ||
		!text(body.email) ||
		!INTEREST_KINDS.some((kind) => kind === body.interest) ||
		(body.merchandise !== undefined &&
			(!Array.isArray(body.merchandise) ||
				body.merchandise.some((item) => choiceSentence(item) !== undefined))) ||
		!optionalText(body.suggestion) ||
		!optionalText(body.cityRegion) ||
		body.consent !== true ||
		!text(body.turnstileToken)
	);
}

/**
 * A song interest takes no merchandise and no suggestion. This is checked on the raw body, and only when no field is of the
 * wrong type or kind (see `stops`), so a field that only fails a length or pattern still reports this as well, and the
 * sentence is the merchandise field's.
 */
function songWithExtras(body: { readonly [name: string]: RawValue }) {
	if (stops(body) || body.interest !== "song") return {};

	const choices = Array.isArray(body.merchandise) ? body.merchandise.length : 0;

	const note = Predicate.isString(body.suggestion)
		? body.suggestion.trim()
		: "";

	return choices > 0 || note !== ""
		? {
				merchandise:
					"Choose merchandise interest to include merchandise suggestions.",
			}
		: {};
}

/** Reads an interest body. `body` is whatever the visitor sent, parsed from JSON. */
export const readInterestInput = <Body>(body: Body) =>
	readFields(interestFields, body, {
		notObject: Object.fromEntries(
			bodyKinds.map((kind) => [
				kind,
				kind === "undefined" ? "Required" : `Expected object, received ${kind}`,
			]),
		),
		winner: "last",
		defaults: { merchandise: [], suggestion: "", cityRegion: "" },
		alongside: songWithExtras,
	});

/** The request's `cf` object, as a Worker gives it: location parts are optional text, and the bot verdict is optional. */
type RequestCf = {
	country?: string;
	region?: string;
	city?: string;
	botManagement?: { verifiedBot?: boolean };
};

/** Reads who is playing from the request: Cloudflare's verdict and location, and the user agent. */
export function readVisitor(request: Request): Visitor {
	// SAFETY: Request.cf is typed CfProperties<unknown>, so its location fields read as unknown. On an incoming Worker request country, region and city are optional strings and botManagement.verifiedBot an optional boolean; cf itself can be absent (read with ?.), the visitor rule re-checks that a location part is text before it keeps it, and verifiedBot is compared with === true.
	const cf = (request as Request & { cf?: RequestCf }).cf;

	return {
		verifiedBot: cf?.botManagement?.verifiedBot === true,
		userAgent: request.headers.get("user-agent") ?? "",
		country: cf?.country,
		region: cf?.region,
		city: cf?.city,
	};
}
