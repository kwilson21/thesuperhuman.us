// FROZEN REFERENCE COPY. These are the Zod 4 schemas of the studio sign-in area exactly as they ran before its Effect
// Schema conversion: the bodies of POST /api/studio/code and /api/studio/session, and the address normalizer of
// src/lib/client-portal.ts, kept only so tests/server/validators-differential.test.ts can require the Effect versions
// to answer every input as these did. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory. The routes
// and the normalizer imported Zod 4 (`zod`), not the Zod 3 of `astro/zod`, so this copy does too.
import { z } from "zod";

/** The body of POST /api/studio/code (src/pages/api/studio/code.ts at f9480f78). */
export const legacyCodeRequestSchema = z.object({
	email: z.string().max(320),
	turnstileToken: z.string().min(1).max(2048),
});

/** The body of POST /api/studio/session (src/pages/api/studio/session.ts at f9480f78). */
export const legacySessionRequestSchema = z.object({
	email: z.string().max(320),
	code: z.string().regex(/^\d{8}$/),
});

const legacyEmailSchema = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email().max(320));

/** `normalizeClientEmail` of src/lib/client-portal.ts at f9480f78. */
export function legacyNormalizeClientEmail(input: string): string | null {
	const parsed = legacyEmailSchema.safeParse(input);

	return parsed.success ? parsed.data : null;
}
