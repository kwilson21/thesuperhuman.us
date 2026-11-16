// The edge for the audio project routes: what each command's body must hold. Effect Schema readers that accept and refuse
// every body as the Zod 4 schemas they replaced did, with the same value (tests/server/audio-project-input-differential.test.ts
// holds each to a frozen copy of those schemas). A body that is not an object, an action that names none of the
// command's actions, or a field that does not read refuses the whole command, and the route answers its one sentence
// ("Check your message and try again.") whatever was wrong. What the value keeps, as Zod 4 kept it:
// - only the action's own fields; any other key is left out;
// - `body` is whatever the client sent, and its key must be there (Zod 4 refused a body with no `body` key, though one set
//   to undefined passes): the text rules read it, not the reader;
// - a message id is a whole number above 0 that a double holds exactly (Zod 4's `int()` refuses an unsafe integer), and
//   never Infinity or NaN;
// - a review id is 1 to 100 characters, counted by code points as Zod 4 counted them (a letter outside the basic plane is
//   one), and is not trimmed.
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import {
	maxPartEtagLength,
	maxProjectFileSize,
	uploadPartSize,
} from "../lib/audio-project-uploads";
import { receivedKind } from "../lib/fields";

const messageBody = Schema.Unknown;

const messageId = Schema.Number.check(
	Schema.makeFilter(
		(value: number) => Number.isSafeInteger(value) && value > 0,
	),
);

const send = Schema.Struct({
	action: Schema.Literal("send"),
	body: messageBody,
});

const read = Schema.Struct({
	action: Schema.Literal("read"),
	messageId,
});

const respond = Schema.Struct({
	action: Schema.Literal("respond"),
	reviewId: Schema.String.check(
		Schema.makeFilter((value: string) => {
			const length = Array.from(value).length;

			return length >= 1 && length <= 100;
		}),
	),
	decision: Schema.Literals(["approved", "changes", "stopped"]),
	body: messageBody,
});

export type SendCommand = typeof send.Type;

export type ReadCommand = typeof read.Type;

export type RespondCommand = typeof respond.Type;

/** The owner's command: a message, or a mark that a client message was read. */
export type OwnerMessageCommand = SendCommand | ReadCommand;

/** The client's command: a message, a read mark, or an answer to the latest review. */
export type StudioMessageCommand = SendCommand | ReadCommand | RespondCommand;

/** Reads a command by its `action`, as a Zod discriminated union did: no object, or no such action, is refused. */
function readCommand<Body, Command>(
	body: Body,
	commands: { readonly [action: string]: Schema.Decoder<Command> },
): { ok: true; value: Command } | { ok: false } {
	if (receivedKind(body) !== "object" || !Predicate.isObject(body))
		return { ok: false };

	const named = "action" in body ? body.action : undefined;

	const reader = Object.entries(commands).find(
		([action]) => action === named,
	)?.[1];

	if (!reader) return { ok: false };
	const decoded = Schema.decodeUnknownResult(reader)(body);

	return Result.isSuccess(decoded)
		? { ok: true, value: decoded.success }
		: { ok: false };
}

/** Reads the owner's body. `body` is what `musicRequest` parsed from JSON. */
export const readOwnerMessageCommand = <Body>(body: Body) =>
	readCommand<Body, OwnerMessageCommand>(body, { send, read });

/** Reads the client's body. */
export const readStudioMessageCommand = <Body>(body: Body) =>
	readCommand<Body, StudioMessageCommand>(body, { send, read, respond });

// The file routes' commands, read as the Zod 4 schemas they replaced read them (tests/server/audio-project-input-differential.test.ts
// holds each to the frozen copy of the Zod 4 schema it replaced). What the value keeps:
// - a trimmed text is trimmed before its length is checked, and a value that is not text is refused (never read as "");
// - a length counts code points, as Zod 4 counted them; a whole number is a safe integer;
// - an upload id is Zod 4's `uuid` check, whose pattern is written out here: RFC versions 1 to 8 and variant, and the nil
//   and max UUIDs in lower case only. The repository's `uuidPattern` and Effect's `isUUID` read other sets, and a looser
//   reader would pass an id that answers 400 today and read the database for it;
// - `peaks` is left out of the value when the body leaves it out, and kept when the body names it.

const ZOD_UUID =
	/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

const uploadUuid = Schema.String.check(
	Schema.makeFilter((value: string) => ZOD_UUID.test(value)),
);

const wholeNumber = (least: number, most: number) =>
	Schema.Number.check(
		Schema.makeFilter(
			(value: number) =>
				Number.isSafeInteger(value) && value >= least && value <= most,
		),
	);

const lengthWithin = (least: number, most: number) =>
	Schema.makeFilter((value: string) => {
		const length = Array.from(value).length;

		return length >= least && length <= most;
	});

/** Text that is trimmed first and then must be `least` to `most` characters. */
const trimmedText = (least: number, most: number) =>
	Schema.String.pipe(
		Schema.decodeTo(Schema.String.check(lengthWithin(least, most)), {
			decode: SchemaGetter.transform((value: string) => value.trim()),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

const mediaVersion = Schema.Literals(["review", "final"]);

const startUpload = Schema.Struct({
	action: Schema.Literal("start"),
	version: mediaVersion,
	displayName: trimmedText(1, 160),
	mediaType: Schema.Literals(["audio/mpeg", "audio/wav"]),
	byteSize: wholeNumber(1, maxProjectFileSize),
});

const completeUpload = Schema.Struct({
	action: Schema.Literal("complete"),
	uploadId: uploadUuid,
	parts: Schema.Array(
		Schema.Struct({
			partNumber: wholeNumber(1, Number.MAX_SAFE_INTEGER),
			etag: Schema.String.check(lengthWithin(1, maxPartEtagLength)),
		}),
	).check(
		Schema.makeFilter(
			(parts: readonly unknown[]) =>
				parts.length >= 1 &&
				parts.length <= Math.ceil(maxProjectFileSize / uploadPartSize),
		),
	),
	peaks: Schema.optional(
		Schema.Array(wholeNumber(0, 100)).check(
			Schema.makeFilter(
				(peaks: readonly number[]) => peaks.length >= 16 && peaks.length <= 400,
			),
		),
	),
});

const abortUpload = Schema.Struct({
	action: Schema.Literal("abort"),
	uploadId: uploadUuid,
});

const recoverUpload = Schema.Struct({
	action: Schema.Literal("recover"),
	uploadId: uploadUuid,
});

export type StartUploadCommand = typeof startUpload.Type;

export type CompleteUploadCommand = typeof completeUpload.Type;

/** The owner's upload command: start, complete, abort or recover. */
export type UploadCommand =
	| StartUploadCommand
	| CompleteUploadCommand
	| typeof abortUpload.Type
	| typeof recoverUpload.Type;

/** Reads the uploads route's body. */
export const readUploadCommand = <Body>(body: Body) =>
	readCommand<Body, UploadCommand>(body, {
		start: startUpload,
		complete: completeUpload,
		abort: abortUpload,
		recover: recoverUpload,
	});

const publishFile = Schema.Struct({
	action: Schema.Literal("publish"),
	note: trimmedText(1, 1000),
	downloadable: Schema.Boolean,
});

const revokeFile = Schema.Struct({
	action: Schema.Literal("revoke"),
	note: trimmedText(0, 1000),
});

/** The owner's file command: publish or revoke. */
export type FileCommand = typeof publishFile.Type | typeof revokeFile.Type;

/** Reads the owner file route's body. */
export const readFileCommand = <Body>(body: Body) =>
	readCommand<Body, FileCommand>(body, {
		publish: publishFile,
		revoke: revokeFile,
	});

/**
 * Reads the query and the body of one part's PUT. The part number is the number its text makes, so an empty or a missing
 * `part` reads as 0, and it must be a whole number; the body must exist.
 */
export function readPartQuery(
	uploadId: string | null,
	part: string | null,
	hasBody: boolean,
): { ok: true; value: { uploadId: string; part: number } } | { ok: false } {
	const id = Schema.decodeUnknownResult(uploadUuid)(uploadId);
	const partNumber = Number(part);

	return Result.isSuccess(id) && Number.isInteger(partNumber) && hasBody
		? { ok: true, value: { uploadId: id.success, part: partNumber } }
		: { ok: false };
}
