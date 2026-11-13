import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/brief-copy";
import {
	asClient,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	type Case,
	type FetchAnswer,
	type SeedRow,
	type Step,
} from "./harness";
import { BASE, owner, resendOk, running } from "./areas/software-projects";

// The golden corpus for POST /api/owner/requests/[id]/brief-copy: the owner sends (or re-sends) a software client a copy
// of the brief they submitted, by email.
//
// Every response branch of the handler and of deliverSoftwareBriefCopy (src/lib/software-brief-copy.ts), and the cases:
//
//   handler
//   403 {ok:false}              a visitor, a signed-in client
//   503 {ok:false}              no MUSIC_DB, no id param, empty id param
//   musicRequest (1024 bytes)   403 no or foreign Origin; 415 text/plain, form, no content type; 400 no body; 413 over
//                               1024 bytes; 400 Invalid JSON (bad JSON, empty body)
//   400 {ok:false}              null, array, string, number body; no action, other action, non-text action;
//                               confirmedNotSent not a boolean
//   404 {ok:false}              unknown id, a request that is not software (service)
//   409 "cannot be sent again"  the claim finds nothing: status sent, uncertain without confirmation, uncertain and too
//                               recent even with confirmation, resolved, withdrawn, blank email
//   503 "could not be sent"     the provider refused (failed), the network or 5xx (uncertain is still a 200), no
//                               RESEND_API_KEY / CONTACT_FROM_EMAIL / CONTACT_TO_EMAIL, the claim throws, the lookup
//                               throws (route catch), stored details that are not JSON (route catch)
//   200 {ok:true}               sent, uncertain (network down, 5xx, a timeout) because "uncertain" is truthy
//   deliverSoftwareBriefCopy    claim states: absent, failed, uncertain at 60s, uncertain at 61s with confirmation;
//                               status write: normal, throws after the provider started (uncertain, no second write),
//                               throws with no provider call (second write, failed), both writes throw (console.error),
//                               another writer changed the attempt time (write finds no row, status still returned)
//   payload                     subject with and without a summary, markup and unicode in name and summary, a one-word
//                               name, no name, long brief, each path of the brief
//
// Multi-step: send then send again (409); failed then a retry that sends; uncertain, refused, then confirmed after 61
// seconds; a 500 then a confirmed retry.

const PATH = "brief-copy";
const TABLE = { music: ["owner_requests"] };

const software = (over: SeedRow = {}) => ({
	owner_requests: [rows.softwareRequest("r1", over)],
});

const withCopy = (status: string | null, at?: string, over: SeedRow = {}) =>
	software({
		details_json: JSON.stringify({
			path: "webapp",
			appGoal: "Schedule rehearsals",
			firstVersion: "A calendar",
			clientCopyStatus: status ?? undefined,
			clientCopyAttemptedAt: at,
		}),
		...over,
	});

const GOOD = { action: "send" };

const send = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { route: PATH, dump: TABLE, ...extra });

const one = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: { seed: software() },
	fetches: resendOk,
	steps: [send(body, step)],
	...extra,
});

const resend = (...answers: FetchAnswer[]) => byHost({ resend: answers });

const oldAttempt = "2026-11-13T11:58:00.000Z";

const cases: Case[] = [
	// actor and bindings
	one("a visitor", { action: "send" }, {}, { as: asVisitor() }),
	{
		name: "a signed-in client",
		music: { seed: running() },
		fetches: resendOk,
		steps: [send(GOOD, { as: asClient("grace@example.test") })],
	},
	{
		name: "no database binding",
		music: { missing: true },
		steps: [send(GOOD)],
	},
	one("no id param", { action: "send" }, {}, { params: {} }),
	one("an empty id param", { action: "send" }, {}, { params: { id: "" } }),
	// musicRequest
	one(
		"an empty origin header",
		{ action: "send" },
		{},
		{ headers: { origin: "" } },
	),
	one(
		"a foreign origin",
		{ action: "send" },
		{},
		{ headers: { origin: "https://evil.example" } },
	),
	one(
		"a text/plain body",
		undefined,
		{},
		{ body: '{"action":"send"}', headers: { "content-type": "text/plain" } },
	),
	one(
		"a urlencoded form body",
		undefined,
		{},
		{
			body: "action=send",
			headers: { "content-type": "application/x-www-form-urlencoded" },
		},
	),
	one("no body at all", undefined),
	one("bad JSON", undefined, {}, { body: "{nope" }),
	one("an empty body", undefined, {}, { body: "" }),
	one(
		"a body over 1024 bytes",
		undefined,
		{},
		{ body: JSON.stringify({ action: "send", pad: "x".repeat(1100) }) },
	),
	// schema
	one("a null body", null),
	one("an array body", []),
	one("a string body", "send"),
	one("a number body", 7),
	one("no action", {}),
	one("another action", { action: "resend" }),
	one("an action that is not text", { action: 1 }),
	one("confirmedNotSent that is not a boolean", {
		action: "send",
		confirmedNotSent: "yes",
	}),
	one("extra fields are ignored", { action: "send", extra: 1, other: [] }),
	// request lookup
	one(
		"an unknown request id",
		{ action: "send" },
		{},
		{
			path: `${BASE}/nope/${PATH}`,
			params: { id: "nope" },
		},
	),
	{
		name: "a request that is not a software request",
		music: {
			seed: { owner_requests: [rows.ownerRequest("r1", { kind: "service" })] },
		},
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	// the claim
	{
		name: "a first send of a new request",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a request in review is sent",
		music: { seed: withCopy(null, undefined, { status: "reviewed" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a resolved request is not sent",
		music: { seed: withCopy(null, undefined, { status: "resolved" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a withdrawn request is not sent",
		music: { seed: withCopy(null, undefined, { status: "withdrawn" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a request with a blank email is not sent",
		music: { seed: withCopy(null, undefined, { email: "" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a copy already sent is not sent again",
		music: { seed: withCopy("sent", oldAttempt) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a failed copy is sent again",
		music: { seed: withCopy("failed", oldAttempt) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "an uncertain copy needs confirmation",
		music: { seed: withCopy("uncertain", oldAttempt) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "an uncertain copy is sent again once confirmed",
		music: { seed: withCopy("uncertain", oldAttempt) },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: true })],
	},
	{
		name: "an uncertain copy attempted 30 seconds ago stays held even when confirmed",
		music: { seed: withCopy("uncertain", "2026-11-13T11:59:30.000Z") },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: true })],
	},
	{
		name: "an uncertain copy attempted exactly 60 seconds ago is sent when confirmed",
		music: { seed: withCopy("uncertain", "2026-11-13T11:59:00.000Z") },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: true })],
	},
	{
		name: "an uncertain copy attempted 61 seconds ago is sent when confirmed",
		music: { seed: withCopy("uncertain", "2026-11-13T11:58:59.000Z") },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: true })],
	},
	{
		name: "an uncertain copy with no attempt time stays held",
		music: { seed: withCopy("uncertain") },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: true })],
	},
	{
		name: "confirmedNotSent false on a failed copy",
		music: { seed: withCopy("failed", oldAttempt) },
		fetches: resendOk,
		steps: [send({ action: "send", confirmedNotSent: false })],
	},
	{
		name: "a copy stuck in an unknown status is not claimed",
		music: { seed: withCopy("sending", oldAttempt) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	// provider outcomes
	{
		name: "the provider refuses with 422",
		music: { seed: withCopy(null) },
		fetches: resend(json(422, { message: "bad address" })),
		steps: [send(GOOD)],
	},
	{
		name: "the provider answers 429",
		music: { seed: withCopy(null) },
		fetches: resend(json(429, {})),
		steps: [send(GOOD)],
	},
	{
		name: "the provider answers 500: uncertain, and the route says ok",
		music: { seed: withCopy(null) },
		fetches: resend(json(500, {})),
		steps: [send(GOOD)],
	},
	{
		name: "the network is down: uncertain, and the route says ok",
		music: { seed: withCopy(null) },
		fetches: resend(networkDown()),
		steps: [send(GOOD)],
	},
	{
		name: "the provider answers 200 with an unreadable body",
		music: { seed: withCopy(null) },
		fetches: byHost({
			resend: { kind: "response", status: 200, text: "<html>", headers: {} },
		}),
		steps: [send(GOOD)],
	},
	{
		name: "no RESEND_API_KEY",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		omit: ["RESEND_API_KEY"],
		steps: [send(GOOD)],
	},
	{
		name: "no CONTACT_FROM_EMAIL",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		omit: ["CONTACT_FROM_EMAIL"],
		steps: [send(GOOD)],
	},
	{
		name: "no CONTACT_TO_EMAIL",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		omit: ["CONTACT_TO_EMAIL"],
		steps: [send(GOOD)],
	},
	// outages and races
	{
		name: "the lookup throws",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		failures: [{ on: /FROM owner_requests WHERE id=\?/, message: "d1 down" }],
		steps: [send(GOOD)],
	},
	{
		name: "the claim throws",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		failures: [{ on: /clientCopyStatus','uncertain'/, message: "d1 down" }],
		steps: [send(GOOD)],
	},
	{
		name: "the status write throws after the provider answered",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		failures: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				message: "d1 down",
			},
		],
		steps: [send(GOOD)],
	},
	{
		name: "the status write throws after a refusal",
		music: { seed: withCopy(null) },
		fetches: resend(json(400, {})),
		failures: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				message: "d1 down",
			},
		],
		steps: [send(GOOD)],
	},
	{
		name: "the claim succeeds, a key is missing, and the status write throws",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		omit: ["RESEND_API_KEY"],
		failures: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				message: "d1 down",
			},
		],
		steps: [send(GOOD)],
	},
	{
		name: "every status write throws with no provider call",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		omit: ["RESEND_API_KEY"],
		failures: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				message: "d1 down",
			},
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus','failed'\)/,
				message: "d1 down",
			},
		],
		steps: [send(GOOD)],
	},
	{
		name: "another writer changes the attempt time before the status write",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		interleave: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				label: "another send re-claims the copy",
				run: (sqlite) =>
					sqlite.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyAttemptedAt','2026-11-13T12:00:05.000Z')`,
					),
			},
		],
		steps: [send(GOOD)],
	},
	{
		name: "the request is withdrawn after the claim",
		music: { seed: withCopy(null) },
		fetches: resendOk,
		interleave: [
			{
				on: /json_set\(details_json,'\$\.clientCopyStatus',\?\)/,
				label: "the request is withdrawn",
				run: (sqlite) =>
					sqlite.exec(`UPDATE owner_requests SET status='withdrawn'`),
			},
		],
		steps: [send(GOOD)],
	},
	// stored data the route trusts
	{
		name: "stored details that are not JSON",
		music: { seed: software({ details_json: "not json" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "stored details that are an array",
		music: { seed: software({ details_json: "[]" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	// payload
	{
		name: "a brief with markup and unicode, and a one-word name",
		music: {
			seed: software({
				name: "Zoë",
				summary: '<b>Tom & Jerry\'s</b> "tool" ☃',
				details_json: JSON.stringify({
					path: "idea",
					idea: "<script>alert(1)</script> & more",
					audienceToday: "Zoë's band",
					firstVersion: "v1",
					signal: "x".repeat(900),
					timing: "date",
					timingDate: "2027-01-01",
					budgetStatus: "range",
					approver: "other",
					approverRole: "Treasurer <ops>",
				}),
			}),
		},
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a request with no name and no summary",
		music: { seed: software({ name: "", summary: "" }) },
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	{
		name: "a website brief with every question",
		music: {
			seed: software({
				name: "  Grace   Brewster Hopper ",
				details_json: JSON.stringify({
					path: "website",
					purpose: "A band site",
					currentUrl: "https://band.example",
					existing: "yes",
					updates: "monthly",
					company: "Hopper LLC",
				}),
			}),
		},
		fetches: resendOk,
		steps: [send(GOOD)],
	},
	// sequences
	{
		name: "send, then send again",
		music: { seed: software() },
		fetches: resendOk,
		steps: [send(GOOD), send(GOOD, { advanceMs: 120_000 })],
	},
	{
		name: "a refusal, then a retry that sends",
		music: { seed: software() },
		fetches: resend(json(400, {}), json(200, {})),
		steps: [send(GOOD), send(GOOD, { advanceMs: 1000 })],
	},
	{
		name: "a network failure, a retry without confirmation, then confirmed after 61 seconds",
		music: { seed: software() },
		fetches: resend(networkDown(), json(200, {})),
		steps: [
			send(GOOD),
			send(GOOD, { advanceMs: 120_000 }),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 1000 }),
		],
	},
	{
		name: "a 500, then a confirmed retry inside 60 seconds, then after",
		music: { seed: software() },
		fetches: resend(json(500, {}), json(200, {})),
		steps: [
			send(GOOD),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 30_000 }),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 31_000 }),
		],
	},
	{
		name: "a withdrawn request after a first send",
		music: { seed: software() },
		fetches: resendOk,
		steps: [
			send(GOOD),
			send(GOOD, {
				advanceMs: 1000,
				before: {
					label: "the request is withdrawn",
					run: (world) => {
						world.music.exec(`UPDATE owner_requests SET status='withdrawn'`);
					},
				},
			}),
		],
	},
];

defineCorpus("owner-request-brief-copy", POST, cases);
