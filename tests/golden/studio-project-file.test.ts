import { GET, HEAD } from "~/pages/api/studio/projects/[id]/files/[fileId]";
import { POST as signOut } from "~/pages/api/studio/sign-out";
import {
	asClient,
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	audioClient,
	audioFile,
	audioPayment,
	FILE_BODY,
	FILE_SIZE,
	GRACE,
	mergeSeeds,
	OTHER,
	sessionRow,
	sql,
	stageSql,
	T1,
	T2,
	T3,
	T4,
} from "./areas/studio-access";

// The golden corpus for GET and HEAD /api/studio/projects/[id]/files/[fileId]: a signed-in client streams or downloads
// a published file of their own project. It decides who can hear private client work, so each reason to refuse is a case
// on its own, from a base where everything is right (a review file at stage review_ready, booking paid, a live session).
//
// Every response branch of the handler, clientProjectFile and fileAvailable, streamClientProjectFile,
// recordProjectFileAccess (src/lib/audio-project-files.ts), mediaRange (src/lib/music-media.ts), and its cases:
//
//   404 text "File not found" + private, no-store  (the same answer for every refusal, so a client learns nothing)
//     portal flag unset, "false", "TRUE" (read first, before the bindings)
//     no cookie, a cookie that is not 72 hex characters, an unknown token, an upper-case token, a missing or empty id param
//     session: expired (at the instant, past), revoked, another client's, no session row for the email
//     project: another client's project, a project that does not exist, revoked, request withdrawn, contact email erased
//       (the request's email is empty), request email changed
//     file: unknown id, a file of another project, upper-case ids, a SQL-looking id, status uploaded or revoked, revoked_at
//       set, published_at empty or after now, expired (at the instant), object_key not the key built from the ids, media type
//       not matching the key
//     stage and payment: a review file at files_under_review, accepted, in_progress, final_files_ready, complete; booking
//       not paid (open, payment_failed, not_created), no payment row; a final file at review_ready, with no expiry, with
//       the balance unpaid, in a stage that is not final, older than one year from publication (at the instant too)
//     download=1 on a file that is not downloadable
//     R2: the object is missing (404 "File unavailable")
//   503 text "Private audio is temporarily unavailable" + private, no-store
//     no MUSIC_DB, no AUDIO bucket (answered before the cookie is looked at), the file query failing, R2 head or get
//     failing, the access insert failing after the response was built, size in R2 not the size in the row ("File
//     unavailable")
//   200 full body                  review and final, mp3 and wav, inline and attachment (project-review.mp3, project-final.wav)
//   206 partial body               first, middle, open-ended, suffix, one byte, the last byte, an end past the size, a suffix
//                                  longer than the file
//   416 with content-range */size  start at the size, start after end, a zero suffix, "items=", two ranges, no start and no
//                                  end, wrong case, a space, letters
//   HEAD                           headers only, content-length of the whole file, Range ignored, no access recorded
//   access record                  GET 200 and 206 write a stream or download row; the second read moves last_at; HEAD, 416
//                                  and every refusal write nothing
//   sequences                      real sign-in, sign-out then read, two sessions of one client, another client's session,
//                                  a second file in the same project

const BASE = "/api/studio/projects/r1/files/f1";
const KEY = "studio/projects/r1/f1.mp3";
const WAV = "studio/projects/r1/f1.wav";
const FINAL_EXPIRY = "2026-12-13T12:00:00.000Z";

const get = (extra: Partial<Step> = {}): Step => ({
	as: asClientCookie(T1.value),
	method: "GET",
	path: BASE,
	params: { id: "r1", fileId: "f1" },
	dump: { music: ["audio_project_file_access"] },
	...extra,
});

const at = (id: string, fileId: string, extra: Partial<Step> = {}) =>
	get({
		path: `/api/studio/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
		params: { id, fileId },
		...extra,
	});

type Scene = {
	readonly stage?: string;
	readonly payment?: SeedRow | null;
	readonly file?: SeedRow;
	readonly request?: SeedRow;
	readonly email?: string;
	readonly sessions?: SeedRow[];
	readonly sql?: string[];
	readonly r2?: { [key: string]: { body: string } };
	readonly more?: SeedRow[];
	readonly extra?: Seed;
};

const scene = (o: Scene = {}): Partial<Case> => ({
	music: {
		seed: mergeSeeds(
			audioClient("r1", o.email ?? GRACE, o.request),
			{
				audio_payments:
					o.payment === null ? [] : [audioPayment("r1", o.payment)],
				audio_project_files: [audioFile("f1", "r1", o.file), ...(o.more ?? [])],
				audio_client_sessions: o.sessions ?? [sessionRow(T1, GRACE)],
			},
			o.extra ?? {},
		),
	},
	setup: sql(stageSql(o.stage ?? "review_ready"), ...(o.sql ?? [])),
	r2: { seed: o.r2 ?? { [KEY]: { body: FILE_BODY } } },
});

const open = (
	name: string,
	o: Scene = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(o),
	steps: [get()],
	...extra,
});

const withStep = (
	name: string,
	step: Partial<Step>,
	o: Scene = {},
	extra: Partial<Case> = {},
): Case => open(name, o, { steps: [get(step)], ...extra });

const ranged = (range: string, extra: Partial<Step> = {}) =>
	get({ headers: { range }, ...extra });

const finalFile: SeedRow = {
	version: "final",
	expires_at: FINAL_EXPIRY,
};

const finalScene = (o: Scene = {}): Scene => ({
	stage: "final_files_ready",
	payment: { balance_status: "paid" },
	...o,
	file: { ...finalFile, ...o.file },
});

const cases: Case[] = [
	// gates
	open("portal flag unset", {}, { omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] }),
	open(
		"portal flag false",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } },
	),
	open(
		"portal flag TRUE in capitals",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" } },
	),
	open(
		"portal flag off wins over missing bindings",
		{},
		{
			omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
			music: { missing: true },
			r2: { missing: true },
		},
	),
	open("no database binding", {}, { music: { missing: true } }),
	open("no audio bucket", {}, { r2: { missing: true } }),
	open(
		"no bindings and no cookie: still 503",
		{},
		{
			music: { missing: true },
			steps: [get({ as: asVisitor() })],
		},
	),
	// who is asking
	withStep("no cookie", { as: asVisitor() }),
	withStep("a cookie that is not a session token", {
		as: asVisitor(),
		headers: { cookie: "studio_session=abc" },
	}),
	withStep("an unknown token of the right shape", {
		as: asClientCookie(T2.value),
	}),
	withStep(
		"an upper-case token",
		{ as: asClientCookie(T4.value.toUpperCase()) },
		{ sessions: [sessionRow(T4, GRACE)] },
	),
	withStep(
		"the cookie among others",
		{ as: asVisitor(), headers: { cookie: `a=b; studio_session=${T1.value}` } },
		{},
	),
	withStep("the owner without a cookie", { as: asOwner() }),
	withStep(
		"an expired session",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T11:59:59.000Z" }),
			],
		},
	),
	withStep(
		"a session that expires at this instant",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T12:00:00.000Z" }),
			],
		},
	),
	withStep(
		"a session that expires one millisecond from now",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T12:00:00.001Z" }),
			],
		},
	),
	withStep(
		"a revoked session",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { revoked_at: "2026-11-13T11:30:00.000Z" }),
			],
		},
	),
	withStep(
		"another client's session",
		{ as: asClientCookie(T2.value) },
		{ sessions: [sessionRow(T1, GRACE), sessionRow(T2, OTHER)] },
	),
	withStep(
		"a session for an email with no request",
		{ as: asClientCookie(T2.value) },
		{ sessions: [sessionRow(T2, "nobody@example.test")] },
	),
	// ids
	withStep("no id param", { params: { fileId: "f1" } }),
	withStep("no file id param", { params: { id: "r1" } }),
	withStep("empty id params", { params: { id: "", fileId: "" } }),
	withStep("an unknown project id", at("r9", "f1")),
	withStep("an unknown file id", at("r1", "f9")),
	withStep("ids in capitals", at("R1", "F1")),
	withStep("an id that looks like SQL", at("r1' OR '1'='1", "f1")),
	withStep("a file of another of this client's projects", at("r1", "f2"), {
		extra: audioClient("r2", GRACE),
		more: [audioFile("f2", "r2", { object_key: "studio/projects/r2/f2.mp3" })],
	}),
	// the project
	open("the project is revoked", {
		sql: [
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
		],
	}),
	open("the request is withdrawn", {
		sql: ["UPDATE owner_requests SET status='withdrawn'"],
	}),
	open("the request is resolved after acceptance", {
		sql: ["UPDATE owner_requests SET status='resolved'"],
	}),
	open("the contact email is erased", {
		sql: ["UPDATE owner_requests SET email=''"],
	}),
	open("the request's email is changed", {
		sql: ["UPDATE owner_requests SET email='someone@example.test'"],
	}),
	open("the project has content deleted but is not revoked", {
		sql: [
			"UPDATE audio_projects SET content_deleted_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
		],
	}),
	// the file
	open("a file that is only uploaded", {
		file: { status: "uploaded", published_at: null },
	}),
	open("a file that is revoked", {
		file: { status: "revoked", revoked_at: "2026-11-13T11:30:00.000Z" },
	}),
	open("a published file with revoked_at set", {
		file: { revoked_at: "2026-11-13T11:30:00.000Z" },
	}),
	open("a published file with no publication time", {
		file: { published_at: null },
	}),
	open("a file published after now", {
		file: { published_at: "2026-11-13T12:00:00.001Z" },
	}),
	open("a file published at this instant", {
		file: { published_at: "2026-11-13T12:00:00.000Z" },
	}),
	open("a file that expires at this instant", {
		file: { expires_at: "2026-11-13T12:00:00.000Z" },
	}),
	open("a file that expires one millisecond from now", {
		file: { expires_at: "2026-11-13T12:00:00.001Z" },
	}),
	open("a file whose object key is not the key built from its ids", {
		file: { object_key: "studio/projects/r2/f1.mp3" },
		r2: { "studio/projects/r2/f1.mp3": { body: FILE_BODY } },
	}),
	open("a wav file whose key says mp3", {
		file: { media_type: "audio/wav" },
	}),
	open("a wav file", {
		file: { media_type: "audio/wav", object_key: WAV },
		r2: { [WAV]: { body: FILE_BODY } },
	}),
	// stage and payment
	open("a review file at files_under_review", { stage: "files_under_review" }),
	open("a review file at accepted", { stage: "accepted" }),
	open("a review file at in_progress", { stage: "in_progress" }),
	open("a review file at revision_in_progress", {
		stage: "revision_in_progress",
	}),
	open("a review file at final_files_ready", { stage: "final_files_ready" }),
	open("a review file at complete", { stage: "complete" }),
	open("a review file with the booking open", {
		payment: { booking_status: "open" },
	}),
	open("a review file with the booking failed", {
		payment: { booking_status: "payment_failed" },
	}),
	open("a review file with the booking not created", {
		payment: { booking_status: "not_created" },
	}),
	open("a review file with no payment row", { payment: null }),
	// final files
	open("a final file at final_files_ready", finalScene()),
	open("a final file at complete", finalScene({ stage: "complete" })),
	open("a final file at review_ready", finalScene({ stage: "review_ready" })),
	open(
		"a final file with no expiry",
		finalScene({ file: { expires_at: null } }),
	),
	open(
		"a final file with the balance open",
		finalScene({ payment: { balance_status: "open" } }),
	),
	open(
		"a final file with the booking unpaid",
		finalScene({ payment: { booking_status: "open", balance_status: "paid" } }),
	),
	open(
		"a final file published a year and a day ago",
		finalScene({ file: { published_at: "2025-11-12T12:00:00.000Z" } }),
	),
	open(
		"a final file published exactly a year ago",
		finalScene({ file: { published_at: "2025-11-13T12:00:00.000Z" } }),
	),
	open(
		"a final file published a year less a millisecond ago",
		finalScene({ file: { published_at: "2025-11-13T12:00:00.001Z" } }),
	),
	// download
	withStep("download of a file that is not downloadable", {
		path: `${BASE}?download=1`,
	}),
	withStep(
		"download of a downloadable review file",
		{ path: `${BASE}?download=1` },
		{ file: { downloadable: 1 } },
	),
	withStep(
		"download of a downloadable final wav",
		{ path: `${BASE}?download=1` },
		finalScene({
			file: { downloadable: 1, media_type: "audio/wav", object_key: WAV },
			r2: { [WAV]: { body: FILE_BODY } },
		}),
	),
	withStep(
		"download=0 is a stream",
		{ path: `${BASE}?download=0` },
		{ file: { downloadable: 1 } },
	),
	withStep(
		"download=true is a stream",
		{ path: `${BASE}?download=true` },
		{ file: { downloadable: 1 } },
	),
	withStep(
		"download=1 twice, then 0: the first counts",
		{ path: `${BASE}?download=1&download=0` },
		{ file: { downloadable: 1 } },
	),
	withStep(
		"a download range",
		{ path: `${BASE}?download=1`, headers: { range: "bytes=0-9" } },
		{ file: { downloadable: 1 } },
	),
	// the stream
	open("a whole file"),
	open("a file of one byte more than its row says", {
		file: { byte_size: FILE_SIZE + 1 },
	}),
	open("a file of one byte less than its row says", {
		file: { byte_size: FILE_SIZE - 1 },
	}),
	open("the object is missing from R2", { r2: {} }),
	open("the first bytes", {}, { steps: [ranged("bytes=0-15")] }),
	open("a middle range", {}, { steps: [ranged("bytes=16-31")] }),
	open("an open-ended range", {}, { steps: [ranged("bytes=48-")] }),
	open("a suffix range", {}, { steps: [ranged("bytes=-8")] }),
	open("one byte", {}, { steps: [ranged("bytes=0-0")] }),
	open("the last byte", {}, { steps: [ranged("bytes=63-63")] }),
	open("an end past the size", {}, { steps: [ranged("bytes=0-1000")] }),
	open("a suffix longer than the file", {}, { steps: [ranged("bytes=-100")] }),
	open("the whole file as a range", {}, { steps: [ranged("bytes=0-")] }),
	open("a start at the size", {}, { steps: [ranged("bytes=64-")] }),
	open("a start after the end", {}, { steps: [ranged("bytes=10-5")] }),
	open("a zero suffix", {}, { steps: [ranged("bytes=-0")] }),
	open("a range with no start and no end", {}, { steps: [ranged("bytes=-")] }),
	open("another unit", {}, { steps: [ranged("items=0-5")] }),
	open("two ranges", {}, { steps: [ranged("bytes=0-5,10-15")] }),
	open("a range in capitals", {}, { steps: [ranged("BYTES=0-5")] }),
	open("a range with a space", {}, { steps: [ranged(" bytes=0-5")] }),
	open("a range of letters", {}, { steps: [ranged("bytes=a-b")] }),
	open("an empty range header", {}, { steps: [ranged("")] }),
	// HEAD
	open("HEAD", {}, { steps: [get({ method: "HEAD" })] }),
	open(
		"HEAD with a Range header ignores it",
		{},
		{ steps: [ranged("bytes=0-9", { method: "HEAD" })] },
	),
	open(
		"HEAD of a download",
		{ file: { downloadable: 1 } },
		{ steps: [get({ method: "HEAD", path: `${BASE}?download=1` })] },
	),
	open(
		"the HEAD export is served by the same function",
		{},
		{ steps: [get({ method: "HEAD", handler: HEAD })] },
	),
	open(
		"HEAD with the object missing",
		{ r2: {} },
		{
			steps: [get({ method: "HEAD" })],
		},
	),
	open(
		"HEAD with the wrong size",
		{ file: { byte_size: 1 } },
		{
			steps: [get({ method: "HEAD" })],
		},
	),
	open(
		"HEAD with no cookie",
		{},
		{
			steps: [get({ method: "HEAD", as: asVisitor() })],
		},
	),
	// access records
	open(
		"two reads: the second moves last_at",
		{},
		{
			steps: [get(), get({ advanceMs: 90_000 })],
		},
	),
	open(
		"a stream and a download are two rows",
		{ file: { downloadable: 1 } },
		{
			steps: [get(), get({ path: `${BASE}?download=1`, advanceMs: 1000 })],
		},
	),
	open(
		"a range request records a stream",
		{},
		{
			steps: [ranged("bytes=0-9"), ranged("bytes=10-19", { advanceMs: 1000 })],
		},
	),
	open(
		"a refused range records nothing",
		{},
		{
			steps: [ranged("bytes=64-"), get({ method: "HEAD" })],
		},
	),
	open(
		"a read after the session expired is refused and records nothing more",
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T12:00:30.000Z" }),
			],
		},
		{
			steps: [get(), get({ advanceMs: 31_000 })],
		},
	),
	open(
		"two sessions of one client write two rows",
		{
			sessions: [sessionRow(T1, GRACE), sessionRow(T3, GRACE)],
		},
		{
			steps: [get(), get({ as: asClientCookie(T3.value), advanceMs: 1000 })],
		},
	),
	// outages
	open(
		"the file query fails",
		{},
		{
			failures: [{ on: /FROM audio_project_files f/, message: "d1 down" }],
		},
	),
	open(
		"the access insert fails after the response was built",
		{},
		{
			failures: [
				{ on: /INSERT INTO audio_project_file_access/, message: "d1 down" },
			],
		},
	),
	open(
		"R2 head fails",
		{},
		{ r2: { seed: { [KEY]: { body: FILE_BODY } }, fails: ["head"] } },
	),
	open(
		"R2 get fails",
		{},
		{ r2: { seed: { [KEY]: { body: FILE_BODY } }, fails: ["get"] } },
	),
	open(
		"R2 get fails on a range",
		{},
		{
			r2: { seed: { [KEY]: { body: FILE_BODY } }, fails: ["get"] },
			steps: [ranged("bytes=0-9")],
		},
	),
	open(
		"R2 head fails on HEAD",
		{},
		{
			r2: { seed: { [KEY]: { body: FILE_BODY } }, fails: ["head"] },
			steps: [get({ method: "HEAD" })],
		},
	),
	// races
	open(
		"the session is revoked between the checks and the access record",
		{},
		{
			interleave: [
				{
					on: /INSERT INTO audio_project_file_access/,
					label: "the client signed out",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE audio_client_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
						),
				},
			],
		},
	),
	open(
		"the file is revoked after the response was built",
		{},
		{
			interleave: [
				{
					on: /INSERT INTO audio_project_file_access/,
					label: "the owner revoked the file",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE audio_project_files SET status='revoked',revoked_at='2026-11-13T11:59:59.000Z'",
						),
				},
			],
		},
	),
	// sequences
	open(
		"a client signed in through the real flow reads a file",
		{},
		{
			music: {
				seed: mergeSeeds(audioClient("r1", GRACE), {
					audio_payments: [audioPayment("r1")],
					audio_project_files: [audioFile("f1", "r1")],
				}),
			},
			steps: [get({ as: asClient(GRACE) })],
		},
	),
	open(
		"a real sign-in, a read, a sign-out, a read",
		{},
		{
			music: {
				seed: mergeSeeds(audioClient("r1", GRACE), {
					audio_payments: [audioPayment("r1")],
					audio_project_files: [audioFile("f1", "r1")],
				}),
			},
			steps: [
				get({ as: asClient(GRACE) }),
				get({
					as: asClient(GRACE),
					handler: signOut,
					method: "POST",
					path: "/api/studio/sign-out",
					dump: { music: ["audio_client_sessions"] },
				}),
				get({ as: asClient(GRACE), advanceMs: 1000 }),
			],
		},
	),
	open(
		"another client's real session cannot read this client's file",
		{},
		{
			music: {
				seed: mergeSeeds(audioClient("r1", GRACE), audioClient("r2", OTHER), {
					audio_payments: [audioPayment("r1"), audioPayment("r2")],
					audio_project_files: [audioFile("f1", "r1")],
				}),
			},
			setup: sql(
				stageSql("review_ready", "r1"),
				stageSql("review_ready", "r2"),
			),
			steps: [get({ as: asClient(OTHER) })],
		},
	),
	open(
		"a second file of the project, a final one, is refused at review_ready",
		{
			more: [
				audioFile("f2", "r1", {
					...finalFile,
					object_key: "studio/projects/r1/f2.mp3",
				}),
			],
			r2: {
				[KEY]: { body: FILE_BODY },
				"studio/projects/r1/f2.mp3": { body: FILE_BODY },
			},
		},
		{
			steps: [get(), at("r1", "f2")],
		},
	),
	open(
		"the same file with a project that moves to final",
		{
			file: { version: "final", expires_at: FINAL_EXPIRY },
			payment: { balance_status: "open" },
		},
		{
			steps: [
				get(),
				get({
					advanceMs: 1000,
					before: {
						label: "the balance was paid and the final files are ready",
						run: (world) => {
							world.music.exec(
								"UPDATE audio_payments SET balance_status='paid'; UPDATE audio_projects SET stage='final_files_ready'",
							);
						},
					},
				}),
			],
		},
	),
];

defineCorpus("studio-project-file", GET, cases);
