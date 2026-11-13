import { POST } from "~/pages/api/owner/projects/[id]/invitation";
import {
	asClient,
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	text,
	type Case,
	type Step,
} from "./harness";
import {
	EARLIER,
	rawStep,
	resendOk,
	routeStep,
	service,
	sql,
	world,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/invitation: the owner queues the studio invitation email for a
// project (the "send" action, with confirmedNotSent for a send that may have gone out) and, after the response,
// `ctx.waitUntil` delivers it (deliverProjectInvitation in src/lib/audio-project-invitations.ts).
//
// Invitation states (audio_projects.invitation_status): pending, sending, sent, failed. queueProjectInvitation moves
// pending, failed (and a sending row older than 60 s when confirmedNotSent is true) back to pending, for a project that
// is not revoked and whose request is a service request, not withdrawn, with an email.
//
// Response branches of the handler, and the cases that reach them (case names start with the topic):
//
//   403 {ok:false}                      "not the owner": visitor, signed-in studio client
//   404 "Not found"                     "portal flag": off, "True", unset, flag off wins over no database
//   503 "Project invitations ..."       "unavailable": no MUSIC_DB, no id param, empty id param, no ctx
//   musicRequest (the 1024 byte cap)    "origin" (403), "content type" (415), "no request body" (400), "body over 1024
//                                       bytes" (413; one of exactly 1024 reaches the schema), "invalid JSON" (400)
//   400 "Check the invitation ..."      "schema": non-objects, action missing/unknown/wrong case/wrong type,
//                                       confirmedNotSent of the wrong type
//   409 "cannot be sent again"          "send": the state matrix below, revoked project, withdrawn request, not a
//                                       service request, no email, unknown id, no project, queue race
//   200 {ok:true}                       "send": pending, failed, stale sending with confirmation, boundary at 60 s,
//                                       resolved and new requests, extra fields
//   503 catch                           "outage": the queue write throws
//   deliverProjectInvitation            claim, recipient lookup, send, final write
//     email                             "email": 200, 202 (sent); 400, 401, 403, 422, 429 (failed); 500, 503, network
//                                       down, timeout (uncertain, the row stays sending); a non-JSON 200 (sent); no API
//                                       key, empty key, no from address (failed, no fetch); no site origin; accents
//     notice races                      "notice": claim lost, access revoked before the claim, withdrawn, revoked, no
//                                       longer a service request or re-addressed before the lookup, final write lost
//     notice outages                    "notice": claim fails, lookup fails, lookup and failed mark fail, final fails
//   sequences                           "twice", "after a refusal", "after an uncertain send", "revoked between sends"
// The state matrix covers each invitation_status (pending, failed, sent, sending fresh, stale, at the 60 s boundary, 59.999 s,
// with no attempt time) with confirmedNotSent absent, false and true.

const step = routeStep("invitation");

const send = (
	body: Step["json"] = { action: "send" },
	extra: Partial<Step> = {},
): Step => step(body, { dump: { music: ["audio_projects"] }, ...extra });

/** A project in this invitation state, no payment, Resend accepting mail. */
const invite = (
	columns: { [column: string]: string | null },
	parts: Parts = {},
): Partial<Case> => ({
	...world({ payment: null, project: columns, ...parts }),
	fetches: resendOk,
});

const pending = () => invite({ invitation_status: "pending" });

const one = (
	name: string,
	body: Step["json"],
	columns: { [column: string]: string | null } = {
		invitation_status: "pending",
	},
	extra: Partial<Case> = {},
	parts: Parts = {},
): Case => ({ name, ...invite(columns, parts), steps: [send(body)], ...extra });

const CLAIM = /UPDATE audio_projects SET invitation_status='sending'/;
const RECIPIENT = /SELECT r\.email FROM owner_requests r JOIN audio_projects p/;
const FINAL = /UPDATE audio_projects SET invitation_status=\?/;
const QUEUE = /UPDATE audio_projects SET invitation_status='pending'/;
const MARK = /SET invitation_status='failed'/;

const mail = (
	name: string,
	fetches: Case["fetches"],
	extra: Partial<Case> = {},
): Case => ({
	name: `email: ${name}`,
	...pending(),
	fetches,
	steps: [send()],
	...extra,
});

/** A case named for its own topic rather than for the email, with the same project and send. */
const late = (
	name: string,
	fetches: Case["fetches"],
	extra: Partial<Case> = {},
): Case => ({ ...mail(name, fetches, extra), name });

const answer = (reply: ReturnType<typeof json>) => byHost({ resend: reply });

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...pending(),
	env,
	omit,
	steps: [send()],
});

const schema = (name: string, body: Step["json"]): Case =>
	one(`schema: ${name}`, body);

// Every invitation state, as (label, columns).
const STATES: [string, { [column: string]: string | null }][] = [
	["pending", { invitation_status: "pending" }],
	[
		"pending with an old attempt",
		{ invitation_status: "pending", invitation_attempted_at: EARLIER },
	],
	["failed", { invitation_status: "failed", invitation_attempted_at: EARLIER }],
	[
		"sent",
		{
			invitation_status: "sent",
			invitation_attempted_at: EARLIER,
			invitation_sent_at: EARLIER,
		},
	],
	[
		"sending 30 seconds ago",
		{
			invitation_status: "sending",
			invitation_attempted_at: "2026-11-13T11:59:30.000Z",
		},
	],
	[
		"sending 2 minutes ago",
		{
			invitation_status: "sending",
			invitation_attempted_at: "2026-11-13T11:58:00.000Z",
		},
	],
	[
		"sending exactly 60 seconds ago",
		{
			invitation_status: "sending",
			invitation_attempted_at: "2026-11-13T11:59:00.000Z",
		},
	],
	[
		"sending 59.999 seconds ago",
		{
			invitation_status: "sending",
			invitation_attempted_at: "2026-11-13T11:59:00.001Z",
		},
	],
	["sending with no attempt time", { invitation_status: "sending" }],
];

const CONFIRMED: [string, Step["json"]][] = [
	["not given", { action: "send" }],
	["false", { action: "send", confirmedNotSent: false }],
	["true", { action: "send", confirmedNotSent: true }],
];

const matrix: Case[] = STATES.flatMap(([label, columns]) =>
	CONFIRMED.map(([how, body]) =>
		one(`send: ${label}, confirmedNotSent ${how}`, body, columns),
	),
);

const cases: Case[] = [
	// 403
	{
		name: "not the owner: a visitor",
		...pending(),
		steps: [send(undefined, { as: asVisitor() })],
	},
	{
		name: "not the owner: a signed-in studio client",
		...pending(),
		steps: [send(undefined, { as: asClient("grace@example.test") })],
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
		steps: [send()],
	},
	// 503
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		steps: [send()],
	},
	{
		name: "unavailable: no id param",
		...pending(),
		steps: [send(undefined, { params: {} })],
	},
	{
		name: "unavailable: an empty id param",
		...pending(),
		steps: [send(undefined, { params: { id: "" } })],
	},
	{
		name: "unavailable: no execution context",
		...pending(),
		noContext: true,
		steps: [send()],
	},
	// musicRequest
	{
		name: "origin: missing",
		...pending(),
		steps: [send(undefined, { headers: {} })],
	},
	{
		name: "origin: another site",
		...pending(),
		steps: [send(undefined, { headers: { origin: "https://example.test" } })],
	},
	{
		name: "origin: the right host over http",
		...pending(),
		steps: [
			send(undefined, { headers: { origin: "http://thesuperhuman.us" } }),
		],
	},
	{
		name: "content type: missing",
		...pending(),
		steps: [
			rawStep("invitation", '{"action":"send"}', {
				headers: { origin: "https://thesuperhuman.us" },
			}),
		],
	},
	{
		name: "content type: text/plain",
		...pending(),
		steps: [
			rawStep("invitation", '{"action":"send"}', {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "text/plain",
				},
			}),
		],
	},
	{
		name: "content type: a charset suffix is accepted",
		...pending(),
		steps: [
			rawStep("invitation", '{"action":"send"}', {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json; charset=utf-8",
				},
				dump: { music: ["audio_projects"] },
			}),
		],
	},
	{
		name: "no request body",
		...pending(),
		steps: [{ ...rawStep("invitation", ""), body: undefined }],
	},
	{
		name: "body over 1024 bytes",
		...pending(),
		steps: [
			rawStep(
				"invitation",
				JSON.stringify({ action: "send", pad: "a".repeat(1100) }),
			),
		],
	},
	{
		name: "body of exactly 1024 bytes reaches the schema and sends",
		...pending(),
		steps: [
			rawStep(
				"invitation",
				JSON.stringify({
					action: "send",
					pad: "a".repeat(
						1024 - JSON.stringify({ action: "send", pad: "" }).length,
					),
				}),
				{ dump: { music: ["audio_projects"] } },
			),
		],
	},
	{
		name: "invalid JSON: bad text",
		...pending(),
		steps: [rawStep("invitation", "{not json")],
	},
	{
		name: "invalid JSON: empty text",
		...pending(),
		steps: [rawStep("invitation", "")],
	},
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "send"),
	schema("a number", 1),
	schema("no action", {}),
	schema("an unknown action", { action: "resend" }),
	schema("action in capitals", { action: "SEND" }),
	schema("action that is a number", { action: 1 }),
	schema("confirmedNotSent as text", {
		action: "send",
		confirmedNotSent: "true",
	}),
	schema("confirmedNotSent as a number", {
		action: "send",
		confirmedNotSent: 1,
	}),
	schema("confirmedNotSent null", { action: "send", confirmedNotSent: null }),
	// the state matrix
	...matrix,
	one("send: extra fields are ignored", {
		action: "send",
		confirmedNotSent: false,
		note: "hi",
		actor: "x",
	}),
	// the project and request
	{
		name: "send: unknown request id",
		...pending(),
		steps: [
			send(undefined, {
				params: { id: "nope" },
				path: "/api/owner/projects/nope/invitation",
			}),
		],
	},
	{
		name: "send: a project whose access was revoked",
		...invite({ invitation_status: "pending", revoked_at: EARLIER }),
		steps: [send()],
	},
	{
		name: "send: a withdrawn request",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ status: "withdrawn" }) },
		),
		steps: [send()],
	},
	{
		name: "send: a resolved request still sends",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ status: "resolved" }) },
		),
		steps: [send()],
	},
	{
		name: "send: a new request still sends",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ status: "new" }) },
		),
		steps: [send()],
	},
	{
		name: "send: a request with a blank email",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ email: "" }) },
		),
		steps: [send()],
	},
	{
		name: "send: a project on a request that is not a service request",
		...invite(
			{ invitation_status: "pending" },
			{
				request: rows.ownerRequest("r1", {
					kind: "purchase",
					status: "reviewed",
				}),
				setup: (w) =>
					w.music.exec(
						`INSERT INTO audio_projects(request_id,created_at,updated_at) VALUES ('r1','${EARLIER}','${EARLIER}')`,
					),
			},
		),
		steps: [send()],
	},
	{
		name: "send: a software request has no project",
		...invite(
			{},
			{ request: rows.softwareRequest("r1", { status: "reviewed" }) },
		),
		steps: [send()],
	},
	{
		name: "send: owner email blank still queues (the actor is not read)",
		...pending(),
		steps: [send(undefined, { as: asOwner("   ") })],
	},
	// emails
	mail("sent: Resend answers 200", answer(json(200, { id: "em_1" }))),
	mail("sent: Resend answers 202", answer(json(202, { id: "em_1" }))),
	mail("refused: Resend answers 400", answer(json(400, { message: "bad" }))),
	mail("refused: Resend answers 401", answer(json(401, { message: "key" }))),
	mail("refused: Resend answers 403", answer(json(403, { message: "domain" }))),
	mail(
		"refused: Resend answers 422",
		answer(json(422, { message: "invalid to" })),
	),
	mail(
		"refused: Resend answers 429",
		answer(json(429, { message: "slow down" })),
	),
	mail("uncertain: Resend answers 500", answer(json(500, { message: "oops" }))),
	mail("uncertain: Resend answers 503", answer(text(503, "unavailable"))),
	mail("uncertain: the network is down", byHost({ resend: networkDown() })),
	mail(
		"uncertain: the request times out",
		byHost({ resend: networkDown("The operation was aborted due to timeout") }),
	),
	mail(
		"sent: a 200 that is not JSON still counts",
		answer(text(200, "<html>ok</html>")),
	),
	mail("no email: no API key", resendOk, { omit: ["RESEND_API_KEY"] }),
	mail("no email: an empty API key", resendOk, { env: { RESEND_API_KEY: "" } }),
	mail("no email: no from address", resendOk, { omit: ["CONTACT_FROM_EMAIL"] }),
	mail("sent: no site origin set", resendOk, { omit: ["SITE_ORIGIN"] }),
	{
		name: "email: a mixed-case plus-tagged recipient",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ email: "Grace+Studio@Example.TEST" }) },
		),
		steps: [send()],
	},
	{
		name: "email: a recipient with accents",
		...invite(
			{ invitation_status: "pending" },
			{ request: service({ email: "grâce@exämple.test" }) },
		),
		steps: [send()],
	},
	// races on the queue write
	late("queue: another worker marks it sent before the write", resendOk, {
		interleave: [
			{
				on: QUEUE,
				label: "another worker marks it sent",
				run: sql(`UPDATE audio_projects SET invitation_status='sent'`),
			},
		],
	}),
	late("queue: access is revoked before the write", resendOk, {
		interleave: [
			{
				on: QUEUE,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	}),
	late("queue: the request is withdrawn before the write", resendOk, {
		interleave: [
			{
				on: QUEUE,
				label: "the request is withdrawn",
				run: sql(`UPDATE owner_requests SET status='withdrawn'`),
			},
		],
	}),
	late("queue: the write throws", resendOk, {
		failures: [{ on: QUEUE, message: "D1 is down" }],
	}),
	// races and outages in the delivery
	late("notice: another worker claims it first", resendOk, {
		interleave: [
			{
				on: CLAIM,
				label: "another worker marks it sent",
				run: sql(`UPDATE audio_projects SET invitation_status='sent'`),
			},
		],
	}),
	late("notice: access is revoked before the claim", resendOk, {
		interleave: [
			{
				on: CLAIM,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	}),
	mail(
		"notice: the request is withdrawn before the recipient lookup",
		resendOk,
		{
			interleave: [
				{
					on: RECIPIENT,
					label: "the request is withdrawn",
					run: sql(`UPDATE owner_requests SET status='withdrawn'`),
				},
			],
		},
	),
	late("notice: access is revoked before the recipient lookup", resendOk, {
		interleave: [
			{
				on: RECIPIENT,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	}),
	mail(
		"notice: the request stops being a service request before the lookup",
		resendOk,
		{
			interleave: [
				{
					on: RECIPIENT,
					label: "the kind changes",
					run: sql(`UPDATE owner_requests SET kind='purchase'`),
				},
			],
		},
	),
	late("notice: the client's address changes before the lookup", resendOk, {
		interleave: [
			{
				on: RECIPIENT,
				label: "the email changes",
				run: sql(`UPDATE owner_requests SET email='new@example.test'`),
			},
		],
	}),
	late("notice: the final write finds the row no longer sending", resendOk, {
		interleave: [
			{
				on: FINAL,
				label: "the row is marked failed",
				run: sql(`UPDATE audio_projects SET invitation_status='failed'`),
			},
		],
	}),
	late("notice: access is revoked before the final write", resendOk, {
		interleave: [
			{
				on: FINAL,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	}),
	late("notice: the claim fails", resendOk, {
		failures: [{ on: CLAIM, message: "D1 is down" }],
	}),
	late("notice: the recipient lookup fails", resendOk, {
		failures: [{ on: RECIPIENT, message: "D1 is down" }],
	}),
	late("notice: the recipient lookup and the failed mark both fail", resendOk, {
		failures: [
			{ on: RECIPIENT, message: "D1 is down" },
			{ on: MARK, message: "D1 is still down" },
		],
	}),
	late("notice: the final write fails", resendOk, {
		failures: [{ on: FINAL, message: "D1 is down" }],
	}),
	// sequences
	{
		name: "twice: the same send is refused the second time (the first is still sending or sent)",
		...pending(),
		steps: [send(), send(undefined, { advanceMs: 1000 })],
	},
	{
		name: "twice: with an uncertain first send the second is refused",
		...pending(),
		fetches: byHost({ resend: networkDown() }),
		steps: [send(), send(undefined, { advanceMs: 1000 })],
	},
	{
		name: "after a refusal: send again and it goes out, then a third send is refused",
		...pending(),
		fetches: byHost({
			resend: [json(422, { message: "bad" }), json(200, { id: "em_2" })],
		}),
		steps: [
			send(),
			send(undefined, { advanceMs: 1000 }),
			send(undefined, { advanceMs: 1000 }),
		],
	},
	{
		name: "after an uncertain send: refused at once, refused when confirmed too early, sent when confirmed after a minute",
		...pending(),
		fetches: byHost({ resend: [networkDown(), json(200, { id: "em_2" })] }),
		steps: [
			send(),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 1000 }),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 58_000 }),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 1000 }),
			send({ action: "send", confirmedNotSent: true }, { advanceMs: 1000 }),
		],
	},
	{
		name: "revoked between sends: the second send is refused",
		...pending(),
		fetches: byHost({ resend: json(422, { message: "bad" }) }),
		steps: [
			send(),
			send(undefined, {
				advanceMs: 1000,
				before: {
					label: "access is revoked",
					run: (w) =>
						w.music.exec(
							`UPDATE audio_projects SET revoked_at='2026-11-13T12:00:00.500Z' WHERE request_id='r1'`,
						),
				},
			}),
		],
	},
	{
		name: "withdrawn between sends: the second send is refused",
		...pending(),
		fetches: byHost({ resend: json(422, { message: "bad" }) }),
		steps: [
			send(),
			send(undefined, {
				advanceMs: 1000,
				before: {
					label: "the request is withdrawn",
					run: (w) =>
						w.music.exec(
							`UPDATE owner_requests SET status='withdrawn' WHERE id='r1'`,
						),
				},
			}),
		],
	},
	{
		name: "outage then repeat: the first queue write fails, the second sends",
		...pending(),
		failures: [{ on: QUEUE, message: "D1 is down" }],
		steps: [send(), send(undefined, { advanceMs: 1000 })],
	},
];

defineCorpus("owner-project-invitation", POST, cases);
