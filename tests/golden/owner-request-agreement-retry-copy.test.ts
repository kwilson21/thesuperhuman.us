import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	MSA_ID,
	MSA_PDF_KEY,
	OTHER_ID,
	PAST,
	SOW_ID,
	SOW_PDF_KEY,
	clientSigned,
	delivered,
	deliveryRows,
	doc,
	forAgreement,
	notificationRows,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	readySmall,
	resend,
	resendOk,
	sha,
	smallPackets,
	type Scene,
} from "./areas/signing";
import {
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
} from "./harness";

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "retry-copy": the owner asks the site to send the
// signed copies (and the signing notices of an agreement still waiting for the countersignature) again. Failed
// deliveries are reset to pending; with confirmedNotSent a delivery stuck "sending" for a minute is reset too. Each
// pending notice and copy is then claimed and sent, one at a time.
//
//   200 {ok:true}   whatever was or was not sent (a form gets a 303 to /owner/requests/r1)
//   400             agreement_id missing or not a uuid; confirmedNotSent, expectedAttempt or confirmedStale of a wrong type
//   404 {ok:false}  no agreement with this id for this request
//   409 "The agreement changed or the operation failed. Reload before retrying."   an outage on a statement of the action
//   rejected        the offer lookup
//   delivery rows after: pending (nothing claimed: no Resend key, no sender, no bucket, no ready artifact, object
//   missing or over 25 MiB or with another hash, a signature missing for the role, the agreement archived or not
//   executed), sent (accepted), failed (a 4xx: also an event), sending (a 5xx, network down or timeout: kept as
//   uncertain, no event). The notices are claimed only while the agreement is client_signed with no project.
// Packets and the full preparation are in owner-request-agreement-retry-artifact.

const body = (over: { [name: string]: string | boolean } = {}) =>
	forAgreement("retry-copy", over);

const at = (offsetMs: number) =>
	new Date(Date.parse("2026-11-13T12:00:00.000Z") - offsetMs).toISOString();

const mail = (
	name: string,
	sc: Scene,
	fetches: Case["fetches"] = resendOk,
	bodyOver: { [name: string]: string | boolean } = {},
	extra: Partial<Case> = {},
): Case =>
	own(name, sc, body(bodyOver), {
		...smallPackets,
		fetches,
		omit: [],
		...extra,
	});

const sending = (
	offset: number,
	over: { [column: string]: string | number | null } = {},
) =>
	delivered("sending", { attempted_at: at(offset), attempt_id: "a1", ...over });

const wire: Case[] = [
	...ownBoth(
		"retry the copies of delivered agreements with nothing to send",
		delivered("sent", { sent_at: PAST }),
		body(),
		smallPackets,
	),
	own("no agreement id", delivered("pending"), { action: "retry-copy" }),
	own(
		"an agreement id that is not a uuid",
		delivered("pending"),
		body({ agreement_id: "x" }),
	),
	...ownBoth(
		"an agreement id that does not exist",
		delivered("pending"),
		body({ agreement_id: OTHER_ID }),
	),
	own(
		"confirmedNotSent given as text",
		delivered("pending"),
		body({ confirmedNotSent: "yes" }),
	),
	own(
		"expectedAttempt is ignored by a copy retry",
		delivered("pending"),
		body({ expectedAttempt: "11111111-2222-4333-8444-555555555555" }),
		smallPackets,
	),
	own(
		"expectedAttempt that is not a uuid",
		delivered("pending"),
		body({ expectedAttempt: "x" }),
	),
	own(
		"confirmedStale is ignored by a copy retry",
		delivered("pending"),
		body({ confirmedStale: true }),
		smallPackets,
	),
	own(
		"a visitor cannot retry",
		delivered("pending"),
		body(),
		{},
		{ as: asVisitor() },
	),
	ownForm(
		"confirmedNotSent on",
		sending(120_000),
		body({ confirmedNotSent: true }),
		{ ...smallPackets, fetches: resendOk, omit: [] },
	),
	ownForm(
		"confirmedNotSent off",
		sending(120_000),
		body({ confirmedNotSent: false }),
		{ ...smallPackets, fetches: resendOk, omit: [] },
	),
];

const resets: Case[] = [
	mail("pending copies are sent", delivered("pending")),
	mail(
		"failed copies are reset and sent",
		delivered("failed", { attempt_id: "a1", attempted_at: at(5000) }),
	),
	mail("sent copies are left alone", delivered("sent", { sent_at: PAST })),
	mail(
		"copies stuck sending are left alone without confirmation",
		sending(120_000),
	),
	mail(
		"copies stuck sending are reset with confirmation",
		sending(120_000),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail(
		"copies sending for exactly a minute are reset with confirmation",
		sending(60_000),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail(
		"copies sending for 59.999 seconds are not reset",
		sending(59_999),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail("copies that started sending now are not reset", sending(0), resendOk, {
		confirmedNotSent: true,
	}),
	mail(
		"copies sending with no attempt time are not reset",
		delivered("sending", { attempt_id: "a1" }),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail(
		"one copy sent and one failed",
		delivered(
			"sent",
			{ sent_at: PAST },
			{
				deliveries: [
					...deliveryRows("sent", { sent_at: PAST }).slice(0, 1),
					...deliveryRows("failed", { attempt_id: "a1" }).slice(1),
				],
			},
		),
	),
	mail(
		"one copy failed and one sending for two minutes",
		delivered(
			"sent",
			{},
			{
				deliveries: [
					...deliveryRows("failed", { attempt_id: "a1" }).slice(0, 1),
					...deliveryRows("sending", {
						attempt_id: "a1",
						attempted_at: at(120_000),
					}).slice(1),
				],
			},
		),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail(
		"a failed copy that was delivered by other means is sent again",
		delivered("failed", {
			alternate_delivered_at: PAST,
			alternate_method: "courier",
		}),
	),
	mail(
		"a pending copy that was delivered by other means is sent",
		delivered("pending", {
			alternate_delivered_at: PAST,
			alternate_method: "courier",
		}),
	),
	mail(
		"a sent copy with an alternate record is left alone",
		delivered("sent", {
			sent_at: PAST,
			alternate_delivered_at: PAST,
			alternate_method: "courier",
		}),
	),
	mail(
		"no delivery rows exist",
		delivered("pending", {}, { deliveries: false }),
	),
	mail(
		"only the client delivery row exists",
		delivered(
			"pending",
			{},
			{ deliveries: deliveryRows("pending").slice(0, 1) },
		),
	),
	mail(
		"only the contractor delivery row exists",
		delivered("pending", {}, { deliveries: deliveryRows("pending").slice(1) }),
	),
	mail(
		"a delivery to an address with markup",
		delivered(
			"pending",
			{},
			{
				deliveries: deliveryRows("pending", {}).map((row, i) =>
					i ? row : { ...row, email: "a<b>&c@example.test" },
				),
			},
		),
	),
];

const clientWaits = (
	status: string,
	over: { [column: string]: string | number | null } = {},
): Scene => ({
	...clientSigned(),
	notifications: notificationRows(status, over),
});

const notices: Case[] = [
	mail("the notices of a waiting agreement are sent", clientWaits("pending")),
	mail(
		"failed notices are reset and sent",
		clientWaits("failed", { attempt_id: "a1" }),
	),
	mail("sent notices are left alone", clientWaits("sent", { sent_at: PAST })),
	mail(
		"notices stuck sending are reset with confirmation",
		clientWaits("sending", { attempt_id: "a1", attempted_at: at(120_000) }),
		resendOk,
		{ confirmedNotSent: true },
	),
	mail(
		"notices stuck sending are left alone without confirmation",
		clientWaits("sending", { attempt_id: "a1", attempted_at: at(120_000) }),
	),
	mail("notices of an executed agreement are not current", {
		...delivered("sent", { sent_at: PAST }),
		notifications: notificationRows("failed", { attempt_id: "a1" }),
	}),
	mail("notices of an agreement whose project started are not current", {
		...clientWaits("failed", { attempt_id: "a1" }),
		extra: {
			software_projects: [
				{
					request_id: "r1",
					offer_id: "o1",
					terms_json: "{}",
					payment_mode: "standard",
					signatures_recorded_at: PAST,
					first_payment_recorded_at: PAST,
					started_at: PAST,
					started_by: "o",
					created_at: PAST,
					updated_at: PAST,
				},
			],
		},
	}),
	mail("notices of an archived agreement are not current", {
		...clientWaits("failed", { attempt_id: "a1" }),
		sow: doc("client_signed", { row: { archive_closed_at: PAST } }),
	}),
	mail(
		"notices with a failing send",
		clientWaits("pending"),
		resend(json(422, {})),
	),
	mail(
		"notices with a send that may have arrived",
		clientWaits("pending"),
		resend(json(503, {})),
	),
	mail(
		"the notices of the MSA id find no receipt",
		clientWaits("pending"),
		resendOk,
		{},
		{ steps: [ownerJson(forAgreement("retry-copy", {}, MSA_ID))] },
	),
	mail("no notification rows", clientWaits("pending"), resendOk, {}, {}),
	...ownBoth("notices sent (twin)", clientWaits("pending"), body(), {
		...smallPackets,
		fetches: resendOk,
		omit: [],
	}),
];

const outcomes: Case[] = [
	mail("both copies accepted", delivered("pending")),
	mail(
		"both copies refused with a 4xx",
		delivered("pending"),
		resend(json(422, { message: "bad" })),
	),
	mail(
		"both copies refused with a 401",
		delivered("pending"),
		resend(json(401, { message: "key" })),
	),
	mail("both copies rate limited", delivered("pending"), resend(json(429, {}))),
	mail("both copies hit a 500", delivered("pending"), resend(json(500, {}))),
	mail("both copies hit a 503", delivered("pending"), resend(json(503, {}))),
	mail(
		"the network is down",
		delivered("pending"),
		byHost({ resend: networkDown("socket hang up") }),
	),
	mail(
		"a timeout",
		delivered("pending"),
		byHost({ resend: networkDown("The operation was aborted due to timeout") }),
	),
	mail("a non-JSON 200", delivered("pending"), resend(text(200, "ok"))),
	mail("a 204", delivered("pending"), resend(text(204, ""))),
	mail("a 302", delivered("pending"), resend(text(302, ""))),
	mail(
		"the client copy is accepted and the contractor copy fails",
		delivered("pending"),
		resend(json(200, { id: "x" }), json(422, {})),
	),
	mail(
		"the client copy fails and the contractor copy is accepted",
		delivered("pending"),
		resend(json(422, {}), json(200, { id: "x" })),
	),
	mail(
		"the client copy may have arrived and the contractor copy is accepted",
		delivered("pending"),
		resend(json(503, {}), json(200, { id: "x" })),
	),
	mail(
		"the network fails for the client copy only",
		delivered("pending"),
		resend(networkDown(), json(200, { id: "x" })),
	),
	mail(
		"a copy after another copy that was refused, with a notice waiting",
		{
			...clientWaits("pending"),
			msa: doc("executed", { artifact: readySmall(MSA_ID, MSA_PDF_KEY) }),
		},
		resend(json(422, {}), json(200, { id: "x" })),
	),
];

const environment: Case[] = [
	mail(
		"no Resend key",
		delivered("pending"),
		resendOk,
		{},
		{ omit: ["RESEND_API_KEY"] },
	),
	mail(
		"no sender address",
		delivered("pending"),
		resendOk,
		{},
		{ omit: ["CONTACT_FROM_EMAIL"] },
	),
	mail(
		"no storage bucket",
		delivered("pending"),
		resendOk,
		{},
		{ r2: { missing: true } },
	),
	mail(
		"R2 get fails",
		delivered("pending"),
		resendOk,
		{},
		{ r2: { fails: ["get"] } },
	),
	mail(
		"the packet is missing from R2",
		delivered("pending"),
		resendOk,
		{},
		{ r2: { seed: {} } },
	),
	mail(
		"the packet in R2 has other bytes",
		delivered("pending"),
		resendOk,
		{},
		{ r2: { seed: { [SOW_PDF_KEY]: { body: "other bytes" } } } },
	),
	mail(
		"the packet is over 25 MiB",
		delivered("pending"),
		resendOk,
		{},
		{
			r2: {
				seed: { [SOW_PDF_KEY]: { body: new Uint8Array(25 * 1024 * 1024 + 1) } },
			},
		},
	),
	mail(
		"the packet is exactly 25 MiB and has another hash",
		delivered("pending"),
		resendOk,
		{},
		{
			r2: {
				seed: { [SOW_PDF_KEY]: { body: new Uint8Array(25 * 1024 * 1024) } },
			},
		},
	),
	mail("the artifact is not ready", {
		...delivered("pending"),
		sow: doc("executed", { artifact: { status: "pending" } }),
	}),
	mail("the artifact failed", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: { status: "failed", error_code: "storage" },
		}),
	}),
	mail("the artifact is rendering", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: {
				status: "rendering",
				attempt_id: "a1",
				attempted_at: at(5000),
			},
		}),
	}),
	mail("the artifact row has no key", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: { status: "ready", pdf_key: null, pdf_sha256: null },
		}),
	}),
	mail("the artifact row names another hash", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: {
				status: "ready",
				pdf_key: SOW_PDF_KEY,
				pdf_sha256: sha("other"),
			},
		}),
	}),
	mail("there is no artifact row", {
		...delivered("pending"),
		sow: doc("executed", { artifact: null }),
	}),
	mail("the agreement is archived", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: readySmall(SOW_ID, SOW_PDF_KEY),
			row: { archive_closed_at: PAST },
		}),
	}),
	mail("the agreement is not executed", {
		...delivered("pending"),
		sow: doc("client_signed", { artifact: readySmall(SOW_ID, SOW_PDF_KEY) }),
	}),
	mail("the agreement was abandoned", {
		...delivered("pending"),
		sow: doc("abandoned", { artifact: readySmall(SOW_ID, SOW_PDF_KEY) }),
	}),
	mail("the client signature row is missing", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: readySmall(SOW_ID, SOW_PDF_KEY),
			client: false,
		}),
	}),
	mail("the contractor signature row is missing", {
		...delivered("pending"),
		sow: doc("executed", {
			artifact: readySmall(SOW_ID, SOW_PDF_KEY),
			contractor: false,
		}),
	}),
	mail(
		"the MSA id is retried",
		delivered("pending"),
		resendOk,
		{},
		{ steps: [ownerJson(forAgreement("retry-copy", {}, MSA_ID))] },
	),
];

const fail = (
	name: string,
	on: RegExp,
	sc: Scene = delivered("pending"),
	nth?: number,
	extra: Partial<Case> = {},
): Case =>
	mail(
		name,
		sc,
		resendOk,
		{},
		{ failures: [{ on, message: "d1 unavailable", nth }], ...extra },
	);

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail("outage: the agreement lookup", /SELECT status,kind,effective_on/),
	fail(
		"outage: resetting the deliveries",
		/UPDATE software_agreement_deliveries SET status='pending'/,
	),
	fail(
		"outage: resetting the notifications",
		/UPDATE software_agreement_notifications SET status='pending'/,
	),
	fail(
		"outage: the notice lookup of the agreement",
		/SELECT request_id,\(SELECT receipt_id/,
		clientWaits("pending"),
	),
	fail(
		"outage: the claim of a notice",
		/UPDATE software_agreement_notifications SET status='sending'/,
		clientWaits("pending"),
	),
	fail(
		"outage: recording a sent notice",
		/UPDATE software_agreement_notifications SET status=\?/,
		clientWaits("pending"),
	),
	fail(
		"outage: the artifact read",
		/SELECT \* FROM software_agreement_artifacts WHERE agreement_id=\? AND status='ready'/,
	),
	fail(
		"outage: the signature lookup",
		/SELECT receipt_id FROM software_agreement_signatures/,
	),
	fail(
		"outage: the claim of the client copy",
		/UPDATE software_agreement_deliveries SET status='sending'/,
	),
	fail(
		"outage: the claim of the contractor copy",
		/UPDATE software_agreement_deliveries SET status='sending'/,
		delivered("pending"),
		2,
	),
	fail(
		"outage: recording the sent client copy",
		/UPDATE software_agreement_deliveries SET status=\?/,
	),
	fail(
		"outage: recording the sent client copy, then retrying",
		/UPDATE software_agreement_deliveries SET status=\?/,
		delivered("pending"),
		1,
		{
			steps: [
				ownerJson(body()),
				ownerJson(body(), { advanceMs: 120_000 }),
				ownerJson(body({ confirmedNotSent: true }), { advanceMs: 120_000 }),
			],
		},
	),
	ownForm("outage: resetting the deliveries", delivered("failed"), body(), {
		...smallPackets,
		failures: [
			{
				on: /UPDATE software_agreement_deliveries SET status='pending'/,
				message: "d1 unavailable",
			},
		],
	}),
];

const raceCase = (
	name: string,
	on: RegExp,
	sql: string,
	sc: Scene = delivered("pending"),
): Case =>
	mail(
		name,
		sc,
		resendOk,
		{},
		{ interleave: [{ on, label: name, run: (sqlite) => sqlite.exec(sql) }] },
	);

const claim = /UPDATE software_agreement_deliveries SET status='sending'/;

const races: Case[] = [
	raceCase(
		"another request claims the client copy first",
		claim,
		"UPDATE software_agreement_deliveries SET status='sending',attempt_id='other',attempted_at='2026-11-13T12:00:00.000Z' WHERE recipient_role='client'",
	),
	raceCase(
		"another request sent both copies first",
		claim,
		"UPDATE software_agreement_deliveries SET status='sent',sent_at='2026-11-13T12:00:00.000Z'",
	),
	raceCase(
		"the agreement is abandoned before the claim",
		claim,
		"UPDATE software_agreements SET status='abandoned'",
	),
	raceCase(
		"the agreement is archived before the claim",
		claim,
		"UPDATE software_agreements SET archive_closed_at='2026-11-13T12:00:00.000Z'",
	),
	raceCase(
		"the owner records an alternate copy before the claim",
		claim,
		"UPDATE software_agreement_deliveries SET alternate_delivered_at='2026-11-13T12:00:00.000Z',alternate_method='courier'",
	),
	raceCase(
		"the artifact is made not ready before the read",
		/SELECT \* FROM software_agreement_artifacts WHERE agreement_id=\? AND status='ready'/,
		"UPDATE software_agreement_artifacts SET status='failed',error_code='storage'",
	),
	raceCase(
		"the delivery rows are deleted before the claim",
		claim,
		"DELETE FROM software_agreement_deliveries",
	),
	raceCase(
		"the signature is deleted before the lookup",
		/SELECT receipt_id FROM software_agreement_signatures/,
		"DELETE FROM software_agreement_signatures WHERE party='client'",
	),
	raceCase(
		"another request marks the failed attempt sent while this one retries",
		/UPDATE software_agreement_deliveries SET status='pending'/,
		"UPDATE software_agreement_deliveries SET status='sent',sent_at='2026-11-13T12:00:00.000Z'",
		delivered("failed", { attempt_id: "a1" }),
	),
	raceCase(
		"a notice is sent by another request first",
		/UPDATE software_agreement_notifications SET status='sending'/,
		"UPDATE software_agreement_notifications SET status='sent',sent_at='2026-11-13T12:00:00.000Z'",
		clientWaits("pending"),
	),
	raceCase(
		"a project starts before the notice claim",
		/UPDATE software_agreement_notifications SET status='sending'/,
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','x','x','x','x','x','x')",
		clientWaits("pending"),
	),
];

const sequences: Case[] = [
	mail(
		"retry twice (a double click)",
		delivered("pending"),
		resendOk,
		{},
		{ steps: [ownerJson(body()), ownerJson(body())] },
	),
	mail(
		"retry after a refused send: the second retry succeeds",
		delivered("pending"),
		resend(json(422, {}), json(422, {}), json(200, { id: "x" })),
		{},
		{ steps: [ownerJson(body()), ownerJson(body())] },
	),
	mail(
		"retry after an uncertain send: unconfirmed, then confirmed",
		delivered("pending"),
		resend(json(503, {}), json(503, {}), json(200, { id: "x" })),
		{},
		{
			steps: [
				ownerJson(body()),
				ownerJson(body(), { advanceMs: 120_000 }),
				ownerJson(body({ confirmedNotSent: true }), { advanceMs: 120_000 }),
			],
		},
	),
	mail(
		"an uncertain send is confirmed before a minute has passed",
		delivered("pending"),
		resend(json(503, {}), json(200, { id: "x" })),
		{},
		{
			steps: [
				ownerJson(body()),
				ownerJson(body({ confirmedNotSent: true }), { advanceMs: 30_000 }),
			],
		},
	),
	mail(
		"retry three times",
		delivered("pending"),
		resendOk,
		{},
		{ steps: [ownerJson(body()), ownerJson(body()), ownerJson(body())] },
	),
	mail(
		"retry the copies, then the notices of the same agreement",
		delivered("pending"),
		resendOk,
		{},
		{
			steps: [
				ownerJson(body()),
				ownerJson(forAgreement("retry-copy", {}, MSA_ID)),
			],
		},
	),
	mail(
		"an invalid retry, then a valid one",
		delivered("pending"),
		resendOk,
		{},
		{
			steps: [ownerJson(body({ confirmedNotSent: "yes" })), ownerJson(body())],
		},
	),
];

const cases: Case[] = [
	...wire,
	...resets,
	...notices,
	...outcomes,
	...environment,
	...outages,
	...races,
	...sequences,
];

defineCorpus("owner-request-agreement-retry-copy", POST, cases);
