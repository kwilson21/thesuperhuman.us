// The Zod copy of the three small agreement text helpers (`cleanText`, `required`, `email`), for the server-only schemas
// that still compose them: the owner agreement routes (`src/pages/api/owner/requests/[id]/agreement.ts` and
// `agreement-attachments.ts`) and `agreementDetailsSchema` and `contractorSchema` in `src/lib/agreement-fields.ts`. Those
// areas are not converted to Effect Schema yet (an area is converted completely, or not started), so they keep Zod until
// their layers. The browser-shared versions of the same helpers are Effect fields in `src/lib/agreement-client-fields.ts`;
// `tests/server/validators-differential.test.ts` holds the two copies to the same answers on a shared table, so they
// cannot drift. Server-only: never import this from a module a browser entry reaches (`astro/zod` must stay out of every
// browser bundle). Delete this file when the last server-only schema that uses it is converted.
import { z } from "astro/zod";

export const cleanText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v.normalize("NFC"))
		.refine(
			(v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(v),
			"Remove control characters.",
		);

export const required = (max: number) =>
	cleanText(max).refine(Boolean, "This answer is required.");

export const email = z
	.string()
	.trim()
	.email()
	.max(320)
	.transform((v) => v.toLowerCase());
