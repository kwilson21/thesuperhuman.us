import { POST } from "~/pages/api/owner/requests/[id]/updates";
import { POST as project } from "~/pages/api/owner/requests/[id]/project";
import {
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type Responder,
} from "./harness";
import {
	accepted,
	command,
	delivery,
	direction,
	handoff,
	input,
	post,
	scene,
	sharedDelivery,
	sql,
	U1,
} from "./areas/software-updates";

// The golden corpus for POST /api/owner/requests/[id]/updates, the client notice. A share with email_client true sets
// notification_status "pending" in the batch, then the route awaits deliverSoftwareNotice (src/lib/software-projects.ts):
// claim (pending -> sending), look up the recipient and the kind, send one email through Resend, then mark sent or
// failed. The route answers 200 either way; `noticeUnchecked: true` appears only when a database step of the notice
// throws. The requeue half (queueSoftwareNotice) belongs to POST /api/owner/requests/[id]/project (action "notice"):
// the sequences here call it to show what the owner does next.
//
// Branches (case names start with their topic):
//
//   email kinds       "kind": progress (update email), direction and delivery reviews (review email), handoff
//   Resend outcomes   "resend": 200, 202 (sent); 400, 401, 403, 404, 422, 429 (failed); 500, 503, network down, timeout
//                     (uncertain: the row stays sending, the route still answers 200 shared:true)
//   no email sent     "no email": no API key, empty key, no from address (marked failed, no fetch); no SITE_ORIGIN (sent)
//   claim             "claim": another worker claimed first; withdrawn, revoked or emptied address before the claim; the
//                     claim statement fails (noticeUnchecked)
//   recipient         "recipient": withdrawn between claim and lookup; lookup fails; kind lookup fails (marked failed)
//   final write       "final": the row was changed meanwhile; the write fails (noticeUnchecked)
//   not requested     "none": email_client false, a draft
//   requeue           "requeue": after an uncertain send (too soon, confirmed after 60 s, unconfirmed), after a refusal,
//                     after a success (409)

const share = (update: ReturnType<typeof input>, over = {}) =>
	command("share", update, over);

const mailed = (body: ReturnType<typeof input> = input()) => ({
	...body,
	email_client: true,
});

const resend = (answer: ReturnType<typeof json>) => byHost({ resend: answer });

const ok = resend(json(200, { id: "em_1" }));

const ACCEPTED = {
	updates: [sharedDelivery(U1)],
	messages: [accepted(U1)],
};

const mail = (
	name: string,
	fetches: Responder,
	extra: Partial<Case> = {},
	body = share(mailed()),
	scenery: Parameters<typeof scene>[0] = {},
): Case => ({
	name,
	...scene(scenery),
	fetches,
	steps: [post(body)],
	...extra,
});

const CLAIM =
	/UPDATE software_project_updates SET notification_status='sending'/;

const RECIPIENT =
	/SELECT r\.email FROM owner_requests r JOIN software_projects p/;

const KIND = /SELECT kind FROM software_project_updates/;

const FINAL = /UPDATE software_project_updates SET notification_status=\?/;

/** The owner's requeue of the first step's notice (POST .../project, action "notice"). */
const requeue = (confirmedNotSent: boolean, extra = {}) =>
	post(
		(prior) => ({
			action: "notice",
			updateId: String(prior.answerJson(0).id),
			confirmedNotSent,
		}),
		{ handler: project, path: "/api/owner/requests/r1/project", ...extra },
	);

const flaky: Responder = (call) =>
	call.n === 0 ? json(500, { message: "oops" }) : json(200, { id: "em_2" });

const refused: Responder = (call) =>
	call.n === 0 ? json(422, { message: "bad to" }) : json(200, { id: "em_2" });

const withdrawn = (on: RegExp, label: string, statement: string) => ({
	interleave: [{ on, label, run: sql(statement) }],
});

const cases: Case[] = [
	// kinds
	mail("kind: a progress note sends the update email", ok),
	mail(
		"kind: a direction review sends the review email",
		ok,
		{},
		share(mailed(direction())),
	),
	mail(
		"kind: a delivery review sends the review email",
		ok,
		{},
		share(mailed(delivery())),
	),
	mail(
		"kind: a handoff sends the handoff email",
		ok,
		{},
		share(mailed(handoff())),
		ACCEPTED,
	),
	mail(
		"kind: a handoff whose guard fails sends nothing",
		ok,
		{},
		share(mailed(handoff())),
	),
	// resend
	mail("resend: answers 200", ok),
	mail("resend: answers 202", resend(json(202, { id: "em_1" }))),
	mail("resend: answers 400", resend(json(400, { message: "bad" }))),
	mail("resend: answers 401", resend(json(401, { message: "key" }))),
	mail("resend: answers 403", resend(json(403, { message: "domain" }))),
	mail("resend: answers 404", resend(json(404, { message: "gone" }))),
	mail("resend: answers 422", resend(json(422, { message: "invalid to" }))),
	mail("resend: answers 429", resend(json(429, { message: "slow down" }))),
	mail(
		"resend: answers 500 and the row stays sending",
		resend(json(500, { message: "oops" })),
	),
	mail("resend: answers 503 with text", resend(text(503, "unavailable"))),
	mail("resend: the network is down", byHost({ resend: networkDown() })),
	mail(
		"resend: the request times out",
		byHost({ resend: networkDown("The operation was aborted due to timeout") }),
	),
	mail(
		"resend: a 200 that is not JSON still counts",
		resend(text(200, "<html>ok</html>")),
	),
	// no email
	mail("no email: no API key", ok, { omit: ["RESEND_API_KEY"] }),
	mail("no email: an empty API key", ok, { env: { RESEND_API_KEY: "" } }),
	mail("no email: no from address", ok, { omit: ["CONTACT_FROM_EMAIL"] }),
	mail("no email: no site origin still sends", ok, { omit: ["SITE_ORIGIN"] }),
	// none
	mail("none: email_client false sends nothing", ok, {}, share(input())),
	mail(
		"none: a draft with email_client true sends nothing",
		ok,
		{},
		command("draft", mailed()),
	),
	// claim
	mail(
		"claim: another worker claimed first",
		ok,
		withdrawn(
			CLAIM,
			"another worker claims",
			"UPDATE software_project_updates SET notification_status='sending',notification_attempted_at='2026-11-13T11:59:00.000Z'",
		),
	),
	mail(
		"claim: the request was withdrawn first",
		ok,
		withdrawn(
			CLAIM,
			"the request is withdrawn",
			"UPDATE owner_requests SET status='withdrawn'",
		),
	),
	mail(
		"claim: access was revoked first",
		ok,
		withdrawn(
			CLAIM,
			"access is revoked",
			"UPDATE software_projects SET revoked_at='2026-11-13T11:59:00.000Z'",
		),
	),
	mail(
		"claim: the address was emptied first",
		ok,
		withdrawn(
			CLAIM,
			"the address is emptied",
			"UPDATE owner_requests SET email=''",
		),
	),
	mail("claim: the claim statement fails", ok, {
		failures: [{ on: CLAIM, message: "D1 unavailable" }],
	}),
	// recipient
	mail(
		"recipient: withdrawn between the claim and the lookup",
		ok,
		withdrawn(
			RECIPIENT,
			"the request is withdrawn",
			"UPDATE owner_requests SET status='withdrawn'",
		),
	),
	mail(
		"recipient: revoked between the claim and the lookup",
		ok,
		withdrawn(
			RECIPIENT,
			"access is revoked",
			"UPDATE software_projects SET revoked_at='2026-11-13T11:59:00.000Z'",
		),
	),
	mail(
		"recipient: the address changes before the lookup",
		ok,
		withdrawn(
			RECIPIENT,
			"the address changes",
			"UPDATE owner_requests SET email='new@example.test'",
		),
	),
	mail("recipient: the lookup fails", ok, {
		failures: [{ on: RECIPIENT, message: "D1 unavailable" }],
	}),
	mail("recipient: the kind lookup fails", ok, {
		failures: [{ on: KIND, message: "D1 unavailable" }],
	}),
	mail("recipient: an accented plus-tagged address", ok, {}, share(mailed()), {
		request: { email: "Grâce+Studio@Example.TEST" },
	}),
	// final
	mail(
		"final: the row was reset before the write",
		ok,
		withdrawn(
			FINAL,
			"the row is reset",
			"UPDATE software_project_updates SET notification_status='pending'",
		),
	),
	mail(
		"final: the row was marked failed elsewhere",
		ok,
		withdrawn(
			FINAL,
			"marked failed elsewhere",
			"UPDATE software_project_updates SET notification_status='failed'",
		),
	),
	mail(
		"final: another attempt time is on the row",
		ok,
		withdrawn(
			FINAL,
			"a newer attempt starts",
			"UPDATE software_project_updates SET notification_attempted_at='2026-11-13T12:00:05.000Z'",
		),
	),
	mail("final: the write fails", ok, {
		failures: [{ on: FINAL, message: "D1 unavailable" }],
	}),
	mail(
		"final: the write fails after a refusal",
		resend(json(422, { message: "x" })),
		{ failures: [{ on: FINAL, message: "D1 unavailable" }] },
	),
	// requeue
	{
		name: "requeue: an uncertain send, asked again at once",
		...scene(),
		fetches: resend(json(500, { message: "oops" })),
		steps: [post(share(mailed())), requeue(true)],
	},
	{
		name: "requeue: an uncertain send, confirmed after 60 seconds",
		...scene(),
		fetches: flaky,
		steps: [post(share(mailed())), requeue(true, { advanceMs: 60_000 })],
	},
	{
		name: "requeue: an uncertain send, 59 seconds is too soon",
		...scene(),
		fetches: flaky,
		steps: [post(share(mailed())), requeue(true, { advanceMs: 59_000 })],
	},
	{
		name: "requeue: an uncertain send, not confirmed after 2 minutes",
		...scene(),
		fetches: flaky,
		steps: [post(share(mailed())), requeue(false, { advanceMs: 120_000 })],
	},
	{
		name: "requeue: after a refusal the owner retries and it sends",
		...scene(),
		fetches: refused,
		steps: [post(share(mailed())), requeue(false)],
	},
	{
		name: "requeue: after a success a retry is refused",
		...scene(),
		fetches: ok,
		steps: [post(share(mailed())), requeue(false)],
	},
	{
		name: "requeue: the retry fails again and is retried once more",
		...scene(),
		fetches: resend(json(422, { message: "bad to" })),
		steps: [post(share(mailed())), requeue(false), requeue(false)],
	},
	{
		name: "requeue: a visitor cannot retry",
		...scene(),
		fetches: refused,
		steps: [post(share(mailed())), requeue(false, { as: asVisitor() })],
	},
	{
		name: "sequence: share with the notice failing, then share the same update again",
		...scene(),
		fetches: resend(json(422, { message: "bad to" })),
		steps: [
			post(share(mailed())),
			post((prior) =>
				share(mailed(), { updateId: String(prior.answerJson(0).id) }),
			),
		],
	},
];

defineCorpus("owner-request-updates-notices", POST, cases);
