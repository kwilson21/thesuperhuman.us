import { z } from "astro/zod";
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

const single = (max: number) =>
	z.string().trim().max(max, `Keep this under ${max} characters.`);

const required = (max: number) =>
	single(max).min(1, "This answer is required.");

const common = {
	name: single(100).min(1, "Add your name."),
	email: single(120).email("Add a valid email address."),
	company: single(120).default(""),
	timing: z.enum(["flexible", "month", "quarter", "date", "asap"], {
		errorMap: () => ({ message: "Choose one." }),
	}),
	timingDate: z
		.string()
		.regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Add a date.")
		.default(""),
	timingReason: single(500).default(""),
	budgetStatus: z
		.enum(["", "approved", "pending", "exploring", "unsure"], {
			errorMap: () => ({ message: "Choose one." }),
		})
		.default(""),
	budgetNote: single(200).default(""),
	approver: z
		.enum(["", "self", "other", "unsure"], {
			errorMap: () => ({ message: "Choose one." }),
		})
		.default(""),
	approverRole: single(120).default(""),
	turnstileToken: z
		.string()
		.min(1, "Complete the security check.")
		.max(2048, "Keep this under 2048 characters."),
	submissionId: z.string().uuid("Invalid submission ID."),
};

const schema = z.discriminatedUnion("path", [
	z.object({
		...common,
		path: z.literal("workflow"),
		today: required(2000),
		audience: single(1000).default(""),
		firstResult: single(2000).default(""),
	}),
	z.object({
		...common,
		path: z.literal("idea"),
		idea: required(1000),
		audienceToday: single(1000).default(""),
		firstVersion: single(1000).default(""),
		signal: single(500).default(""),
	}),
	// Over-long values skip the link checks: max already reports them, and URL parsing of a long international host is slow.
	z.object({
		...common,
		path: z.literal("website"),
		purpose: required(2000),
		currentUrl: single(currentUrlMax)
			.default("")
			.refine(
				(value) =>
					value.length > currentUrlMax ||
					value === "" ||
					currentSiteHref(value) !== null,
				(value) => ({ message: currentUrlMessage(value) }),
			),
		existing: single(2000).default(""),
		updates: z.enum(["self", "help", "unsure"], { message: "Choose one." }),
	}),
	z.object({
		...common,
		path: z.literal("webapp"),
		appGoal: required(1000),
		firstVersion: single(1000).default(""),
	}),
]);

export type SoftwareInput = z.infer<typeof schema>;

export function validateSoftwareInquiry(
	input: unknown,
):
	| { ok: true; value: SoftwareInput }
	| { ok: false; errors: Record<string, string> } {
	const lineErrors: Record<string, string> = {};

	if (isObject(input)) {
		const raw = new Map<string, unknown>(Object.entries(input));
		const timingDate = raw.get("timingDate");

		if (
			raw.has("timingDate") &&
			raw.get("timing") === "date" &&
			(!isText(timingDate) ||
				!/^\d{4}-\d{2}-\d{2}$/.test(timingDate) ||
				!Number.isFinite(Date.parse(timingDate)) ||
				new Date(timingDate).toISOString().slice(0, 10) !== timingDate)
		)
			lineErrors.timingDate = "Add a valid date.";

		for (const key of [
			"name",
			"email",
			"company",
			"timingReason",
			"budgetNote",
			"approverRole",
		]) {
			const value = raw.get(key);

			if (isText(value) && /[\r\n]/.test(value))
				lineErrors[key] = "Use one line.";
		}

		const currentUrl = raw.get("currentUrl");

		if (
			raw.get("path") === "website" &&
			isText(currentUrl) &&
			/[\r\n]/.test(currentUrl)
		)
			lineErrors.currentUrl = "Use one line.";

		const path = raw.get("path");

		const questions =
			isText(path) && hasKey(softwareQuestions, path)
				? softwareQuestions[path]
				: [];

		for (const key of [...questions, ...softwareDetailKeys]) {
			const value = raw.get(key);

			if (isText(value) && /[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value))
				lineErrors[key] = "Remove control characters.";
		}
	}

	const parsed = schema.safeParse(input, {
		errorMap: (issue, context) => ({
			message:
				issue.code === "invalid_type" &&
				!["path", "timing", "budgetStatus", "approver", "updates"].includes(
					String(issue.path[0]),
				)
					? issue.path.length
						? "This answer is required."
						: "Please send the form again."
					: context.defaultError,
		}),
	});

	if (!parsed.success || Object.keys(lineErrors).length) {
		const errors: Record<string, string> = {};

		if (!parsed.success)
			for (const issue of parsed.error.issues)
				errors[String(issue.path[0] ?? "_form")] ??=
					issue.path[0] === "path" ? "Choose a starting point." : issue.message;

		return { ok: false, errors: { ...errors, ...lineErrors } };
	}

	const value = parsed.data;

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
