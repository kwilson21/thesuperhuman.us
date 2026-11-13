// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion (PR 7 of the
// Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect version to answer
// every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";
import {
	currentSiteHref,
	currentUrlMessage,
	softwareDetailKeys,
	softwareQuestions,
} from "../../../src/lib/software-inquiry";
import { isObject, isText } from "../../../src/lib/type-guards";

function hasKey<T extends object>(
	record: T,
	key: string,
): key is Extract<keyof T, string> {
	return Object.hasOwn(record, key);
}

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

export type LegacySoftwareInput = z.infer<typeof schema>;

export function legacyValidateSoftwareInquiry(
	input: RawValue,
):
	| { ok: true; value: LegacySoftwareInput }
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
