// FROZEN REFERENCE COPY. The commands of the two audio project message routes (POST /api/owner/projects/[id]/messages and
// POST /api/studio/projects/[id]/messages) as they ran before the Effect Schema conversion of the audio projects area, with
// Zod 4 (`zod`), which the routes imported. It is kept only so tests/server/audio-project-input-differential.test.ts can require the
// Effect readers (src/server/audio-project-input.ts) to accept and refuse every input as these do. It is not product code:
// nothing under src/ or scripts/ may import it (tests/architecture/legacy-validators.test.ts), and the Effect stack's
// final layer deletes this directory. Live imports from src: the type `RawValue` only.
import { z } from "zod";
import type { RawValue } from "../../../src/lib/fields";

const ownerMessageSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("send"), body: z.unknown() }),
	z.object({
		action: z.literal("read"),
		messageId: z.number().int().positive(),
	}),
]);

const studioMessageSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("send"), body: z.unknown() }),
	z.object({
		action: z.literal("read"),
		messageId: z.number().int().positive(),
	}),
	z.object({
		action: z.literal("respond"),
		reviewId: z.string().min(1).max(100),
		decision: z.enum(["approved", "changes", "stopped"]),
		body: z.unknown(),
	}),
]);

type Read = { ok: true; value: RawValue } | { ok: false };

/** What the owner's route made of a body: the parsed command, or a refusal (its 400 says one sentence whatever was wrong). */
export function legacyReadOwnerMessage(body: RawValue): Read {
	const parsed = ownerMessageSchema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** What the studio route made of a body. */
export function legacyReadStudioMessage(body: RawValue): Read {
	const parsed = studioMessageSchema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
