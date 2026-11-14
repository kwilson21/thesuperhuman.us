// FROZEN REFERENCE COPY. This is the Zod 3 schema of POST /api/software/brief/suggest exactly as it ran before the Effect
// Schema conversion (branch claude/effect-11-intake), kept only so tests/server/brief-input-differential.test.ts can require
// the Effect reader to answer every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
import { z } from "astro/zod";

export const legacySuggestSchema = z
	.object({
		// Pages opened before the questions took curly apostrophes still send the straight ones, so both are accepted.
		question: z
			.string()
			.max(100)
			.transform((value) => value.replaceAll("'", "’"))
			.pipe(
				z.enum([
					"What happens today?",
					"What’s the idea?",
					"Have a first result in mind?",
					"Have a first version in mind?",
					"What’s the website for?",
					"What should the app let people do?",
				]),
			),
		text: z.string().max(2000),
		earlier: z
			.object({
				path: z.enum(["workflow", "idea", "website", "webapp"]),
				today: z.string().max(2000).optional(),
				idea: z.string().max(1000).optional(),
				purpose: z.string().max(2000).optional(),
				appGoal: z.string().max(1000).optional(),
			})
			.strict(),
	})
	.strict();

/** The answer the old route acted on: the parsed value, or a refusal (the route then answers empty). */
export function legacyReadSuggest(
	body: unknown,
): { ok: true; value: unknown } | { ok: false } {
	const parsed = legacySuggestSchema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
