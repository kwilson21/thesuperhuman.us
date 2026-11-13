import { POST } from "~/pages/api/owner/projects/[id]/updates";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Step,
} from "./harness";
import {
	act,
	at,
	atStage,
	BODIES,
	DUE,
	EARLIER,
	LATER,
	NOTE,
	payment,
	PROJECT_TABLES,
	published,
	rawStep,
	service,
	sql,
	STAGES,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/updates, the stage half: the owner moves an audio project
// through its stages (accept, progress note, start work, begin revision, complete, revise the due date). Every change
// saves a client-timeline update and, after the response, `ctx.waitUntil` runs the notice. The notice emails, the
// retry_email action and the notice races are in owner-project-update-notices.test.ts. Here the mail key is left out,
// so the notice runs its statements and fails without a Resend call (a fixture of every case with the full email body
// would pass 1 MiB, the limit Biome formats to).
//
// Response branches of the handler, and the cases that reach them (every case name starts with its topic):
//
//   403 {ok:false}                       "not the owner": visitor, signed-in studio client
//   404 "Not found"                      "portal flag": off, "True", unset, flag off wins over no database
//   503 "Project updates are ..."        "unavailable": no MUSIC_DB, no ctx, no id param, empty id param
//   musicRequest (src/lib/music-request.ts, with the 8192 byte cap)
//     403 Forbidden                      "origin": missing, another site, http scheme
//     415 JSON required                  "content type": missing, text/plain, upper case; a charset suffix is accepted
//     400 Missing request                "no request body"
//     413 Request too large              "body over 8192 bytes"; one of exactly 8192 bytes reaches the schema
//     400 Invalid JSON                   "invalid JSON": bad text, empty text
//   400 "Check the update ..."           "schema": non-object bodies, action missing/unknown/wrong type, every field of
//                                        every action missing, wrong type, over length, malformed date or reason
//   retry_email                          see owner-project-update-notices.test.ts
//   saveProjectUpdate (src/lib/audio-project-updates.ts)
//     200 {ok:true,update}               "<action> from <stage>" matrix (6 actions x 7 stages), "text", "actor", each
//                                        reason, due today, the New York date rollover
//     409 "cannot take that update"      every invalid move in the matrix; unknown project, not a service request,
//                                        revoked project, withdrawn request, request not reviewed (accept, complete),
//                                        payment not paid (start work, begin revision, complete), no published review or
//                                        final file (the batch guard refuses with no race), a due date that is past,
//                                        malformed, not later than the current one, or missing; blank owner email;
//                                        "race": updated_at, stage, payment, file, request or access changed between the
//                                        read and the write
//     503 catch                          "outage" and "rolled back": the state read, each stage batch, the progress
//                                        insert, an audit trigger that aborts the batch
//   sequences                            "twice", "life", "outage then repeat"
//   effects                              every success also runs the notice (claim, recipient, failed mark); every case
//                                        dumps audio_projects, audio_project_audit and audio_project_updates

/** The project, with the mail key left out (see the header). */
const quiet = (stage: string, parts: Parts = {}): Partial<Case> => ({
	...at(stage, parts),
	omit: ["RESEND_API_KEY"],
});

const one = (
	name: string,
	body: Step["json"],
	parts: Parts = {},
	extra: Partial<Case> = {},
	stage = "in_progress",
): Case => ({ name, ...quiet(stage, parts), steps: [act(body)], ...extra });

const ACTIONS = [
	"accept",
	"progress",
	"start_work",
	"begin_revision",
	"complete",
	"revise_date",
] as const;

const matrix: Case[] = STAGES.flatMap((stage) =>
	ACTIONS.map((action) =>
		one(`${action} from ${stage}`, BODIES[action], {}, {}, stage),
	),
);

const schema = (name: string, body: Step["json"]): Case =>
	one(`schema: ${name}`, body);

const long = (n: number) => "a".repeat(n);

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...quiet("in_progress"),
	env,
	omit,
	steps: [act(BODIES.progress)],
});

const STATE = /SELECT p\.stage,p\.current_due_at/;

const race = (
	name: string,
	body: Step["json"],
	stage: string,
	on: RegExp,
	statement: string,
	parts: Parts = {},
): Case =>
	one(
		`race: ${name}`,
		body,
		parts,
		{ interleave: [{ on, label: name, run: sql(statement) }] },
		stage,
	);

const outage = (
	name: string,
	body: Step["json"],
	stage: string,
	on: RegExp,
	parts: Parts = {},
): Case =>
	one(
		`outage: ${name}`,
		body,
		parts,
		{ failures: [{ on, message: "D1 is down" }] },
		stage,
	);

const cases: Case[] = [
	// 403
	{
		name: "not the owner: a visitor",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { as: asVisitor() })],
	},
	{
		name: "not the owner: a signed-in studio client",
		...at("in_progress"),
		steps: [act(BODIES.progress, { as: asClient("grace@example.test") })],
	},
	// 404
	flag("portal flag: off", { AUDIO_CLIENT_PORTAL_ENABLED: "false" }),
	flag("portal flag: 'True' is not 'true'", {
		AUDIO_CLIENT_PORTAL_ENABLED: "True",
	}),
	flag("portal flag: not set", undefined, ["AUDIO_CLIENT_PORTAL_ENABLED"]),
	{
		name: "portal flag: off wins over a missing database",
		music: { missing: true },
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [act(BODIES.progress)],
	},
	// 503
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		steps: [act(BODIES.progress)],
	},
	{
		name: "unavailable: no execution context",
		...quiet("in_progress"),
		noContext: true,
		steps: [act(BODIES.progress)],
	},
	{
		name: "unavailable: no id param",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { params: {} })],
	},
	{
		name: "unavailable: an empty id param",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { params: { id: "" } })],
	},
	// musicRequest
	{
		name: "origin: missing",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { headers: {} })],
	},
	{
		name: "origin: another site",
		...quiet("in_progress"),
		steps: [
			act(BODIES.progress, { headers: { origin: "https://example.test" } }),
		],
	},
	{
		name: "origin: the right host over http",
		...quiet("in_progress"),
		steps: [
			act(BODIES.progress, { headers: { origin: "http://thesuperhuman.us" } }),
		],
	},
	{
		name: "content type: missing",
		...quiet("in_progress"),
		steps: [
			rawStep("updates", JSON.stringify(BODIES.progress), {
				headers: { origin: "https://thesuperhuman.us" },
			}),
		],
	},
	{
		name: "content type: text/plain",
		...quiet("in_progress"),
		steps: [
			rawStep("updates", JSON.stringify(BODIES.progress), {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "text/plain",
				},
			}),
		],
	},
	{
		name: "content type: upper case is refused",
		...quiet("in_progress"),
		steps: [
			rawStep("updates", JSON.stringify(BODIES.progress), {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "Application/JSON",
				},
			}),
		],
	},
	{
		name: "content type: a charset suffix is accepted",
		...quiet("in_progress"),
		steps: [
			rawStep("updates", JSON.stringify(BODIES.progress), {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json; charset=utf-8",
				},
				dump: { music: PROJECT_TABLES },
			}),
		],
	},
	{
		name: "no request body",
		...quiet("in_progress"),
		steps: [{ ...rawStep("updates", ""), body: undefined }],
	},
	{
		name: "body over 8192 bytes",
		...quiet("in_progress"),
		steps: [
			rawStep(
				"updates",
				JSON.stringify({ action: "progress", body: long(8200) }),
			),
		],
	},
	{
		name: "body of exactly 8192 bytes reaches the schema",
		...quiet("in_progress"),
		steps: [
			rawStep(
				"updates",
				JSON.stringify({
					action: "progress",
					body: long(
						8192 - JSON.stringify({ action: "progress", body: "" }).length,
					),
				}),
			),
		],
	},
	{
		name: "invalid JSON: bad text",
		...quiet("in_progress"),
		steps: [rawStep("updates", "{not json")],
	},
	{
		name: "invalid JSON: empty text",
		...quiet("in_progress"),
		steps: [rawStep("updates", "")],
	},
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "progress"),
	schema("a number", 5),
	schema("no action", {}),
	schema("an unknown action", { action: "delete", body: NOTE }),
	schema("action in capitals", { action: "PROGRESS", body: NOTE }),
	schema("action that is a number", { action: 5, body: NOTE }),
	schema("progress with no body", { action: "progress" }),
	schema("progress body that is a number", { action: "progress", body: 7 }),
	schema("progress body that is null", { action: "progress", body: null }),
	schema("progress body that is empty", { action: "progress", body: "" }),
	schema("progress body of only spaces", {
		action: "progress",
		body: "   \n ",
	}),
	schema("progress body of 1001 characters", {
		action: "progress",
		body: long(1001),
	}),
	schema("accept with no due date", { action: "accept", body: NOTE }),
	schema("accept with no body", { action: "accept", dueDate: LATER }),
	schema("accept due date written 2026-12-1", {
		action: "accept",
		dueDate: "2026-12-1",
		body: NOTE,
	}),
	schema("accept due date written with slashes", {
		action: "accept",
		dueDate: "12/15/2026",
		body: NOTE,
	}),
	schema("accept due date that is not a day (Feb 30)", {
		action: "accept",
		dueDate: "2026-02-30",
		body: NOTE,
	}),
	schema("accept due date in month 13", {
		action: "accept",
		dueDate: "2026-13-01",
		body: NOTE,
	}),
	schema("accept due date with a time", {
		action: "accept",
		dueDate: "2026-12-15T00:00:00Z",
		body: NOTE,
	}),
	schema("accept due date with a leading space", {
		action: "accept",
		dueDate: " 2026-12-15",
		body: NOTE,
	}),
	schema("accept due date that is a number", {
		action: "accept",
		dueDate: 20261215,
		body: NOTE,
	}),
	schema("revise_date with no reason", {
		action: "revise_date",
		dueDate: "2026-12-20",
		body: NOTE,
	}),
	schema("revise_date with an unknown reason", {
		action: "revise_date",
		dueDate: "2026-12-20",
		reason: "because",
		body: NOTE,
	}),
	schema("revise_date reason that is not text", {
		action: "revise_date",
		dueDate: "2026-12-20",
		reason: 3,
		body: NOTE,
	}),
	schema("revise_date with no due date", {
		action: "revise_date",
		reason: "protect_song",
		body: NOTE,
	}),
	schema("start_work with no body", { action: "start_work" }),
	schema("begin_revision with no body", { action: "begin_revision" }),
	schema("complete with no body", { action: "complete" }),
	schema("retry_email with no update id", { action: "retry_email" }),
	schema("retry_email update id 0", { action: "retry_email", updateId: 0 }),
	schema("retry_email update id -1", { action: "retry_email", updateId: -1 }),
	schema("retry_email update id 1.5", { action: "retry_email", updateId: 1.5 }),
	schema("retry_email update id as text", {
		action: "retry_email",
		updateId: "1",
	}),
	schema("retry_email update id null", {
		action: "retry_email",
		updateId: null,
	}),
	schema("retry_email confirmedNotSent as text", {
		action: "retry_email",
		updateId: 1,
		confirmedNotSent: "true",
	}),
	schema("retry_email confirmedNotSent null", {
		action: "retry_email",
		updateId: 1,
		confirmedNotSent: null,
	}),
	// the 42-case matrix of action by stage
	...matrix,
	// text edges
	one("text: unicode, emoji and accents are kept", {
		action: "progress",
		body: "Café mix ready \u{1F3B5} 日本語 ñ",
	}),
	one("text: markup characters are stored as typed", {
		action: "progress",
		body: `<script>alert("x")</script> & 'quotes' "double" <b>bold</b>`,
	}),
	one("text: newlines and tabs are kept", {
		action: "progress",
		body: "line one\nline two\n\n\tindented",
	}),
	one("text: padding is trimmed", {
		action: "progress",
		body: "   padded note \n",
	}),
	one("text: exactly 1000 characters", {
		action: "progress",
		body: long(1000),
	}),
	one("text: 1000 characters with padding around them", {
		action: "progress",
		body: ` ${long(1000)} `,
	}),
	one("text: a NUL character is stored", {
		action: "progress",
		body: "before\u0000after",
	}),
	one("text: extra fields are dropped", {
		action: "progress",
		body: NOTE,
		kind: "accepted",
		actor: "someone else",
	}),
	// owner identity
	{
		name: "actor: a blank owner email cannot save",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { as: asOwner("   ") })],
	},
	{
		name: "actor: a mixed-case owner email is stored as given",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { as: asOwner("Owner@Example.TEST") })],
	},
	{
		name: "actor: a long owner email is stored as given",
		...quiet("in_progress"),
		steps: [act(BODIES.progress, { as: asOwner(`${long(400)}@x.test`) })],
	},
	// the project and the request
	{
		name: "project: unknown request id",
		...quiet("in_progress"),
		steps: [
			act(BODIES.progress, {
				params: { id: "nope" },
				path: "/api/owner/projects/nope/updates",
			}),
		],
	},
	{
		name: "project: the request has no project (not a service request)",
		...quiet("in_progress", {
			request: rows.ownerRequest("r1", {
				kind: "purchase",
				status: "reviewed",
			}),
			files: [],
		}),
		steps: [act(BODIES.progress)],
	},
	one("project: access revoked blocks progress", BODIES.progress, {
		project: { ...atStage("in_progress"), revoked_at: EARLIER },
	}),
	one(
		"project: access revoked blocks accept",
		BODIES.accept,
		{
			project: { revoked_at: EARLIER },
		},
		{},
		"files_under_review",
	),
	one(
		"project: access revoked blocks start work",
		BODIES.start_work,
		{
			project: { ...atStage("accepted"), revoked_at: EARLIER },
		},
		{},
		"accepted",
	),
	one("project: access revoked blocks a date change", BODIES.revise_date, {
		project: { revoked_at: EARLIER },
	}),
	one("request: withdrawn blocks progress", BODIES.progress, {
		request: service({ status: "withdrawn" }),
	}),
	one(
		"request: withdrawn blocks start work",
		BODIES.start_work,
		{
			request: service({ status: "withdrawn" }),
		},
		{},
		"accepted",
	),
	one("request: withdrawn blocks a date change", BODIES.revise_date, {
		request: service({ status: "withdrawn" }),
	}),
	one("request: resolved still takes progress", BODIES.progress, {
		request: service({ status: "resolved" }),
	}),
	one("request: new still takes progress", BODIES.progress, {
		request: service({ status: "new" }),
	}),
	one(
		"request: new cannot accept",
		BODIES.accept,
		{
			request: service({ status: "new" }),
		},
		{},
		"files_under_review",
	),
	one(
		"request: resolved cannot accept",
		BODIES.accept,
		{
			request: service({ status: "resolved" }),
		},
		{},
		"files_under_review",
	),
	one(
		"request: withdrawn cannot accept",
		BODIES.accept,
		{
			request: service({ status: "withdrawn" }),
		},
		{},
		"files_under_review",
	),
	one(
		"request: resolved can start work",
		BODIES.start_work,
		{
			request: service({ status: "resolved" }),
		},
		{},
		"accepted",
	),
	one(
		"request: new can start work",
		BODIES.start_work,
		{
			request: service({ status: "new" }),
		},
		{},
		"accepted",
	),
	one(
		"request: resolved can begin a revision",
		BODIES.begin_revision,
		{
			request: service({ status: "resolved" }),
		},
		{},
		"review_ready",
	),
	one(
		"request: resolved can complete",
		BODIES.complete,
		{
			request: service({ status: "resolved" }),
		},
		{},
		"final_files_ready",
	),
	one(
		"request: new cannot complete",
		BODIES.complete,
		{
			request: service({ status: "new" }),
		},
		{},
		"final_files_ready",
	),
	one(
		"request: withdrawn cannot complete",
		BODIES.complete,
		{
			request: service({ status: "withdrawn" }),
		},
		{},
		"final_files_ready",
	),
	// payment
	one(
		"payment: start work with the booking open",
		BODIES.start_work,
		{
			payment: payment({
				booking_status: "open",
				balance_status: "not_created",
			}),
		},
		{},
		"accepted",
	),
	one(
		"payment: start work with the booking not created",
		BODIES.start_work,
		{
			payment: payment({
				booking_status: "not_created",
				balance_status: "not_created",
			}),
		},
		{},
		"accepted",
	),
	one(
		"payment: start work with the booking failed",
		BODIES.start_work,
		{
			payment: payment({
				booking_status: "payment_failed",
				balance_status: "not_created",
			}),
		},
		{},
		"accepted",
	),
	one(
		"payment: start work with no payment row",
		BODIES.start_work,
		{
			payment: null,
		},
		{},
		"accepted",
	),
	one(
		"payment: begin a revision with the booking unpaid",
		BODIES.begin_revision,
		{
			payment: payment({
				booking_status: "void",
				balance_status: "not_created",
			}),
		},
		{},
		"review_ready",
	),
	one(
		"payment: complete with the balance open",
		BODIES.complete,
		{
			payment: payment({ balance_status: "open" }),
		},
		{},
		"final_files_ready",
	),
	one(
		"payment: complete with the balance void",
		BODIES.complete,
		{
			payment: payment({ balance_status: "void" }),
		},
		{},
		"final_files_ready",
	),
	one(
		"payment: complete with the booking unpaid",
		BODIES.complete,
		{
			payment: payment({ booking_status: "open" }),
		},
		{},
		"final_files_ready",
	),
	one("payment: progress needs no payment", BODIES.progress, {
		payment: null,
	}),
	// files the batch guards want
	one(
		"files: begin a revision with no published review",
		BODIES.begin_revision,
		{
			files: [],
		},
		{},
		"review_ready",
	),
	one(
		"files: begin a revision when the review is only a draft",
		BODIES.begin_revision,
		{
			files: [
				{
					...published("fr"),
					status: "uploaded",
					published_at: null,
					publication_id: null,
				},
			],
		},
		{},
		"review_ready",
	),
	one(
		"files: begin a revision when the review was revoked",
		BODIES.begin_revision,
		{
			files: [published("fr", { status: "revoked", revoked_at: EARLIER })],
		},
		{},
		"review_ready",
	),
	one(
		"files: complete with no published final",
		BODIES.complete,
		{
			files: [published("fr")],
		},
		{},
		"final_files_ready",
	),
	one(
		"files: complete when only a review is published",
		BODIES.complete,
		{
			files: [published("ff", { version: "review" })],
		},
		{},
		"final_files_ready",
	),
	// due dates
	one(
		"date: accept with a due date in the past",
		{
			action: "accept",
			dueDate: "2026-11-12",
			body: NOTE,
		},
		{},
		{},
		"files_under_review",
	),
	one(
		"date: accept due today is allowed",
		{
			action: "accept",
			dueDate: "2026-11-13",
			body: NOTE,
		},
		{},
		{},
		"files_under_review",
	),
	{
		name: "date: the floor is the New York date, late evening there",
		...quiet("files_under_review"),
		steps: [
			// 03:00 UTC on the 14th is 22:00 on the 13th in New York.
			act(
				{ action: "accept", dueDate: "2026-11-13", body: NOTE },
				{ advanceMs: 15 * 3_600_000 },
			),
		],
	},
	{
		name: "date: the floor is the New York date, after its midnight",
		...quiet("files_under_review"),
		steps: [
			// 06:00 UTC on the 14th is 01:00 on the 14th in New York.
			act(
				{ action: "accept", dueDate: "2026-11-13", body: NOTE },
				{ advanceMs: 18 * 3_600_000 },
			),
		],
	},
	one("date: revise to the same date", {
		...BODIES.revise_date,
		dueDate: DUE,
	}),
	one("date: revise to an earlier date", {
		...BODIES.revise_date,
		dueDate: "2026-11-20",
	}),
	one("date: revise to a day later", {
		...BODIES.revise_date,
		dueDate: "2026-12-02",
	}),
	one(
		"date: revise when the current date is in the past",
		{
			...BODIES.revise_date,
			dueDate: "2026-11-10",
		},
		{ project: atStage("in_progress", { current_due_at: "2026-11-01" }) },
	),
	one("date: revise a project that has no due date", BODIES.revise_date, {
		project: { stage: "in_progress" },
	}),
	one("date: revise for client_clarification", {
		...BODIES.revise_date,
		reason: "client_clarification",
	}),
	one("date: revise for schedule_conflict", {
		...BODIES.revise_date,
		reason: "schedule_conflict",
	}),
	// races
	race(
		"accept loses on updated_at",
		BODIES.accept,
		"files_under_review",
		/UPDATE audio_projects SET stage='accepted'/,
		`UPDATE audio_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
	),
	race(
		"accept after the request is withdrawn",
		BODIES.accept,
		"files_under_review",
		/UPDATE audio_projects SET stage='accepted'/,
		`UPDATE owner_requests SET status='withdrawn'`,
	),
	race(
		"accept after another change moved the stage",
		BODIES.accept,
		"files_under_review",
		/UPDATE audio_projects SET stage='accepted'/,
		`UPDATE audio_projects SET stage='in_progress'`,
	),
	race(
		"accept after access was revoked",
		BODIES.accept,
		"files_under_review",
		/UPDATE audio_projects SET stage='accepted'/,
		`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
	),
	race(
		"start work after the booking is voided",
		BODIES.start_work,
		"accepted",
		/UPDATE audio_projects SET stage='in_progress'/,
		`UPDATE audio_payments SET booking_status='void'`,
	),
	race(
		"start work loses on updated_at",
		BODIES.start_work,
		"accepted",
		/UPDATE audio_projects SET stage='in_progress'/,
		`UPDATE audio_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
	),
	race(
		"begin a revision after the review is revoked",
		BODIES.begin_revision,
		"review_ready",
		/UPDATE audio_projects SET stage='revision_in_progress'/,
		`UPDATE audio_project_files SET status='revoked'`,
	),
	race(
		"complete after the final is revoked",
		BODIES.complete,
		"final_files_ready",
		/UPDATE audio_projects SET stage='complete'/,
		`UPDATE audio_project_files SET status='revoked' WHERE version='final'`,
	),
	race(
		"complete after the balance is voided",
		BODIES.complete,
		"final_files_ready",
		/UPDATE audio_projects SET stage='complete'/,
		`UPDATE audio_payments SET balance_status='void'`,
	),
	race(
		"date change loses on the due date",
		BODIES.revise_date,
		"in_progress",
		/UPDATE audio_projects SET current_due_at=\?/,
		`UPDATE audio_projects SET current_due_at='2026-12-10'`,
	),
	race(
		"date change loses on updated_at",
		BODIES.revise_date,
		"in_progress",
		/UPDATE audio_projects SET current_due_at=\?/,
		`UPDATE audio_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
	),
	race(
		"date change after the project completes",
		BODIES.revise_date,
		"in_progress",
		/UPDATE audio_projects SET current_due_at=\?/,
		`UPDATE audio_projects SET stage='complete'`,
	),
	race(
		"progress after access is revoked",
		BODIES.progress,
		"in_progress",
		/SELECT p\.request_id,'progress'/,
		`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
	),
	race(
		"progress after the project completes",
		BODIES.progress,
		"in_progress",
		/SELECT p\.request_id,'progress'/,
		`UPDATE audio_projects SET stage='complete'`,
	),
	race(
		"progress after the request is withdrawn",
		BODIES.progress,
		"in_progress",
		/SELECT p\.request_id,'progress'/,
		`UPDATE owner_requests SET status='withdrawn'`,
	),
	// outages and rolled-back batches
	outage("the state read fails", BODIES.progress, "in_progress", STATE),
	outage(
		"the accept batch fails",
		BODIES.accept,
		"files_under_review",
		/UPDATE audio_projects SET stage='accepted'/,
	),
	outage(
		"the start work batch fails",
		BODIES.start_work,
		"accepted",
		/UPDATE audio_projects SET stage='in_progress'/,
	),
	outage(
		"the begin revision batch fails",
		BODIES.begin_revision,
		"review_ready",
		/UPDATE audio_projects SET stage='revision_in_progress'/,
	),
	outage(
		"the complete batch fails",
		BODIES.complete,
		"final_files_ready",
		/UPDATE audio_projects SET stage='complete'/,
	),
	outage(
		"the date change batch fails",
		BODIES.revise_date,
		"in_progress",
		/UPDATE audio_projects SET current_due_at=\?/,
	),
	outage(
		"the progress insert fails",
		BODIES.progress,
		"in_progress",
		/SELECT p\.request_id,'progress'/,
	),
	one(
		"rolled back: an audit trigger aborts the accept batch",
		BODIES.accept,
		{
			setup: (w) =>
				w.music.exec(
					`CREATE TRIGGER golden_audit_locked BEFORE INSERT ON audio_project_audit BEGIN SELECT RAISE(ABORT,'audit locked'); END`,
				),
		},
		{},
		"files_under_review",
	),
	one(
		"rolled back: an audit trigger aborts the date change batch",
		BODIES.revise_date,
		{
			setup: (w) =>
				w.music.exec(
					`CREATE TRIGGER golden_audit_locked BEFORE INSERT ON audio_project_audit BEGIN SELECT RAISE(ABORT,'audit locked'); END`,
				),
		},
	),
	// sequences
	{
		name: "twice: the same accept is refused the second time",
		...quiet("files_under_review"),
		steps: [act(BODIES.accept), act(BODIES.accept, { advanceMs: 1000 })],
	},
	{
		name: "twice: the same start work is refused the second time",
		...quiet("accepted"),
		steps: [
			act(BODIES.start_work),
			act(BODIES.start_work, { advanceMs: 1000 }),
		],
	},
	{
		name: "twice: the same progress note is saved twice",
		...quiet("in_progress"),
		steps: [act(BODIES.progress), act(BODIES.progress, { advanceMs: 1000 })],
	},
	{
		name: "twice: a date change, the same date again, then a later date",
		...quiet("in_progress"),
		steps: [
			act(BODIES.revise_date),
			act(BODIES.revise_date, { advanceMs: 1000 }),
			act(
				{ ...BODIES.revise_date, dueDate: "2026-12-31" },
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "life: accept, start work, a revision too early, review ready, a revision, complete too early, final ready, complete, then nothing more",
		...quiet("files_under_review"),
		steps: [
			act(BODIES.accept),
			act(BODIES.start_work, { advanceMs: 1000 }),
			act(BODIES.begin_revision, { advanceMs: 1000 }),
			act(BODIES.progress, {
				advanceMs: 1000,
				before: {
					label: "a review mix is published",
					run: (w) => {
						w.music.exec(
							`UPDATE audio_projects SET stage='review_ready' WHERE request_id='r1'`,
						);
					},
				},
			}),
			act(BODIES.begin_revision, { advanceMs: 1000 }),
			act(BODIES.complete, { advanceMs: 1000 }),
			act(BODIES.complete, {
				advanceMs: 1000,
				before: {
					label: "the final mix is published",
					run: (w) => {
						w.music.exec(
							`UPDATE audio_projects SET stage='final_files_ready' WHERE request_id='r1'`,
						);
					},
				},
			}),
			act(BODIES.progress, { advanceMs: 1000 }),
			act(BODIES.revise_date, { advanceMs: 1000 }),
		],
	},
	{
		name: "outage then repeat: the first accept fails, the second saves",
		...quiet("files_under_review"),
		failures: [
			{
				on: /UPDATE audio_projects SET stage='accepted'/,
				message: "D1 is down",
			},
		],
		steps: [act(BODIES.accept), act(BODIES.accept, { advanceMs: 1000 })],
	},
	{
		name: "twice: complete, then progress is refused",
		...quiet("final_files_ready"),
		steps: [act(BODIES.complete), act(BODIES.progress, { advanceMs: 1000 })],
	},
];

defineCorpus("owner-project-updates", POST, cases);
