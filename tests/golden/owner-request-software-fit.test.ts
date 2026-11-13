import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	BASE,
	EARLIER,
	NOW,
	offer,
	ORIGIN,
	project,
	projectTables,
	raw,
	request,
	secondsFromNow,
	withOffers,
} from "./areas/software-offers";
import {
	asClient,
	asClientCookie,
	asVisitor,
	defineCorpus,
	generatedBody,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";

// The golden corpus for the fit review action, and for every guard in front of the actions, of
// POST /api/owner/requests/[id]/software: the owner records whether a software request looks like a fit
// (potential-fit, needs-clarification, stated-mismatch) with a private note. The other actions have their own files
// (owner-request-software-question, -decline, -revoke, -offer-draft, -offer-send, -offer-signing); they share the
// guards below, which are recorded here with the fit action as the carrier.
//
// Every response branch that a fit command can reach, and the cases that reach it:
//
//   guards before the action (cache-control private, no-store, unless the answer comes from musicRequest)
//   403 {ok:false}                        a visitor, a forged studio cookie, a signed-in studio client
//   503 {ok:false}                        no MUSIC_DB, no id param, an empty id param
//   403 {ok:false,error:"Forbidden"}      musicRequest: no Origin header, another origin (no cache-control header)
//   415 {ok:false,error:"JSON required"}  musicRequest: no content type, text/plain, form content type
//   400 {ok:false,error:"Missing request"}  musicRequest: a JSON content type and no body at all
//   413 {ok:false,error:"Request too large"}  musicRequest: one byte over 80 KiB (exactly 80 KiB reads and fails to parse)
//   400 {ok:false,error:"Invalid JSON"}   musicRequest: bad JSON, an empty body
//   400 {ok:false,message:"Check the required fields..."}  schema: null, array, string, number, unknown or missing action,
//                                         upper-case action, bad label, missing or over-long note, wrong types
//   404 {ok:false}                        an unknown id, a request of another kind
//   409 closed ("This request is closed.")   a withdrawn request, a request with an empty email
//   409 resolved ("...Reopen it to make a new offer.")  a resolved request
//   (the project-started 409 does not apply to fit: a started project still takes a fit note)
//   fit
//   409 stale ("The request changed or could not be saved...")  expectedRequestUpdatedAt that is stale, empty, the wrong
//                                         time format; the batch guard fails (updated_at, status or email moved in a race);
//                                         the batch throws (outage); a stale second fit in a sequence
//   (a request whose stored details_json is not JSON, an array or null is read before any try block: see the cases)
//   200 {ok:true,updatedAt}               every label on a new and a reviewed request, an empty note, a note trimmed, a
//                                         note of 500 characters, unicode and markup stored as written, a request with a
//                                         started project, a request whose updated_at is ahead of the clock (the new
//                                         time is one millisecond later), a repeat that updates the same review row
//   effects: one batch of four statements (guard, upsert review, update owner_requests.updated_at, audit "fit-reviewed")
//   or one rolled-back batch; no email, no R2, no outgoing fetch.

const fit = (over: { [key: string]: JsonValue } = {}): JsonValue => ({
	action: "fit",
	label: "potential-fit",
	note: "Clear scope, one user.",
	...over,
});

const FIT_TABLES = [
	"owner_requests",
	"owner_request_audit",
	"software_fit_reviews",
];

const dumpFit = { music: FIT_TABLES };

const fitStep = (
	body: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => act(body, { dump: dumpFit, ...extra });

const fitCase = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: { seed: withOffers([]) },
	steps: [fitStep(body, step)],
	...extra,
});

const statusCase = (
	name: string,
	status: string,
	over: SeedRow = {},
): Case => ({
	name,
	music: { seed: withOffers([], {}, { status, ...over }) },
	steps: [fitStep(fit())],
});

const moveUpdatedAt =
	(to: string) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(`UPDATE owner_requests SET updated_at='${to}'`);

const cases: Case[] = [
	// who is asking
	fitCase("a visitor", fit(), {}, { as: asVisitor() }),
	fitCase(
		"a forged studio cookie",
		fit(),
		{},
		{ as: asClientCookie("forged") },
	),
	{
		name: "a signed-in studio client",
		music: {
			seed: {
				owner_requests: [
					request(),
					rows.ownerRequest("c1", {
						kind: "service",
						email: "client@example.test",
					}),
				],
			},
		},
		steps: [fitStep(fit(), { as: asClient("client@example.test") })],
	},
	// bindings
	{
		name: "no database binding",
		music: { missing: true },
		steps: [fitStep(fit())],
	},
	fitCase("no id param", fit(), {}, { params: {} }),
	fitCase("an empty id param", fit(), {}, { params: { id: "" } }),
	// musicRequest
	fitCase("no Origin header", fit(), {}, { headers: {} }),
	fitCase(
		"another Origin",
		fit(),
		{},
		{ headers: { origin: "https://evil.example.test" } },
	),
	fitCase(
		"an Origin with the right host over http",
		fit(),
		{},
		{ headers: { origin: "http://thesuperhuman.us" } },
	),
	fitCase(
		"no content type",
		undefined,
		{},
		{
			json: undefined,
			body: JSON.stringify(fit()),
			headers: { origin: ORIGIN },
		},
	),
	fitCase(
		"a text/plain content type",
		undefined,
		{},
		{
			json: undefined,
			body: JSON.stringify(fit()),
			headers: { origin: ORIGIN, "content-type": "text/plain" },
		},
	),
	fitCase(
		"a form content type",
		undefined,
		{},
		{
			json: undefined,
			body: "action=fit&label=potential-fit&note=x",
			headers: {
				origin: ORIGIN,
				"content-type": "application/x-www-form-urlencoded",
			},
		},
	),
	fitCase(
		"a JSON content type with a charset",
		undefined,
		{},
		{
			json: undefined,
			body: JSON.stringify(fit()),
			headers: {
				origin: ORIGIN,
				"content-type": "application/json; charset=utf-8",
			},
		},
	),
	fitCase(
		"no body at all",
		undefined,
		{},
		{
			json: undefined,
			body: undefined,
			headers: { origin: ORIGIN, "content-type": "application/json" },
		},
	),
	{
		name: "a body one byte over 80 KiB",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(undefined, {
				json: undefined,
				body: generatedBody(80 * 1024 + 1),
				headers: { origin: ORIGIN, "content-type": "application/json" },
			}),
		],
	},
	{
		name: "a body of exactly 80 KiB that is not JSON",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(undefined, {
				json: undefined,
				body: generatedBody(80 * 1024),
				headers: { origin: ORIGIN, "content-type": "application/json" },
			}),
		],
	},
	{
		name: "a JSON body of just under 80 KiB with a note that is too long",
		music: { seed: withOffers([]) },
		steps: [fitStep(fit({ note: "x".repeat(79 * 1024) }))],
	},
	{
		name: "bad JSON",
		music: { seed: withOffers([]) },
		steps: [raw("{not json", { dump: dumpFit })],
	},
	{
		name: "an empty body",
		music: { seed: withOffers([]) },
		steps: [raw("", { dump: dumpFit })],
	},
	// the schema
	fitCase("a null body", null),
	fitCase("an array body", []),
	fitCase("a string body", "fit"),
	fitCase("a number body", 5),
	fitCase("no action", { label: "potential-fit", note: "x" }),
	fitCase("an unknown action", { action: "delete" }),
	fitCase("an upper-case action", fit({ action: "FIT" })),
	fitCase("an action that is not text", fit({ action: 5 })),
	fitCase("a label that is not allowed", fit({ label: "great-fit" })),
	fitCase("no label", { action: "fit", note: "x" }),
	fitCase("a label that is not text", fit({ label: 3 })),
	fitCase("no note", { action: "fit", label: "potential-fit" }),
	fitCase("a note that is not text", fit({ note: 12 })),
	fitCase("a note of null", fit({ note: null })),
	fitCase("a note over 500 characters", fit({ note: "n".repeat(501) })),
	fitCase(
		"a note over 500 characters before trimming and 500 after",
		fit({ note: ` ${"n".repeat(500)} ` }),
	),
	fitCase("a note of exactly 500 characters", fit({ note: "n".repeat(500) })),
	fitCase(
		"an expectedRequestUpdatedAt that is not text",
		fit({
			expectedRequestUpdatedAt: 5,
		}),
	),
	fitCase(
		"an expectedRequestUpdatedAt of null",
		fit({
			expectedRequestUpdatedAt: null,
		}),
	),
	// the request
	{
		name: "an unknown request id",
		music: { seed: withOffers([]) },
		steps: [fitStep(fit(), { path: `${BASE}/nope`, params: { id: "nope" } })],
	},
	{
		name: "a request of another kind",
		music: {
			seed: { owner_requests: [rows.ownerRequest("r1", { kind: "service" })] },
		},
		steps: [fitStep(fit())],
	},
	{
		name: "a purchase request",
		music: {
			seed: { owner_requests: [rows.ownerRequest("r1", { kind: "purchase" })] },
		},
		steps: [fitStep(fit())],
	},
	statusCase("a withdrawn request", "withdrawn"),
	statusCase("a request with an empty email", "reviewed", { email: "" }),
	statusCase("a withdrawn request with an empty email", "withdrawn", {
		email: "",
	}),
	statusCase("a resolved request", "resolved"),
	statusCase("a request whose stored details are not JSON", "reviewed", {
		details_json: "{bad",
	}),
	statusCase("a request whose stored details are an array", "reviewed", {
		details_json: "[]",
	}),
	statusCase("a request whose stored details are null", "reviewed", {
		details_json: "null",
	}),
	statusCase("a request whose stored details are a company text", "reviewed", {
		details_json: JSON.stringify({ company: "Hopper & Co <b>", paths: "x" }),
	}),
	statusCase("a new request", "new"),
	statusCase("a reviewed request", "reviewed"),
	// the three labels
	fitCase(
		"the needs-clarification label",
		fit({ label: "needs-clarification" }),
	),
	fitCase("the stated-mismatch label", fit({ label: "stated-mismatch" })),
	// the note
	fitCase("an empty note", fit({ note: "" })),
	fitCase("a note of only spaces", fit({ note: "   " })),
	fitCase("a note with spaces around it", fit({ note: "  call on Friday  " })),
	fitCase(
		"a note with unicode",
		fit({ note: "Café, 日本語, 🙂 and a nbsp here" }),
	),
	fitCase(
		"a note with markup",
		fit({
			note: `<script>alert("x")</script> & 'quotes' <b>bold</b>`,
		}),
	),
	fitCase(
		"a note with newlines and tabs",
		fit({ note: "line one\n\nline two\tend" }),
	),
	fitCase("extra fields are dropped", fit({ extra: true, status: "resolved" })),
	// expectedRequestUpdatedAt
	fitCase(
		"a matching expectedRequestUpdatedAt",
		fit({
			expectedRequestUpdatedAt: EARLIER,
		}),
	),
	fitCase(
		"a stale expectedRequestUpdatedAt",
		fit({
			expectedRequestUpdatedAt: "2026-11-13T10:00:00.000Z",
		}),
	),
	fitCase(
		"an empty expectedRequestUpdatedAt",
		fit({
			expectedRequestUpdatedAt: "",
		}),
	),
	fitCase(
		"an expectedRequestUpdatedAt in another time format",
		fit({
			expectedRequestUpdatedAt: "2026-11-13T11:00:00Z",
		}),
	),
	// the clock
	{
		name: "a request whose updated_at is ahead of the clock",
		music: {
			seed: withOffers([], {}, { updated_at: secondsFromNow(3600) }),
		},
		steps: [fitStep(fit())],
	},
	{
		name: "a request whose updated_at is the same millisecond as the clock",
		music: { seed: withOffers([], {}, { updated_at: NOW }) },
		steps: [fitStep(fit())],
	},
	// started project and other rows around the request
	{
		name: "a request with a started project still takes a fit note",
		music: {
			seed: withOffers([offer("sent")], { software_projects: [project()] }),
		},
		steps: [
			fitStep(fit(), { dump: { music: [...FIT_TABLES, ...projectTables] } }),
		],
	},
	{
		name: "a request with a client-signed agreement still takes a fit note",
		music: {
			seed: {
				...rows.agreementBase(),
				...withOffers([offer("sent")]),
				software_agreements: [rows.agreement("a1", "r1", "o1")],
			},
		},
		steps: [fitStep(fit())],
	},
	{
		name: "a request with a draft and a sent offer",
		music: { seed: withOffers([offer("sent"), offer("draft", 2)]) },
		steps: [
			fitStep(fit(), { dump: { music: [...FIT_TABLES, "software_offers"] } }),
		],
	},
	// sequences
	{
		name: "two fit notes: the second updates the review row",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(fit({ note: "first", expectedRequestUpdatedAt: EARLIER })),
			fitStep(
				fit({
					label: "needs-clarification",
					note: "second",
					expectedRequestUpdatedAt: NOW,
				}),
				{ advanceMs: 60_000 },
			),
		],
	},
	{
		name: "a fit note with the first answer's old updatedAt is stale",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(fit({ expectedRequestUpdatedAt: EARLIER })),
			fitStep(fit({ expectedRequestUpdatedAt: EARLIER }), {
				advanceMs: 60_000,
			}),
		],
	},
	{
		name: "the same fit note sent twice in one millisecond",
		music: { seed: withOffers([]) },
		steps: [fitStep(fit()), fitStep(fit())],
	},
	{
		name: "a fit note after the request was withdrawn",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(fit()),
			fitStep(fit(), {
				advanceMs: 1000,
				before: {
					label: "the client withdraws the request",
					run: (world) =>
						world.music.exec("UPDATE owner_requests SET status='withdrawn'"),
				},
			}),
		],
	},
	// races
	fitCase("a fit that loses a race on updated_at", fit(), {
		interleave: [
			{
				on: /INSERT INTO software_fit_reviews/,
				label: "another change moves updated_at",
				run: moveUpdatedAt("2026-11-13T11:30:00.000Z"),
			},
		],
	}),
	fitCase("a fit that loses a race on status", fit(), {
		interleave: [
			{
				on: /INSERT INTO software_fit_reviews/,
				label: "the request is resolved",
				run: (sqlite) =>
					sqlite.exec("UPDATE owner_requests SET status='resolved'"),
			},
		],
	}),
	fitCase("a fit that loses a race on the email", fit(), {
		interleave: [
			{
				on: /INSERT INTO software_fit_reviews/,
				label: "the email is cleared",
				run: (sqlite) => sqlite.exec("UPDATE owner_requests SET email=''"),
			},
		],
	}),
	// outages
	fitCase("the first read fails", fit(), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	fitCase("the fit batch fails", fit(), {
		failures: [
			{ on: /INSERT INTO software_fit_reviews/, message: "D1 is down" },
		],
	}),
	{
		name: "the fit batch fails after an earlier fit",
		music: { seed: withOffers([]) },
		steps: [
			fitStep(fit({ note: "first" })),
			fitStep(fit({ note: "second" }), { advanceMs: 1000 }),
		],
		failures: [
			{
				on: /INSERT INTO software_fit_reviews/,
				nth: 2,
				message: "D1 is down",
			},
		],
	},
];

defineCorpus("owner-request-software-fit", POST, cases);
