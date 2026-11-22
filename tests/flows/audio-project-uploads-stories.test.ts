import { describe, expect, it } from "vitest";
import {
	abortUpload,
	finishUpload,
	putUploadPart,
	startUpload,
} from "../../src/server/flows/audio-project-uploads";
import { double, partial } from "../helpers/doubles";
import {
	AT,
	endedWith,
	memoryBucket,
	seedProject,
	worldServices,
} from "../helpers/audio-project-world";
import { musicWorld } from "../helpers/music-world";

// The owner's uploads as stories: R2 is a map of objects and multipart uploads, the project is the real schema, and R2's
// failures are the messages R2 writes, "... (10043)".

type World = ReturnType<typeof musicWorld>;

const KEY = "studio/projects/song-1/upload-1.mp3";
const PART = { partNumber: 1, etag: "a".repeat(32) };

/** An R2 whose multipart handle does what `handle` says; objects and aborts are kept for the story to read. */
function multipart(handle: Partial<R2MultipartUpload> = {}) {
	const state = memoryBucket();
	const aborted: string[] = [];
	const opened: string[] = [];

	const bucket = double<R2Bucket>({
		...state.bucket,
		createMultipartUpload: async (key: string) => {
			opened.push(key);

			return double<R2MultipartUpload>({
				uploadId: "r2-1",
				abort: async () => {
					aborted.push(key);
				},
			});
		},
		resumeMultipartUpload: () =>
			double<R2MultipartUpload>({
				uploadPart: async (partNumber: number) => ({
					partNumber,
					etag: "a".repeat(32),
				}),
				complete: async () => {
					state.objects.set(KEY, 5);

					return partial<R2Object>({ size: 5 });
				},
				abort: async () => {
					aborted.push(KEY);
				},
				...handle,
			}),
	});

	return { ...state, bucket, aborted, opened };
}

const start = (
	world: World,
	bucket: R2Bucket,
	version: "review" | "final" = "review",
) =>
	endedWith(
		startUpload({
			requestId: "song-1",
			version,
			displayName: "Mix v1",
			mediaType: "audio/mpeg",
			byteSize: 5,
			now: () => AT,
			newId: () => "upload-1",
		}),
		worldServices(world, bucket),
	);

const seedUpload = (world: World, over: { state?: string } = {}) =>
	world.sql
		.prepare(`INSERT INTO audio_project_uploads(id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,state,created_at)
      VALUES ('upload-1','song-1','r2-1',?,'review','Mix v1','audio/mpeg',5,?,?)`)
		.run(KEY, over.state ?? "pending", AT.toISOString());

const finish = (
	world: World,
	bucket: R2Bucket,
	parts: { partNumber: number; etag: string }[] | null = [PART],
) =>
	endedWith(
		finishUpload({
			requestId: "song-1",
			uploadId: "upload-1",
			parts,
			peaks: null,
			now: () => AT,
		}),
		worldServices(world, bucket),
	);

const abort = (world: World, bucket: R2Bucket) =>
	endedWith(
		abortUpload({ requestId: "song-1", uploadId: "upload-1" }),
		worldServices(world, bucket),
	);

const put = (world: World, bucket: R2Bucket, bytes = 5, part = 1) =>
	endedWith(
		putUploadPart({
			requestId: "song-1",
			uploadId: "upload-1",
			part,
			contentLength: null,
			body: new Blob([new Uint8Array(bytes)]).stream(),
		}),
		worldServices(world, bucket),
	);

const rowsOf = (world: World, table: string) =>
	world.sql.prepare(`SELECT id FROM ${table}`).all();

const failing = (message: string) => async () => {
	throw new Error(message);
};

describe("starting an upload", () => {
	it("opens a multipart upload and records it once the booking is paid", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress", { booking: "open" });
		const r2 = multipart();

		expect(await start(world, r2.bucket)).toEqual({
			refused: "UploadNotReady",
		});
		expect(r2.opened).toEqual([]);

		world.sql.exec("UPDATE audio_payments SET booking_status='paid'");
		expect(await start(world, r2.bucket)).toEqual({
			done: { id: "upload-1", partSize: 10 * 1024 * 1024 },
		});
		expect(r2.opened).toEqual([KEY]);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([
			{ id: "upload-1" },
		]);
	});

	it("takes a final only from the stages a final may be published in", async () => {
		const world = musicWorld();
		seedProject(world, "complete");

		expect(await start(world, multipart().bucket, "final")).toEqual({
			refused: "UploadNotReady",
		});
	});

	it("drops the multipart upload again when the project closed before the row was written", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO audio_project_uploads/,
				() => {
					world.sql.exec(
						"UPDATE audio_projects SET revoked_at='2026-11-13T11:00:00.000Z'",
					);
				},
			],
		});

		seedProject(world, "in_progress");
		const r2 = multipart();

		expect(await start(world, r2.bucket)).toEqual({
			refused: "UploadNotReady",
		});
		expect(r2.aborted).toEqual([KEY]);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([]);
	});

	it("names R2 being unavailable, and any other R2 failure, apart", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");

		for (const [message, tag] of [
			["The service is unavailable. (10043)", "ObjectStoreUnavailable"],
			["boom", "ObjectStoreFailed"],
		] as const) {
			const bucket = double<R2Bucket>({
				createMultipartUpload: failing(message),
			});

			expect(await start(world, bucket)).toEqual({ refused: tag });
		}
	});
});

describe("putting a part", () => {
	it("stores a part of the right length, and refuses another length", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		const r2 = multipart();

		expect(await put(world, r2.bucket, 4)).toEqual({
			refused: "PartWrongSize",
		});
		expect(await put(world, r2.bucket, 5, 2)).toEqual({
			refused: "PartWrongSize",
		});
		expect(await put(world, r2.bucket)).toEqual({ done: PART });
	});

	it("answers a lost race for a part put into an upload that is being discarded, or that R2 no longer has", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world, { state: "discarding" });

		expect(await put(world, multipart().bucket)).toEqual({
			refused: "PartNotUploadable",
		});

		const other = musicWorld();
		seedProject(other, "in_progress");
		seedUpload(other);

		const gone = multipart({
			uploadPart: failing(
				"The specified multipart upload does not exist. (10024)",
			),
		});

		expect(await put(other, gone.bucket)).toEqual({
			refused: "PartNotUploadable",
		});
	});

	it("refuses an upload the project does not have, and a project that is closed", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");

		expect(await put(world, multipart().bucket)).toEqual({
			refused: "UploadGone",
		});

		seedUpload(world);
		world.sql.exec(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:00:00.000Z'",
		);
		expect(await put(world, multipart().bucket)).toEqual({
			refused: "UploadNotReady",
		});
	});
});

describe("finishing an upload", () => {
	it("joins the parts, records the file and drops the upload row", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		const r2 = multipart();

		expect(await finish(world, r2.bucket)).toEqual({ done: "upload-1" });
		expect(rowsOf(world, "audio_project_files")).toEqual([{ id: "upload-1" }]);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([]);
	});

	it("recovers an object R2 already finished, and a completion the row survived", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		const r2 = multipart();
		r2.objects.set(KEY, 5);

		expect(await finish(world, r2.bucket, null)).toEqual({ done: "upload-1" });
		expect(rowsOf(world, "audio_project_files")).toEqual([{ id: "upload-1" }]);
	});

	it("refuses an object of another size, and parts that are not the file's parts", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		const r2 = multipart();
		r2.objects.set(KEY, 6);

		expect(await finish(world, r2.bucket)).toEqual({
			refused: "UploadSizeMismatch",
		});

		r2.objects.clear();

		for (const parts of [
			null,
			[],
			[PART, { ...PART, partNumber: 2 }],
			[{ ...PART, partNumber: 2 }],
		])
			expect(await finish(world, r2.bucket, parts)).toEqual({
				refused: "UploadNotFinishable",
			});
	});

	it("refuses a discarding upload and a project that cannot take the file now", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world, { state: "discarding" });

		expect(await finish(world, multipart().bucket)).toEqual({
			refused: "UploadNotFinishable",
		});

		const other = musicWorld();
		seedProject(other, "complete");
		seedUpload(other);
		expect(await finish(other, multipart().bucket)).toEqual({
			refused: "UploadNotFinishable",
		});
	});

	it("maps what R2 says at the completion: an invalid part and a lost upload are 409s, an outage is its own failure", async () => {
		for (const [message, expected] of [
			[
				"The specified parts could not be found. (10025)",
				"UploadNotFinishable",
			],
			[
				"The specified multipart upload does not exist. (10024)",
				"UploadNotFinishable",
			],
			["The service is unavailable. (10043)", "ObjectStoreUnavailable"],
			["boom", "ObjectStoreFailed"],
		] as const) {
			const world = musicWorld();
			seedProject(world, "in_progress");
			seedUpload(world);
			const r2 = multipart({ complete: failing(message) });

			expect(await finish(world, r2.bucket)).toEqual({ refused: expected });
		}
	});

	it("continues to the file row when R2 lost the upload or was too busy but the object is there", async () => {
		for (const message of [
			"The specified multipart upload does not exist. (10024)",
			"Too many requests for one key. (10058)",
		]) {
			const world = musicWorld();
			seedProject(world, "in_progress");
			seedUpload(world);
			const r2 = multipart();

			// The first look finds nothing; the object another completion made is there by the time of the second.
			let looks = 0;

			const bucket = double<R2Bucket>({
				...r2.bucket,
				head: async () => {
					looks += 1;

					return looks === 1 ? null : partial<R2Object>({ size: 5 });
				},
				resumeMultipartUpload: () =>
					double<R2MultipartUpload>({ complete: failing(message) }),
			});

			expect(await finish(world, bucket)).toEqual({ done: "upload-1" });
		}
	});

	it("tries a busy completion three times, waiting between, and then names the outage", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		let tries = 0;

		const r2 = multipart({
			complete: async () => {
				tries += 1;

				throw new Error("Too many requests for one key. (10058)");
			},
		});

		expect(await finish(world, r2.bucket)).toEqual({
			refused: "ObjectStoreUnavailable",
		});
		expect(tries).toBe(3);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([
			{ id: "upload-1" },
		]);
	});
});

describe("aborting an upload", () => {
	it("removes the object when R2 has it, or the multipart upload when it does not, and then the row", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		const r2 = multipart();
		r2.objects.set(KEY, 5);

		expect(await abort(world, r2.bucket)).toEqual({ done: undefined });
		expect(r2.deleted).toEqual([KEY]);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([]);

		const other = musicWorld();
		seedProject(other, "in_progress");
		seedUpload(other);
		const again = multipart();

		expect(await abort(other, again.bucket)).toEqual({ done: undefined });
		expect(again.aborted).toEqual([KEY]);
		expect(rowsOf(other, "audio_project_uploads")).toEqual([]);
	});

	it("finishes a discard when R2 no longer has the multipart upload, and keeps it retryable for any other failure", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);

		const gone = multipart({
			abort: failing("The specified multipart upload does not exist. (10024)"),
		});

		expect(await abort(world, gone.bucket)).toEqual({ done: undefined });
		expect(rowsOf(world, "audio_project_uploads")).toEqual([]);

		const other = musicWorld();
		seedProject(other, "in_progress");
		seedUpload(other);
		const broken = multipart({ abort: failing("boom") });

		expect(await abort(other, broken.bucket)).toEqual({
			refused: "ObjectStoreFailed",
		});
		expect(
			other.sql.prepare("SELECT state FROM audio_project_uploads").all(),
		).toEqual([{ state: "discarding" }]);
	});

	it("only drops the row when a file was already made from the upload", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedUpload(world);
		world.sql
			.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at)
        VALUES ('upload-1','song-1','review',?,'Mix v1','audio/mpeg',5,?)`)
			.run(KEY, AT.toISOString());
		const r2 = multipart();

		expect(await abort(world, r2.bucket)).toEqual({ done: undefined });
		expect(r2.deleted).toEqual([]);
		expect(rowsOf(world, "audio_project_uploads")).toEqual([]);
		expect(rowsOf(world, "audio_project_files")).toEqual([{ id: "upload-1" }]);
	});

	it("answers an upload the project does not have", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");

		expect(await abort(world, multipart().bucket)).toEqual({
			refused: "UploadGone",
		});
	});
});
