// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion of the public
// music area (PR 10 of the Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect
// version (src/server/music-input.ts) to answer every input as this one does. It is not product code: nothing under src/
// may import it (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: the type `RawValue` and the id pattern (constant data) from src/lib/music-catalog.ts.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";
import { musicId } from "../../../src/lib/music-catalog";

export const legacyInterestSchema = z
	.object({
		releaseId: musicId,
		email: z.string().trim().toLowerCase().email().max(120),
		interest: z.enum(["song", "merchandise", "both"]),
		merchandise: z
			.array(z.enum(["shirts", "hoodies", "stickers", "digital-art"]))
			.max(4)
			.default([]),
		suggestion: z.string().trim().max(500).default(""),
		cityRegion: z.string().trim().max(120).default(""),
		consent: z.literal(true, {
			errorMap: () => ({
				message:
					"Check the box to confirm I may email you about your selection.",
			}),
		}),
		turnstileToken: z
			.string()
			.min(1, "Complete the verification and try again.")
			.max(2048),
	})
	.refine(
		(v) => v.interest !== "song" || (!v.merchandise.length && !v.suggestion),
		{
			path: ["merchandise"],
			message:
				"Choose merchandise interest to include merchandise suggestions.",
		},
	);

export const legacyEventSchema = z.object({
	releaseId: musicId,
	recordingId: musicId,
	sessionId: z.string().uuid(),
	playthroughId: z.string().uuid(),
	eventId: z.string().uuid(),
	sequence: z.number().int().min(1).max(10_000),
	medium: z.enum(["audio", "video"]),
	event: z.enum(["start", "progress", "listen30", "complete", "replay"]),
	accumulatedSeconds: z.number().int().min(0).max(86_400),
	mediaDurationSeconds: z.number().int().min(0).max(86_400),
	campaignId: musicId.optional(),
	channel: musicId.optional(),
	creative: musicId.optional(),
});

/** What the route made of an interest body: the parsed value, or the 400's `errors` exactly as the route built them. */
export function legacyReadInterest(
	body: RawValue,
):
	| { ok: true; value: RawValue }
	| { ok: false; errors: Record<string, string> } {
	const parsed = legacyInterestSchema.safeParse(body);

	return parsed.success
		? { ok: true, value: parsed.data }
		: {
				ok: false,
				errors: Object.fromEntries(
					parsed.error.issues.map((i) => [i.path[0] ?? "_form", i.message]),
				),
			};
}

/** What the route made of an event body: the parsed value, or a refusal (the 400 says nothing more). */
export function legacyReadEvent(
	body: RawValue,
):
	| { ok: true; value: RawValue }
	| { ok: false; errors: Record<string, string> } {
	const parsed = legacyEventSchema.safeParse(body);

	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, errors: {} };
}
