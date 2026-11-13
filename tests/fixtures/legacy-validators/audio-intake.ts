// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion (PR 7 of the
// Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect version to answer
// every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: `directionFields` (which preferences each service allows, constant data) and the type
// `RawValue`. A later edit to either moves both sides of the differential together.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";
import { directionFields } from "../../../src/lib/audio-intake";

// Added with the Effect version (security fixes, 2026-11): a control character is refused, as in the software inquiry. Both
// sides of the differential move together; the line break and the tab stay allowed in the two free-text answers.
const noControl = (value: string) =>
	!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(value);

const noControlMessage = "Remove control characters.";

const short = (max: number) => z.string().trim().max(max);

const optionalLink = short(2048)
	.refine((value) => {
		if (!value) return true;

		try {
			const url = new URL(value);

			return url.protocol === "https:" && !url.username && !url.password;
		} catch {
			return false;
		}
	}, "Use a complete HTTPS link, or leave this blank.")
	.refine(noControl, noControlMessage);

const schema = z.object({
	service: z.enum(["vocal-mix", "mastering", "bundle", "custom"]),
	title: short(120)
		.min(1, "Add a song or project title.")
		.refine((v) => !/[\r\n]/.test(v))
		.refine(noControl, noControlMessage),
	direction: z.enum(["judgment", "preferences", "specific"]),
	preferences: z.record(z.string().max(30), z.string().max(30)).default({}),
	preserve: short(1200).refine(noControl, noControlMessage).default(""),
	referenceUrl: optionalLink.default(""),
	referenceNote: short(2000).refine(noControl, noControlMessage).default(""),
	name: short(100)
		.min(1, "Add your name.")
		.refine((v) => !/[\r\n]/.test(v))
		.refine(noControl, noControlMessage),
	email: short(120).email("Add a valid email address."),
	permission: z.literal(true, {
		errorMap: () => ({ message: "Allow access to the files for this review." }),
	}),
	turnstileToken: z.string().min(1, "Complete the security check.").max(2048),
	fileLink: optionalLink.default(""),
});

export type LegacyIntakeInput = z.infer<typeof schema>;

// Added with the Effect version, as for the control-character refusal: a vertical tab or form feed in the two free-text
// answers is read as a line break. The same preprocessing runs on both sides of the differential, so the comparison is
// still of the two schemas.
function withLineBreaks(input: RawValue): RawValue {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return input;
	const copy: { [name: string]: RawValue } = { ...input };

	for (const name of ["preserve", "referenceNote"]) {
		const text = Object.hasOwn(copy, name) ? copy[name] : undefined;

		if (typeof text === "string")
			copy[name] = text.replace(/[\u000b\u000c]/g, "\n");
	}

	return copy;
}

export function legacyValidateIntake(
	rawInput: RawValue,
):
	| { ok: true; value: LegacyIntakeInput }
	| { ok: false; errors: Record<string, string> } {
	const result = schema.safeParse(withLineBreaks(rawInput));

	if (!result.success)
		return {
			ok: false,
			errors: Object.fromEntries(
				result.error.issues.map((i) => [
					String(i.path[0] ?? "_form"),
					i.message,
				]),
			),
		};

	const value = result.data,
		fields = directionFields(value.service);

	const errors: Record<string, string> = {};

	for (const [key, choice] of Object.entries(value.preferences)) {
		const field = fields.find((f) => f.id === key);

		if (
			!field ||
			(choice !== "decide" && !field.options.some((o) => o.value === choice))
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
		errors.referenceNote = "Describe the specific direction you have in mind.";

	if (value.service === "custom" && !value.referenceNote)
		errors.referenceNote = "Briefly describe your project and what you need.";

	return Object.keys(errors).length
		? { ok: false, errors }
		: { ok: true, value };
}
