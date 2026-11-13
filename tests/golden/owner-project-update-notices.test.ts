import { POST } from "~/pages/api/owner/projects/[id]/updates";
import {
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	text,
	type Case,
	type SeedRow,
} from "./harness";
import {
	act,
	at,
	atStage,
	BODIES,
	confirmed,
	EARLIER,
	resendOk,
	retry,
	service,
	sql,
	update,
	withProject,
	world,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/updates, the notice half: the email a saved update sends to the
// client (deliverProjectUpdateNotice, run in ctx.waitUntil after the response) and the retry_email action
// (queueProjectNoticeForDelivery). The stage changes are in owner-project-updates.test.ts.
//
//   Notice states      pending -> sending (claim) -> sent | failed; a send that is "uncertain" leaves the row sending
//   email: Resend      200, 202 (sent); 400, 401, 403, 422, 429 (failed); 500, 503, network down, timeout (uncertain, the
//                      row stays sending); a 200 with a non-JSON body (sent); no API key, an empty key, no from address
//                      (failed, no fetch); no SITE_ORIGIN (sent); blank request email (failed, no fetch); accented and
//                      plus-tagged recipients
//   notice: races      another worker claims first; the request is withdrawn, access revoked or the address changed
//                      before the recipient lookup; the final write finds the row no longer sending
//   notice: outages    the claim fails; the recipient lookup fails; the lookup and the failed mark both fail; the final
//                      write fails (the settled waitUntil records each; the route still answers 200)
//   retry_email 200    a pending or failed notice; a sending notice only when confirmedNotSent is true and it was
//                      attempted at least 60 s ago (the boundary at exactly 60 s and 59.999 s); then it is sent again
//   retry_email 409    a sent notice; a fresh sending notice (even when confirmed); a stale one unconfirmed or with
//                      confirmedNotSent false; no attempt time; an unknown id; another project's update; a revoked
//                      project; a withdrawn request; a request with no email; another worker marks it sent first
//   retry_email 503    the queue write fails
//   retry_email 403    a visitor
//   sequences          "after an uncertain send", "after a refusal"

/** An email that Resend answers in a given way, for the progress note that sends it. */
const mail = (
	name: string,
	fetches: Case["fetches"],
	extra: Partial<Case> = {},
): Case => ({
	name: `email: ${name}`,
	...at("in_progress"),
	fetches,
	steps: [act(BODIES.progress)],
	...extra,
});

const resend = (answer: ReturnType<typeof json>) => byHost({ resend: answer });

const CLAIM = /UPDATE audio_project_updates SET notification_status='sending'/;

const RECIPIENT = /SELECT r\.email FROM owner_requests r JOIN audio_projects p/;

const FINAL = /UPDATE audio_project_updates SET notification_status=\?/;

const QUEUE =
	/SET notification_status='pending',notification_attempted_at=NULL/;

/** Retry cases: one update row with this notification state on a running project. */
const queued = (
	name: string,
	row: SeedRow,
	caseExtra: Partial<Case> = {},
): Case => ({
	name: `retry: ${name}`,
	...at("in_progress", { updates: [update(1, row)] }),
	steps: [retry(1)],
	...caseExtra,
});

const cases: Case[] = [
	// emails after a saved update
	mail("sent: Resend answers 200", resend(json(200, { id: "em_1" }))),
	mail("sent: Resend answers 202", resend(json(202, { id: "em_1" }))),
	mail("refused: Resend answers 400", resend(json(400, { message: "bad" }))),
	mail("refused: Resend answers 401", resend(json(401, { message: "key" }))),
	mail("refused: Resend answers 403", resend(json(403, { message: "domain" }))),
	mail(
		"refused: Resend answers 422",
		resend(json(422, { message: "invalid to" })),
	),
	mail(
		"refused: Resend answers 429",
		resend(json(429, { message: "slow down" })),
	),
	mail("uncertain: Resend answers 500", resend(json(500, { message: "oops" }))),
	mail("uncertain: Resend answers 503", resend(text(503, "unavailable"))),
	mail("uncertain: the network is down", byHost({ resend: networkDown() })),
	mail(
		"uncertain: the request times out",
		byHost({
			resend: networkDown("The operation was aborted due to timeout"),
		}),
	),
	mail(
		"sent: a 200 that is not JSON still counts",
		resend(text(200, "<html>ok</html>")),
	),
	mail("no email: no API key", resendOk, { omit: ["RESEND_API_KEY"] }),
	mail("no email: an empty API key", resendOk, { env: { RESEND_API_KEY: "" } }),
	mail("no email: no from address", resendOk, { omit: ["CONTACT_FROM_EMAIL"] }),
	mail("sent: no site origin set", resendOk, { omit: ["SITE_ORIGIN"] }),
	{
		name: "email: the request has a blank email",
		...at("in_progress", { request: service({ email: "" }) }),
		fetches: resendOk,
		steps: [act(BODIES.progress)],
	},
	{
		name: "email: a plus-tagged mixed-case recipient",
		...at("in_progress", {
			request: service({ email: "Grace+Studio@Example.TEST" }),
		}),
		fetches: resendOk,
		steps: [act(BODIES.progress)],
	},
	{
		name: "email: a recipient with accents",
		...at("in_progress", { request: service({ email: "grâce@exämple.test" }) }),
		fetches: resendOk,
		steps: [act(BODIES.progress)],
	},
	// the notice after the response
	mail("notice: another worker claimed it first", resendOk, {
		interleave: [
			{
				on: CLAIM,
				label: "another worker marks the notice sent",
				run: sql(`UPDATE audio_project_updates SET notification_status='sent'`),
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
	mail("notice: access is revoked before the recipient lookup", resendOk, {
		interleave: [
			{
				on: RECIPIENT,
				label: "access is revoked",
				run: withProject(`revoked_at='2026-11-13T11:30:00.000Z'`),
			},
		],
	}),
	mail("notice: the client's address changes before the lookup", resendOk, {
		interleave: [
			{
				on: RECIPIENT,
				label: "the email changes",
				run: sql(`UPDATE owner_requests SET email='new@example.test'`),
			},
		],
	}),
	mail("notice: the final write finds the row no longer sending", resendOk, {
		interleave: [
			{
				on: FINAL,
				label: "the row is marked failed",
				run: sql(
					`UPDATE audio_project_updates SET notification_status='failed'`,
				),
			},
		],
	}),
	mail("notice: the claim fails", resendOk, {
		failures: [{ on: CLAIM, message: "D1 is down" }],
	}),
	mail("notice: the recipient lookup fails", resendOk, {
		failures: [{ on: RECIPIENT, message: "D1 is down" }],
	}),
	mail("notice: the recipient lookup and the failed mark both fail", resendOk, {
		failures: [
			{ on: RECIPIENT, message: "D1 is down" },
			{ on: /SET notification_status='failed'/, message: "D1 is still down" },
		],
	}),
	mail("notice: the final write fails", resendOk, {
		failures: [{ on: FINAL, message: "D1 is down" }],
	}),
	// retry_email
	queued("a pending notice is queued again and sent", {
		notification_status: "pending",
	}),
	queued("a failed notice is queued again and sent", {
		notification_status: "failed",
		notification_attempted_at: EARLIER,
	}),
	queued("a sent notice cannot be retried", {
		notification_status: "sent",
		notification_attempted_at: EARLIER,
		notification_sent_at: EARLIER,
	}),
	queued("a fresh sending notice cannot be retried", {
		notification_status: "sending",
		notification_attempted_at: "2026-11-13T11:59:30.000Z",
	}),
	{
		name: "retry: a stale sending notice is refused without confirmation",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:58:00.000Z",
				}),
			],
		}),
		steps: [retry(1)],
	},
	{
		name: "retry: a stale sending notice is refused when confirmedNotSent is false",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:58:00.000Z",
				}),
			],
		}),
		steps: [confirmed(1, false)],
	},
	{
		name: "retry: a stale sending notice is queued when the owner confirms it was not sent",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:58:00.000Z",
				}),
			],
		}),
		steps: [confirmed(1, true)],
	},
	{
		name: "retry: a fresh sending notice is refused even when confirmed",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:59:30.000Z",
				}),
			],
		}),
		steps: [confirmed(1, true)],
	},
	{
		name: "retry: sending exactly 60 seconds ago counts as stale",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:59:00.000Z",
				}),
			],
		}),
		steps: [confirmed(1, true)],
	},
	{
		name: "retry: sending 59.999 seconds ago is not stale",
		...at("in_progress", {
			updates: [
				update(1, {
					notification_status: "sending",
					notification_attempted_at: "2026-11-13T11:59:00.001Z",
				}),
			],
		}),
		steps: [confirmed(1, true)],
	},
	{
		name: "retry: sending with no attempt time is never stale",
		...at("in_progress", {
			updates: [update(1, { notification_status: "sending" })],
		}),
		steps: [confirmed(1, true)],
	},
	{
		name: "retry: an unknown update id",
		...at("in_progress", { updates: [update(1)] }),
		steps: [retry(9999)],
	},
	{
		name: "retry: another project's update cannot be retried",
		...at("in_progress", {
			moreRequests: [
				rows.ownerRequest("r2", {
					service_id: "vocal-mix",
					status: "reviewed",
					email: "ada@example.test",
				}),
			],
			updates: [update(1, { request_id: "r2", notification_status: "failed" })],
		}),
		steps: [retry(1)],
	},
	queued(
		"a revoked project cannot retry",
		{ notification_status: "failed" },
		{
			...world({
				project: atStage("in_progress", { revoked_at: EARLIER }),
				updates: [update(1, { notification_status: "failed" })],
			}),
		},
	),
	queued(
		"a withdrawn request cannot retry",
		{ notification_status: "failed" },
		{
			...world({
				project: atStage("in_progress"),
				request: service({ status: "withdrawn" }),
				updates: [update(1, { notification_status: "failed" })],
			}),
		},
	),
	queued(
		"a request with no email cannot retry",
		{ notification_status: "failed" },
		{
			...world({
				project: atStage("in_progress"),
				request: service({ email: "" }),
				updates: [update(1, { notification_status: "failed" })],
			}),
		},
	),
	{
		name: "retry: queued, but Resend refuses again",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		fetches: resend(json(422, { message: "bad address" })),
		steps: [retry(1)],
	},
	{
		name: "retry: queued, but the send is uncertain",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		fetches: byHost({ resend: networkDown() }),
		steps: [retry(1)],
	},
	{
		name: "retry: another worker claims the notice right after it is queued",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		interleave: [
			{
				on: CLAIM,
				label: "another worker claims the notice",
				run: sql(
					`UPDATE audio_project_updates SET notification_status='sending'`,
				),
			},
		],
		steps: [retry(1)],
	},
	{
		name: "retry: the notice is sent by another worker before the queue write",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		interleave: [
			{
				on: QUEUE,
				label: "another worker marks it sent",
				run: sql(`UPDATE audio_project_updates SET notification_status='sent'`),
			},
		],
		steps: [retry(1)],
	},
	{
		name: "retry: the queue write fails",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		failures: [{ on: QUEUE, message: "D1 is down" }],
		steps: [retry(1)],
	},
	{
		name: "retry: a blank owner email still retries (the actor is not read)",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		steps: [retry(1, { as: asOwner("   ") })],
	},
	{
		name: "retry: a visitor cannot",
		...at("in_progress", {
			updates: [update(1, { notification_status: "failed" })],
		}),
		steps: [retry(1, { as: asVisitor() })],
	},
	{
		name: "after an uncertain send: refuse at once, then confirm after a minute",
		...at("in_progress"),
		fetches: byHost({
			resend: [networkDown(), json(200, { id: "em_2" })],
		}),
		steps: [
			act(BODIES.progress),
			retry(1, { advanceMs: 1000 }),
			confirmed(1, true),
			confirmed(1, true),
			{ ...confirmed(1, true), advanceMs: 61_000 },
			retry(1, { advanceMs: 1000 }),
		],
	},
	{
		name: "after a refusal: retry sends, a second retry is refused",
		...at("in_progress"),
		fetches: byHost({
			resend: [json(422, { message: "bad" }), json(200, { id: "em_2" })],
		}),
		steps: [
			act(BODIES.progress),
			retry(1, { advanceMs: 1000 }),
			retry(1, { advanceMs: 1000 }),
		],
	},
];

defineCorpus("owner-project-update-notices", POST, cases);
