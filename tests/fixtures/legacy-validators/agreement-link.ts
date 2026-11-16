// FROZEN REFERENCE COPY. This is the Zod 3 body schema of POST /api/agreements/link exactly as it ran before the Effect
// Schema conversion, kept only so tests/server/agreement-link-input.test.ts can require the Effect reader to accept and
// refuse every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts).
import { z } from "astro/zod";

export const legacyAgreementLinkSchema = z.object({
	email: z.string().max(320),
	turnstileToken: z.string().min(1).max(2048),
});
