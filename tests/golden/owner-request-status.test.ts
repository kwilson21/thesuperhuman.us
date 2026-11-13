import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for POST /api/owner/requests/[id]: the owner changes a request's status (review, resolve, reopen,
// withdraw) or its private note. It is the worked example for tests/golden/README.md: single steps, multi-step
// sequences, races made with `interleave`, outages made with `failures`, and the software guards.
//
// Every response branch of the handler and of changeOwnerRequest (src/lib/owner-requests.ts), and its cases:
//
//   handler
//   403 no owner                          a visitor, a signed-in client
//   503 no MUSIC_DB or no id param        no database binding, no id param, empty id param
//   400 body is not JSON                  bad JSON, empty body
//   400 body fails the schema             array body, unknown action, missing action, action not text, note missing,
//                                         note not text, note over 1000, expectedUpdatedAt not text
//   200 changed                           every valid transition, notes, extra fields dropped
//   404 "Request not found."              unknown id
//   409 with no message                   stale expectedUpdatedAt, invalid transition, invalid actor, lost race, outage,
//                                         deposit block text (not one of the four messages shown to the owner)
//   409 with a message                    signed agreement pending, project started, project incomplete, offer sending
//   changeOwnerRequest
//   status x action                       the 16 plain-request transition cases (8 valid, 8 invalid)
//   note                                  note on each status, trimmed, cleared, over-long after trim, note race, outage
//   expectedUpdatedAt                     matching, stale, stale after an earlier step (multi-step)
//   software withdraw                     no extras, active project revoked, countersign pending (pre-check and race),
//                                         open deposit (pre-check and race), paid deposit allowed, refunded deposit
//                                         allowed, offer sending, old live link revoked, updated_at race
//   software resolve                      no project, completed project, revoked project, project in progress
//                                         (pre-check and race), countersign pending, signing retired
//   software reopen                       no project, project present (pre-check and race)
//   lost race, plain request              updated_at changed, status changed
//   outage                                first read fails, transition batch fails, note batch fails

const EARLIER = "2026-11-13T11:00:00.000Z";
const NOW = "2026-11-13T12:00:00.000Z";
const BASE = "/api/owner/requests";

const withStatus = (status: string, over: SeedRow = {}) => ({
	owner_requests: [rows.ownerRequest("r1", { status, ...over })],
});

const change = (
	body: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	path: `${BASE}/r1`,
	params: { id: "r1" },
	json: body,
	dump: { music: ["owner_requests", "owner_request_audit"] },
	...extra,
});

const plainCase = (
	name: string,
	status: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: withStatus(status) },
	steps: [change(body)],
	...extra,
});

const ACTIONS = ["review", "resolve", "reopen", "withdraw"] as const;
const STATUSES = ["new", "reviewed", "resolved", "withdrawn"] as const;

const transitions: Case[] = STATUSES.flatMap((status) =>
	ACTIONS.map((action) =>
		plainCase(`${action} a ${status} request`, status, { action }),
	),
);

const notes: Case[] = STATUSES.map((status) =>
	plainCase(`note on a ${status} request`, status, {
		action: "note",
		note: "  call on Friday  ",
	}),
);

// A software request with an offer, as a case seeds it.
const software = (
	extra: { [table: string]: SeedRow[] } = {},
	status = "reviewed",
) => ({
	owner_requests: [rows.softwareRequest("r1", { status })],
	software_offers: [rows.softwareOffer("o1", "r1")],
	...extra,
});

const softwareTables = [
	"owner_requests",
	"owner_request_audit",
	"software_offers",
	"software_offer_links",
	"software_projects",
	"software_project_audit",
	"software_agreements",
	"audio_client_sessions",
	"audio_client_codes",
];

const softwareStep = (action: string, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: `${BASE}/r1`,
	params: { id: "r1" },
	json: { action },
	dump: { music: softwareTables },
	...extra,
});

const softwareCase = (
	name: string,
	action: string,
	seed: { [table: string]: SeedRow[] },
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed },
	steps: [softwareStep(action)],
	...extra,
});

const signedAgreement = {
	...rows.agreementBase(),
	software_agreements: [rows.agreement("a1", "r1", "o1")],
};

const reviewAgreement = {
	...rows.agreementBase(),
	software_agreements: [rows.agreement("a1", "r1", "o1", { status: "review" })],
};

const project = (over: SeedRow = {}) => [
	rows.softwareProject("r1", "o1", over),
];

const lateSigned = (sqlite: { exec: (sql: string) => void }) => {
	sqlite.exec(
		`INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES ('template-msa','msa',1,'MSA','${"0".repeat(64)}','${EARLIER}','o');
     INSERT INTO software_agreement_clients(id,recipient_email,legal_name,legal_name_key,entity_type,jurisdiction,business_address,notice_email,created_at) VALUES ('client-1','grace@example.test','G','g','llc','VA','a','grace@example.test','${EARLIER}');
     INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES ('a1','msa','o1','r1','client-1','template-msa','client_signed','MSA','${"0".repeat(64)}','{}','${EARLIER}','2026-11-13','h')`,
	);
};

const cases: Case[] = [
	// 403
	{
		name: "not the owner: a visitor",
		music: { seed: withStatus("new") },
		steps: [change({ action: "review" }, { as: asVisitor() })],
	},
	// 503
	{
		name: "no database binding",
		music: { missing: true },
		steps: [change({ action: "review" })],
	},
	{
		name: "no id param",
		music: { seed: withStatus("new") },
		steps: [change({ action: "review" }, { params: {} })],
	},
	{
		name: "an empty id param",
		music: { seed: withStatus("new") },
		steps: [change({ action: "review" }, { params: { id: "" } })],
	},
	// 400
	plainCase("bad JSON", "new", undefined, {
		steps: [change(undefined, { body: "{not json" })],
	}),
	plainCase("an empty body", "new", undefined, {
		steps: [change(undefined, { body: "" })],
	}),
	plainCase("an array body", "new", []),
	plainCase("an unknown action", "new", { action: "delete" }),
	plainCase("no action", "new", {}),
	plainCase("an action that is not text", "new", { action: 5 }),
	plainCase("a note action with no note", "new", { action: "note" }),
	plainCase("a note that is not text", "new", { action: "note", note: 12 }),
	plainCase("a note over 1000 characters", "new", {
		action: "note",
		note: "a".repeat(1001),
	}),
	plainCase("a note of 1000 characters with spaces around it", "new", {
		action: "note",
		note: ` ${"a".repeat(1000)} `,
	}),
	plainCase("an expectedUpdatedAt that is not text", "new", {
		action: "review",
		expectedUpdatedAt: 5,
	}),
	plainCase("a review with extra fields", "new", {
		action: "review",
		note: "ignored",
		extra: true,
	}),
	plainCase("a note cleared with an empty note", "new", {
		action: "note",
		note: "",
	}),
	// 404
	{
		name: "an unknown request id",
		music: { seed: withStatus("new") },
		steps: [
			change(
				{ action: "review" },
				{ path: `${BASE}/nope`, params: { id: "nope" } },
			),
		],
	},
	// actor
	{
		name: "an owner email that is blank",
		music: { seed: withStatus("new") },
		steps: [change({ action: "review" }, { as: asOwner("   ") })],
	},
	{
		name: "an owner email over 320 characters",
		music: { seed: withStatus("new") },
		steps: [
			change(
				{ action: "review" },
				{ as: asOwner(`${"a".repeat(320)}@x.test`) },
			),
		],
	},
	{
		name: "an owner email in capitals is stored in lower case",
		music: { seed: withStatus("new") },
		steps: [
			change({ action: "review" }, { as: asOwner("Owner@Example.TEST") }),
		],
	},
	// the 16 transitions and the 4 notes
	...transitions,
	...notes,
	// expectedUpdatedAt
	plainCase("a matching expectedUpdatedAt", "new", {
		action: "review",
		expectedUpdatedAt: EARLIER,
	}),
	plainCase("a stale expectedUpdatedAt", "new", {
		action: "review",
		expectedUpdatedAt: "2026-11-13T10:00:00.000Z",
	}),
	// multi-step sequences
	{
		name: "review, then a stale resolve, then a fresh resolve",
		music: { seed: withStatus("new") },
		steps: [
			change({ action: "review", expectedUpdatedAt: EARLIER }),
			change(
				{ action: "resolve", expectedUpdatedAt: EARLIER },
				{ advanceMs: 60_000 },
			),
			change({ action: "resolve", expectedUpdatedAt: NOW }),
		],
	},
	{
		name: "the whole life: review, resolve, reopen, withdraw, review again",
		music: { seed: withStatus("new") },
		steps: [
			change({ action: "review" }, { advanceMs: 1000 }),
			change({ action: "resolve" }, { advanceMs: 1000 }),
			change({ action: "reopen" }, { advanceMs: 1000 }),
			change({ action: "withdraw" }, { advanceMs: 1000 }),
			change({ action: "review" }, { advanceMs: 1000 }),
		],
	},
	{
		name: "the same review sent twice",
		music: { seed: withStatus("new") },
		steps: [change({ action: "review" }), change({ action: "review" })],
	},
	{
		name: "two notes in a row, the second with the first's updatedAt",
		music: { seed: withStatus("new") },
		steps: [
			change({ action: "note", note: "first", expectedUpdatedAt: EARLIER }),
			change(
				{ action: "note", note: "second", expectedUpdatedAt: NOW },
				{ advanceMs: 5000 },
			),
			change(
				{ action: "note", note: "third", expectedUpdatedAt: NOW },
				{ advanceMs: 5000 },
			),
		],
	},
	{
		name: "a note after a withdraw",
		music: { seed: withStatus("reviewed") },
		steps: [
			change({ action: "withdraw" }, { advanceMs: 1000 }),
			change({ action: "note", note: "closing note" }, { advanceMs: 1000 }),
		],
	},
	// races on a plain request
	plainCase(
		"a plain review that loses a race on updated_at",
		"new",
		{ action: "review" },
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "another change moves updated_at",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	plainCase(
		"a plain review that loses a race on status",
		"new",
		{ action: "review" },
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "another change withdraws the request",
					run: (sqlite) =>
						sqlite.exec(`UPDATE owner_requests SET status='withdrawn'`),
				},
			],
		},
	),
	plainCase(
		"a note that loses a race on updated_at",
		"new",
		{ action: "note", note: "x" },
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET private_note/,
					label: "another change moves updated_at",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	// outages
	plainCase(
		"the first read fails",
		"new",
		{ action: "review" },
		{
			failures: [
				{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
			],
		},
	),
	plainCase(
		"the transition batch fails",
		"new",
		{ action: "review" },
		{
			failures: [
				{ on: /UPDATE owner_requests SET status/, message: "D1 is down" },
			],
		},
	),
	plainCase(
		"the note batch fails",
		"new",
		{ action: "note", note: "x" },
		{
			failures: [
				{ on: /UPDATE owner_requests SET private_note/, message: "D1 is down" },
			],
		},
	),
	// software withdraw
	softwareCase(
		"withdraw a software request with nothing attached",
		"withdraw",
		software(),
	),
	softwareCase(
		"withdraw a software request with an old live offer link",
		"withdraw",
		software({ software_offer_links: [rows.offerLink("r1")] }),
	),
	softwareCase(
		"withdraw a software request while its offer is still sending",
		"withdraw",
		software({
			software_offer_links: [
				rows.offerLink("r1", { created_at: "2026-11-13T11:59:50.000Z" }),
			],
		}),
	),
	softwareCase(
		"withdraw a software request with a signed agreement waiting for countersignature",
		"withdraw",
		software(signedAgreement),
	),
	softwareCase(
		"withdraw a software request with an open deposit invoice",
		"withdraw",
		software({ software_invoices: [rows.softwareInvoice("i1", "r1", "o1")] }),
	),
	softwareCase(
		"withdraw a software request with a paid deposit",
		"withdraw",
		software({
			software_invoices: [
				rows.softwareInvoice("i1", "r1", "o1", { status: "paid" }),
			],
		}),
	),
	softwareCase(
		"withdraw a software request with a void deposit invoice",
		"withdraw",
		software({
			software_invoices: [
				rows.softwareInvoice("i1", "r1", "o1", { status: "void" }),
			],
		}),
	),
	softwareCase(
		"withdraw a software request with a running project, client sessions and an unsigned agreement",
		"withdraw",
		software({
			...reviewAgreement,
			software_projects: project(),
			audio_client_sessions: [
				{
					token_hash: "t1",
					email: "grace@example.test",
					created_at: EARLIER,
					expires_at: "2026-12-01T00:00:00.000Z",
					last_seen_at: EARLIER,
				},
			],
			audio_client_codes: [
				{
					email: "grace@example.test",
					code_hash: "c1",
					created_at: EARLIER,
					expires_at: "2026-12-01T00:00:00.000Z",
				},
			],
		}),
	),
	softwareCase(
		"withdraw a software request when a countersignature arrives after the check",
		"withdraw",
		software(),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "the client signs",
					run: lateSigned,
				},
			],
		},
	),
	softwareCase(
		"withdraw a software request when a deposit invoice opens after the check",
		"withdraw",
		software(),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "a deposit invoice is created",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES ('i9','r1','o1',0,'deposit',50000,7,'open','o','${EARLIER}','${EARLIER}')`,
						),
				},
			],
		},
	),
	softwareCase(
		"withdraw a software request that loses a race on updated_at",
		"withdraw",
		software(),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "another change moves updated_at",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	softwareCase(
		"withdraw a software request already withdrawn",
		"withdraw",
		software({}, "withdrawn"),
	),
	// software resolve
	softwareCase(
		"resolve a software request with no project",
		"resolve",
		software(),
	),
	softwareCase(
		"resolve a software request with a completed project",
		"resolve",
		software({
			software_projects: project({ completed_at: EARLIER, state: "complete" }),
		}),
	),
	softwareCase(
		"resolve a software request with a revoked project",
		"resolve",
		software({ software_projects: project({ revoked_at: EARLIER }) }),
	),
	softwareCase(
		"resolve a software request with a project in progress",
		"resolve",
		software({ software_projects: project() }),
	),
	softwareCase(
		"resolve a software request with a signed agreement waiting for countersignature",
		"resolve",
		software(signedAgreement),
	),
	softwareCase(
		"resolve a software request and retire its unsigned agreement and offer link",
		"resolve",
		software({
			...reviewAgreement,
			software_offer_links: [rows.offerLink("r1")],
		}),
	),
	softwareCase(
		"resolve a software request when a project starts after the check",
		"resolve",
		software(),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "the project is started",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','{}','standard','${EARLIER}','${EARLIER}','${EARLIER}','o','${EARLIER}','${EARLIER}')`,
						),
				},
			],
		},
	),
	// software reopen
	softwareCase(
		"reopen a resolved software request with no project",
		"reopen",
		software({}, "resolved"),
	),
	softwareCase(
		"reopen a resolved software request that has a project",
		"reopen",
		software(
			{ software_projects: project({ completed_at: EARLIER }) },
			"resolved",
		),
	),
	softwareCase(
		"reopen a resolved software request when a project starts after the check",
		"reopen",
		software({}, "resolved"),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status/,
					label: "the project is started",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','{}','standard','${EARLIER}','${EARLIER}','${EARLIER}','o','${EARLIER}','${EARLIER}')`,
						),
				},
			],
		},
	),
	softwareCase("review a software request", "review", software({}, "new")),
	{
		name: "a software request resolved, reopened, then withdrawn",
		music: {
			seed: software({ software_offer_links: [rows.offerLink("r1")] }, "new"),
		},
		steps: [
			softwareStep("resolve", { advanceMs: 1000 }),
			softwareStep("reopen", { advanceMs: 1000 }),
			softwareStep("withdraw", { advanceMs: 1000 }),
		],
	},
	{
		name: "a software request with a project is withdrawn, then reopen is refused",
		music: { seed: software({ software_projects: project() }) },
		steps: [
			softwareStep("withdraw", { advanceMs: 1000 }),
			softwareStep("reopen", { advanceMs: 1000 }),
		],
	},
	{
		name: "a purchase request is withdrawn",
		music: {
			seed: {
				owner_requests: [
					rows.ownerRequest("r1", { kind: "purchase", status: "reviewed" }),
				],
			},
		},
		steps: [change({ action: "withdraw" })],
	},
	{
		name: "not the owner: a signed-in studio client",
		music: { seed: withStatus("new") },
		steps: [
			change({ action: "review" }, { as: asClient("grace@example.test") }),
		],
	},
];

defineCorpus("owner-request-status", POST, cases);
