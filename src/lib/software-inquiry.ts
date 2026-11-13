import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	type Body,
	choiceField,
	emailPattern,
	type Mutable,
	plainErrors,
	type RawValue,
	readVariants,
	refuseEveryKind,
	stringField,
	uuidPattern,
	type VariantValues,
} from "./fields";
import type { NewOwnerRequest } from "./owner-requests";
import type { OwnerRequest } from "./owner-model";
import { isText, isObject } from "./type-guards";

export const softwarePaths = {
	website: "Website design",
	webapp: "Web app",
	workflow: "Workflow automation",
} as const;

// Earlier briefs keep the name they were sent with. The page no longer offers it, but the server still accepts it from pages opened before the change.
export const legacySoftwarePaths = { idea: "Bring an idea to life" } as const;

export const softwarePathDescriptions = {
	website: "A site people can read on a phone and act on.",
	webapp: "An app people open in a browser, on a phone or a computer.",
	workflow: "A tool that takes manual steps out of a task your team repeats.",
} as const;

export const softwareBriefKickers = {
	website: "Website brief",
	webapp: "Web app brief",
	workflow: "Workflow brief",
} as const;

export type SoftwarePath = keyof typeof softwarePaths;

export type StoredSoftwarePath =
	| SoftwarePath
	| keyof typeof legacySoftwarePaths;

function hasKey<T extends object>(
	record: T,
	key: string,
): key is Extract<keyof T, string> {
	return Object.hasOwn(record, key);
}

function labelOf<T extends Record<string, string>>(
	labels: T,
	value: string | undefined,
): string | undefined {
	return value !== undefined && hasKey(labels, value)
		? labels[value]
		: undefined;
}

/** Older runtimes lack Intl.Segmenter although its type says it always exists, so the parameter admits undefined and the check is that it is a function. */
function isSegmenter(
	value: typeof Intl.Segmenter | undefined,
): value is typeof Intl.Segmenter {
	return typeof value === "function";
}

export function softwarePathLabel(
	path: string | null | undefined,
): string | undefined {
	if (!isText(path)) return undefined;

	if (hasKey(softwarePaths, path)) return softwarePaths[path];

	return hasKey(legacySoftwarePaths, path)
		? legacySoftwarePaths[path]
		: undefined;
}

export const softwareLabels = {
	path: "Project",
	today: "What happens today?",
	audience: "Who needs this to work better?",
	firstResult: "What would a useful first result look like?",
	name: "Your name",
	email: "Email",
	idea: "What’s the idea?",
	audienceToday: "Who is it for, and what do they do today instead?",
	firstVersion: "What’s the one thing the first version must let them do?",
	signal: "How will you know it’s worth building further? (optional)",
	company: "Company, if you have one",
	timingDate: "Needed by",
	timing: "Timing",
	timingReason: "Why this timing? (optional)",
	budgetStatus: "Budget status",
	budgetNote: "Budget amount, if you’d like to share it (optional)",
	approver: "Who will approve the project?",
	approverRole: "Their role (optional)",
	purpose: "What’s the website for?",
	currentUrl: "Current website",
	existing: "What they already have",
	updates: "Who will keep it up to date?",
	appGoal: "What should the app let people do?",
} as const;

// The client reads their own answers, so "they" becomes "you".
export const clientSoftwareLabels: Record<string, string> = {
	...softwareLabels,
	existing: "What you already have",
};

export const softwareQuestions = {
	website: ["purpose", "currentUrl", "existing", "updates"],
	webapp: ["appGoal", "firstVersion"],
	workflow: ["today", "audience", "firstResult"],
	idea: ["idea", "audienceToday", "firstVersion", "signal"],
} as const;

export const softwareDetailKeys = [
	"name",
	"email",
	"company",
	"timing",
	"timingDate",
	"timingReason",
	"budgetStatus",
	"budgetNote",
	"approver",
	"approverRole",
] as const;

export const timingLabels = {
	flexible: "Flexible",
	month: "Within a month",
	quarter: "In one to three months",
	date: "By a date",
	asap: "As soon as possible",
} as const;

export const budgetLabels = {
	approved: "Approved",
	pending: "Waiting for approval",
	exploring: "Still exploring",
	unsure: "Not sure yet",
} as const;

export const approverLabels = {
	self: "I do",
	other: "Someone else, and I can involve them",
	unsure: "Not sure yet",
} as const;

export const updateLabels = {
	self: "Me or someone on my team",
	help: "I’d like help with updates",
	unsure: "Not sure yet",
} as const;

export function currentSiteHref(value: unknown): string | null {
	if (!isText(value) || !/^https?:\/\//i.test(value) || /\s/.test(value))
		return null;

	try {
		const url = new URL(value);

		return (url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname &&
			!url.username &&
			!url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}

// bareHost: dots split the host labels, so it runs in linear time; '@' is excluded, so an email address is not a host.
const bareHost =
	/^(\/\/)?([^\s\/:?#.@]+(\.[^\s\/:?#.@]+)+\.?|localhost)(:\d+)?([\/?#]\S*)?$/i;

// Four cases, in order. A link that starts with http:// or https:// but isn't accepted as a link
// (it doesn't parse, or has a space, username or password) is told to check the link or leave it
// empty.
// A mistyped or other scheme (https//x.com, https:/x.com, ftp://x) is told to start with
// https:// or http://, unless a digit (a port, x.com:8080) or a space (a label, Website: x.com)
// follows the colon after a scheme other than http or https.
// A bare host, host:port or localhost is told to add https:// when that makes a valid link.
// Anything else (none, n/a, an email address) is told to check the link or leave it empty.
// Callers pass at most 2048 characters (the schema skips longer values); the bare host check
// parses the URL, which is slow on very long international hosts.
export const currentUrlMessage = (value: string) =>
	/^https?:\/\//i.test(value)
		? "Check the link, or leave it empty."
		: /^https?:/i.test(value) ||
				/^https?\/\//i.test(value) ||
				/^[a-z][a-z\d+.-]*:(?![\d\s])/i.test(value)
			? "Use https:// or http:// at the start of the link."
			: bareHost.test(value) && currentSiteHref("https://" + value) !== null
				? "Add https:// to the start of the link."
				: "Check the link, or leave it empty.";

const currentUrlMax = 2048;

// The inquiry's validator, written to answer exactly as the Zod 3 schema it replaced did (tests/server/validators-differential.test.ts
// holds it to that on thousands of inputs): the same sentences, the first sentence of a field wins, one set of fields
// per `path`, and the error keys follow the order of the fields.
const required = {
	missing: "This answer is required.",
	wrongType: () => "This answer is required.",
};

const tooLong = (max: number) =>
	Schema.isMaxLength(max, { message: `Keep this under ${max} characters.` });

const single = (max: number) => stringField(required, tooLong(max));

const needed = (max: number) =>
	stringField(
		required,
		tooLong(max),
		Schema.isMinLength(1, { message: "This answer is required." }),
	);

const chooseOne = <const V extends readonly [string, ...string[]]>(values: V) =>
	choiceField(values, {
		missing: "Choose one.",
		wrongType: () => "Choose one.",
		notOneOf: () => "Choose one.",
	});

const common = {
	name: stringField(
		required,
		tooLong(100),
		Schema.isMinLength(1, { message: "Add your name." }),
	),
	email: stringField(
		required,
		tooLong(120),
		Schema.isPattern(emailPattern, { message: "Add a valid email address." }),
	),
	company: single(120),
	timing: chooseOne(["flexible", "month", "quarter", "date", "asap"]),
	timingDate: stringField(
		{ ...required, trim: false },
		Schema.isPattern(/^$|^\d{4}-\d{2}-\d{2}$/, { message: "Add a date." }),
	),
	timingReason: single(500),
	budgetStatus: chooseOne(["", "approved", "pending", "exploring", "unsure"]),
	budgetNote: single(200),
	approver: chooseOne(["", "self", "other", "unsure"]),
	approverRole: single(120),
	turnstileToken: stringField(
		{ ...required, trim: false },
		Schema.isMinLength(1, { message: "Complete the security check." }),
		tooLong(2048),
	),
	submissionId: stringField(
		{ ...required, trim: false },
		Schema.isPattern(uuidPattern, { message: "Invalid submission ID." }),
	),
};

const variants = {
	workflow: {
		...common,
		today: needed(2000),
		audience: single(1000),
		firstResult: single(2000),
	},
	idea: {
		...common,
		idea: needed(1000),
		audienceToday: single(1000),
		firstVersion: single(1000),
		signal: single(500),
	},
	website: {
		...common,
		purpose: needed(2000),
		// Over-long values skip the link checks: max already reports them, and URL parsing of a long international host is slow.
		currentUrl: stringField(
			required,
			tooLong(currentUrlMax),
			Schema.makeFilter((value: string) =>
				value.length > currentUrlMax ||
				value === "" ||
				currentSiteHref(value) !== null
					? true
					: currentUrlMessage(value),
			),
		),
		existing: single(2000),
		updates: chooseOne(["self", "help", "unsure"]),
	},
	webapp: {
		...common,
		appGoal: needed(1000),
		firstVersion: single(1000),
	},
};

// The optional answers an absent field gives as empty.
const optional = {
	company: "",
	timingDate: "",
	timingReason: "",
	budgetStatus: "",
	budgetNote: "",
	approver: "",
	approverRole: "",
} as const;

const defaults = {
	workflow: { ...optional, audience: "", firstResult: "" },
	idea: { ...optional, audienceToday: "", firstVersion: "", signal: "" },
	website: { ...optional, currentUrl: "", existing: "" },
	webapp: { ...optional, firstVersion: "" },
};

export type SoftwareInput = Mutable<VariantValues<"path", typeof variants>>;

/** The body's own value for a key: what a Map built from its entries read. */
const own = (input: Body, key: string) =>
	Object.hasOwn(input, key) ? input[key] : undefined;

/**
 * The checks made on the raw body, before and besides the fields: a date that is not a date, a line break where one line
 * is asked for, a control character in an answer. A later entry for a key replaces an earlier one and keeps its place.
 */
function lineErrors(input: Body): Record<string, string> {
	const entries: [string, string][] = [];
	const timingDate = own(input, "timingDate");

	if (
		Object.hasOwn(input, "timingDate") &&
		own(input, "timing") === "date" &&
		(!isText(timingDate) ||
			!/^\d{4}-\d{2}-\d{2}$/.test(timingDate) ||
			!Number.isFinite(Date.parse(timingDate)) ||
			new Date(timingDate).toISOString().slice(0, 10) !== timingDate)
	)
		entries.push(["timingDate", "Add a valid date."]);

	for (const key of [
		"name",
		"email",
		"company",
		"timingReason",
		"budgetNote",
		"approverRole",
	]) {
		const value = own(input, key);

		if (isText(value) && /[\r\n]/.test(value))
			entries.push([key, "Use one line."]);
	}

	const currentUrl = own(input, "currentUrl");

	if (
		own(input, "path") === "website" &&
		isText(currentUrl) &&
		/[\r\n]/.test(currentUrl)
	)
		entries.push(["currentUrl", "Use one line."]);

	const path = own(input, "path");

	const questions =
		isText(path) && hasKey(softwareQuestions, path)
			? softwareQuestions[path]
			: [];

	for (const key of [...questions, ...softwareDetailKeys]) {
		const value = own(input, key);

		if (isText(value) && /[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value))
			entries.push([key, "Remove control characters."]);
	}

	return Object.fromEntries(entries);
}

export function validateSoftwareInquiry(
	input: RawValue,
):
	| { ok: true; value: SoftwareInput }
	| { ok: false; errors: Record<string, string> } {
	const read = readVariants("path", variants, input, {
		unknownVariant: "Choose a starting point.",
		notObject: refuseEveryKind("Please send the form again."),
		defaults,
		alongside: lineErrors,
	});

	if (!read.ok) return { ok: false, errors: plainErrors(read.errors) };

	const value: SoftwareInput = read.value;

	if (value.approver !== "other") value.approverRole = "";

	return { ok: true, value };
}

export function softwareRequest(input: SoftwareInput): NewOwnerRequest {
	const fields = new Map<string, unknown>(Object.entries(input));

	const firstLine = String(fields.get(softwareQuestions[input.path][0]))
		.trim()
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?])\s/, 1)[0];

	const summaryCharacters = isSegmenter(Intl.Segmenter)
		? [
				...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
					firstLine,
				),
			].map((part) => part.segment)
		: Array.from(firstLine);

	return {
		kind: "software",
		serviceId: input.path,
		submissionId: input.submissionId,
		name: input.name,
		email: input.email,
		summary: summaryCharacters.slice(0, 80).join("").trimEnd(),
		details: Object.fromEntries(
			[
				"path",
				...softwareQuestions[input.path],
				...softwareDetailKeys.filter(
					(key) => key !== "name" && key !== "email",
				),
			].map((key) => [key, fields.get(key)]),
		),
	};
}

export function softwareBrief(request: OwnerRequest): Record<string, string> {
	const details = request.details;

	const path: StoredSoftwarePath =
		isText(details.path) && hasKey(softwareQuestions, details.path)
			? details.path
			: "workflow";

	return Object.fromEntries(
		["path", ...softwareQuestions[path], ...softwareDetailKeys].flatMap(
			(key): [string, string][] => {
				if (key === "approverRole" && details.approver !== "other") return [];

				const value =
					key === "name"
						? request.name
						: key === "email"
							? request.email
							: details[key];

				const text = isText(value) ? value : undefined;

				// The label tables were once indexed with the raw value, which coerces it to a key.
				const labelKey = value == null ? undefined : String(value);

				const display =
					key === "path"
						? softwarePathLabel(text)
						: key === "timing"
							? labelOf(timingLabels, labelKey)
							: key === "budgetStatus"
								? labelOf(budgetLabels, labelKey)
								: key === "approver"
									? labelOf(approverLabels, labelKey)
									: key === "updates"
										? labelOf(updateLabels, labelKey)
										: value;

				const shown = isText(display) ? display : "";

				return shown ? [[key, shown]] : [];
			},
		),
	);
}
