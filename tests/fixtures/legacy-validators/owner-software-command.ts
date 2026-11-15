// FROZEN REFERENCE COPY. This is the Zod 3 command schema of POST /api/owner/requests/[id]/software exactly as it ran
// before the Effect Schema conversion of the software offers area, kept only so tests/server/validators-differential.test.ts
// can require the Effect reader (src/server/software-offer-input.ts) to accept and refuse every input as this one does,
// with the same value. It is not product code: nothing under src/ may import it (tests/architecture/legacy-validators.test.ts),
// and the Effect stack's final layer deletes this directory. Live imports from src: the type `RawValue` only.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";

export const legacySoftwareCommandSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("fit"),
		label: z.enum(["potential-fit", "needs-clarification", "stated-mismatch"]),
		note: z.string().trim().max(500),
		expectedRequestUpdatedAt: z.string().optional(),
	}),
	z.object({
		action: z.literal("draft"),
		terms: z.unknown(),
		agreementDetails: z.unknown().optional(),
		reusedMsaId: z.string().uuid().nullable().optional(),
		confirmMsaReuse: z.boolean().optional(),
		removedAttachmentKeys: z
			.array(z.string().regex(/^agreements\/attachments\/[a-f0-9-]+\.pdf$/))
			.max(100)
			.default([]),
		expectedUpdatedAt: z.string().nullable(),
	}),
	z.object({
		action: z.literal("send"),
		version: z.number().int().positive(),
		expectedUpdatedAt: z.string(),
	}),
	z.object({
		action: z.literal("revoke"),
		expectedLinkCreatedAt: z.string().min(1),
	}),
	z.object({
		action: z.enum(["question", "decline"]),
		text: z.string().trim().min(1).max(2000),
	}),
]);

/** What the route made of a body: the parsed command, or a refusal (the 400 says only "Check the required fields and their limits."). */
export function legacyReadSoftwareCommand(
	body: RawValue,
): { ok: true; value: RawValue } | { ok: false } {
	const parsed = legacySoftwareCommandSchema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
