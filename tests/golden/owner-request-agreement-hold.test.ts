import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	MSA_ID,
	OTHER_ID,
	PAST,
	SOW_ID,
	delivered,
	doc,
	executed,
	forAgreement,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	type Scene,
} from "./areas/signing";
import { asOwner, asVisitor, defineCorpus, rows, type Case } from "./harness";

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "hold": the owner puts a legal hold on an
// agreement or lifts it. One batch sets legal_hold and writes a hold-changed event (an event is written even when the
// value does not change). The action does not look at the agreement's state. A form that leaves `held` out lifts the
// hold; JSON must say it.
//
//   200 {ok:true}   the batch committed (a form gets a 303 to /owner/requests/r1)
//   400             agreement_id missing or not a uuid; held missing (JSON only) or not a boolean
//   404 {ok:false}  no agreement with this id for this request
//   409 "The agreement changed or the operation failed. Reload before retrying."   the batch failed: an agreement
//                   whose archive was closed (the cleanup lock trigger refuses a change of legal_hold), an outage
//   rejected        the offer lookup

const body = (held: boolean | string | number | null, id: string = SOW_ID) => ({
	action: "hold",
	agreement_id: id,
	held,
});

const noHeld = { action: "hold", agreement_id: SOW_ID };

const BATCH = /UPDATE software_agreements SET legal_hold/;

const wire: Case[] = [
	...ownBoth("place a hold", executed(), body(true)),
	...ownBoth(
		"lift a hold",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		body(false),
	),
	own("held missing in JSON", executed(), noHeld),
	ownForm(
		"held missing lifts the hold",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		noHeld,
	),
	own("held as text", executed(), body("true")),
	own("held as 1", executed(), body(1)),
	own("held null", executed(), body(null)),
	ownForm("held on", executed(), body("on")),
	ownForm("held true", executed(), body("true")),
	ownForm("held false", executed(), body("false")),
	ownForm("held yes is not accepted", executed(), body("yes")),
	ownForm("held 1 is not accepted", executed(), body("1")),
	ownForm("held in capitals is not accepted", executed(), body("ON")),
	own("an agreement id that is not a uuid", executed(), body(true, "x")),
	own("no agreement id", executed(), { action: "hold", held: true }),
	...ownBoth(
		"an agreement id that does not exist",
		executed(),
		body(true, OTHER_ID),
	),
	own(
		"an agreement of another request",
		{
			...executed(),
			extra: {
				software_agreements: [
					rows.agreement(OTHER_ID, "r9", "o1", {
						status: "executed",
						offer_id: null,
					}),
				],
			},
		},
		body(true, OTHER_ID),
	),
	own("a visitor cannot hold", executed(), body(true), {}, { as: asVisitor() }),
	own("the MSA id is held", executed(), body(true, MSA_ID)),
];

const states: Case[] = [
	own(
		"hold an agreement in review",
		{ msa: doc("review"), sow: doc("review") },
		body(true),
	),
	own(
		"hold a client_signed agreement",
		{ msa: doc("client_signed"), sow: doc("client_signed") },
		body(true),
	),
	own("hold an executed agreement", executed(), body(true)),
	own(
		"hold an abandoned agreement",
		{ msa: doc("abandoned"), sow: doc("abandoned") },
		body(true),
	),
	own(
		"hold an ended agreement",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: {
					ended_at: "2026-11-13",
					retain_until: "2036-11-13T12:00:00.000Z",
				},
			}),
		},
		body(true),
	),
	own(
		"hold an agreement that is already held",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		body(true),
	),
	own("lift a hold that is not set", executed(), body(false)),
	own(
		"hold an agreement whose archive was closed",
		{
			msa: doc("executed"),
			sow: doc("executed", { row: { archive_closed_at: PAST } }),
		},
		body(true),
	),
	own(
		"lift a hold on an agreement whose archive was closed",
		{
			msa: doc("executed"),
			sow: doc("executed", { row: { archive_closed_at: PAST, legal_hold: 1 } }),
		},
		body(false),
	),
	own(
		"an MSA that belongs to the earlier request of a reused offer",
		{ reused: doc("executed"), msa: false, sow: doc("client_signed") },
		body(true, "00000000-0000-4000-8000-0000000000a0"),
	),
	own(
		"hold with the clock a day later",
		executed(),
		body(true),
		{},
		{ advanceMs: 86_400_000 },
	),
	own(
		"hold by an owner email in capitals",
		executed(),
		body(true),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	own(
		"hold by an owner email with markup",
		executed(),
		body(true),
		{},
		{ as: asOwner("o<b>@example.test") },
	),
	own(
		"hold keeps the deliveries and artifacts alone",
		delivered("sent", { sent_at: PAST }),
		body(true),
	),
];

const sequences: Case[] = [
	own("hold, release, hold", executed(), body(true), {
		steps: [
			ownerJson(body(true)),
			ownerJson(body(false)),
			ownerJson(body(true)),
		],
	}),
	own("hold twice (a double click)", executed(), body(true), {
		steps: [ownerJson(body(true)), ownerJson(body(true))],
	}),
	own(
		"release twice",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		body(false),
		{ steps: [ownerJson(body(false)), ownerJson(body(false))] },
	),
	own("hold the SOW and the MSA", executed(), body(true), {
		steps: [ownerJson(body(true)), ownerJson(body(true, MSA_ID))],
	}),
	own("an invalid hold, then a valid one", executed(), body(true), {
		steps: [ownerJson(body("true")), ownerJson(body(true))],
	}),
	own("hold, then end", executed(), body(true), {
		steps: [
			ownerJson(body(true)),
			ownerJson(
				forAgreement("end", { ended_on: "2026-11-13", confirmed: true }),
			),
		],
	}),
];

const raceCase = (name: string, sql: string, sc: Scene = executed()): Case =>
	own(name, sc, body(true), {
		interleave: [{ on: BATCH, label: name, run: (sqlite) => sqlite.exec(sql) }],
	});

const races: Case[] = [
	raceCase(
		"the hold is set by another request first",
		"UPDATE software_agreements SET legal_hold=1 WHERE id='" + SOW_ID + "'",
	),
	raceCase(
		"the archive is closed before the batch",
		"UPDATE software_agreements SET archive_closed_at='2026-11-13T12:00:00.000Z' WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"the agreement is deleted before the batch",
		"DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_artifacts; DELETE FROM software_agreement_signatures WHERE agreement_id='" +
			SOW_ID +
			"'; DELETE FROM software_agreements WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"the agreement is abandoned before the batch",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='sow'",
	),
];

const fail = (name: string, on: RegExp, extra: Partial<Case> = {}): Case =>
	own(name, executed(), body(true), {
		failures: [{ on, message: "d1 unavailable" }],
		...extra,
	});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail("outage: the agreement lookup", /SELECT status,kind,effective_on/),
	fail("outage: the batch", BATCH),
	fail("outage: the batch, then the same request again", BATCH, {
		steps: [ownerJson(body(true)), ownerJson(body(true))],
	}),
	ownForm("outage: the batch", executed(), body(true), {
		failures: [{ on: BATCH, message: "d1 unavailable" }],
	}),
];

const cases: Case[] = [...wire, ...states, ...sequences, ...races, ...outages];

defineCorpus("owner-request-agreement-hold", POST, cases);
