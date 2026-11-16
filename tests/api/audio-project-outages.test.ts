import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { describe, expect, it, vi } from "vitest";
import { POST as access } from "~/pages/api/owner/projects/[id]/access";
import { POST as invitation } from "~/pages/api/owner/projects/[id]/invitation";
import { POST as messages } from "~/pages/api/owner/projects/[id]/messages";
import { POST as updates } from "~/pages/api/owner/projects/[id]/updates";
import {
	POST as uploads,
	PUT as part,
} from "~/pages/api/owner/projects/[id]/uploads";
import { POST as ownerFile } from "~/pages/api/owner/projects/[id]/files/[fileId]";
import { POST as studioMessages } from "~/pages/api/studio/projects/[id]/messages";
import { GET as studioFile } from "~/pages/api/studio/projects/[id]/files/[fileId]";
import { boundStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// How the audio project routes answer when storage fails or another request gets there first. The owner's decisions
// (2026-11-14): an unexpected database or store error answers 500 with the route's fixed sentence and never raw error
// text; a real lost race stays 409; a missing binding is a deliberate 503. The real music schema is used; the database
// is the real one with one statement made to throw.

const OWNER = { email: "owner@example.com" };
const TOKEN = "a".repeat(72);
const NOW = new Date();
const UPLOAD = "98f3c6a7-9d1e-4f44-ae41-74db25122e14";
const LEAK = "D1 exploded with a secret";

type Seed = {
	stage?: string;
	files?: boolean;
	draft?: boolean;
	upload?: "pending" | "discarding";
};

/** A music database with one paid service project "song-1", a studio session, and what the case seeds. */
function world(seed: Seed = {}) {
	const sql = new DatabaseSync(":memory:");

	sql.exec(
		readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
	);
	const at = NOW.toISOString();
	const past = new Date(NOW.getTime() - 60_000).toISOString();
	const later = new Date(NOW.getTime() + 3_600_000).toISOString();

	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','reviewed',?,?)`)
		.run(at, at);
	sql
		.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
    offer_accepted_at,booking_status,balance_status,created_at,updated_at)
    VALUES ('song-1','Mastering',7500,3750,3750,?,'paid','not_created',?,?)`)
		.run(at, at, at);
	sql
		.prepare("UPDATE audio_projects SET stage=? WHERE request_id='song-1'")
		.run(seed.stage ?? "in_progress");
	sql
		.prepare(`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
    VALUES (?,'artist@example.com',?,?,?)`)
		.run(createHash("sha256").update(TOKEN).digest("hex"), at, later, at);

	if (seed.files)
		sql
			.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at)
      VALUES ('file-1','song-1','review','studio/projects/song-1/file-1.mp3','Mix.mp3','audio/mpeg',10,1,'published',?,?)`)
			.run(past, past);

	if (seed.draft)
		sql
			.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at)
      VALUES ('file-1','song-1','review','studio/projects/song-1/file-1.mp3','Mix.mp3','audio/mpeg',10,1,'uploaded',?)`)
			.run(past);

	if (seed.upload)
		sql
			.prepare(`INSERT INTO audio_project_uploads(id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,state,created_at)
      VALUES (?,'song-1','r2-id','studio/projects/song-1/' || ? || '.wav','review','Mix.wav','audio/wav',10,?,?)`)
			.run(UPLOAD, UPLOAD, seed.upload, at);

	return sqliteD1(sql);
}

/** The same database, but a statement whose SQL matches throws with text that must never reach a client. */
function failing(db: D1Database, pattern: RegExp): D1Database {
	return double<D1Database>({
		prepare: (query: string) => {
			if (pattern.test(query)) throw new Error(LEAK);

			return db.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			if (items.some((item) => pattern.test(boundStatement(item).query)))
				throw new Error(LEAK);

			return db.batch<T>(items);
		},
	});
}

const bucket = double<R2Bucket>({
	head: async () => null,
	createMultipartUpload: async () => {
		throw new Error("not reached");
	},
});

function context(
	db: D1Database,
	request: Request,
	options: { owner?: boolean; AUDIO?: R2Bucket; fileId?: string } = {},
) {
	const runtime = partial<TestRuntime>({
		env: partial<TestRuntime["env"]>({
			AUDIO_CLIENT_PORTAL_ENABLED: "true",
			MUSIC_DB: db,
			AUDIO: options.AUDIO ?? bucket,
		}),
		ctx: double<ExecutionContext>({ waitUntil: () => {} }),
	});

	return partial<APIContext>({
		params: { id: "song-1", fileId: options.fileId ?? "file-1" },
		request,
		locals: { runtime, owner: options.owner === false ? undefined : OWNER },
	});
}

const post = (
	path: string,
	body: Record<string, string | number | boolean>,
	headers: Record<string, string> = {},
) =>
	new Request(`https://thesuperhuman.us${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://thesuperhuman.us",
			...headers,
		},
		body: JSON.stringify(body),
	});

type Handler = (context: APIContext) => Promise<Response> | Response;

const owner = "/api/owner/projects/song-1";
const studio = "/api/studio/projects/song-1";
const cookie = { cookie: `studio_session=${TOKEN}` };

const outages: {
	name: string;
	handler: Handler;
	pattern: RegExp;
	request: () => Request;
	sentence: string;
	seed?: Seed;
	owner?: boolean;
}[] = [
	{
		name: "closing access",
		handler: access,
		pattern: /UPDATE audio_projects SET revoked_at/,
		request: () => post(`${owner}/access`, { action: "revoke" }),
		sentence: "Project access could not be closed. Please try again.",
	},
	{
		name: "queuing an invitation",
		handler: invitation,
		pattern: /invitation_status/,
		request: () => post(`${owner}/invitation`, { action: "send" }),
		sentence: "The invitation could not be queued. Please try again.",
	},
	{
		name: "an owner message",
		handler: messages,
		pattern: /SELECT request_id,stage,revoked_at FROM audio_projects/,
		request: () => post(`${owner}/messages`, { action: "send", body: "Hello" }),
		sentence: "Your message could not be saved. Please try again.",
	},
	{
		name: "a progress note",
		handler: updates,
		pattern: /SELECT p\.stage/,
		request: () =>
			post(`${owner}/updates`, { action: "progress", body: "Working" }),
		sentence: "The project update could not be saved. Please try again.",
	},
	{
		name: "starting an upload",
		handler: uploads,
		pattern: /SELECT 1 WHERE/,
		request: () =>
			post(`${owner}/uploads`, {
				action: "start",
				version: "review",
				displayName: "Mix.wav",
				mediaType: "audio/wav",
				byteSize: 10,
			}),
		sentence: "The upload could not be saved. Please try again.",
	},
	{
		name: "putting a part",
		handler: part,
		pattern: /FROM audio_project_uploads/,
		request: () =>
			new Request(
				`https://thesuperhuman.us${owner}/uploads?uploadId=${UPLOAD}&part=1`,
				{
					method: "PUT",
					body: new Uint8Array(10),
				},
			),
		sentence: "This part could not be uploaded. Please try again.",
	},
	{
		name: "publishing a file",
		handler: ownerFile,
		pattern: /FROM audio_project_files WHERE id=\? AND request_id=\?/,
		request: () =>
			post(`${owner}/files/file-1`, {
				action: "publish",
				note: "Ready",
				downloadable: true,
			}),
		sentence: "The file could not be published. Please try again.",
	},
	{
		name: "revoking a file",
		handler: ownerFile,
		pattern: /SELECT version,status FROM audio_project_files/,
		request: () =>
			post(`${owner}/files/file-1`, { action: "revoke", note: "Mistake" }),
		sentence: "The file could not be published. Please try again.",
	},
	{
		name: "a client message",
		handler: studioMessages,
		pattern: /audio_client_sessions/,
		request: () =>
			post(`${studio}/messages`, { action: "send", body: "Hello" }, cookie),
		sentence: "Your message could not be saved. Please try again.",
		owner: false,
	},
];

describe("an unexpected failure answers 500 with the route's sentence", () => {
	for (const outage of outages)
		it(outage.name, async () => {
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});
			const db = failing(world(outage.seed), outage.pattern);

			const response = await outage.handler(
				context(db, outage.request(), { owner: outage.owner }),
			);

			const text = await response.text();

			expect(response.status).toBe(500);
			expect(text).toContain(outage.sentence);
			expect(text).not.toContain(LEAK);
			// The log line names the route by its path, as the converted routes do.
			expect(String(logged.mock.calls[0]?.[0])).toMatch(
				/^\/api\/(owner|studio)\/projects\/\[id\]\/.* failed unexpectedly:/,
			);
			logged.mockRestore();
		});

	it("a client's file", async () => {
		const db = failing(
			world({ stage: "review_ready", files: true }),
			/FROM audio_project_files f/,
		);

		const response = await studioFile(
			context(
				db,
				new Request(`https://thesuperhuman.us${studio}/files/file-1`, {
					headers: cookie,
				}),
				{
					owner: false,
				},
			),
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe(
			"Private audio is temporarily unavailable",
		);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
});

describe("a lost race answers 409", () => {
	it("a part for an upload that is being discarded", async () => {
		const response = await part(
			context(
				world({ upload: "discarding" }),
				new Request(
					`https://thesuperhuman.us${owner}/uploads?uploadId=${UPLOAD}&part=1`,
					{
						method: "PUT",
						headers: { "content-length": "10" },
						body: new Uint8Array(10),
					},
				),
			),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			ok: false,
			error: "This part could not be uploaded. Please try again.",
		});
	});
});

const GONE = new Error(
	"The specified multipart upload does not exist. (10024)",
);

const CONCURRENT = new Error(
	"There was a conflict with a concurrent write to the same key. (10058)",
);

const BAD_PART = new Error(
	"One or more of the specified parts could not be found. The part may not have been uploaded, or the specified entity tag may not match the part's entity tag. (10025)",
);

const completeUpload = () =>
	new Request(`https://thesuperhuman.us${owner}/uploads`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://thesuperhuman.us",
		},
		body: JSON.stringify({
			action: "complete",
			uploadId: UPLOAD,
			parts: [{ partNumber: 1, etag: "etag-1" }],
		}),
	});

/** A bucket whose head answers one object after the first call (or never) and whose multipart upload fails to complete. */
function bucketCompleting(
	failure: Error,
	object: { size: number } | null,
): R2Bucket {
	let heads = 0;

	return double<R2Bucket>({
		head: async () =>
			heads++ === 0 || !object ? null : double<R2Object>(object),
		resumeMultipartUpload: () =>
			double<R2MultipartUpload>({
				complete: async () => {
					throw failure;
				},
				uploadPart: async () => {
					throw failure;
				},
			}),
	});
}

describe("an upload that R2 no longer has, or a completion it refuses, is a lost race", () => {
	const putRequest = () =>
		new Request(
			`https://thesuperhuman.us${owner}/uploads?uploadId=${UPLOAD}&part=1`,
			{
				method: "PUT",
				headers: { "content-length": "10" },
				body: new Uint8Array(10),
			},
		);

	it("a part for a multipart upload R2 no longer has answers 409 with the part sentence", async () => {
		const response = await part(
			context(world({ upload: "pending" }), putRequest(), {
				AUDIO: bucketCompleting(GONE, null),
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			ok: false,
			error: "This part could not be uploaded. Please try again.",
		});
	});

	it("a completion for a multipart upload R2 no longer has, and no object, answers 409", async () => {
		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucketCompleting(GONE, null),
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			ok: false,
			error: "This upload cannot be finished now.",
		});
	});

	it("a completion that lost the race to another completion finishes when the object is there", async () => {
		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucketCompleting(GONE, { size: 10 }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, fileId: UPLOAD });
	});

	it("a completion that keeps losing a concurrent write to the same key is tried three times, then answers 503", async () => {
		let completes = 0;

		const bucket = double<R2Bucket>({
			head: async () => null,
			resumeMultipartUpload: () =>
				double<R2MultipartUpload>({
					complete: async () => {
						completes++;
						throw CONCURRENT;
					},
				}),
		});

		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucket,
			}),
		);

		expect(completes).toBe(3);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The upload could not be saved. Please try again.",
		});
	});

	it("a completion that loses a concurrent write once and wins the second try is saved", async () => {
		let completes = 0;

		const bucket = double<R2Bucket>({
			head: async () => null,
			resumeMultipartUpload: () =>
				double<R2MultipartUpload>({
					complete: async () => {
						if (completes++ === 0) throw CONCURRENT;

						return double<R2Object>({ size: 10 });
					},
				}),
		});

		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucket,
			}),
		);

		expect(completes).toBe(2);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, fileId: UPLOAD });
	});

	it("a completion that loses a concurrent write to the same key finishes when the object is there", async () => {
		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucketCompleting(CONCURRENT, { size: 10 }),
			}),
		);

		expect(response.status).toBe(200);
	});

	it("a completion R2 refuses for a missing part or a wrong entity tag answers 409", async () => {
		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucketCompleting(BAD_PART, null),
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			ok: false,
			error: "This upload cannot be finished now.",
		});
	});

	it("any other R2 failure of a completion stays 500", async () => {
		const response = await uploads(
			context(world({ upload: "pending" }), completeUpload(), {
				AUDIO: bucketCompleting(new Error(LEAK), null),
			}),
		);

		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain(LEAK);
	});
});

describe("a stored state that disagrees with R2 is not an unavailable service", () => {
	it("a file whose object has another size answers 500 and logs one fixed line", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await studioFile(
			context(
				world({ stage: "review_ready", files: true }),
				new Request(`https://thesuperhuman.us${studio}/files/file-1`, {
					headers: cookie,
				}),
				{
					owner: false,
					AUDIO: double<R2Bucket>({
						head: async () => double<R2Object>({ size: 11 }),
					}),
				},
			),
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("File unavailable");
		expect(logged).toHaveBeenCalledTimes(1);
		expect(String(logged.mock.calls[0])).toContain(
			"/api/studio/projects/[id]/files/[fileId] failed unexpectedly",
		);
		logged.mockRestore();
	});
});

const UNAVAILABLE = new Error(
	"The service is unavailable, try again later. (10043)",
);

const down = (over: Partial<R2Bucket> = {}) =>
	double<R2Bucket>({
		head: async () => {
			throw UNAVAILABLE;
		},
		createMultipartUpload: async () => {
			throw UNAVAILABLE;
		},
		get: async () => {
			throw UNAVAILABLE;
		},
		resumeMultipartUpload: () =>
			double<R2MultipartUpload>({
				complete: async () => {
					throw UNAVAILABLE;
				},
				uploadPart: async () => {
					throw UNAVAILABLE;
				},
			}),
		...over,
	});

describe("R2 reports itself unavailable (10043): a known dependency outage answers 503 with the route's sentence and no unexpected-failure log", () => {
	const startUpload = () =>
		post(`${owner}/uploads`, {
			action: "start",
			version: "review",
			displayName: "Mix.wav",
			mediaType: "audio/wav",
			byteSize: 10,
		});

	const putPart = () =>
		new Request(
			`https://thesuperhuman.us${owner}/uploads?uploadId=${UPLOAD}&part=1`,
			{
				method: "PUT",
				headers: { "content-length": "10" },
				body: new Uint8Array(10),
			},
		);

	const cases: {
		name: string;
		handler: Handler;
		request: () => Request;
		seed: Seed;
		bucket: R2Bucket;
		sentence: string;
		owner?: boolean;
		fileId?: string;
	}[] = [
		{
			name: "starting an upload",
			handler: uploads,
			request: startUpload,
			seed: {},
			bucket: down(),
			sentence: "The upload could not be saved. Please try again.",
		},
		{
			name: "finishing an upload, at the head",
			handler: uploads,
			request: completeUpload,
			seed: { upload: "pending" },
			bucket: down(),
			sentence: "The upload could not be saved. Please try again.",
		},
		{
			name: "finishing an upload, at the completion",
			handler: uploads,
			request: completeUpload,
			seed: { upload: "pending" },
			bucket: down({ head: async () => null }),
			sentence: "The upload could not be saved. Please try again.",
		},
		{
			name: "putting a part",
			handler: part,
			request: putPart,
			seed: { upload: "pending" },
			bucket: down(),
			sentence: "This part could not be uploaded. Please try again.",
		},
		{
			name: "publishing a file, at the head",
			handler: ownerFile,
			request: () =>
				post(`${owner}/files/file-1`, {
					action: "publish",
					note: "Ready",
					downloadable: true,
				}),
			seed: { draft: true },
			bucket: down(),
			sentence: "The file could not be published. Please try again.",
		},
	];

	for (const one of cases)
		it(one.name, async () => {
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});

			const response = await one.handler(
				context(world(one.seed), one.request(), { AUDIO: one.bucket }),
			);

			const text = await response.text();

			expect(response.status).toBe(503);
			expect(text).toContain(one.sentence);
			expect(logged).not.toHaveBeenCalled();
			logged.mockRestore();
		});

	it("a client's file, at the head", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await studioFile(
			context(
				world({ stage: "review_ready", files: true }),
				new Request(`https://thesuperhuman.us${studio}/files/file-1`, {
					headers: cookie,
				}),
				{ owner: false, AUDIO: down() },
			),
		);

		expect(response.status).toBe(503);
		expect(await response.text()).toBe(
			"Private audio is temporarily unavailable",
		);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(logged).not.toHaveBeenCalled();
		logged.mockRestore();
	});
});
