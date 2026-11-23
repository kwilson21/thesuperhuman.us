// FROZEN REFERENCE COPY. This is the Zod 3 command schema of POST /api/owner/agreements (src/pages/api/owner/agreements.ts
// at 01a6a86d) exactly as it ran before the Effect Schema conversion of the signing area, kept only so
// tests/server/validators-differential.test.ts can require the Effect reader (src/server/agreement-input.ts) to accept and
// refuse every body as this one did, with the same value. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: `readContractor` only. The route's Zod transform already called that Effect Schema reader for the
// contractor's details (its own differential block holds it to the frozen Zod contractor schema), so this copy calls it as
// the route did. The version label's pattern (src/lib/agreement-version-label.ts) is frozen below.
import { z } from "astro/zod";
import { readContractor } from "../../../src/lib/agreement-fields";

const versionLabelPattern = /^[A-Za-z0-9.-]{1,40}$/;

export const legacyOwnerAgreementsSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("access-cleanup"), confirmed: z.literal(true) }),
	z.object({ action: z.literal("retention-preview") }),
	z.object({
		action: z.literal("retention-apply"),
		confirmed: z.literal(true),
		manifest: z.unknown(),
	}),
	z.object({
		action: z.literal("preview"),
		kind: z.enum(["msa", "sow"]),
		text: z.string().max(102400),
		expectedCurrentVersion: z.coerce.number().int().min(0),
		versionLabel: z.string().trim().max(40).optional(),
		sourceRevision: z.string().trim().max(120).optional(),
	}),
	z.object({
		action: z.literal("publish"),
		kind: z.enum(["msa", "sow"]),
		text: z.string().max(102400),
		expectedCurrentVersion: z.coerce.number().int().min(0),
		versionLabel: z.string().trim().regex(versionLabelPattern),
		sourceRevision: z.string().trim().max(120).optional(),
		confirmed: z.boolean().optional(),
	}),
	z.object({
		action: z.literal("template-version"),
		kind: z.enum(["msa", "sow"]),
		version: z.coerce.number().int().positive(),
	}),
	z.object({
		action: z.literal("setting"),
		enabled: z.boolean(),
		confirmed: z.literal(true),
	}),
	z.object({
		action: z.literal("config"),
		// The contractor's details are read with Effect Schema; a failure fails the whole body, as the Zod object did.
		values: z.unknown().transform((value, context) => {
			const read = readContractor(value);

			if (read.ok) return read.value;
			context.addIssue({
				code: "custom",
				message: "Invalid contractor details.",
			});

			return z.NEVER;
		}),
		expectedCurrentVersion: z.coerce.number().int().min(0),
	}),
]);
