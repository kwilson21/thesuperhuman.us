import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/projects/[id]/files/[fileId]";
import {
	asClient,
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	type Case,
	type Step,
} from "./harness";
import {
	atStage,
	EARLIER,
	file,
	FILE_TABLES,
	keyOf,
	NOTE,
	payment,
	published,
	rawStep,
	resendOk,
	routeStep,
	service,
	sql,
	STAGES,
	world,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/files/[fileId]: the owner publishes an uploaded project file to
// the client (with a note, and whether a review mix may be downloaded) or revokes one. Both save a client-timeline
// update (a published file's, always; a revoked file's, only when it had been published) and, after the response,
// `ctx.waitUntil` runs the notice email. Dumps: audio_projects, audio_project_audit, audio_project_files and
// audio_project_updates. The mail key is left out except in the "email" cases, so a notice runs its statements and
// fails without a Resend call (this keeps the fixture under the 1 MiB Biome formats).
//
// Response branches of the handler, and the cases that reach them (case names start with the topic):
//
//   403 {ok:false}                      "not the owner": visitor, signed-in studio client
//   404 "Not found"                     "portal flag": off, "True", unset, flag off wins over no database
//   503 "File publication ..."          "unavailable": no MUSIC_DB, no ctx, no id param, no fileId param; "publish: no
//                                       R2 bucket" (checked only on the publish path; "revoke: no R2 bucket" works)
//   musicRequest (8192 byte cap)        "origin" (403), "content type" (415), "no request body" (400), "body over 8192
//                                       bytes" (413), "invalid JSON" (400)
//   400 "Check the file action ..."     "schema": non-objects, action missing/unknown, publish note missing/blank/over
//                                       1000/not text, downloadable missing/not boolean, revoke note missing/over
//                                       1000/not text
//   revoke 200 {ok:true}                "revoke": an uploaded draft (no note needed, no client notice), a published file
//                                       (note needed, notice queued); the stage matrix: a review or final revoked from
//                                       each of the 7 stages, with and without another published file of the version
//   revoke 409 "cannot be revoked"      "revoke": unknown file, another project's file, already revoked, published with
//                                       a blank note, project access revoked, blank owner email, lost races
//   publish 200 {ok:true,updateId}      "publish": review from the 3 allowed stages, final from the 4 allowed stages (with
//                                       the balance paid), downloadable true/false, a leap-day expiry, a second review
//                                       revoking the first, a second final leaving the first, request new or resolved
//   publish 409 "cannot be published"   "publish": every other stage, balance unpaid, booking unpaid, no payment row,
//                                       a file that is published or revoked, unknown, another project's, a key that does
//                                       not match its id or media type, an R2 object that is missing or the wrong size,
//                                       revoked access, withdrawn request, blank owner email, lost races
//   503 catch                           "outage": the file read, the R2 head, the publish batch, the revoke batch, a
//                                       rolled-back batch (an updates-table trigger that aborts)
//   notice (waitUntil)                  "email": sent, refused, uncertain, no key, and for a revoked file's notice
//   sequences                           "life", "second review", "revoke then publish", "twice"

const BYTES = "abcdefghijkl";
const R2 = { seed: { [keyOf("f1")]: { body: BYTES } } };

const fileStep = routeStep("files", "f1");

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	fileStep(body, { dump: { music: FILE_TABLES }, ...extra });

const publish = (extra: Partial<Step> = {}, downloadable = true): Step =>
	act({ action: "publish", note: NOTE, downloadable }, extra);

const revoke = (note = "I am replacing this mix.", extra: Partial<Step> = {}) =>
	act({ action: "revoke", note }, extra);

/** A project at `stage` with a draft file f1 (review, 12 bytes) in R2, both installments paid, no mail key. */
const draft = (
	stage: string,
	fileOver: { [column: string]: string | number | null } = {},
	parts: Parts = {},
): Partial<Case> => ({
	...world({
		project: atStage(stage),
		...parts,
		files: [file("f1", fileOver), ...(parts.files ?? [])],
	}),
	r2: R2,
	omit: ["RESEND_API_KEY"],
	fetches: resendOk,
});

/** The same, with f1 already published. */
const live = (
	stage: string,
	fileOver: { [column: string]: string | number | null } = {},
	parts: Parts = {},
): Partial<Case> => ({
	...world({
		project: atStage(stage),
		...parts,
		files: [published("f1", fileOver), ...(parts.files ?? [])],
	}),
	r2: R2,
	omit: ["RESEND_API_KEY"],
	fetches: resendOk,
});

const FINAL = { version: "final" };

const pub = (
	name: string,
	stage: string,
	fileOver: { [column: string]: string | number | null } = {},
	parts: Parts = {},
	extra: Partial<Case> = {},
	step: Step = publish(),
): Case => ({
	name: `publish: ${name}`,
	...draft(stage, fileOver, parts),
	steps: [step],
	...extra,
});

const rev = (
	name: string,
	stage: string,
	fileOver: { [column: string]: string | number | null } = {},
	parts: Parts = {},
	extra: Partial<Case> = {},
	step: Step = revoke(),
): Case => ({
	name: `revoke: ${name}`,
	...live(stage, fileOver, parts),
	steps: [step],
	...extra,
});

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...draft("in_progress"),
	env,
	omit,
	steps: [publish()],
});

const schema = (name: string, body: JsonValue | undefined): Case => ({
	name: `schema: ${name}`,
	...draft("in_progress"),
	steps: [act(body)],
});

const long = (n: number) => "a".repeat(n);

const SELECT_FILE =
	/SELECT id,request_id,version,object_key,media_type,byte_size,status/;

const SELECT_REVOKE = /SELECT version,status FROM audio_project_files/;
const PUBLISH = /UPDATE audio_project_files SET status='published'/;

const REVOKE =
	/UPDATE audio_project_files SET status='revoked',revoked_at=\?,revoked_by/;

const race = (
	name: string,
	on: RegExp,
	statement: string,
	base: Partial<Case>,
	step: Step,
): Case => ({
	name: `race: ${name}`,
	...base,
	interleave: [{ on, label: name, run: sql(statement) }],
	steps: [step],
});

const outage = (
	name: string,
	on: RegExp,
	base: Partial<Case>,
	step: Step,
): Case => ({
	name: `outage: ${name}`,
	...base,
	failures: [{ on, message: "D1 is down" }],
	steps: [step],
});

const withMail = (
	base: Partial<Case>,
	fetches: Case["fetches"],
): Partial<Case> => ({
	...base,
	omit: [],
	fetches,
});

// 2028-02-29 12:00 UTC, as a clock move from the frozen 2026-11-13 12:00 UTC.
const LEAP_DAY = Date.UTC(2028, 1, 29, 12) - Date.UTC(2026, 10, 13, 12);

const publishMatrix: Case[] = ["review", "final"].flatMap((version) =>
	STAGES.map((stage) =>
		pub(`a ${version} file from ${stage}`, stage, { version }),
	),
);

const revokeMatrix: Case[] = ["review", "final"].flatMap((version) =>
	STAGES.map((stage) =>
		rev(
			`a published ${version} file at ${stage}`,
			stage,
			version === "final"
				? { version, expires_at: "2027-11-13T11:00:00.000Z" }
				: { version },
		),
	),
);

const cases: Case[] = [
	// 403
	{
		name: "not the owner: a visitor",
		...draft("in_progress"),
		steps: [publish({ as: asVisitor() })],
	},
	{
		name: "not the owner: a signed-in studio client",
		...draft("in_progress", {}, {}),
		omit: [],
		steps: [publish({ as: asClient("grace@example.test") })],
	},
	// 404
	flag("portal flag: off", { AUDIO_CLIENT_PORTAL_ENABLED: "false" }),
	flag("portal flag: 'True' is not 'true'", {
		AUDIO_CLIENT_PORTAL_ENABLED: "True",
	}),
	flag("portal flag: not set", undefined, [
		"AUDIO_CLIENT_PORTAL_ENABLED",
		"RESEND_API_KEY",
	]),
	{
		name: "portal flag: off wins over a missing database",
		music: { missing: true },
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [publish()],
	},
	// 503
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		r2: R2,
		steps: [publish()],
	},
	{
		name: "unavailable: no execution context",
		...draft("in_progress"),
		noContext: true,
		steps: [publish()],
	},
	{
		name: "unavailable: no id param",
		...draft("in_progress"),
		steps: [publish({ params: { fileId: "f1" } })],
	},
	{
		name: "unavailable: no fileId param",
		...draft("in_progress"),
		steps: [publish({ params: { id: "r1" } })],
	},
	{
		name: "unavailable: an empty fileId param",
		...draft("in_progress"),
		steps: [publish({ params: { id: "r1", fileId: "" } })],
	},
	{
		name: "publish: no R2 bucket is unavailable",
		...draft("in_progress"),
		r2: { missing: true },
		steps: [publish()],
	},
	{
		name: "revoke: no R2 bucket is not needed",
		...live("in_progress"),
		r2: { missing: true },
		steps: [revoke()],
	},
	// musicRequest
	{
		name: "origin: missing",
		...draft("in_progress"),
		steps: [publish({ headers: {} })],
	},
	{
		name: "origin: another site",
		...draft("in_progress"),
		steps: [publish({ headers: { origin: "https://example.test" } })],
	},
	{
		name: "origin: the right host over http",
		...draft("in_progress"),
		steps: [publish({ headers: { origin: "http://thesuperhuman.us" } })],
	},
	{
		name: "content type: missing",
		...draft("in_progress"),
		steps: [
			rawStep(
				"files",
				"{}",
				{ headers: { origin: "https://thesuperhuman.us" } },
				"f1",
			),
		],
	},
	{
		name: "content type: text/plain",
		...draft("in_progress"),
		steps: [
			rawStep(
				"files",
				"{}",
				{
					headers: {
						origin: "https://thesuperhuman.us",
						"content-type": "text/plain",
					},
				},
				"f1",
			),
		],
	},
	{
		name: "no request body",
		...draft("in_progress"),
		steps: [{ ...rawStep("files", "", {}, "f1"), body: undefined }],
	},
	{
		name: "body over 8192 bytes",
		...draft("in_progress"),
		steps: [
			rawStep(
				"files",
				JSON.stringify({ action: "revoke", note: long(8200) }),
				{},
				"f1",
			),
		],
	},
	{
		name: "invalid JSON: bad text",
		...draft("in_progress"),
		steps: [rawStep("files", "{nope", {}, "f1")],
	},
	{
		name: "invalid JSON: empty text",
		...draft("in_progress"),
		steps: [rawStep("files", "", {}, "f1")],
	},
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "publish"),
	schema("no action", {}),
	schema("an unknown action", { action: "delete" }),
	schema("action in capitals", {
		action: "PUBLISH",
		note: NOTE,
		downloadable: true,
	}),
	schema("publish with no note", { action: "publish", downloadable: true }),
	schema("publish with a blank note", {
		action: "publish",
		note: "   ",
		downloadable: true,
	}),
	schema("publish with a note over 1000", {
		action: "publish",
		note: long(1001),
		downloadable: true,
	}),
	schema("publish with a note that is not text", {
		action: "publish",
		note: 5,
		downloadable: true,
	}),
	schema("publish with no downloadable", { action: "publish", note: NOTE }),
	schema("publish with downloadable as text", {
		action: "publish",
		note: NOTE,
		downloadable: "yes",
	}),
	schema("publish with downloadable null", {
		action: "publish",
		note: NOTE,
		downloadable: null,
	}),
	schema("revoke with no note key", { action: "revoke" }),
	schema("revoke with a note over 1000", {
		action: "revoke",
		note: long(1001),
	}),
	schema("revoke with a note that is not text", { action: "revoke", note: 5 }),
	schema("revoke with a note of 1000 padded with spaces is allowed", {
		action: "revoke",
		note: ` ${long(1000)} `,
	}),
	// publish: the matrix of stage by version
	...publishMatrix,
	pub("a final file with the balance unpaid", "final_files_ready", FINAL, {
		payment: payment({ balance_status: "open" }),
	}),
	pub(
		"a review file with the balance unpaid still publishes",
		"in_progress",
		{},
		{ payment: payment({ balance_status: "open" }) },
	),
	pub(
		"a file with the booking unpaid",
		"in_progress",
		{},
		{
			payment: payment({
				booking_status: "open",
				balance_status: "not_created",
			}),
		},
	),
	pub("a file with no payment row", "in_progress", {}, { payment: null }),
	pub(
		"a file when access was revoked",
		"in_progress",
		{},
		{ project: atStage("in_progress", { revoked_at: EARLIER }) },
	),
	pub(
		"a file when the request is withdrawn",
		"in_progress",
		{},
		{ request: service({ status: "withdrawn" }) },
	),
	pub(
		"a file when the request is resolved",
		"in_progress",
		{},
		{ request: service({ status: "resolved" }) },
	),
	pub(
		"a file when the request is new",
		"in_progress",
		{},
		{ request: service({ status: "new" }) },
	),
	// publish: the file
	pub(
		"a review with downloads allowed",
		"in_progress",
		{},
		{},
		{},
		publish({}, true),
	),
	pub(
		"a review with downloads not allowed",
		"in_progress",
		{},
		{},
		{},
		publish({}, false),
	),
	pub(
		"a final with downloads not allowed is still downloadable",
		"in_progress",
		FINAL,
		{},
		{},
		publish({}, false),
	),
	pub(
		"a final published on the leap day gets an expiry on 1 March",
		"in_progress",
		FINAL,
		{},
		{},
		publish({ advanceMs: LEAP_DAY }),
	),
	pub(
		"a wav file",
		"in_progress",
		{ media_type: "audio/wav", object_key: keyOf("f1", "wav") },
		{},
		{ r2: { seed: { [keyOf("f1", "wav")]: { body: BYTES } } } },
	),
	pub("an already published file", "in_progress", {
		status: "published",
		published_at: EARLIER,
		publication_id: "pub-f1",
	}),
	pub("a revoked file", "in_progress", {
		status: "revoked",
		revoked_at: EARLIER,
	}),
	pub(
		"an unknown file id",
		"in_progress",
		{},
		{},
		{},
		publish({
			params: { id: "r1", fileId: "nope" },
			path: "/api/owner/projects/r1/files/nope",
		}),
	),
	pub(
		"a file that belongs to another project",
		"in_progress",
		{ request_id: "r2", object_key: keyOf("f1", "mp3", "r2") },
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
	pub(
		"a file whose key does not match its id",
		"in_progress",
		{ object_key: keyOf("other") },
		{},
		{ r2: { seed: { [keyOf("other")]: { body: BYTES } } } },
	),
	pub(
		"a file whose key has the wrong extension for its media type",
		"in_progress",
		{ object_key: keyOf("f1", "wav") },
		{},
		{ r2: { seed: { [keyOf("f1", "wav")]: { body: BYTES } } } },
	),
	pub("a file whose R2 object is missing", "in_progress", {}, {}, { r2: {} }),
	pub(
		"a file whose R2 object has the wrong size",
		"in_progress",
		{},
		{},
		{ r2: { seed: { [keyOf("f1")]: { body: "short" } } } },
	),
	pub("a file whose recorded size is not the object's", "in_progress", {
		byte_size: 13,
	}),
	pub(
		"a blank owner email cannot publish",
		"in_progress",
		{},
		{},
		{},
		publish({ as: asOwner("   ") }),
	),
	pub(
		"note: unicode, markup and quotes are stored as typed",
		"in_progress",
		{},
		{},
		{},
		act({
			action: "publish",
			note: `Mix <b>ready</b> & "done" 'ok' café \u{1F3B5}`,
			downloadable: true,
		}),
	),
	pub(
		"note: padding is trimmed",
		"in_progress",
		{},
		{},
		{},
		act({ action: "publish", note: "  trimmed  ", downloadable: true }),
	),
	pub(
		"note: exactly 1000 characters",
		"in_progress",
		{},
		{},
		{},
		act({ action: "publish", note: long(1000), downloadable: true }),
	),
	pub(
		"a second review replaces the first",
		"review_ready",
		{ id: "f2", object_key: keyOf("f2") },
		{ files: [published("f1")] },
		{ r2: { seed: { [keyOf("f2")]: { body: BYTES } } } },
		act(
			{ action: "publish", note: NOTE, downloadable: false },
			{
				params: { id: "r1", fileId: "f2" },
				path: "/api/owner/projects/r1/files/f2",
			},
		),
	),
	pub(
		"a second final leaves the first published",
		"final_files_ready",
		{ id: "f2", version: "final", object_key: keyOf("f2") },
		{
			files: [
				published("f1", {
					version: "final",
					expires_at: "2027-11-13T11:00:00.000Z",
				}),
			],
		},
		{ r2: { seed: { [keyOf("f2")]: { body: BYTES } } } },
		act(
			{ action: "publish", note: NOTE, downloadable: false },
			{
				params: { id: "r1", fileId: "f2" },
				path: "/api/owner/projects/r1/files/f2",
			},
		),
	),
	// publish: races
	race(
		"publish after the file is revoked",
		PUBLISH,
		`UPDATE audio_project_files SET status='revoked'`,
		draft("in_progress"),
		publish(),
	),
	race(
		"publish after access is revoked",
		PUBLISH,
		`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
		draft("in_progress"),
		publish(),
	),
	race(
		"publish after the request is withdrawn",
		PUBLISH,
		`UPDATE owner_requests SET status='withdrawn'`,
		draft("in_progress"),
		publish(),
	),
	race(
		"publish after the booking is voided",
		PUBLISH,
		`UPDATE audio_payments SET booking_status='void'`,
		draft("in_progress"),
		publish(),
	),
	race(
		"publish after the project completes",
		PUBLISH,
		`UPDATE audio_projects SET stage='complete'`,
		draft("in_progress"),
		publish(),
	),
	race(
		"publish after the balance is voided (final)",
		PUBLISH,
		`UPDATE audio_payments SET balance_status='void'`,
		draft("in_progress", FINAL),
		publish(),
	),
	// publish: outages
	outage("the file read fails", SELECT_FILE, draft("in_progress"), publish()),
	outage("the publish batch fails", PUBLISH, draft("in_progress"), publish()),
	{
		name: "outage: the R2 head fails",
		...draft("in_progress"),
		r2: { ...R2, fails: ["head"] },
		steps: [publish()],
	},
	{
		name: "rolled back: an updates trigger aborts the publish batch",
		...draft(
			"in_progress",
			{},
			{
				setup: (w) =>
					w.music.exec(
						`CREATE TRIGGER golden_updates_locked BEFORE INSERT ON audio_project_updates BEGIN SELECT RAISE(ABORT,'updates locked'); END`,
					),
			},
		),
		steps: [publish()],
	},
	// publish: the notice email
	{
		name: "email: a published file is announced",
		...withMail(draft("in_progress"), resendOk),
		steps: [publish()],
	},
	{
		name: "email: Resend refuses",
		...withMail(
			draft("in_progress"),
			byHost({ resend: json(422, { message: "bad" }) }),
		),
		steps: [publish()],
	},
	{
		name: "email: the send is uncertain",
		...withMail(draft("in_progress"), byHost({ resend: networkDown() })),
		steps: [publish()],
	},
	{
		name: "email: the claim fails",
		...withMail(draft("in_progress"), resendOk),
		failures: [
			{
				on: /UPDATE audio_project_updates SET notification_status='sending'/,
				message: "D1 is down",
			},
		],
		steps: [publish()],
	},
	// revoke
	rev("a published file with a note", "in_progress"),
	rev(
		"a published file with a blank note",
		"in_progress",
		{},
		{},
		{},
		revoke(""),
	),
	rev(
		"a published file with a whitespace note",
		"in_progress",
		{},
		{},
		{},
		revoke("   "),
	),
	rev(
		"a published file with a 1000 character note",
		"in_progress",
		{},
		{},
		{},
		revoke(long(1000)),
	),
	rev(
		"a published file with markup and unicode in the note",
		"in_progress",
		{},
		{},
		{},
		revoke(`Redo <i>soon</i> & "thanks" café \u{1F3B5}`),
	),
	{
		name: "revoke: an uploaded draft needs no note",
		...draft("in_progress"),
		steps: [revoke("")],
	},
	{
		name: "revoke: an uploaded draft with a note ignores it",
		...draft("in_progress"),
		steps: [revoke("not sent to anyone")],
	},
	rev("an already revoked file", "in_progress", {
		status: "revoked",
		revoked_at: EARLIER,
		revoked_by: "owner@example.test",
		revocation_id: "rev-old",
	}),
	rev(
		"an unknown file id",
		"in_progress",
		{},
		{},
		{},
		revoke("x", {
			params: { id: "r1", fileId: "nope" },
			path: "/api/owner/projects/r1/files/nope",
		}),
	),
	rev(
		"a file that belongs to another project",
		"in_progress",
		{ request_id: "r2", object_key: keyOf("f1", "mp3", "r2") },
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
	rev(
		"a file when project access is revoked",
		"in_progress",
		{},
		{ project: atStage("in_progress", { revoked_at: EARLIER }) },
	),
	rev(
		"a file when the request is withdrawn still revokes",
		"in_progress",
		{},
		{ request: service({ status: "withdrawn" }) },
	),
	rev(
		"a blank owner email cannot revoke",
		"in_progress",
		{},
		{},
		{},
		revoke("x", { as: asOwner("   ") }),
	),
	rev(
		"a file with no payment still revokes",
		"in_progress",
		{},
		{ payment: null },
	),
	rev(
		"the other published review keeps the stage at review_ready",
		"review_ready",
		{},
		{ files: [published("f2", { object_key: keyOf("f2") })] },
	),
	rev(
		"the other published final keeps a completed project complete",
		"complete",
		{ version: "final", expires_at: "2027-11-13T11:00:00.000Z" },
		{
			files: [
				published("f2", {
					version: "final",
					object_key: keyOf("f2"),
					expires_at: "2027-11-13T11:00:00.000Z",
				}),
			],
		},
	),
	...revokeMatrix,
	// revoke: races and outages
	race(
		"revoke after another change revoked the file",
		REVOKE,
		`UPDATE audio_project_files SET status='revoked'`,
		live("in_progress"),
		revoke(),
	),
	race(
		"revoke after the draft was published",
		REVOKE,
		`UPDATE audio_project_files SET status='published',published_at='2026-11-13T11:30:00.000Z'`,
		draft("in_progress"),
		revoke(""),
	),
	race(
		"revoke after access is revoked",
		REVOKE,
		`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
		live("in_progress"),
		revoke(),
	),
	outage("the revoke read fails", SELECT_REVOKE, live("in_progress"), revoke()),
	outage("the revoke batch fails", REVOKE, live("in_progress"), revoke()),
	{
		name: "rolled back: an updates trigger aborts the revoke batch",
		...live(
			"in_progress",
			{},
			{
				setup: (w) =>
					w.music.exec(
						`CREATE TRIGGER golden_updates_locked BEFORE INSERT ON audio_project_updates BEGIN SELECT RAISE(ABORT,'updates locked'); END`,
					),
			},
		),
		steps: [revoke()],
	},
	{
		name: "email: a revoked file is announced",
		...withMail(live("in_progress"), resendOk),
		steps: [revoke()],
	},
	{
		name: "email: a revoked file's notice is refused",
		...withMail(
			live("in_progress"),
			byHost({ resend: json(429, { message: "slow" }) }),
		),
		steps: [revoke()],
	},
	{
		name: "email: a revoked draft sends no notice",
		...withMail(draft("in_progress"), resendOk),
		steps: [revoke("")],
	},
	// sequences
	{
		name: "twice: publish, then the same publish again",
		...draft("in_progress"),
		steps: [publish(), publish({ advanceMs: 1000 })],
	},
	{
		name: "revoke then publish: a revoked file cannot be published again",
		...draft("in_progress"),
		steps: [
			publish(),
			revoke("Wrong take.", { advanceMs: 1000 }),
			publish({ advanceMs: 1000 }),
		],
	},
	{
		name: "twice: revoke a published file, then revoke it again",
		...live("in_progress"),
		steps: [revoke(), revoke("again", { advanceMs: 1000 })],
	},
	{
		name: "life: publish a review, publish a second that replaces it, revoke the second, publish a final",
		...world({
			project: atStage("in_progress"),
			files: [
				file("f1"),
				file("f2", { object_key: keyOf("f2") }),
				file("f3", { version: "final", object_key: keyOf("f3") }),
			],
		}),
		r2: {
			seed: {
				[keyOf("f1")]: { body: BYTES },
				[keyOf("f2")]: { body: BYTES },
				[keyOf("f3")]: { body: BYTES },
			},
		},
		omit: ["RESEND_API_KEY"],
		fetches: resendOk,
		steps: [
			publish(),
			act(
				{ action: "publish", note: "A second take.", downloadable: false },
				{
					advanceMs: 1000,
					params: { id: "r1", fileId: "f2" },
					path: "/api/owner/projects/r1/files/f2",
				},
			),
			act(
				{ action: "revoke", note: "Take two is withdrawn." },
				{
					advanceMs: 1000,
					params: { id: "r1", fileId: "f2" },
					path: "/api/owner/projects/r1/files/f2",
				},
			),
			act(
				{ action: "publish", note: "Final mix.", downloadable: true },
				{
					advanceMs: 1000,
					params: { id: "r1", fileId: "f3" },
					path: "/api/owner/projects/r1/files/f3",
				},
			),
			publish({ advanceMs: 1000 }),
		],
	},
	{
		name: "a final is published after the balance is paid late",
		...draft("in_progress", FINAL, {
			payment: payment({ balance_status: "open" }),
		}),
		steps: [
			publish(),
			publish({
				advanceMs: 1000,
				before: {
					label: "the balance is paid",
					run: (w) =>
						w.music.exec(
							`UPDATE audio_payments SET balance_status='paid' WHERE request_id='r1'`,
						),
				},
			}),
		],
	},
	{
		name: "outage then repeat: the first publish batch fails, the second publishes",
		...draft("in_progress"),
		failures: [{ on: PUBLISH, message: "D1 is down" }],
		steps: [publish(), publish({ advanceMs: 1000 })],
	},
];

defineCorpus("owner-project-file", POST, cases);
