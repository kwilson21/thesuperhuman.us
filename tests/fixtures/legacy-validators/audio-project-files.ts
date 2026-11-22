// FROZEN REFERENCE COPY. What the audio project file routes read before the Effect Schema conversion of the audio projects
// area, with Zod 4 (`zod`), which the routes imported: the four commands of POST /api/owner/projects/[id]/uploads, the query
// and body check of its PUT, and the two commands of POST /api/owner/projects/[id]/files/[fileId]. It is kept only so
// tests/server/audio-project-input-differential.test.ts can require the Effect readers (src/server/audio-project-input.ts) to
// accept and refuse every input as these do. It is not product code: nothing under src/ or scripts/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory. It imports
// nothing from src/ but the type `RawValue`; the three size limits are written out so the copy stays what it was.
import { z } from "zod";
import type { RawValue } from "../../../src/lib/fields";

const maxProjectFileSize = 1024 * 1024 * 1024;
const uploadPartSize = 10 * 1024 * 1024;
const maxPartEtagLength = 256;

const id = z.uuid();

const start = z.object({
	action: z.literal("start"),
	version: z.enum(["review", "final"]),
	displayName: z.string().trim().min(1).max(160),
	mediaType: z.enum(["audio/mpeg", "audio/wav"]),
	byteSize: z.number().int().min(1).max(maxProjectFileSize),
});

const complete = z.object({
	action: z.literal("complete"),
	uploadId: id,
	parts: z
		.array(
			z.object({
				partNumber: z.number().int().positive(),
				etag: z.string().min(1).max(maxPartEtagLength),
			}),
		)
		.min(1)
		.max(Math.ceil(maxProjectFileSize / uploadPartSize)),
	peaks: z.array(z.number().int().min(0).max(100)).min(16).max(400).optional(),
});

const abort = z.object({ action: z.literal("abort"), uploadId: id });

const recover = z.object({ action: z.literal("recover"), uploadId: id });

const uploadInput = z.discriminatedUnion("action", [
	start,
	complete,
	abort,
	recover,
]);

const fileInput = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("publish"),
		note: z.string().trim().min(1).max(1000),
		downloadable: z.boolean(),
	}),
	z.object({ action: z.literal("revoke"), note: z.string().trim().max(1000) }),
]);

type Read = { ok: true; value: RawValue } | { ok: false };

/** What the uploads route made of a body: the parsed command, or a refusal (its 400 says one sentence whatever was wrong). */
export function legacyReadUploadCommand(body: RawValue): Read {
	const parsed = uploadInput.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** What the owner file route made of a body. */
export function legacyReadFileCommand(body: RawValue): Read {
	const parsed = fileInput.safeParse(body);

	return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/**
 * What the PUT of one part made of its query and body: `uploadId` a uuid, `part` the number the query's text makes (an empty
 * or a missing one makes 0), which must be an integer, and a body that exists.
 */
export function legacyReadPartQuery(
	uploadId: string | null,
	part: string | null,
	hasBody: boolean,
): Read {
	const parsed = id.safeParse(uploadId);
	const partNumber = Number(part);

	if (!parsed.success || !Number.isInteger(partNumber) || !hasBody)
		return { ok: false };

	return { ok: true, value: { uploadId: parsed.data, part: partNumber } };
}
