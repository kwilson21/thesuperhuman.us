// FROZEN REFERENCE COPY. This is the Zod 3 schema of POST /api/software/brief/pass exactly as it ran before the Effect
// Schema conversion (branch claude/effect-11-intake), kept only so tests/server/brief-input-differential.test.ts can require
// the Effect reader to answer every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
import { z } from "astro/zod";

export const legacyPassSchema = z
	.object({ token: z.string().min(1).max(2048) })
	.strict();

/** The answer the old route acted on: the parsed value, or a refusal (the route then answers `{ ok: false }`). */
export function legacyReadPass(
	body: unknown,
): { ok: true; value: unknown } | { ok: false } {
	const parsed = legacyPassSchema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
