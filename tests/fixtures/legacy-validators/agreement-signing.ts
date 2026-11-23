// FROZEN REFERENCE COPY. These are the Zod 3 body schemas of the signing routes exactly as they ran before the Effect
// Schema conversion of the signing area (POST /api/offer/[token]/link, /review and /sign, at 01a6a86d), kept only so
// tests/server/validators-differential.test.ts can require the Effect readers (src/server/agreement-input.ts) to accept
// and refuse every body as these did, with the same value. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
import { z } from "astro/zod";

/** The body of POST /api/offer/[token]/link (src/pages/api/offer/[token]/link.ts). */
export const legacySigningLinkSchema = z.object({
	turnstileToken: z.string().min(1).max(2048),
});

/** The body of POST /api/offer/[token]/review (src/pages/api/offer/[token]/review.ts). */
export const legacySigningReviewSchema = z.object({
	csrf_nonce: z.string().min(1),
	values: z.unknown(),
});

/** The body of POST /api/offer/[token]/sign (src/pages/api/offer/[token]/sign.ts). */
export const legacySigningSignSchema = z.object({
	csrf_nonce: z.string().min(1),
	documents: z
		.array(
			z.object({
				id: z.string().uuid(),
				hash: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.min(1)
		.max(2),
	consent: z.literal(true),
});
