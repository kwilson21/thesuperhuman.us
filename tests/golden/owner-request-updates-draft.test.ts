import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/updates";
import { defineCorpus, rows, type Case, type SeedRow } from "./harness";
import {
	command,
	D1,
	D2,
	delivery,
	direction,
	EARLIER,
	FUTURE,
	handoff,
	input,
	post,
	scene,
	seedSql,
	sql,
	sharedDelivery,
	terms,
	U1,
	update,
} from "./areas/software-updates";

// The golden corpus for POST /api/owner/requests/[id]/updates, action "draft": the owner saves the one draft of a
// project (insert, then edit in place). The front door and the schema are in owner-request-updates-gates.test.ts, sharing
// in owner-request-updates-share.test.ts, the client notice in owner-request-updates-notices.test.ts.
//
// Branches reached after the body is valid (cases start with their topic):
//
//   404 {ok:false}                      "project": unknown id (gates), revoked, content deleted
//   409 "...complete."                  "state": a complete project; every other state saves
//   400 "Use up to 30 business days."   "window": no agreement terms and a window over 30 (any kind), 31, 365
//   agreement terms (projectAgreementDetails)   "agreement": review_business_days from the sent offer, from an executed
//                                       agreement, a string, a number, 0, text, over 30, malformed JSON, an offer not
//                                       sent, an agreement not executed; the review window moves to the extended column
//   400 "Choose a milestone ..."        "milestone": past the agreed milestones (2 agreed, index 2); every project and
//                                       update milestone pair saves
//   409 (outer catch)                   "terms": terms_json empty or malformed
//   400 "Choose deliverables ..."       "delivered": out of range, duplicate, unknown title, digit text, mixed titles and
//                                       numbers; numbers and titles are stored as indexes
//   409 "Another update was saved..."   "stale": project updated_at differs; 409 "The draft changed. Reload before
//                                       saving.": expectedUpdatedAt differs, no draft but one expected, draft but none
//                                       expected, updateId is not the draft's
//   400 "Describe the visual ..."       "visual": the draft has a picture and the saved text has no description
//   200 {ok,id,updatedAt,projectUpdatedAt,shared:false}   "save": new draft, edited draft, every kind and evidence type,
//                                       handoff forces its evidence type, notice stays not_requested, no supersede, the
//                                       timestamp rule (never before the project or draft time), a given updateId
//   batch (db.batch of one draft save): guards (open project, not complete, project updated_at, draft row), the insert or
//     update, the project updated_at, the audit row
//   409 "...could not be saved."        "race" and "outage": see below
//   409 stale project via the inner catch   "race: project changed"
//   rejected                            "outage: the project read fails twice"
//   sequences                           "sequence": save, save again with the new time, repeat a stale save, change kind

const draft = (update: JsonValue | undefined, over = {}) =>
	command("draft", update, over);

const save = (
	name: string,
	body: JsonValue,
	scenery: Parameters<typeof scene>[0] = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(scenery),
	steps: [post(body)],
	...extra,
});

const long = (n: number) => "a".repeat(n);

const states = [
	"preparing",
	"building",
	"waiting_for_input",
	"ready_for_review",
	"complete",
] as const;

const stateCases = states.map((state) =>
	save(`state: a ${state} project`, draft(input()), {
		project: {
			state,
			waiting_for: state === "waiting_for_input" ? "Logo" : "",
		},
	}),
);

const milestones = [0, 1, 2].flatMap((current) =>
	[0, 1, 2].map((target) =>
		save(
			`milestone: project on ${current}, update on ${target}`,
			draft(input({ milestone_index: target })),
			{ project: { milestone_index: current } },
		),
	),
);

const kinds = [
	["progress", input()],
	["direction_review", direction()],
	["delivery_review", delivery()],
	["handoff", handoff()],
] as const;

const kindCases = kinds.map(([kind, body]) =>
	save(`save: a new ${kind} draft`, draft(body)),
);

const AGREED = (days: JsonValue) =>
	JSON.stringify({
		review_business_days: days,
		correction_calendar_days: "30",
	});

const window = (
	name: string,
	days: number,
	offer: SeedRow | undefined,
	kind: JsonValue = "delivery_review",
	extra: Partial<Case> = {},
) =>
	save(
		`${name}`,
		draft(input({ kind, review_window_days: days, artifact_version: "v" })),
		{ offer },
		extra,
	);

const agreementSetup = (
	values: string,
	status = "executed",
): Partial<Case> => ({
	music: {
		seed: {
			...scene().music?.seed,
			...rows.agreementBase(),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status,
					values_json: values,
				}),
			],
		},
	},
	setup: seedSql(
		"UPDATE software_projects SET agreement_id='a1' WHERE request_id='r1'",
	),
});

const cases: Case[] = [
	// project
	save("project: revoked", draft(input()), {
		project: { revoked_at: EARLIER },
	}),
	save("project: content deleted", draft(input()), {
		project: { content_deleted_at: EARLIER },
	}),
	save("project: the request is withdrawn", draft(input()), {
		request: { status: "withdrawn" },
	}),
	save("project: the request has no email", draft(input()), {
		request: { email: "" },
	}),
	...stateCases,
	...milestones,
	save(
		"milestone: past the agreed milestones",
		draft(input({ milestone_index: 2 })),
		{
			project: {
				terms_json: JSON.stringify({
					...JSON.parse(terms()),
					milestones: JSON.parse(terms()).milestones.slice(0, 2),
				}),
			},
		},
	),
	save("terms: terms_json is malformed", draft(input()), {
		project: { terms_json: "{bad" },
	}),
	save("terms: terms_json fails the schema", draft(input()), {
		project: { terms_json: "{}" },
	}),
	// review window
	window("window: 30 days without agreement terms", 30, undefined),
	window("window: 31 days without agreement terms", 31, undefined),
	window("window: 365 days without agreement terms", 365, undefined),
	window("window: 31 days on a progress update", 31, undefined, "progress"),
	window(
		"window: 5 days on a progress update stores nothing",
		5,
		undefined,
		"progress",
	),
	window(
		"window: 12 days on a direction review",
		12,
		undefined,
		"direction_review",
	),
	window(
		"window: 10 days on a handoff stores nothing",
		10,
		undefined,
		"handoff",
	),
	window("agreement: the sent offer says 10 business days", 5, {
		agreement_details_json: AGREED("10"),
	}),
	window("agreement: the offer says 10 as a number", 5, {
		agreement_details_json: AGREED(10),
	}),
	window("agreement: the offer says 45 and the update 5", 5, {
		agreement_details_json: AGREED("45"),
	}),
	window("agreement: the offer says 45 and the update 400", 365, {
		agreement_details_json: AGREED("45"),
	}),
	window(
		"agreement: the offer says 8 and a progress update",
		5,
		{
			agreement_details_json: AGREED("8"),
		},
		"progress",
	),
	window("agreement: the offer says 0 as text", 5, {
		agreement_details_json: AGREED("0"),
	}),
	window("agreement: the offer says 0 as a number", 31, {
		agreement_details_json: AGREED(0),
	}),
	window("agreement: the offer says abc", 5, {
		agreement_details_json: AGREED("abc"),
	}),
	window("agreement: the offer says 3", 5, {
		agreement_details_json: AGREED("3"),
	}),
	window("agreement: the offer says nothing about review days", 5, {
		agreement_details_json: JSON.stringify({ correction_calendar_days: "30" }),
	}),
	window("agreement: the offer details are malformed", 5, {
		agreement_details_json: "{bad",
	}),
	window("agreement: the offer has no sent time", 40, {
		agreement_details_json: AGREED("10"),
		sent_at: null,
	}),
	{
		name: "agreement: an executed agreement says 7 business days",
		...agreementSetup(JSON.stringify({ owner: { review_business_days: "7" } })),
		steps: [
			post(draft(input({ kind: "delivery_review", review_window_days: 5 }))),
		],
	},
	{
		name: "agreement: an executed agreement beats the offer",
		...agreementSetup(
			JSON.stringify({ owner: { review_business_days: "40" } }),
		),
		steps: [
			post(draft(input({ kind: "delivery_review", review_window_days: 5 }))),
		],
	},
	{
		name: "agreement: an agreement that is not executed is ignored",
		...agreementSetup(
			JSON.stringify({ owner: { review_business_days: "7" } }),
			"client_signed",
		),
		steps: [
			post(draft(input({ kind: "delivery_review", review_window_days: 40 }))),
		],
	},
	{
		name: "agreement: an executed agreement without an owner block",
		...agreementSetup("{}"),
		steps: [
			post(draft(input({ kind: "delivery_review", review_window_days: 40 }))),
		],
	},
	// delivered deliverables
	save(
		"delivered: titles become indexes",
		draft(delivery({ delivered_deliverables: ["Docs", "Prototype"] })),
	),
	save(
		"delivered: digit text becomes an index",
		draft(delivery({ delivered_deliverables: ["2", "01"] })),
	),
	save(
		"delivered: numbers and titles mixed",
		draft(delivery({ delivered_deliverables: [0, "Deployment"] })),
	),
	save(
		"delivered: an index out of range",
		draft(delivery({ delivered_deliverables: [3] })),
	),
	save(
		"delivered: a digit text out of range",
		draft(delivery({ delivered_deliverables: ["9"] })),
	),
	save(
		"delivered: the same deliverable twice",
		draft(delivery({ delivered_deliverables: [1, 1] })),
	),
	save(
		"delivered: a number and its title",
		draft(delivery({ delivered_deliverables: [0, "Prototype"] })),
	),
	save(
		"delivered: an unknown title",
		draft(delivery({ delivered_deliverables: ["Poster"] })),
	),
	save(
		"delivered: a title with other case",
		draft(delivery({ delivered_deliverables: ["docs"] })),
	),
	save(
		"delivered: milestone two has one deliverable",
		draft(delivery({ milestone_index: 1, delivered_deliverables: [1] })),
	),
	save(
		"delivered: none chosen saves as a draft",
		draft(delivery({ delivered_deliverables: [] })),
	),
	save(
		"delivered: stored order is the order sent",
		draft(delivery({ delivered_deliverables: [2, 0, 1] })),
	),
	// stale and draft identity
	save(
		"stale: the project changed since the page loaded",
		draft(input(), { expectedProjectUpdatedAt: "2026-11-13T10:00:00.000Z" }),
	),
	save(
		"stale: the project time has no milliseconds",
		draft(input(), { expectedProjectUpdatedAt: "2026-11-13T11:00:00Z" }),
	),
	save(
		"stale: a draft is expected but none exists",
		draft(input(), { expectedUpdatedAt: EARLIER }),
	),
	save("stale: no draft is expected but one exists", draft(input()), {
		updates: [update(D1, "draft")],
	}),
	save(
		"stale: the draft time differs",
		draft(input(), { expectedUpdatedAt: "2026-11-13T10:00:00.000Z" }),
		{ updates: [update(D1, "draft")] },
	),
	save(
		"stale: updateId is not the draft's",
		draft(input(), { expectedUpdatedAt: EARLIER, updateId: D2 }),
		{ updates: [update(D1, "draft")] },
	),
	save(
		"stale: updateId equals the draft's",
		draft(input({ title: "Same id" }), {
			expectedUpdatedAt: EARLIER,
			updateId: D1,
		}),
		{ updates: [update(D1, "draft")] },
	),
	save(
		"save: a chosen updateId with no draft is used as the id",
		draft(input(), { updateId: D2 }),
	),
	save(
		"save: a chosen updateId that belongs to a shared update",
		draft(input(), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
	),
	// visual
	save(
		"visual: the draft has a picture and the text has no description",
		draft(input({ visual_alt: "" }), { expectedUpdatedAt: EARLIER }),
		{
			updates: [
				update(D1, "draft", {
					visual_key: `software/r1/${D1}/a.png`,
					visual_media_type: "image/png",
					visual_alt: "A chart",
				}),
			],
		},
	),
	save(
		"visual: the draft has a picture and keeps a description",
		draft(input({ visual_alt: "A new chart" }), { expectedUpdatedAt: EARLIER }),
		{
			updates: [
				update(D1, "draft", {
					visual_key: `software/r1/${D1}/a.png`,
					visual_media_type: "image/png",
					visual_alt: "A chart",
				}),
			],
		},
	),
	save(
		"visual: a draft with no picture saves with no description",
		draft(input(), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
	),
	// save
	save("save: a new draft with a title", draft(input({ title: "Hello" }))),
	...kindCases,
	save(
		"save: an edited draft",
		draft(input({ title: "Edited", what_changed: "More" }), {
			expectedUpdatedAt: EARLIER,
		}),
		{ updates: [update(D1, "draft")] },
	),
	save(
		"save: a draft that changes its kind",
		draft(delivery(), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
	),
	save(
		"save: a handoff draft forces its evidence type",
		draft(handoff({ evidence_type: "concept" })),
	),
	save(
		"save: a progress draft keeps the evidence type",
		draft(input({ evidence_type: "demonstration" })),
	),
	save(
		"save: email_client true stays not_requested on a draft",
		draft(input({ email_client: true })),
	),
	save(
		"save: next_update_on and links are stored",
		draft(
			input({
				next_update_on: "2026-12-01",
				links: [{ label: "Repo", url: "https://example.test/r" }],
				preview_url: "https://example.test/p",
			}),
		),
	),
	save(
		"save: empty next_update_on and preview_url store null",
		draft(input({ next_update_on: "", preview_url: "" })),
	),
	save(
		"save: the project next_update_on is not touched by a draft",
		draft(input({ next_update_on: "2026-12-01" })),
		{ project: { next_update_on: "2026-11-20" } },
	),
	save(
		"save: shared updates are not superseded by a draft",
		draft(delivery()),
		{ updates: [sharedDelivery(U1)] },
	),
	save(
		"save: a draft beside a superseded and a shared update",
		draft(input()),
		{ updates: [update(U1, "superseded"), update(D2, "shared")] },
	),
	save(
		"save: markup is stored as sent",
		draft(
			input({
				title: "<img src=x onerror=alert(1)>",
				what_changed: "a & b < c > d \"q\" 'q'",
				checks_limitations: "<b>bold</b>",
			}),
		),
	),
	save(
		"save: a very long what_changed and next_step",
		draft(
			input({
				what_changed: long(1000),
				next_step: long(300),
				client_request: long(300),
				checks_limitations: long(1000),
			}),
		),
	),
	// timestamp rule
	save(
		"time: the project time is in the future",
		draft(input(), { expectedProjectUpdatedAt: FUTURE }),
		{ project: { updated_at: FUTURE } },
	),
	save(
		"time: the draft time is in the future",
		draft(input(), { expectedUpdatedAt: FUTURE }),
		{ updates: [update(D1, "draft", { updated_at: FUTURE })] },
	),
	save(
		"time: both are earlier than the clock",
		draft(input(), {
			expectedUpdatedAt: "2026-11-13T09:00:00.000Z",
			expectedProjectUpdatedAt: "2026-11-13T10:00:00.000Z",
		}),
		{
			project: { updated_at: "2026-11-13T10:00:00.000Z" },
			updates: [
				update(D1, "draft", { updated_at: "2026-11-13T09:00:00.000Z" }),
			],
		},
	),
	save(
		"time: the project time equals the clock",
		draft(input(), { expectedProjectUpdatedAt: "2026-11-13T12:00:00.000Z" }),
		{ project: { updated_at: "2026-11-13T12:00:00.000Z" } },
	),
	// races (the batch of a draft save)
	save(
		"race: the project changed between the read and the write",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "another save moves the project",
					run: sql(
						"UPDATE software_projects SET updated_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
					),
				},
			],
		},
	),
	save(
		"race: the project was revoked",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "the access is revoked",
					run: sql(
						"UPDATE software_projects SET revoked_at='2026-11-13T11:30:00.000Z' WHERE request_id='r1'",
					),
				},
			],
		},
	),
	save(
		"race: the project was completed",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "the project completes",
					run: sql(
						"UPDATE software_projects SET state='complete' WHERE request_id='r1'",
					),
				},
			],
		},
	),
	save(
		"race: the request was withdrawn",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "the request is withdrawn",
					run: sql(
						"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
					),
				},
			],
		},
	),
	save(
		"race: the client email was erased",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "the email is erased",
					run: sql("UPDATE owner_requests SET email='' WHERE id='r1'"),
				},
			],
		},
	),
	save(
		"race: another draft was created first",
		draft(input()),
		{},
		{
			interleave: [
				{
					on: /INSERT INTO software_project_updates\(/,
					label: "another draft appears",
					run: sql(
						`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at) VALUES ('${D2}','r1','progress','draft',0,'Other','prototype','o','${EARLIER}','${EARLIER}')`,
					),
				},
			],
		},
	),
	save(
		"race: the draft was edited elsewhere",
		draft(input({ title: "Mine" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			interleave: [
				{
					on: /UPDATE software_project_updates SET kind=\?/,
					label: "the draft is edited elsewhere",
					run: sql(
						"UPDATE software_project_updates SET title='Theirs',updated_at='2026-11-13T11:45:00.000Z'",
					),
				},
			],
		},
	),
	save(
		"race: the draft was deleted",
		draft(input({ title: "Mine" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			interleave: [
				{
					on: /UPDATE software_project_updates SET kind=\?/,
					label: "the draft is deleted",
					run: sql("DELETE FROM software_project_updates"),
				},
			],
		},
	),
	save(
		"race: the draft was shared elsewhere",
		draft(input({ title: "Mine" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			interleave: [
				{
					on: /UPDATE software_project_updates SET kind=\?/,
					label: "the draft is shared elsewhere",
					run: sql(
						"UPDATE software_project_updates SET status='shared',shared_at='2026-11-13T11:45:00.000Z'",
					),
				},
			],
		},
	),
	// outages
	save(
		"outage: the first project read fails",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the project read fails twice",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					message: "D1 unavailable",
				},
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					nth: 2,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the agreement lookup fails",
		draft(input()),
		{},
		{
			failures: [
				{ on: /SELECT agreement_details_json/, message: "D1 unavailable" },
			],
		},
	),
	save(
		"outage: the draft lookup fails",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /WHERE request_id=\? AND status='draft'/,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the batch fails on a new draft",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /INSERT INTO software_project_updates\(/,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the batch fails on an edit",
		draft(input(), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			failures: [
				{
					on: /UPDATE software_project_updates SET kind=\?/,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the batch and the project re-read fail",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /INSERT INTO software_project_updates\(/,
					message: "D1 unavailable",
				},
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					nth: 2,
					message: "D1 unavailable",
				},
			],
		},
	),
	save(
		"outage: the batch fails and every project read after it",
		draft(input()),
		{},
		{
			failures: [
				{
					on: /INSERT INTO software_project_updates\(/,
					message: "D1 unavailable",
				},
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					nth: 2,
					message: "D1 unavailable",
				},
				{
					on: /SELECT \* FROM software_projects WHERE request_id/,
					nth: 3,
					message: "D1 unavailable",
				},
			],
		},
	),
	// sequences
	{
		name: "sequence: save, then save again with the new time",
		...scene(),
		steps: [
			post(draft(input({ title: "One" }))),
			post((prior) =>
				draft(input({ title: "Two" }), {
					expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: save, then repeat the first request",
		...scene(),
		steps: [
			post(draft(input({ title: "One" }))),
			post(draft(input({ title: "One" }))),
		],
	},
	{
		name: "sequence: save, then change the kind and save again",
		...scene(),
		steps: [
			post(draft(input({ title: "One" }))),
			post((prior) =>
				draft(delivery(), {
					expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: two saves in the same millisecond keep rising times",
		...scene(),
		steps: [
			post(draft(input({ title: "One" }))),
			post((prior) =>
				draft(input({ title: "Two" }), {
					expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
			post((prior) =>
				draft(input({ title: "Three" }), {
					expectedUpdatedAt: String(prior.answerJson(1).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(1).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: a save a minute later",
		...scene(),
		steps: [
			post(draft(input({ title: "One" }))),
			post(
				(prior) =>
					draft(input({ title: "Two" }), {
						expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
						expectedProjectUpdatedAt: String(
							prior.answerJson(0).projectUpdatedAt,
						),
					}),
				{ advanceMs: 60_000 },
			),
		],
	},
];

defineCorpus("owner-request-updates-draft", POST, cases);
