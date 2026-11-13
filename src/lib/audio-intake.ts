import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	choiceField,
	emailPattern,
	fieldOf,
	type FieldValues,
	type Mutable,
	plainErrors,
	type RawValue,
	readFields,
	receivedKind,
	stringField,
} from "./fields";
import type { NewOwnerRequest } from "./owner-requests";

export const audioOffers = {
	"vocal-mix": {
		name: "Two-track vocal mixing",
		price: 150,
		description:
			"I clean, balance and shape your recorded vocals over a finished stereo beat.",
		scope:
			"One song up to five minutes, one stereo beat and up to eight prepared vocal tracks. Cleanup, light tuning and timing. Two revision rounds. Stereo WAV mix and MP3; mastering separate.",
		files: "Your stereo beat and separate, prepared vocal tracks.",
		preparation:
			"Choose your takes first. Name your files and export each from the same starting point. WAV is preferred. Include a rough mix if you have one, and note any effects already applied.",
	},
	mastering: {
		name: "Mastering",
		price: 75,
		description:
			"I adjust the overall tone, dynamics and level of your finished mix for release.",
		scope:
			"One stereo song up to five minutes. Overall tone, dynamics and level. Two revision rounds. Final WAV master and MP3. Mixing and specialist formats are separate.",
		files: "Your finished stereo mix.",
		preparation:
			"Send a WAV at its original sample rate without clipping. Tell me about processing that defines the sound before removing it. No arbitrary peak-level target is required.",
	},
	bundle: {
		name: "Two-track vocal mix + master",
		price: 200,
		description: "Both, from prepared vocals to final master.",
		scope:
			"One song up to five minutes, one stereo beat and up to eight prepared vocal tracks. Cleanup and light tuning/timing. Two revision rounds. Approved WAV mix, final WAV master and MP3.",
		files: "Your stereo beat and separate, prepared vocal tracks.",
		preparation:
			"Choose your takes first. Name your files and export each from the same starting point. WAV is preferred. Include a rough mix and note existing effects. We approve the mix before mastering.",
	},
	custom: {
		name: "Something else / not sure",
		price: null,
		description: "Full mixing, production or recording support.",
		scope:
			"Files and project needs are reviewed before acceptance. We agree on work, deliverables and timing in a custom quote. Two revision rounds, like every project.",
		files: "A rough mix or representative recording, if available.",
		preparation:
			"For full mixing, describe the instrumental and vocal tracks available. For recording support, describe your setup. You can start without finished audio.",
	},
} as const;

export type IntakeService = keyof typeof audioOffers;

export type Direction = "judgment" | "preferences" | "specific";

type PreferenceField = {
	id: string;
	label: string;
	options: { value: string; label: string }[];
};

const vocalFields: PreferenceField[] = [
	{
		id: "vocal",
		label: "Vocal character",
		options: [
			{ value: "natural", label: "Natural & intimate" },
			{ value: "forward", label: "Bold & upfront" },
			{ value: "blended", label: "Blended into the track" },
		],
	},
	{
		id: "space",
		label: "Space",
		options: [
			{ value: "dry", label: "Close & dry" },
			{ value: "spacious", label: "Spacious & atmospheric" },
		],
	},
	{
		id: "tuning",
		label: "Tuning character",
		options: [
			{ value: "natural", label: "Natural" },
			{ value: "stylized", label: "Noticeably stylized" },
		],
	},
];

const masterFields: PreferenceField[] = [
	{
		id: "tone",
		label: "Overall character",
		options: [
			{ value: "warm", label: "Warm & rounded" },
			{ value: "bright", label: "Bright & open" },
		],
	},
	{
		id: "dynamics",
		label: "Overall feel",
		options: [
			{ value: "open", label: "Open & dynamic" },
			{ value: "dense", label: "Dense & assertive" },
		],
	},
];

export function directionFields(service: IntakeService): PreferenceField[] {
	return service === "mastering"
		? masterFields
		: service === "custom"
			? []
			: vocalFields;
}

export function describePreferences(
	service: IntakeService,
	preferences: Record<string, string>,
): string[] {
	return directionFields(service).flatMap((field) => {
		const option = field.options.find((o) => o.value === preferences[field.id]);

		return option ? [`${field.label}: ${option.label}`] : [];
	});
}

// The intake form's validator, written to answer exactly as the Zod 3 schema it replaced did (tests/server/validators-differential.test.ts
// holds it to that on thousands of inputs): the same sentences, Zod's own among them ("Required", "Expected string,
// received number", "String must contain at most 120 character(s)"), because the visitor reads them; the last sentence of
// a field wins; and the error keys follow the order of the fields.
const kinds = {
	missing: "Required",
	wrongType: (received: string) => `Expected string, received ${received}`,
};

const tooLong = (max: number) =>
	Schema.isMaxLength(max, {
		message: `String must contain at most ${max} character(s)`,
	});

const oneLine = Schema.makeFilter((value: string) =>
	/[\r\n]/.test(value) ? "Invalid input" : true,
);

// Text a visitor typed holds no control character, so it cannot swell the stored request (a control character takes six
// characters of JSON) or reach an email as more than text. A line break and a tab are allowed where text runs over
// several lines. The sentence is the one the software inquiry and the agreement forms give.
const noControl = Schema.makeFilter((value: string) =>
	/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(value)
		? "Remove control characters."
		: true,
);

const linkSentence = "Use a complete HTTPS link, or leave this blank.";

const httpsLink = Schema.makeFilter((value: string) => {
	if (!value) return true;

	try {
		const url = new URL(value);

		return url.protocol === "https:" && !url.username && !url.password
			? true
			: linkSentence;
	} catch {
		return linkSentence;
	}
});

const optionalLink = () =>
	stringField(kinds, tooLong(2048), httpsLink, noControl);

const choice = <const V extends readonly [string, ...string[]]>(values: V) => {
	const expected = values.map((value) => `'${value}'`).join(" | ");

	return choiceField(values, {
		missing: "Required",
		wrongType: (received) => `Expected ${expected}, received ${received}`,
		notOneOf: (received) =>
			`Invalid enum value. Expected ${expected}, received '${received}'`,
	});
};

// A record of short keys to short values: the sentence is the last issue Zod raised, a key's before its value's.
const preferences = fieldOf<Record<string, string>>((raw) => {
	if (raw === undefined) return { value: {} };

	if (!Predicate.isObject(raw) || receivedKind(raw) !== "object")
		return { say: `Expected object, received ${receivedKind(raw)}` };

	const said: string[] = [];
	const copy: Record<string, string> = {};

	for (const [key, chosen] of Object.entries(raw)) {
		if (key.length > 30)
			said.push("String must contain at most 30 character(s)");

		if (!Predicate.isString(chosen))
			said.push(
				chosen === undefined
					? "Required"
					: `Expected string, received ${receivedKind(chosen)}`,
			);
		else {
			if (chosen.length > 30)
				said.push("String must contain at most 30 character(s)");
			copy[key] = chosen;
		}
	}

	return said.length > 0 ? { say: said[said.length - 1] } : { value: copy };
});

const fields = {
	service: choice(["vocal-mix", "mastering", "bundle", "custom"]),
	title: stringField(
		kinds,
		tooLong(120),
		Schema.isMinLength(1, { message: "Add a song or project title." }),
		oneLine,
		noControl,
	),
	direction: choice(["judgment", "preferences", "specific"]),
	preferences,
	preserve: stringField(kinds, tooLong(1200), noControl),
	referenceUrl: optionalLink(),
	referenceNote: stringField(kinds, tooLong(2000), noControl),
	name: stringField(
		kinds,
		tooLong(100),
		Schema.isMinLength(1, { message: "Add your name." }),
		oneLine,
		noControl,
	),
	email: stringField(
		kinds,
		tooLong(120),
		Schema.isPattern(emailPattern, { message: "Add a valid email address." }),
	),
	permission: fieldOf<true>((raw) =>
		raw === true
			? { value: true }
			: { say: "Allow access to the files for this review." },
	),
	// The security token is kept as it arrived (not trimmed).
	turnstileToken: stringField(
		{ ...kinds, trim: false },
		Schema.isMinLength(1, { message: "Complete the security check." }),
		tooLong(2048),
	),
	fileLink: optionalLink(),
};

export type IntakeInput = Mutable<FieldValues<typeof fields>>;

/** The sentences the checks across fields give. */
type CrossFieldErrors = Partial<
	Record<"preferences" | "fileLink" | "referenceNote", string>
>;

export function isAudioIntakeAvailable(env: Env | undefined) {
	return Boolean(env?.MUSIC_DB && env.TURNSTILE_SECRET_KEY && env.RATE_LIMIT);
}

export function ownerRequestForIntake(input: IntakeInput): NewOwnerRequest {
	const offer = audioOffers[input.service];

	return {
		kind: "service",
		serviceId: input.service,
		name: input.name,
		email: input.email,
		summary: `${input.title} · ${offer.name}`,
		details: {
			title: input.title,
			fileLink: input.fileLink,
			direction: input.direction,
			preferences: input.preferences,
			preserve: input.preserve,
			referenceUrl: input.referenceUrl,
			referenceNote: input.referenceNote,
		},
	};
}

/**
 * Text pasted from a word processor carries vertical tabs and form feeds where it has line breaks. In the two free-text
 * answers, which allow line breaks, they become "\n" before the answers are read, so the stored text has them too. In a
 * one-line answer they are still refused as control characters. The length is counted as it arrived (each becomes one
 * character).
 */
function withLineBreaks(input: RawValue): RawValue {
	if (!Predicate.isObject(input) || Array.isArray(input)) return input;
	const copy: { [name: string]: RawValue } = { ...input };

	for (const name of ["preserve", "referenceNote"]) {
		const text = Object.hasOwn(copy, name) ? copy[name] : undefined;

		if (Predicate.isString(text))
			copy[name] = text.replace(/[\u000b\u000c]/g, "\n");
	}

	return copy;
}

export function validateIntake(
	rawInput: RawValue,
):
	| { ok: true; value: IntakeInput }
	| { ok: false; errors: Record<string, string> } {
	const input = withLineBreaks(rawInput);

	const read = readFields(fields, input, {
		winner: "last",
		defaults: {
			preferences: {},
			preserve: "",
			referenceUrl: "",
			referenceNote: "",
			fileLink: "",
		},
		notObject: {
			null: "Expected object, received null",
			string: "Expected object, received string",
			number: "Expected object, received number",
			nan: "Expected object, received nan",
			boolean: "Expected object, received boolean",
			array: "Expected object, received array",
			bigint: "Expected object, received bigint",
			symbol: "Expected object, received symbol",
			function: "Expected object, received function",
			promise: "Expected object, received promise",
			map: "Expected object, received map",
			set: "Expected object, received set",
			date: "Expected object, received date",
			undefined: "Required",
		},
		// Run only once every field has read, as the cross-field checks always did.
		after: (value) => {
			const errors: CrossFieldErrors = {};

			const allowed = directionFields(value.service);

			for (const [key, chosen] of Object.entries(value.preferences)) {
				const field = allowed.find((f) => f.id === key);

				if (
					!field ||
					(chosen !== "decide" &&
						!field.options.some((o) => o.value === chosen))
				)
					errors.preferences =
						"These preferences do not match your selected service.";
			}

			if (
				value.direction === "judgment" &&
				Object.values(value.preferences).some((v) => v !== "decide")
			)
				errors.preferences =
					"Choose a preference path to include specific settings.";

			if (value.service !== "custom" && !value.fileLink)
				errors.fileLink = "Provide your files before submitting for review.";

			if (value.direction === "specific" && !value.referenceNote)
				errors.referenceNote =
					"Describe the specific direction you have in mind.";

			if (value.service === "custom" && !value.referenceNote)
				errors.referenceNote =
					"Briefly describe your project and what you need.";

			return errors;
		},
	});

	return read.ok
		? { ok: true, value: read.value }
		: { ok: false, errors: plainErrors(read.errors) };
}
