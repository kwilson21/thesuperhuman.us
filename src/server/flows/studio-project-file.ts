// A client's read of one project file: the session, then ONE batch with the file, the project, the request and the payment,
// the rule that hides every file the client may not see, the object's size from R2 (a missing object, or another size than
// the row's, is a named failure), the bytes a Range header asks for (HEAD reads none and ignores Range) and, for a GET that read
// an object, the access record last (docs/plans/2026-11-audio-projects-conversion.md, section 3). It builds no response; the
// route does.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { hashValue } from "../../lib/client-portal";
import { hashing } from "../agreement-services";
import { readStudioSession } from "../agreement-store";
import {
	getObject,
	headObject,
	readClientFileFacts,
	recordFileAccess,
} from "../audio-project-store";
import { openStudioSession } from "../rules/agreement-session";
import { FileHidden, serveProjectFile } from "../rules/studio-project-file";
import { sliceOf } from "./media-range";

/** The bucket has no object for a file the project names. The route answers 404 "File unavailable". */
export class ObjectMissing extends Data.TaggedError("ObjectMissing") {}

/** The bucket's object is another size than the file's row says: a stored state that disagrees with R2. The route logs it and answers 500. */
export class ObjectSizeDiffers extends Data.TaggedError("ObjectSizeDiffers") {}

/** The Range header names bytes the file does not have. The route answers 416 with the file's headers and its size. */
export class ProjectFileRangeRefused extends Data.TaggedError(
	"ProjectFileRangeRefused",
)<{
	readonly file: {
		readonly version: "review" | "final";
		readonly media_type: "audio/mpeg" | "audio/wav";
	};
	readonly size: number;
}> {}

/** What the client's read found: the file, the object's size, the bytes to read and the body (none for HEAD). */
export type ProjectFileRead = {
	readonly file: {
		readonly version: "review" | "final";
		readonly media_type: "audio/mpeg" | "audio/wav";
	};
	readonly size: number;
	readonly slice: { readonly offset: number; readonly length: number } | null;
	readonly body: ReadableStream | null;
};

export const readProjectFile = (input: {
	readonly requestId: string;
	readonly fileId: string;
	readonly token: string;
	readonly download: boolean;
	readonly method: string;
	readonly range: string | null;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const tokenHash = yield* hashing(() => hashValue(input.token));
		const stored = yield* readStudioSession(tokenHash);

		if (stored === null) return yield* Effect.fail(new FileHidden());

		const session = yield* openStudioSession
			.decide({ now }, stored)
			.pipe(
				Effect.catchTag("StudioSessionNotOpen", () =>
					Effect.fail(new FileHidden()),
				),
			);

		const facts = yield* readClientFileFacts(input.requestId, input.fileId);

		const file = yield* serveProjectFile.decide(
			{
				requestId: input.requestId,
				email: session.email,
				now,
				download: input.download,
			},
			facts,
		);

		const head = yield* headObject(file.object_key);

		if (head === null) return yield* Effect.fail(new ObjectMissing());

		if (head.size !== file.byte_size)
			return yield* Effect.fail(new ObjectSizeDiffers());

		const slice = yield* sliceOf(
			{ method: input.method, range: input.range },
			head.size,
		).pipe(
			Effect.catchTag("RangeOutsideFile", (outside) =>
				Effect.fail(new ProjectFileRangeRefused({ file, size: outside.size })),
			),
		);

		if (input.method === "HEAD")
			return {
				file,
				size: head.size,
				slice,
				body: null,
			} satisfies ProjectFileRead;

		const object = yield* getObject(file.object_key, slice);

		if (object === null) return yield* Effect.fail(new ObjectMissing());

		yield* recordFileAccess(
			file.id,
			tokenHash,
			input.download,
			input.now().toISOString(),
		);

		return {
			file,
			size: head.size,
			slice,
			body: object.body,
		} satisfies ProjectFileRead;
	});
