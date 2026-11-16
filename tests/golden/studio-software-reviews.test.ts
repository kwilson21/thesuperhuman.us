import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/studio/software/[id]/reviews/[updateId]";
import {
	ADA,
	ADA_TOKEN,
	EARLIER,
	GRACE,
	GRACE_TOKEN,
	ORIGIN,
	OTHER_TOKEN,
	SOFTWARE_MESSAGE_TABLES,
	message,
	session,
	softwareSeed,
	softwareUpdate,
	terms,
} from "./areas/studio-messages";
import {
	asClient,
	asClientCookie,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for POST /api/studio/software/[id]/reviews/[updateId]: a signed-in client answers a shared review
// on a software project: confirms the direction, accepts a milestone, or asks for changes.
//
// Every response branch of the handler and of postSoftwareReviewDecision (src/lib/software-project-messages.ts), and
// the cases that reach each. Every answer carries cache-control: private, no-store.
//
//   handler (src/pages/api/studio/software/[id]/reviews/[updateId].ts)
//   404 {ok:false}            portal off (flag "false", flag missing), no session lookup match (unknown, capitals, revoked,
//                             expired, another client's project, project closed, request withdrawn, content deleted,
//                             blank email, unknown project), no id param, no updateId param, empty updateId
//   503 {ok:false}            no MUSIC_DB
//   401 {ok:false}            no cookie, short cookie, cookie with another name
//   musicRequest              403 no/foreign/ported Origin; 415 text/plain, urlencoded form, no content type, capitalised
//                             type; 400 Missing request; 413 over 16000 bytes; 400 Invalid JSON (bad JSON, empty body).
//                             Reached only after the project lookup, so a bad body on an unknown project is a 404.
//   400 "Check the decision"  null/array/string body, unknown or missing or non-text decision, accepted without confirm,
//                             confirm false or text, changes with no/blank/non-text/over-2000/control-character/surrogate
//                             note, selections that are not whole numbers 0 to 19 or are over 20 long
//   200 {ok:true,status:200}  every decision that applies (see below)
//   409 generic message       a throw from postSoftwareReviewDecision or the batch: guard failed (already decided, newer
//                             update shared, project complete, closed, withdrawn, session gone, content deleted), a milestone
//                             missing from the terms, unreadable terms, an audit note over 200 characters, an outage
//   uncaught                  the session lookup sits outside the try: an outage there rejects (recorded as "rejected")
//   postSoftwareReviewDecision
//   409 {ok:false,status:409} update unknown, not shared (draft, superseded), kind progress or handoff, of another project
//   400 "doesn't apply"       direction_confirmed on a delivery review; milestone_accepted on a direction review
//   400 "only part"           accepted while the review omits a deliverable (saved scope, names, legacy, unreadable)
//   400 "Choose an unmet..."  a check beyond the list, a missing deliverable that was delivered or does not exist, an
//                             inaccessible one that was not delivered, a delivery change request with no selection
//   200 and the batch         state x decision (5 project states x 4 applicable answers), step set to handoff, direction or
//                             build, duplicate and unsorted selections, milestone 2, a review of an earlier milestone
//                             while the project is on a later one (no state change, no state-changed audit row)
//   multi-step                repeated answers, answer then change, owner shares a newer review in between
//
// Owner notification: none. The route sends no email; every case records no outgoing fetch.

const BASE = "/api/studio/software";
const GOOD = asClientCookie(GRACE_TOKEN);

const decide = (
	json: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: GOOD,
	path: `${BASE}/r1/reviews/u1`,
	params: { id: "r1", updateId: "u1" },
	headers: { origin: ORIGIN },
	json,
	dump: { music: SOFTWARE_MESSAGE_TABLES },
	...extra,
});

const onDelivery = (json: JsonValue | undefined, extra: Partial<Step> = {}) =>
	decide(json, {
		path: `${BASE}/r1/reviews/u2`,
		params: { id: "r1", updateId: "u2" },
		...extra,
	});

const raw = (body: string, extra: Partial<Step> = {}): Step =>
	decide(undefined, {
		body,
		headers: { origin: ORIGIN, "content-type": "application/json" },
		...extra,
	});

const confirm = { decision: "direction_confirmed" };
const accept = { decision: "milestone_accepted", confirm: true };

const changes = (
	note: JsonValue | undefined,
	extra: { [key: string]: JsonValue | undefined } = {},
) => ({
	decision: "changes_requested",
	note,
	...extra,
});

const direction = (id = "u1", over: SeedRow = {}) =>
	softwareUpdate(id, "direction_review", over);

const delivery = (id = "u2", over: SeedRow = {}) =>
	softwareUpdate(id, "delivery_review", over);

type Options = {
	updates?: SeedRow[];
	extra?: { [table: string]: SeedRow[] };
	project?: SeedRow;
	request?: SeedRow;
};

const swCase = (
	name: string,
	options: Options,
	steps: Step[],
	more: Partial<Case> = {},
): Case => ({
	name,
	music: {
		seed: softwareSeed(
			{
				software_project_updates: options.updates ?? [direction(), delivery()],
				...options.extra,
			},
			options.project,
			options.request,
		),
	},
	steps,
	...more,
});

const onBatch = (
	label: string,
	sql: string,
	on = /INSERT INTO software_project_messages/,
) => ({
	interleave: [
		{
			on,
			label,
			run: (sqlite: { exec: (sql: string) => void }) => sqlite.exec(sql),
		},
	],
});

const newerUpdate = (
	kind: string,
	milestone: number,
	sharedAt: string,
	id = "u9",
	status = "shared",
) =>
	`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,shared_at,shared_by,created_by,created_at,updated_at) VALUES ('${id}','r1','${kind}','${status}',${milestone},'t','prototype','${sharedAt}','o','o','${EARLIER}','${EARLIER}')`;

const STATES = [
	"preparing",
	"building",
	"waiting_for_input",
	"ready_for_review",
	"complete",
] as const;

const cases: Case[] = [
	// ---- refusals before the body is read
	swCase("portal off: the flag is false", {}, [decide(confirm)], {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	swCase("portal off: the flag is not set", {}, [decide(confirm)], {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [decide(confirm)],
	},
	swCase("no cookie at all", {}, [decide(confirm, { as: asVisitor() })]),
	swCase("a cookie that is too short", {}, [
		decide(confirm, { as: asClientCookie("abc") }),
	]),
	swCase("a cookie with another name", {}, [
		decide(confirm, {
			as: asVisitor(),
			headers: { origin: ORIGIN, cookie: `session=${GRACE_TOKEN}` },
		}),
	]),
	swCase("no cookie and a bad body: the cookie check comes first", {}, [
		raw("{bad", { as: asVisitor() }),
	]),
	swCase("a session no one issued", {}, [
		decide(confirm, { as: asClientCookie(OTHER_TOKEN) }),
	]),
	swCase("a session token in capitals", {}, [
		decide(confirm, { as: asClientCookie(GRACE_TOKEN.toUpperCase()) }),
	]),
	swCase(
		"a revoked session",
		{
			extra: {
				audio_client_sessions: [
					session(GRACE_TOKEN, GRACE, { revoked_at: EARLIER }),
				],
			},
		},
		[decide(confirm)],
	),
	swCase(
		"an expired session",
		{
			extra: {
				audio_client_sessions: [
					session(GRACE_TOKEN, GRACE, {
						expires_at: "2026-11-13T11:59:59.999Z",
					}),
				],
			},
		},
		[decide(confirm)],
	),
	swCase("another client's project", {}, [
		decide(confirm, { as: asClientCookie(ADA_TOKEN) }),
	]),
	swCase(
		"a project whose access was closed",
		{ project: { revoked_at: EARLIER } },
		[decide(confirm)],
	),
	swCase("a withdrawn request", { request: { status: "withdrawn" } }, [
		decide(confirm),
	]),
	swCase(
		"a project whose content was deleted",
		{ project: { content_deleted_at: EARLIER } },
		[decide(confirm)],
	),
	swCase(
		"a request with a blank email",
		{
			request: { email: "" },
			extra: { audio_client_sessions: [session(GRACE_TOKEN, "")] },
		},
		[decide(confirm)],
	),
	swCase("a project id that does not exist", {}, [
		decide(confirm, {
			path: `${BASE}/nope/reviews/u1`,
			params: { id: "nope", updateId: "u1" },
		}),
	]),
	swCase("no id param", {}, [decide(confirm, { params: { updateId: "u1" } })]),
	swCase("no updateId param", {}, [decide(confirm, { params: { id: "r1" } })]),
	swCase("an empty updateId param", {}, [
		decide(confirm, { params: { id: "r1", updateId: "" } }),
	]),
	swCase("a bad body on an unknown project is a 404", {}, [
		raw("{bad", {
			path: `${BASE}/nope/reviews/u1`,
			params: { id: "nope", updateId: "u1" },
		}),
	]),
	{
		name: "a signed-in client through the real sign-in",
		music: { seed: softwareSeed({ software_project_updates: [direction()] }) },
		steps: [decide(confirm, { as: asClient(GRACE) })],
	},
	// ---- Origin, content type, size, JSON
	swCase("no Origin header", {}, [decide(confirm, { headers: {} })]),
	swCase("an Origin from another site", {}, [
		decide(confirm, { headers: { origin: "https://evil.example" } }),
	]),
	swCase("content type text/plain", {}, [
		raw(JSON.stringify(confirm), {
			headers: { origin: ORIGIN, "content-type": "text/plain" },
		}),
	]),
	swCase("an urlencoded form", {}, [
		raw("decision=direction_confirmed", {
			headers: {
				origin: ORIGIN,
				"content-type": "application/x-www-form-urlencoded",
			},
		}),
	]),
	swCase("no content type", {}, [
		raw(JSON.stringify(confirm), { headers: { origin: ORIGIN } }),
	]),
	swCase("a JSON content type in capitals", {}, [
		raw(JSON.stringify(confirm), {
			headers: { origin: ORIGIN, "content-type": "Application/JSON" },
		}),
	]),
	swCase("a lower-case JSON content type with a charset", {}, [
		raw(JSON.stringify(confirm), {
			headers: {
				origin: ORIGIN,
				"content-type": "application/json; charset=utf-8",
			},
		}),
	]),
	swCase("no request body", {}, [
		decide(undefined, {
			headers: { origin: ORIGIN, "content-type": "application/json" },
		}),
	]),
	swCase("an empty body", {}, [raw("")]),
	swCase("bad JSON", {}, [raw("{not json")]),
	swCase("a body over 16000 bytes", {}, [decide(changes("a".repeat(16100)))]),
	swCase("a null body", {}, [raw("null")]),
	swCase("an array body", {}, [raw("[]")]),
	swCase("a string body", {}, [raw('"direction_confirmed"')]),
	// ---- the schema
	swCase("an unknown decision", {}, [decide({ decision: "reject" })]),
	swCase("no decision", {}, [decide({})]),
	swCase("a decision that is not text", {}, [decide({ decision: 4 })]),
	swCase("an acceptance with no confirm", { updates: [delivery("u1")] }, [
		decide({ decision: "milestone_accepted" }),
	]),
	swCase("an acceptance with confirm false", { updates: [delivery("u1")] }, [
		decide({ decision: "milestone_accepted", confirm: false }),
	]),
	swCase("an acceptance with confirm as text", { updates: [delivery("u1")] }, [
		decide({ decision: "milestone_accepted", confirm: "true" }),
	]),
	swCase("a confirmation with extra fields", {}, [
		decide({ ...confirm, note: "ignored", extra: 1 }),
	]),
	swCase("changes with no note", {}, [
		decide({ decision: "changes_requested" }),
	]),
	swCase("changes with a blank note", {}, [decide(changes("   \n "))]),
	swCase("changes with a note that is not text", {}, [decide(changes(5))]),
	swCase("changes with a note of 2001 characters", {}, [
		decide(changes("a".repeat(2001))),
	]),
	swCase("changes with a note of exactly 2000 characters", {}, [
		decide(changes("a".repeat(2000))),
	]),
	swCase("changes with a note of 2000 characters inside spaces", {}, [
		decide(changes(` ${"a".repeat(2000)} `)),
	]),
	swCase("changes with a control character in the note", {}, [
		decide(changes("a\u0001b")),
	]),
	swCase("changes with a lone surrogate in the note", {}, [
		decide(changes("a\ud800b")),
	]),
	swCase("changes with a note with markup, quotes and unicode", {}, [
		decide(changes(`<script>alert("x")</script> & 'q' 🎧 谢谢`)),
	]),
	swCase("changes with a note with line breaks and tabs", {}, [
		decide(changes("one\n\ttwo\r\nthree")),
	]),
	swCase(
		"changes with an http link in the note (links are not checked here)",
		{},
		[decide(changes("see http://example.com"))],
	),
	swCase("changes with criteria that is not a list", {}, [
		decide(changes("x", { criteria: 1 })),
	]),
	...[-1, 20, 1.5, "1", null].map((value) =>
		swCase(`changes with a check index of ${JSON.stringify(value)}`, {}, [
			decide(changes("x", { criteria: [value] })),
		]),
	),
	swCase("changes with 21 check indexes", {}, [
		decide(
			changes("x", {
				criteria: Array.from({ length: 21 }, (_, index) => index % 20),
			}),
		),
	]),
	swCase("changes with a missing deliverable index of 20", {}, [
		decide(changes("x", { missing_deliverables: [20] })),
	]),
	swCase("changes with an inaccessible deliverable index of -1", {}, [
		decide(changes("x", { inaccessible_deliverables: [-1] })),
	]),
	// ---- the update being answered
	swCase("an update that does not exist", {}, [
		decide(confirm, {
			path: `${BASE}/r1/reviews/nope`,
			params: { id: "r1", updateId: "nope" },
		}),
	]),
	swCase(
		"an update that is a draft",
		{ updates: [direction("u1", { status: "draft", shared_at: null })] },
		[decide(confirm)],
	),
	swCase(
		"an update that was superseded",
		{ updates: [direction("u1", { status: "superseded" })] },
		[decide(confirm)],
	),
	swCase("a progress update", { updates: [softwareUpdate("u1", "progress")] }, [
		decide(confirm),
	]),
	swCase(
		"a handoff update",
		{
			updates: [softwareUpdate("u1", "handoff", { evidence_type: "handoff" })],
		},
		[decide(confirm)],
	),
	swCase(
		"an update that belongs to another client's project",
		{
			extra: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed" }),
					rows.softwareRequest("r2", { status: "reviewed", email: ADA }),
				],
				software_offers: [
					rows.softwareOffer("o1", "r1"),
					rows.softwareOffer("o2", "r2"),
				],
				software_projects: [
					rows.softwareProject("r1", "o1", {
						terms_json: terms(),
						state: "building",
					}),
					rows.softwareProject("r2", "o2", {
						terms_json: terms(),
						state: "building",
					}),
				],
				software_project_updates: [
					direction("u1"),
					{ ...direction("u8"), request_id: "r2" },
				],
			},
		},
		[
			decide(confirm, {
				path: `${BASE}/r1/reviews/u8`,
				params: { id: "r1", updateId: "u8" },
			}),
		],
	),
	// ---- project state x decision
	...STATES.flatMap((state) => [
		swCase(
			`direction confirmed while the project is ${state}`,
			{ project: { state } },
			[decide(confirm)],
		),
		swCase(
			`direction changes requested while the project is ${state}`,
			{ project: { state } },
			[decide(changes("Smaller scope"))],
		),
		swCase(
			`milestone accepted while the project is ${state}`,
			{ project: { state } },
			[onDelivery(accept)],
		),
		swCase(
			`delivery changes requested while the project is ${state}`,
			{ project: { state } },
			[onDelivery(changes("Tests fail", { criteria: [1] }))],
		),
	]),
	swCase(
		"direction confirmed from every step: handoff",
		{ project: { step: "handoff", state: "ready_for_review" } },
		[decide(confirm)],
	),
	swCase(
		"milestone accepted while the step is direction",
		{ project: { step: "direction" } },
		[onDelivery(accept)],
	),
	swCase("direction_confirmed on a delivery review", {}, [onDelivery(confirm)]),
	swCase("milestone_accepted on a direction review", {}, [decide(accept)]),
	swCase(
		"a project with a wait note is cleared by an answer",
		{ project: { state: "waiting_for_input", waiting_for: "your logo" } },
		[decide(confirm)],
	),
	// ---- changes: selections
	swCase("direction changes with two unmet checks", {}, [
		decide(changes("x", { criteria: [0, 2] })),
	]),
	swCase("changes with duplicate and unsorted selections", {}, [
		onDelivery(
			changes("x", {
				criteria: [2, 0, 2, 1],
				inaccessible_deliverables: [2, 0, 2],
			}),
		),
	]),
	swCase("a delivery change request with no selection", {}, [
		onDelivery(changes("x")),
	]),
	swCase("a delivery change request with only an unmet check", {}, [
		onDelivery(changes("x", { criteria: [0] })),
	]),
	swCase(
		"a delivery change request with only an inaccessible deliverable",
		{},
		[onDelivery(changes("x", { inaccessible_deliverables: [1] }))],
	),
	swCase("a check beyond the milestone's list", {}, [
		decide(changes("x", { criteria: [3] })),
	]),
	swCase("a missing deliverable that was delivered (legacy full scope)", {}, [
		decide(changes("x", { missing_deliverables: [1] })),
	]),
	swCase("a missing deliverable beyond the list", {}, [
		decide(changes("x", { missing_deliverables: [3] })),
	]),
	swCase("an inaccessible deliverable beyond the list", {}, [
		decide(changes("x", { inaccessible_deliverables: [3] })),
	]),
	swCase(
		"a partial delivery: a missing deliverable that was left out",
		{
			updates: [
				direction(),
				delivery("u2", { delivered_deliverables_json: "[0,2]" }),
			],
		},
		[onDelivery(changes("x", { missing_deliverables: [1] }))],
	),
	swCase(
		"a partial delivery: a missing deliverable that was delivered",
		{
			updates: [
				direction(),
				delivery("u2", { delivered_deliverables_json: "[0,2]" }),
			],
		},
		[onDelivery(changes("x", { missing_deliverables: [0] }))],
	),
	swCase(
		"a partial delivery: an inaccessible deliverable that was left out",
		{
			updates: [
				direction(),
				delivery("u2", { delivered_deliverables_json: "[0,2]" }),
			],
		},
		[onDelivery(changes("x", { inaccessible_deliverables: [1] }))],
	),
	swCase(
		"a partial delivery: an inaccessible deliverable that was delivered",
		{
			updates: [
				direction(),
				delivery("u2", { delivered_deliverables_json: "[0,2]" }),
			],
		},
		[onDelivery(changes("x", { inaccessible_deliverables: [2] }))],
	),
	// ---- acceptance and the delivered scope
	...[
		["every deliverable by name", '["Prototype","Docs","Deployment"]'],
		["every deliverable by index with a repeat", "[0,0,1,2]"],
		["only one deliverable by index", "[0]"],
		["only one deliverable by name", '["Prototype"]'],
		["a name that is not planned", '["Nope"]'],
		["an index out of range", "[7]"],
		["a legacy empty list", "[]"],
		["text that is not JSON", "not json"],
		["JSON that is not a list", '{"a":1}'],
		["JSON that is a string", '"all"'],
		["a mix of names, indexes and junk", '[0,"Docs",null,"Deployment"]'],
	].map(([label, scope]) =>
		swCase(
			`acceptance with a delivery that holds ${label}`,
			{
				updates: [
					direction(),
					delivery("u2", { delivered_deliverables_json: scope }),
				],
			},
			[onDelivery(accept)],
		),
	),
	// ---- milestones and terms
	swCase(
		"the second milestone accepted while the project is on it",
		{
			project: { milestone_index: 1 },
			updates: [direction(), delivery("u2", { milestone_index: 1 })],
		},
		[onDelivery(accept)],
	),
	swCase(
		"the first milestone accepted while the project is on the second: no state change",
		{ project: { milestone_index: 1 } },
		[onDelivery(accept)],
	),
	swCase(
		"a review for a milestone the terms do not have",
		{ updates: [direction("u1", { milestone_index: 2 })] },
		[decide(confirm)],
	),
	swCase(
		"a project whose terms are not JSON",
		{ project: { terms_json: "not json" } },
		[decide(confirm)],
	),
	swCase("a project whose terms are empty", { project: { terms_json: "{}" } }, [
		decide(confirm),
	]),
	swCase(
		"a project with one milestone",
		{
			project: {
				terms_json: terms({
					milestones: [
						{
							name: "Only",
							deliverables: ["All"],
							acceptance: ["Done"],
							feeCents: 100_000,
						},
					],
				}),
			},
		},
		[onDelivery(accept)],
	),
	swCase(
		"a version label so long the audit note overflows",
		{ updates: [direction("u1", { artifact_version: "V".repeat(190) })] },
		[decide(confirm)],
	),
	swCase(
		"a version label of unicode and markup",
		{ updates: [direction("u1", { artifact_version: "<b>v1</b> & 谢谢" })] },
		[decide(confirm)],
	),
	// ---- already answered and superseded
	swCase(
		"the review already has a decision",
		{
			extra: {
				software_project_messages: [
					{
						...message("r1", "client"),
						update_id: "u1",
						decision: "direction_confirmed",
					},
				],
			},
		},
		[decide(confirm)],
	),
	swCase(
		"the review already has a different decision",
		{
			extra: {
				software_project_messages: [
					{
						...message("r1", "client"),
						update_id: "u1",
						decision: "changes_requested",
					},
				],
			},
		},
		[decide(confirm)],
	),
	swCase(
		"a plain message about the review is not a decision",
		{
			extra: {
				software_project_messages: [
					{ ...message("r1", "client"), update_id: "u1" },
				],
			},
		},
		[decide(confirm)],
	),
	swCase(
		"an older review of the same kind and milestone is superseded by a newer one",
		{
			updates: [
				direction("u1"),
				direction("u3", { shared_at: "2026-11-13T11:30:00.000Z" }),
			],
		},
		[decide(confirm)],
	),
	swCase(
		"the newer review of the same kind and milestone is answered",
		{
			updates: [
				direction("u1"),
				direction("u3", { shared_at: "2026-11-13T11:30:00.000Z" }),
			],
		},
		[
			decide(confirm, {
				path: `${BASE}/r1/reviews/u3`,
				params: { id: "r1", updateId: "u3" },
			}),
		],
	),
	swCase(
		"two reviews shared at the same instant: the greater id wins",
		{
			updates: [direction("u1"), direction("u3")],
		},
		[decide(confirm)],
	),
	swCase(
		"two reviews shared at the same instant: the greater id is answered",
		{
			updates: [direction("u1"), direction("u3")],
		},
		[
			decide(confirm, {
				path: `${BASE}/r1/reviews/u3`,
				params: { id: "r1", updateId: "u3" },
			}),
		],
	),
	swCase(
		"a newer review of another kind does not supersede",
		{
			updates: [
				direction("u1"),
				delivery("u2", { shared_at: "2026-11-13T11:30:00.000Z" }),
			],
		},
		[decide(confirm)],
	),
	swCase(
		"a newer review of another milestone does not supersede",
		{
			updates: [
				direction("u1"),
				direction("u3", {
					milestone_index: 1,
					shared_at: "2026-11-13T11:30:00.000Z",
				}),
			],
		},
		[decide(confirm)],
	),
	swCase(
		"a newer update that was superseded does not supersede",
		{
			updates: [
				direction("u1"),
				direction("u3", {
					status: "superseded",
					shared_at: "2026-11-13T11:30:00.000Z",
				}),
			],
		},
		[decide(confirm)],
	),
	swCase(
		"a decision on a review whose project is on a later milestone, with an update of the project's milestone newer",
		{
			project: { milestone_index: 1 },
			updates: [
				delivery("u2"),
				delivery("u3", {
					milestone_index: 1,
					shared_at: "2026-11-13T11:30:00.000Z",
				}),
			],
		},
		[onDelivery(accept)],
	),
	// ---- sequences
	swCase("confirm, confirm again, then ask for changes", {}, [
		decide(confirm, { advanceMs: 1000 }),
		decide(confirm, { advanceMs: 1000 }),
		decide(changes("Changed my mind"), { advanceMs: 1000 }),
	]),
	swCase("accept, accept again, then ask for changes", {}, [
		onDelivery(accept, { advanceMs: 1000 }),
		onDelivery(accept, { advanceMs: 1000 }),
		onDelivery(changes("Too late", { criteria: [0] }), { advanceMs: 1000 }),
	]),
	swCase(
		"changes on a delivery, a new delivery is shared, the old one and the new one are answered",
		{},
		[
			onDelivery(changes("Fix it", { criteria: [0] }), { advanceMs: 1000 }),
			onDelivery(accept, {
				advanceMs: 1000,
				before: {
					label: "the owner shares delivery v2",
					run: (world) =>
						world.music.exec(
							newerUpdate(
								"delivery_review",
								0,
								"2026-11-13T12:00:01.500Z",
								"u3",
							),
						),
				},
			}),
			decide(accept, {
				advanceMs: 1000,
				path: `${BASE}/r1/reviews/u3`,
				params: { id: "r1", updateId: "u3" },
			}),
		],
	),
	swCase("direction confirmed, then the delivery accepted", {}, [
		decide(confirm, { advanceMs: 1000 }),
		onDelivery(accept, { advanceMs: 1000 }),
	]),
	swCase(
		"accepted on the first milestone, then the second",
		{
			updates: [
				direction(),
				delivery("u2"),
				delivery("u4", { milestone_index: 1 }),
			],
		},
		[
			onDelivery(accept, { advanceMs: 1000 }),
			onDelivery(accept, {
				advanceMs: 1000,
				path: `${BASE}/r1/reviews/u4`,
				params: { id: "r1", updateId: "u4" },
				before: {
					label: "the owner moves the project to milestone 2",
					run: (world) =>
						world.music.exec(`UPDATE software_projects SET milestone_index=1`),
				},
			}),
		],
	),
	// ---- races
	swCase(
		"a newer review is shared after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the owner shares a newer direction",
			newerUpdate("direction_review", 0, "2026-11-13T11:59:00.000Z"),
		),
	),
	swCase(
		"another tab answers first",
		{},
		[decide(confirm)],
		onBatch(
			"another answer lands",
			`INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r1','client','x','Confirmed','u1','direction_confirmed','2026-11-13T11:59:59.000Z')`,
		),
	),
	swCase(
		"the session is revoked after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the session is revoked",
			`UPDATE audio_client_sessions SET revoked_at='${EARLIER}'`,
		),
	),
	swCase(
		"the session expires after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the session expires",
			`UPDATE audio_client_sessions SET expires_at='${EARLIER}'`,
		),
	),
	swCase(
		"the project is closed after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the project is closed",
			`UPDATE software_projects SET revoked_at='${EARLIER}'`,
		),
	),
	swCase(
		"the request is withdrawn after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the request is withdrawn",
			`UPDATE owner_requests SET status='withdrawn'`,
		),
	),
	swCase(
		"the project completes after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the project completes",
			`UPDATE software_projects SET state='complete'`,
		),
	),
	swCase(
		"the content is deleted after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the content is deleted",
			`UPDATE software_projects SET content_deleted_at='${EARLIER}'`,
		),
	),
	swCase(
		"the update is superseded after the checks",
		{},
		[decide(confirm)],
		onBatch(
			"the update is superseded",
			`UPDATE software_project_updates SET status='superseded'`,
		),
	),
	swCase(
		"the project moves to the next milestone after the checks",
		{},
		[onDelivery(accept)],
		onBatch(
			"the owner moves the project on",
			`UPDATE software_projects SET milestone_index=1`,
		),
	),
	swCase(
		"the terms are edited after the checks",
		{},
		[onDelivery(accept)],
		onBatch("the terms change", `UPDATE software_projects SET terms_json='{}'`),
	),
	// ---- outages
	swCase("the session lookup fails: the route rejects", {}, [decide(confirm)], {
		failures: [
			{ on: /SELECT email FROM audio_client_sessions/, message: "D1 is down" },
		],
	}),
	swCase(
		"the project list lookup fails: the route rejects",
		{},
		[decide(confirm)],
		{
			failures: [
				{ on: /WHERE r\.email=\? AND r\.email<>''/, message: "D1 is down" },
			],
		},
	),
	swCase("the update read fails", {}, [decide(confirm)], {
		failures: [
			{
				on: /SELECT \* FROM software_project_updates WHERE request_id=\? AND id=\?/,
				message: "D1 is down",
			},
		],
	}),
	swCase("the project read fails", {}, [decide(confirm)], {
		failures: [
			{
				on: /SELECT \* FROM software_projects WHERE request_id=\?/,
				message: "D1 is down",
			},
		],
	}),
	swCase("the decision batch fails", {}, [decide(confirm)], {
		failures: [
			{ on: /INSERT INTO software_project_messages/, message: "D1 is down" },
		],
	}),
	swCase(
		"the decision batch fails on a change request",
		{},
		[onDelivery(changes("x", { criteria: [0] }))],
		{
			failures: [
				{ on: /INSERT INTO software_project_messages/, message: "D1 is down" },
			],
		},
	),
];

defineCorpus("studio-software-reviews", POST, cases);
