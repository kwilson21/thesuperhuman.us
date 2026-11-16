import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { beforeEach, expect, it } from "vitest";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { byteRange, bytesStream } from "../helpers/r2";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { GET, HEAD } from "~/pages/api/studio/projects/[id]/files/[fileId]";
import { completeClientCode, issueClientCode } from "~/lib/audio-client-access";
import {
	clientProjectFile,
	privateProjectObjectKey,
} from "~/lib/audio-project-files";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

const secret = "studio-code-key-for-tests-32-characters";
const now = new Date();
let sql: InstanceType<typeof DatabaseSync>, db: D1Database, token: string;

let bucket: R2Bucket;

beforeEach(async () => {
	sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);

	db = sqliteD1(sql);

	const insertRequest =
		sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES (?,'service',?,'A song','reviewed',?,?)`);

	insertRequest.run(
		"song-1",
		"artist@example.com",
		now.toISOString(),
		now.toISOString(),
	);
	insertRequest.run(
		"song-2",
		"other@example.com",
		now.toISOString(),
		now.toISOString(),
	);
	sql
		.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
    offer_accepted_at,booking_status,balance_status,created_at,updated_at)
    VALUES ('song-1','Mastering',7500,3750,3750,?,'paid','not_created',?,?)`)
		.run(now.toISOString(), now.toISOString(), now.toISOString());
	sql
		.prepare(
			"UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-1'",
		)
		.run();
	sql
		.prepare(
			"UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-2'",
		)
		.run();
	const code = (await issueClientCode(db, "artist@example.com", secret, now))!;
	token = (await completeClientCode(
		db,
		"artist@example.com",
		code.code,
		code.nonce,
		secret,
		now,
	))!;

	const insertFile = sql.prepare(`INSERT INTO audio_project_files
    (id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at,expires_at)
    VALUES (?,?,?,?,?,'audio/mpeg',5,?,'published',?,?,?)`);

	insertFile.run(
		"review-1",
		"song-1",
		"review",
		privateProjectObjectKey("song-1", "review-1", "audio/mpeg"),
		"First review",
		0,
		now.toISOString(),
		now.toISOString(),
		null,
	);
	insertFile.run(
		"review-2",
		"song-2",
		"review",
		privateProjectObjectKey("song-2", "review-2", "audio/mpeg"),
		"Other artist",
		0,
		now.toISOString(),
		now.toISOString(),
		null,
	);
	const bytes = new Uint8Array([1, 2, 3, 4, 5]);
	bucket = double<R2Bucket>({
		head: async () => partial<R2Object>({ size: bytes.length }),
		get: async (_key: string, options?: R2GetOptions) => {
			const range = byteRange(options?.range);

			return partial<R2ObjectBody>({
				body: bytesStream(
					range
						? bytes.slice(range.offset, range.offset + range.length)
						: bytes,
				),
			});
		},
	});
});

function context(
	fileId = "review-1",
	options: {
		project?: string;
		cookie?: boolean;
		range?: string;
		download?: boolean;
		method?: "GET" | "HEAD";
	} = {},
) {
	const project = options.project ?? "song-1";
	const url = `https://thesuperhuman.us/api/studio/projects/${project}/files/${fileId}${options.download ? "?download=1" : ""}`;

	const headers = new Headers();

	if (options.cookie !== false)
		headers.set("cookie", `studio_session=${token}`);

	if (options.range) headers.set("range", options.range);

	return partial<APIContext>({
		params: { id: project, fileId },
		request: new Request(url, {
			method: options.method ?? "GET",
			headers,
		}),
		locals: {
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					AUDIO_CLIENT_PORTAL_ENABLED: "true",
					MUSIC_DB: db,
					AUDIO: bucket,
				}),
			}),
		},
	});
}

it("streams only the active client review file with private caching and one audit row", async () => {
	expect((await GET(context("review-1", { cookie: false }))).status).toBe(404);
	expect((await GET(context("review-2", { project: "song-2" }))).status).toBe(
		404,
	);
	expect((await GET(context("review-1", { download: true }))).status).toBe(404);
	sql
		.prepare(
			"UPDATE audio_payments SET booking_status='open' WHERE request_id='song-1'",
		)
		.run();
	expect((await GET(context("review-1"))).status).toBe(404);
	sql
		.prepare(
			"UPDATE audio_payments SET booking_status='paid' WHERE request_id='song-1'",
		)
		.run();
	const response = await GET(context("review-1", { range: "bytes=1-3" }));
	expect(response.status).toBe(206);
	expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(
		new Uint8Array([2, 3, 4]),
	);
	expect((await HEAD(context("review-1", { method: "HEAD" }))).status).toBe(
		200,
	);
	expect(
		sql.prepare("SELECT access_kind FROM audio_project_file_access").all(),
	).toEqual([{ access_kind: "stream" }]);
	sql.close();
});

it("keeps final files hidden until paid and blocks expired or revoked access", async () => {
	sql
		.prepare(
			"UPDATE audio_projects SET stage='final_files_ready' WHERE request_id='song-1'",
		)
		.run();
	const expires = new Date(now);
	expires.setUTCFullYear(expires.getUTCFullYear() + 1);
	sql
		.prepare(`INSERT INTO audio_project_files
    (id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at,expires_at)
    VALUES ('final-1','song-1','final',?,'Final master','audio/mpeg',5,1,'published',?,?,?)`)
		.run(
			privateProjectObjectKey("song-1", "final-1", "audio/mpeg"),
			now.toISOString(),
			now.toISOString(),
			expires.toISOString(),
		);
	expect((await GET(context("final-1"))).status).toBe(404);
	sql
		.prepare(
			"UPDATE audio_payments SET balance_status='open' WHERE request_id='song-1'",
		)
		.run();
	expect((await GET(context("final-1"))).status).toBe(404);
	sql
		.prepare(
			"UPDATE audio_payments SET balance_status='paid' WHERE request_id='song-1'",
		)
		.run();
	const download = await GET(context("final-1", { download: true }));
	expect(download.status).toBe(200);
	expect(download.headers.get("content-disposition")).toContain("attachment");
	expect(
		sql.prepare("SELECT access_kind FROM audio_project_file_access").all(),
	).toEqual([{ access_kind: "download" }]);
	expect(
		await clientProjectFile(
			db,
			"song-1",
			"final-1",
			token,
			new Date(expires.getTime() + 1),
		),
	).toBeNull();
	const tooLong = new Date(now);
	tooLong.setUTCFullYear(tooLong.getUTCFullYear() + 2);
	sql
		.prepare("UPDATE audio_project_files SET expires_at=? WHERE id='final-1'")
		.run(tooLong.toISOString());
	expect(
		await clientProjectFile(
			db,
			"song-1",
			"final-1",
			token,
			new Date(expires.getTime() + 1),
		),
	).toBeNull();
	sql
		.prepare("UPDATE audio_projects SET revoked_at=? WHERE request_id='song-1'")
		.run(now.toISOString());
	expect((await GET(context("final-1"))).status).toBe(404);
	sql.close();
});
