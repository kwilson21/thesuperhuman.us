import { createHash } from "node:crypto";
import type { JsonValue } from "../helpers/json";
import { POST as publishFile } from "~/pages/api/owner/projects/[id]/files/[fileId]";
import { POST, PUT } from "~/pages/api/owner/projects/[id]/uploads";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	uuidFor,
	type Case,
	type Step,
} from "./harness";
import {
	atStage,
	EARLIER,
	file,
	keyOf,
	NOTE,
	payment,
	rawStep,
	resendOk,
	routeStep,
	service,
	sql,
	STAGES,
	upload,
	UPLOAD_TABLES,
	world,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for /api/owner/projects/[id]/uploads: the owner's browser sends a project audio file to R2 in
// parts. POST carries four JSON actions (start, complete, abort, recover); PUT carries one raw part of the file in
// the body, with the upload id and part number in the query.
//
//   POST start      beginProjectUpload: checks the project can take a file (paid booking, a working stage), opens an R2
//                   multipart upload, records it in audio_project_uploads; the R2 upload is aborted again when the record
//                   cannot be written.
//   PUT             one part (the part sizes are fixed by byte_size: 10 MiB each, the last one shorter); R2 uploadPart.
//   POST complete   finishProjectUpload: R2 complete with the part list (or the object already in R2), size check, the
//                   audio_project_files row (status uploaded), the upload row deleted. A saved file id is the upload id.
//   POST recover    the same without a part list: only when R2 already holds the object.
//   POST abort      abortProjectUpload: the row goes to "discarding", the R2 object or multipart upload is removed, the row
//                   is deleted; with a file already saved from the upload only the row is deleted.
//
// Response branches, and the cases that reach them (names start with the topic):
//
//   POST  403 "Owner access required."          "not the owner": visitor, signed-in studio client
//         404 "Not found."                       "portal flag": off, "True", unset, flag off wins over no database
//         503 "Private uploads are unavailable." "unavailable": no id, no MUSIC_DB, no AUDIO bucket
//         musicRequest (34000 byte cap)          "origin" 403, "content type" 415, "no request body" 400, "body over 34000
//                                                bytes" 413, "invalid JSON" 400
//         400 "Check the file details ..."       "schema": every field of start, complete (parts, peaks), abort, recover
//         start 200 {ok,uploadId,partSize}       "start": the 7 stages x 2 versions matrix, wav, name edges, 1 GiB
//         start 409 "not ready"                  "start": stage not allowed, booking unpaid, no payment, access revoked,
//                                                withdrawn, unknown project, a request id that cannot make an R2 key, the
//                                                insert finding the project changed (the R2 upload is aborted, and an
//                                                abort that fails is swallowed)
//         404 "no longer available"              "complete", "recover", "abort": unknown upload, another project's upload
//         abort 200 {ok:true}                    "abort": R2 multipart upload aborted, object already in R2 deleted, a
//                                                saved file only drops the row, an upload already discarding
//         complete/recover 200 {ok,fileId}       "complete": the object is already in R2, a part list that R2 completes
//                                                (in the sequences), peaks, a file row that already exists
//         409 "size did not match"               "complete": the R2 object is not byte_size long
//         409 "cannot be finished now"           "complete", "recover": discarding row, project cannot take a file, no
//                                                object and no part list, a part list of the wrong length or numbering,
//                                                the insert finding the row changed
//         503 catch                              "outage": each D1 statement and each R2 call (createMultipartUpload,
//                                                head, complete, delete, abort), a multipart upload R2 no longer has
//   PUT   403, 404, 503 as POST            "put: ..." (PUT has no Origin or content-type check)
//         400 "Invalid file part."          "put": uploadId missing or not a UUID, part not an integer, no body
//         404 "no longer available"         "put": unknown upload, another project's upload
//         409 "not ready for file upload"   "put": the project cannot take a file now
//         400 "wrong size"                  "put": part 0 or past the last part, a content-length that differs, a body
//                                           shorter or longer than the part
//         200 {ok,part}                     "put": a part of a one-part file, the last part of a 10 MiB + 3 byte file
//         503 catch                         "put": a discarding upload, R2 uploadPart failing, a multipart upload R2 does
//                                           not have, the D1 read failing
//   sequences                                "flow": start, PUT, complete, publish; start and abort; and the repeat cases

const BYTES = "abcdefghijkl";
const ETAG = createHash("sha256").update(BYTES).digest("hex").slice(0, 32);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const FIRST = uuidFor(1);
const TEN_MIB = 10 * 1024 * 1024;

const step = routeStep("uploads");

const dumps = { music: UPLOAD_TABLES, r2: true };

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	step(body, { dump: dumps, ...extra });

const startBody = (over: { [name: string]: string | number } = {}) => ({
	action: "start",
	version: "review",
	displayName: "Mix v1",
	mediaType: "audio/mpeg",
	byteSize: 12,
	...over,
});

const complete = (over: { [name: string]: JsonValue } = {}) => ({
	action: "complete",
	uploadId: U1,
	parts: [{ partNumber: 1, etag: ETAG }],
	...over,
});

const finish = (action: "abort" | "recover", uploadId = U1) => ({
	action,
	uploadId,
});

const putUrl = (uploadId: string, part: string) =>
	`/api/owner/projects/r1/uploads?uploadId=${uploadId}&part=${part}`;

/** A raw part: the body is the bytes, the query names the upload and the part. No Origin, as a browser PUT to the same site. */
const put = (
	part: string | number = 1,
	body: string | null = BYTES,
	extra: Partial<Step> = {},
	uploadId = U1,
): Step => ({
	as: asOwner(),
	handler: PUT,
	method: "PUT",
	path: putUrl(uploadId, String(part)),
	params: { id: "r1" },
	body: body ?? undefined,
	headers: { "content-type": "application/octet-stream" },
	dump: dumps,
	...extra,
});

/** A project at `stage`, paid, with an open upload U1 (a 12 byte mp3, review) that R2 knows as upload-1. */
const open = (
	stage = "in_progress",
	uploadOver: { [column: string]: string | number | null } = {},
	parts: Parts = {},
	extra: Partial<Case> = {},
): Partial<Case> => ({
	...world({
		project: atStage(stage),
		uploads: [upload(U1, uploadOver)],
		...parts,
	}),
	r2: { uploads: { "upload-1": keyOf(U1) } },
	fetches: resendOk,
	...extra,
});

const named = (name: string, base: Partial<Case>, ...steps: Step[]): Case => ({
	...base,
	name,
	steps,
});

const begin = (
	stage = "in_progress",
	parts: Parts = {},
	extra: Partial<Case> = {},
): Partial<Case> => ({
	...world({ project: atStage(stage), ...parts }),
	...extra,
});

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...open(),
	env,
	omit,
	steps: [act(startBody())],
});

const schema = (name: string, body: JsonValue | undefined): Case =>
	named(`schema: ${name}`, begin(), act(body));

const long = (n: number) => "a".repeat(n);

const INSERT_UPLOAD = /INSERT INTO audio_project_uploads/;

const INSERT_FILE = /INSERT INTO audio_project_files/;

const SELECT_UPLOAD =
	/FROM audio_project_uploads WHERE request_id=\? AND id=\?/;

const CAN_UPLOAD = /SELECT 1 WHERE EXISTS/;

const DISCARD = /UPDATE audio_project_uploads SET state='discarding'/;

const DELETE_ROW =
	/DELETE FROM audio_project_uploads WHERE id=\? AND request_id=\? AND state='discarding'/;

const DELETE_DONE =
	/DELETE FROM audio_project_uploads WHERE id=\? AND request_id=\?$/;

const peaks = (n: number, value = 50) => Array.from({ length: n }, () => value);

const startMatrix: Case[] = ["review", "final"].flatMap((version) =>
	STAGES.map((stage) =>
		named(
			`start: a ${version} file from ${stage}`,
			begin(stage),
			act(startBody({ version })),
		),
	),
);

const cases: Case[] = [
	// 403 404 503
	named(
		"not the owner: a visitor",
		begin(),
		act(startBody(), { as: asVisitor() }),
	),
	named(
		"not the owner: a signed-in studio client",
		begin(),
		act(startBody(), { as: asClient("grace@example.test") }),
	),
	named(
		"not the owner: PUT by a visitor",
		open(),
		put(1, BYTES, { as: asVisitor() }),
	),
	flag("portal flag: off", { AUDIO_CLIENT_PORTAL_ENABLED: "false" }),
	flag("portal flag: 'True' is not 'true'", {
		AUDIO_CLIENT_PORTAL_ENABLED: "True",
	}),
	flag("portal flag: not set", undefined, ["AUDIO_CLIENT_PORTAL_ENABLED"]),
	named(
		"portal flag: off for a PUT",
		{ ...open(), env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } },
		put(),
	),
	{
		name: "portal flag: off wins over a missing database",
		music: { missing: true },
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [act(startBody())],
	},
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		steps: [act(startBody())],
	},
	{
		name: "unavailable: no R2 bucket",
		...begin(),
		r2: { missing: true },
		steps: [act(startBody())],
	},
	named("unavailable: no id param", begin(), act(startBody(), { params: {} })),
	named(
		"unavailable: an empty id param",
		begin(),
		act(startBody(), { params: { id: "" } }),
	),
	{
		name: "unavailable: PUT with no database",
		music: { missing: true },
		steps: [put()],
	},
	{
		name: "unavailable: PUT with no R2 bucket",
		...open(),
		r2: { missing: true },
		steps: [put()],
	},
	named(
		"unavailable: PUT with no id param",
		open(),
		put(1, BYTES, { params: {} }),
	),
	// musicRequest
	named("origin: missing", begin(), act(startBody(), { headers: {} })),
	named(
		"origin: another site",
		begin(),
		act(startBody(), { headers: { origin: "https://example.test" } }),
	),
	named(
		"origin: the right host over http",
		begin(),
		act(startBody(), { headers: { origin: "http://thesuperhuman.us" } }),
	),
	named(
		"content type: missing",
		begin(),
		rawStep("uploads", JSON.stringify(startBody()), {
			headers: { origin: "https://thesuperhuman.us" },
		}),
	),
	named(
		"content type: text/plain",
		begin(),
		rawStep("uploads", JSON.stringify(startBody()), {
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "text/plain",
			},
		}),
	),
	{
		...named("no request body", begin(), {
			...rawStep("uploads", ""),
			body: undefined,
		}),
	},
	named(
		"body over 34000 bytes",
		begin(),
		rawStep("uploads", JSON.stringify({ action: "start", pad: long(34_100) })),
	),
	named(
		"body of exactly 34000 bytes reaches the schema",
		begin(),
		rawStep(
			"uploads",
			JSON.stringify({
				action: "start",
				pad: long(34_000 - JSON.stringify({ action: "start", pad: "" }).length),
			}),
		),
	),
	named("invalid JSON: bad text", begin(), rawStep("uploads", "{not json")),
	named("invalid JSON: empty text", begin(), rawStep("uploads", "")),
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "start"),
	schema("no action", {}),
	schema("an unknown action", { action: "resume" }),
	schema("action in capitals", { ...startBody(), action: "START" }),
	schema("start with no version", {
		action: "start",
		displayName: "x",
		mediaType: "audio/mpeg",
		byteSize: 1,
	}),
	schema("start with an unknown version", startBody({ version: "draft" })),
	schema("start with no displayName", {
		action: "start",
		version: "review",
		mediaType: "audio/mpeg",
		byteSize: 1,
	}),
	schema("start with an empty displayName", startBody({ displayName: "" })),
	schema(
		"start with a displayName of spaces",
		startBody({ displayName: "   " }),
	),
	schema(
		"start with a displayName over 160",
		startBody({ displayName: long(161) }),
	),
	schema(
		"start with a displayName that is a number",
		startBody({ displayName: 5 }),
	),
	schema("start with no mediaType", {
		action: "start",
		version: "review",
		displayName: "x",
		byteSize: 1,
	}),
	schema(
		"start with mediaType audio/ogg",
		startBody({ mediaType: "audio/ogg" }),
	),
	schema(
		"start with mediaType audio/mp3",
		startBody({ mediaType: "audio/mp3" }),
	),
	schema(
		"start with mediaType in capitals",
		startBody({ mediaType: "AUDIO/MPEG" }),
	),
	schema("start with no byteSize", {
		action: "start",
		version: "review",
		displayName: "x",
		mediaType: "audio/mpeg",
	}),
	schema("start with byteSize 0", startBody({ byteSize: 0 })),
	schema("start with byteSize -1", startBody({ byteSize: -1 })),
	schema("start with byteSize 1.5", startBody({ byteSize: 1.5 })),
	schema("start with byteSize as text", startBody({ byteSize: "12" })),
	schema(
		"start with byteSize over 1 GiB",
		startBody({ byteSize: 1024 * 1024 * 1024 + 1 }),
	),
	schema("complete with no uploadId", {
		action: "complete",
		parts: [{ partNumber: 1, etag: ETAG }],
	}),
	schema(
		"complete with an uploadId that is not a UUID",
		complete({ uploadId: "upload-1" }),
	),
	schema(
		"complete with a UUID of no valid variant",
		complete({ uploadId: "11111111-1111-1111-1111-111111111111" }),
	),
	schema("complete with no parts", { action: "complete", uploadId: U1 }),
	schema("complete with an empty part list", complete({ parts: [] })),
	schema("complete with parts that are not a list", complete({ parts: "1" })),
	schema(
		"complete with part number 0",
		complete({ parts: [{ partNumber: 0, etag: ETAG }] }),
	),
	schema(
		"complete with part number 1.5",
		complete({ parts: [{ partNumber: 1.5, etag: ETAG }] }),
	),
	schema("complete with no etag", complete({ parts: [{ partNumber: 1 }] })),
	schema(
		"complete with an empty etag",
		complete({ parts: [{ partNumber: 1, etag: "" }] }),
	),
	schema(
		"complete with an etag over 256",
		complete({ parts: [{ partNumber: 1, etag: long(257) }] }),
	),
	schema(
		"complete with 104 parts",
		complete({
			parts: Array.from({ length: 104 }, (_, i) => ({
				partNumber: i + 1,
				etag: ETAG,
			})),
		}),
	),
	schema("complete with peaks of 15 values", complete({ peaks: peaks(15) })),
	schema("complete with peaks of 401 values", complete({ peaks: peaks(401) })),
	schema("complete with a peak of 101", complete({ peaks: peaks(16, 101) })),
	schema("complete with a peak of -1", complete({ peaks: peaks(16, -1) })),
	schema("complete with a peak of 1.5", complete({ peaks: peaks(16, 1.5) })),
	schema("complete with peaks null", complete({ peaks: null })),
	schema("complete with peaks that are not a list", complete({ peaks: "50" })),
	schema("abort with no uploadId", { action: "abort" }),
	schema("abort with an uploadId that is not a UUID", {
		action: "abort",
		uploadId: "x",
	}),
	schema("recover with no uploadId", { action: "recover" }),
	// start
	...startMatrix,
	named(
		"start: a wav file",
		begin(),
		act(startBody({ mediaType: "audio/wav" })),
	),
	named(
		"start: a 1 GiB file",
		begin(),
		act(startBody({ byteSize: 1024 * 1024 * 1024 })),
	),
	named(
		"start: a name with markup and unicode, padded",
		begin(),
		act(startBody({ displayName: `  <b>Mix</b> & "v2" café \u{1F3B5}  ` })),
	),
	named(
		"start: a name of exactly 160 characters",
		begin(),
		act(startBody({ displayName: long(160) })),
	),
	named(
		"start: the booking is not paid",
		begin("in_progress", {
			payment: payment({
				booking_status: "open",
				balance_status: "not_created",
			}),
		}),
		act(startBody()),
	),
	named(
		"start: no payment row",
		begin("in_progress", { payment: null }),
		act(startBody()),
	),
	named(
		"start: access revoked",
		begin("in_progress", {
			project: atStage("in_progress", { revoked_at: EARLIER }),
		}),
		act(startBody()),
	),
	named(
		"start: the request is withdrawn",
		begin("in_progress", { request: service({ status: "withdrawn" }) }),
		act(startBody()),
	),
	named(
		"start: the request is resolved",
		begin("in_progress", { request: service({ status: "resolved" }) }),
		act(startBody()),
	),
	named(
		"start: unknown project",
		begin(),
		act(startBody(), {
			params: { id: "nope" },
			path: "/api/owner/projects/nope/uploads",
		}),
	),
	{
		...named(
			"start: a request id that cannot be part of an R2 key",
			begin("in_progress", {
				request: service({ id: "Req1" }),
				payment: payment({ request_id: "Req1" }),
			}),
			act(startBody(), {
				params: { id: "Req1" },
				path: "/api/owner/projects/Req1/uploads",
			}),
		),
	},
	{
		...named(
			"start: the insert finds the project revoked, so the R2 upload is aborted",
			begin(),
			act(startBody()),
		),
		interleave: [
			{
				on: INSERT_UPLOAD,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	},
	named(
		"start: R2 refuses to open the upload",
		{ ...begin(), r2: { fails: ["createMultipartUpload"] } },
		act(startBody()),
	),
	named(
		"start: the readiness check fails",
		{ ...begin(), failures: [{ on: CAN_UPLOAD, message: "D1 is down" }] },
		act(startBody()),
	),
	named(
		"start: the insert fails, so the R2 upload is aborted",
		{ ...begin(), failures: [{ on: INSERT_UPLOAD, message: "D1 is down" }] },
		act(startBody()),
	),
	named(
		"start: the insert fails and the abort fails too",
		{
			...begin(),
			failures: [{ on: INSERT_UPLOAD, message: "D1 is down" }],
			r2: { fails: ["abort"] },
		},
		act(startBody()),
	),
	{
		...named(
			"start: the insert finds the project changed and the abort fails too",
			begin(),
			act(startBody()),
		),
		interleave: [
			{
				on: INSERT_UPLOAD,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
		r2: { fails: ["abort"] },
	},
	// complete, recover, abort: the upload
	named("complete: an unknown upload", open(), act(complete({ uploadId: U2 }))),
	named("recover: an unknown upload", open(), act(finish("recover", U2))),
	named("abort: an unknown upload", open(), act(finish("abort", U2))),
	named(
		"complete: another project's upload",
		open(
			"in_progress",
			{ request_id: "r2", object_key: keyOf(U1, "mp3", "r2") },
			{
				moreRequests: [
					rows.ownerRequest("r2", {
						service_id: "vocal-mix",
						status: "reviewed",
						email: "ada@example.test",
					}),
				],
			},
		),
		act(complete()),
	),
	named(
		"complete: the upload read fails",
		{ ...open(), failures: [{ on: SELECT_UPLOAD, message: "D1 is down" }] },
		act(complete()),
	),
	// complete
	named(
		"complete: the object is already in R2 (a part list is not needed)",
		{
			...open(),
			r2: {
				uploads: { "upload-1": keyOf(U1) },
				seed: { [keyOf(U1)]: { body: BYTES } },
			},
		},
		act(complete()),
	),
	named(
		"complete: with peaks",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		act(complete({ peaks: peaks(16, 0) })),
	),
	named(
		"complete: with 400 peaks of 100",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		act(complete({ peaks: peaks(400, 100) })),
	),
	named(
		"complete: an etag of 256 characters is accepted when the object exists",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		act(complete({ parts: [{ partNumber: 1, etag: long(256) }] })),
	),
	named(
		"complete: the object in R2 is the wrong size",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: "short" } } } },
		act(complete()),
	),
	named(
		"complete: the object has the right size but the recorded size differs",
		{
			...open("in_progress", { byte_size: 13 }),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } } },
		},
		act(complete()),
	),
	named(
		"complete: no object in R2 and the parts were never uploaded",
		open(),
		act(complete()),
	),
	named(
		"complete: no object and R2 no longer has the multipart upload",
		{ ...open(), r2: {} },
		act(complete()),
	),
	named(
		"complete: no object and R2 fails to complete",
		{
			...open(),
			r2: { uploads: { "upload-1": keyOf(U1) }, fails: ["complete"] },
		},
		act(complete()),
	),
	named(
		"complete: two parts for a one-part file",
		open(),
		act(
			complete({
				parts: [
					{ partNumber: 1, etag: ETAG },
					{ partNumber: 2, etag: ETAG },
				],
			}),
		),
	),
	named(
		"complete: a part list that starts at 2",
		open(),
		act(complete({ parts: [{ partNumber: 2, etag: ETAG }] })),
	),
	named(
		"complete: a part list that repeats a part",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		act(
			complete({
				parts: [
					{ partNumber: 1, etag: ETAG },
					{ partNumber: 1, etag: ETAG },
				],
			}),
		),
	),
	named(
		"complete: a part list that is in the wrong order",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		act(
			complete({
				parts: [
					{ partNumber: 2, etag: ETAG },
					{ partNumber: 1, etag: ETAG },
				],
			}),
		),
	),
	named(
		"complete: both parts of a two-part file, but part 1 was never uploaded",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		act(
			complete({
				parts: [
					{ partNumber: 1, etag: ETAG },
					{ partNumber: 2, etag: ETAG },
				],
			}),
		),
	),
	named(
		"complete: the upload row is already discarding",
		open(
			"in_progress",
			{ state: "discarding" },
			{},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(complete()),
	),
	named(
		"complete: the project is no longer at a stage that takes files",
		open(
			"files_under_review",
			{},
			{},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(complete()),
	),
	named(
		"complete: a final upload when the project is at final_files_ready",
		open(
			"final_files_ready",
			{ version: "final" },
			{},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(complete()),
	),
	named(
		"complete: a review upload when the project is at final_files_ready",
		open(
			"final_files_ready",
			{},
			{},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(complete()),
	),
	named(
		"complete: the booking is no longer paid",
		open(
			"in_progress",
			{},
			{
				payment: payment({
					booking_status: "void",
					balance_status: "not_created",
				}),
			},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(complete()),
	),
	named(
		"complete: a file with this id already exists",
		{
			...open("in_progress", {}, { files: [file(U1)] }),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } } },
		},
		act(complete()),
	),
	{
		...named(
			"complete: the upload row changes to discarding before the file insert",
			{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
			act(complete()),
		),
		interleave: [
			{
				on: INSERT_FILE,
				label: "an abort marks the upload discarding",
				run: sql(`UPDATE audio_project_uploads SET state='discarding'`),
			},
		],
	},
	{
		...named(
			"complete: the project changes before the file insert",
			{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
			act(complete()),
		),
		interleave: [
			{
				on: INSERT_FILE,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	},
	named(
		"complete: R2 head fails",
		{ ...open(), r2: { fails: ["head"] } },
		act(complete()),
	),
	named(
		"complete: the file insert fails",
		{
			...open(),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } } },
			failures: [{ on: INSERT_FILE, message: "D1 is down" }],
		},
		act(complete()),
	),
	named(
		"complete: the upload row delete fails",
		{
			...open(),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } } },
			failures: [{ on: DELETE_DONE, message: "D1 is down" }],
		},
		act(complete()),
	),
	// recover
	named(
		"recover: the object is in R2",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		act(finish("recover")),
	),
	named("recover: the object is not in R2", open(), act(finish("recover"))),
	named(
		"recover: the object is the wrong size",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: "short" } } } },
		act(finish("recover")),
	),
	named(
		"recover: the upload row is discarding",
		open(
			"in_progress",
			{ state: "discarding" },
			{},
			{ r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		),
		act(finish("recover")),
	),
	// abort
	named("abort: an open multipart upload", open(), act(finish("abort"))),
	named(
		"abort: the object had already been completed in R2",
		{ ...open(), r2: { seed: { [keyOf(U1)]: { body: BYTES } } } },
		act(finish("abort")),
	),
	named(
		"abort: a file already saved from this upload only drops the row",
		{
			...open("in_progress", {}, { files: [file(U1)] }),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } } },
		},
		act(finish("abort")),
	),
	named(
		"abort: an upload already discarding is finished",
		open("in_progress", { state: "discarding" }),
		act(finish("abort")),
	),
	named(
		"abort: R2 no longer has the upload (the row stays discarding today)",
		{ ...open(), r2: {} },
		act(finish("abort")),
	),
	named(
		"abort: R2 fails to abort",
		{ ...open(), r2: { uploads: { "upload-1": keyOf(U1) }, fails: ["abort"] } },
		act(finish("abort")),
	),
	named(
		"abort: R2 fails to look the object up",
		{ ...open(), r2: { uploads: { "upload-1": keyOf(U1) }, fails: ["head"] } },
		act(finish("abort")),
	),
	named(
		"abort: R2 fails to delete the object",
		{
			...open(),
			r2: { seed: { [keyOf(U1)]: { body: BYTES } }, fails: ["delete"] },
		},
		act(finish("abort")),
	),
	named(
		"abort: the discard write fails",
		{ ...open(), failures: [{ on: DISCARD, message: "D1 is down" }] },
		act(finish("abort")),
	),
	named(
		"abort: the final row delete fails",
		{ ...open(), failures: [{ on: DELETE_ROW, message: "D1 is down" }] },
		act(finish("abort")),
	),
	named(
		"abort: the project is revoked (aborting still works)",
		open(
			"in_progress",
			{},
			{ project: atStage("in_progress", { revoked_at: EARLIER }) },
		),
		act(finish("abort")),
	),
	// PUT
	named("put: a one-part file", open(), put()),
	named("put: part 0 is the wrong size", open(), put(0)),
	named("put: part 2 of a one-part file is the wrong size", open(), put(2)),
	named("put: part '' reads as 0", open(), put("")),
	named("put: part 'abc' is invalid", open(), put("abc")),
	named("put: part 1.5 is invalid", open(), put("1.5")),
	named("put: part -1 is the wrong size", open(), put(-1)),
	named("put: part 1e0 is read as 1", open(), put("1e0")),
	{
		...named(
			"put: no part in the query reads as 0",
			open(),
			put(1, BYTES, { path: `/api/owner/projects/r1/uploads?uploadId=${U1}` }),
		),
	},
	{
		...named(
			"put: no uploadId in the query",
			open(),
			put(1, BYTES, { path: "/api/owner/projects/r1/uploads?part=1" }),
		),
	},
	named(
		"put: an uploadId that is not a UUID",
		open(),
		put(1, BYTES, {}, "nope"),
	),
	{ ...named("put: no body", open(), put(1, null)) },
	named("put: an empty body", open(), put(1, "")),
	named("put: a body shorter than the part", open(), put(1, "abc")),
	named("put: a body longer than the part", open(), put(1, `${BYTES}x`)),
	named(
		"put: a content-length that matches",
		open(),
		put(1, BYTES, {
			headers: {
				"content-type": "application/octet-stream",
				"content-length": "12",
			},
		}),
	),
	named(
		"put: a content-length that differs from the part size",
		open(),
		put(1, BYTES, {
			headers: {
				"content-type": "application/octet-stream",
				"content-length": "999",
			},
		}),
	),
	named(
		"put: another site's Origin is not checked",
		open(),
		put(1, BYTES, {
			headers: {
				origin: "https://example.test",
				"content-type": "application/octet-stream",
			},
		}),
	),
	named(
		"put: no content type is needed",
		open(),
		put(1, BYTES, { headers: {} }),
	),
	named("put: an unknown upload", open(), put(1, BYTES, {}, U2)),
	named(
		"put: another project's upload",
		open(
			"in_progress",
			{ request_id: "r2", object_key: keyOf(U1, "mp3", "r2") },
			{
				moreRequests: [
					rows.ownerRequest("r2", {
						service_id: "vocal-mix",
						status: "reviewed",
						email: "ada@example.test",
					}),
				],
			},
		),
		put(),
	),
	named(
		"put: the project is not at a stage that takes files",
		open("files_under_review"),
		put(),
	),
	named(
		"put: a final upload at final_files_ready",
		open("final_files_ready", { version: "final" }),
		put(),
	),
	named(
		"put: a review upload at final_files_ready",
		open("final_files_ready"),
		put(),
	),
	named(
		"put: the booking is not paid",
		open(
			"in_progress",
			{},
			{
				payment: payment({
					booking_status: "open",
					balance_status: "not_created",
				}),
			},
		),
		put(),
	),
	named(
		"put: access revoked",
		open(
			"in_progress",
			{},
			{ project: atStage("in_progress", { revoked_at: EARLIER }) },
		),
		put(),
	),
	named(
		"put: the upload is discarding",
		open("in_progress", { state: "discarding" }),
		put(),
	),
	named(
		"put: R2 no longer has the multipart upload",
		{ ...open(), r2: {} },
		put(),
	),
	named(
		"put: R2 fails to take the part",
		{
			...open(),
			r2: { uploads: { "upload-1": keyOf(U1) }, fails: ["uploadPart"] },
		},
		put(),
	),
	named(
		"put: the upload read fails",
		{ ...open(), failures: [{ on: SELECT_UPLOAD, message: "D1 is down" }] },
		put(),
	),
	named(
		"put: the readiness check fails",
		{ ...open(), failures: [{ on: CAN_UPLOAD, message: "D1 is down" }] },
		put(),
	),
	named(
		"put: the last part of a file of 10 MiB and 3 bytes",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		put(2, "xyz"),
	),
	named(
		"put: the first part of that file is too short",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		put(1, BYTES),
	),
	named(
		"put: part 3 of that file does not exist",
		open("in_progress", { byte_size: TEN_MIB + 3 }),
		put(3, "xyz"),
	),
	named(
		"put: a part sent twice replaces the first",
		open(),
		put(1, BYTES),
		put(1, BYTES, { advanceMs: 1000 }),
	),
	// sequences
	{
		...named(
			"flow: start, put the part, complete, then publish the file",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(complete({ uploadId: FIRST })),
			{
				...routeStep("files", FIRST)(
					{ action: "publish", note: NOTE, downloadable: true },
					{ dump: { music: UPLOAD_TABLES, r2: true } },
				),
				handler: publishFile,
				advanceMs: 1000,
			},
		),
		omit: ["RESEND_API_KEY"],
		fetches: resendOk,
	},
	{
		...named(
			"flow: start, put, complete, then complete again",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(complete({ uploadId: FIRST })),
			act(complete({ uploadId: FIRST }), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: start, put, complete with a wrong etag",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(
				complete({
					uploadId: FIRST,
					parts: [{ partNumber: 1, etag: "wrong" }],
				}),
				{ advanceMs: 1000 },
			),
		),
	},
	{
		...named(
			"flow: start a final file, put, complete with peaks",
			begin(),
			act(startBody({ version: "final", mediaType: "audio/wav" })),
			put(1, BYTES, {}, FIRST),
			act(complete({ uploadId: FIRST, peaks: peaks(32, 7) }), {
				advanceMs: 1000,
			}),
		),
	},
	{
		...named(
			"flow: start, put, abort, then put again and complete",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(finish("abort", FIRST), { advanceMs: 1000 }),
			put(1, BYTES, { advanceMs: 1000 }, FIRST),
			act(complete({ uploadId: FIRST }), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: start, then abort without any part",
			begin(),
			act(startBody()),
			act(finish("abort", FIRST), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: start, put, complete, then abort the saved upload",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(complete({ uploadId: FIRST })),
			act(finish("abort", FIRST), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: start, put, recover (the object is not yet in R2), then complete",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(finish("recover", FIRST), { advanceMs: 1000 }),
			act(complete({ uploadId: FIRST }), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: two starts open two uploads",
			begin(),
			act(startBody()),
			act(startBody({ displayName: "Mix v2" }), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: a two-part file, the short last part, then a failed complete",
			begin(),
			act(startBody({ byteSize: TEN_MIB + 3 })),
			put(2, "xyz", {}, FIRST),
			act(
				complete({
					uploadId: FIRST,
					parts: [
						{ partNumber: 1, etag: ETAG },
						{ partNumber: 2, etag: "x" },
					],
				}),
				{ advanceMs: 1000 },
			),
			act(finish("abort", FIRST), { advanceMs: 1000 }),
		),
	},
	{
		...named(
			"flow: start, then the booking is voided, then the put is refused",
			begin(),
			act(startBody()),
			put(
				1,
				BYTES,
				{
					advanceMs: 1000,
					before: {
						label: "the booking is voided",
						run: (w) =>
							w.music.exec(`UPDATE audio_payments SET booking_status='void'`),
					},
				},
				FIRST,
			),
		),
	},
	{
		...named(
			"flow: start, then the project completes, then complete is refused",
			begin(),
			act(startBody()),
			put(1, BYTES, {}, FIRST),
			act(complete({ uploadId: FIRST }), {
				advanceMs: 1000,
				before: {
					label: "the project completes",
					run: (w) =>
						w.music.exec(`UPDATE audio_projects SET stage='complete'`),
				},
			}),
		),
	},
	{
		...named(
			"flow: the first start fails, the second works",
			begin(),
			act(startBody()),
			act(startBody(), { advanceMs: 1000 }),
		),
		failures: [{ on: INSERT_UPLOAD, message: "D1 is down" }],
	},
];

defineCorpus("owner-project-uploads", POST, cases);
