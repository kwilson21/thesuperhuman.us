// FROZEN REFERENCE COPY. What the owner's project access, invitation and updates routes read before the Effect Schema
// conversion of the audio projects area, with Zod 4 (`zod`), which the routes imported: the body of POST
// /api/owner/projects/[id]/access, of .../invitation and of .../updates. It is kept only so
// tests/server/audio-project-input-differential.test.ts can require the Effect readers (src/server/audio-project-input.ts) to
// accept and refuse every input as these do. It is not product code: nothing under src/ or scripts/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory. It imports
// nothing from src/ but the type `RawValue`; the date check is written out so the copy stays what it was.
import { z } from "zod";
import type { RawValue } from "../../../src/lib/fields";

function legacyValidProjectDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00Z`);

	return (
		!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
	);
}

const accessSchema = z.object({ action: z.literal("revoke") });

const invitationSchema = z.object({
	action: z.literal("send"),
	confirmedNotSent: z.boolean().optional(),
});

const note = z.string().trim().min(1).max(1000);
const date = z.string().refine(legacyValidProjectDate);

const updateSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("accept"), dueDate: date, body: note }),
	z.object({ action: z.literal("progress"), body: note }),
	z.object({ action: z.literal("start_work"), body: note }),
	z.object({ action: z.literal("begin_revision"), body: note }),
	z.object({ action: z.literal("complete"), body: note }),
	z.object({
		action: z.literal("revise_date"),
		dueDate: date,
		reason: z.enum([
			"protect_song",
			"client_clarification",
			"schedule_conflict",
		]),
		body: note,
	}),
	z.object({
		action: z.literal("retry_email"),
		updateId: z.number().int().positive(),
		confirmedNotSent: z.boolean().optional(),
	}),
]);

type Read = { ok: true; value: RawValue } | { ok: false };

const read = (
	schema: {
		safeParse: (
			body: RawValue,
		) => { success: true; data: RawValue } | { success: false };
	},
	body: RawValue,
): Read => {
	const parsed = schema.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
};

/** What the access route made of a body. */
export const legacyReadAccessCommand = (body: RawValue) =>
	read(accessSchema, body);

/** What the invitation route made of a body. */
export const legacyReadInvitationCommand = (body: RawValue) =>
	read(invitationSchema, body);

/** What the updates route made of a body. */
export const legacyReadUpdateCommand = (body: RawValue) =>
	read(updateSchema, body);
