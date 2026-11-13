import { vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	MSA_ID,
	OTHER_ID,
	PAST,
	SOW_ID,
	delivered,
	deliveryRows,
	doc,
	executed,
	forAgreement,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	smallPackets,
	resendOk,
	type Scene,
} from "./areas/signing";
import { asOwner, asVisitor, defineCorpus, rows, type Case } from "./harness";

vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "record-alternate-copy": the owner records that a
// signed copy was handed over another way (the client or the contractor, by a method the owner types). One batch
// updates the delivery row of the role and writes a copy-delivered event. The action does not look at the agreement's
// state, at an existing record, or at whether the delivery row exists.
//
//   200 {ok:true}   the batch committed (a form gets a 303 to /owner/requests/r1), including for a role with no delivery
//                   row, an agreement in any status, and a record that overwrites an earlier one
//   400             agreement_id missing or not a uuid; role not client or contractor; method missing, empty, over 200
//                   characters or with a control character; confirmed not literally true
//   404 {ok:false}  no agreement with this id for this request
//   409 "The agreement changed or the operation failed. Reload before retrying."   the batch failed (the agreement
//                   vanished and the event's foreign key failed, an outage), or the lookup failed
//   rejected        the offer lookup

const body = (over: { [name: string]: string | boolean } = {}) =>
	forAgreement("record-alternate-copy", {
		role: "client",
		method: "Courier, signed in person",
		confirmed: true,
		...over,
	});

const BATCH = /UPDATE software_agreement_deliveries SET alternate_delivered_at/;

const method = (name: string, value: string | number | boolean | null) =>
	own(name, executed(), { ...body(), method: value });

const wire: Case[] = [
	...ownBoth("record the client's alternate copy", executed(), body()),
	...ownBoth(
		"record the contractor's alternate copy",
		executed(),
		body({ role: "contractor" }),
	),
	own("record both roles in turn", executed(), body(), {
		steps: [
			ownerJson(body()),
			ownerJson(body({ role: "contractor", method: "Hand delivery" })),
		],
	}),
	own("no role", executed(), {
		action: "record-alternate-copy",
		agreement_id: SOW_ID,
		method: "x",
		confirmed: true,
	}),
	own("a role in capitals", executed(), body({ role: "CLIENT" })),
	own("an unknown role", executed(), body({ role: "owner" })),
	own("a role that is not text", executed(), { ...body(), role: 1 }),
	own("no method", executed(), {
		action: "record-alternate-copy",
		agreement_id: SOW_ID,
		role: "client",
		confirmed: true,
	}),
	own("no confirmation", executed(), {
		action: "record-alternate-copy",
		agreement_id: SOW_ID,
		role: "client",
		method: "x",
	}),
	own("confirmed false", executed(), body({ confirmed: false })),
	own("confirmed as text", executed(), body({ confirmed: "true" })),
	own("no agreement id", executed(), {
		action: "record-alternate-copy",
		role: "client",
		method: "x",
		confirmed: true,
	}),
	own(
		"an agreement id that is not a uuid",
		executed(),
		body({ agreement_id: "x" }),
	),
	...ownBoth(
		"an agreement id that does not exist",
		executed(),
		body({ agreement_id: OTHER_ID }),
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
		body({ agreement_id: OTHER_ID }),
	),
	own(
		"a visitor cannot record a copy",
		executed(),
		body(),
		{},
		{ as: asVisitor() },
	),
];

const methods: Case[] = [
	method("a method with accents", "Remise en main propre à Zoë"),
	method("a method written decomposed is stored composed", "Café handoff"),
	method("a method padded with spaces", "   courier   "),
	method(
		"a method with markup and quotes",
		`<img src=x onerror=alert(1)> & "q" 'p'`,
	),
	method("a method in Chinese", "当面交付"),
	method("a method with an emoji", "Mail 📬"),
	method("a method with a line break", "line one\nline two"),
	method("a method of 200 characters", "m".repeat(200)),
	method("a method of 201 characters", "m".repeat(201)),
	method("an empty method", ""),
	method("a method of only spaces", "    "),
	method("a method with a control character", "a\u0007b"),
	method("a method that is a number", 5),
	method("a method that is null", null),
	method("a method that is a boolean", true),
];

const states: Case[] = [
	own("the delivery was pending", delivered("pending"), body()),
	own("the delivery was sent", delivered("sent", { sent_at: PAST }), body()),
	own(
		"the delivery had failed",
		delivered("failed", { attempt_id: "a1" }),
		body(),
	),
	own(
		"the delivery was still sending",
		delivered("sending", { attempt_id: "a1", attempted_at: PAST }),
		body(),
	),
	own(
		"an earlier record is overwritten",
		delivered("pending", {
			alternate_delivered_at: PAST,
			alternate_method: "courier",
		}),
		body({ method: "Hand delivery" }),
	),
	own(
		"the contractor record is overwritten",
		delivered("pending", {
			alternate_delivered_at: PAST,
			alternate_method: "courier",
		}),
		body({ role: "contractor", method: "Hand delivery" }),
	),
	own(
		"there are no delivery rows: the event is still written",
		{ ...executed(), deliveries: false },
		body(),
	),
	own(
		"only the contractor row exists and the client is named",
		{ ...executed(), deliveries: deliveryRows("pending").slice(1) },
		body(),
	),
	own(
		"the agreement is only client_signed",
		{ msa: doc("client_signed"), sow: doc("client_signed") },
		body(),
	),
	own(
		"the agreement is in review",
		{ msa: doc("review"), sow: doc("review") },
		body(),
	),
	own(
		"the agreement was abandoned",
		{ msa: doc("abandoned"), sow: doc("abandoned") },
		body(),
	),
	own(
		"the agreement is archived",
		{
			msa: doc("executed"),
			sow: doc("executed", { row: { archive_closed_at: PAST } }),
		},
		body(),
	),
	own(
		"the MSA id is named (it has no delivery rows)",
		executed(),
		body({ agreement_id: MSA_ID }),
	),
	own(
		"a held agreement",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		body(),
	),
	own(
		"an ended agreement",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: {
					ended_at: "2026-11-13",
					retain_until: "2036-11-13T12:00:00.000Z",
				},
			}),
		},
		body(),
	),
	own(
		"recorded a day later",
		executed(),
		body(),
		{},
		{ advanceMs: 86_400_000 },
	),
	own(
		"recorded by an owner email in capitals",
		executed(),
		body(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	own(
		"recorded by an owner email with markup",
		executed(),
		body(),
		{},
		{ as: asOwner("o<b>@example.test") },
	),
	own(
		"a record after a refused copy send",
		delivered("failed", { attempt_id: "a1" }),
		body(),
		{ ...smallPackets, fetches: resendOk, omit: [] },
	),
];

const raceCase = (name: string, sql: string, sc: Scene = executed()): Case =>
	own(name, sc, body(), {
		interleave: [{ on: BATCH, label: name, run: (sqlite) => sqlite.exec(sql) }],
	});

const races: Case[] = [
	raceCase(
		"the delivery row is deleted before the batch",
		"DELETE FROM software_agreement_deliveries",
	),
	raceCase(
		"the delivery is sent by another request first",
		"UPDATE software_agreement_deliveries SET status='sent',sent_at='2026-11-13T12:00:00.000Z'",
	),
	raceCase(
		"another record is written first",
		"UPDATE software_agreement_deliveries SET alternate_delivered_at='2026-11-13T11:59:00.000Z',alternate_method='other'",
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
	own(name, executed(), body(), {
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
		steps: [ownerJson(body()), ownerJson(body())],
	}),
	ownForm("outage: the batch", executed(), body(), {
		failures: [{ on: BATCH, message: "d1 unavailable" }],
	}),
];

const sequences: Case[] = [
	own("record the same copy twice (a double click)", executed(), body(), {
		steps: [ownerJson(body()), ownerJson(body())],
	}),
	own("record, then record another method", executed(), body(), {
		steps: [
			ownerJson(body()),
			ownerJson(body({ method: "Courier two" }), { advanceMs: 60_000 }),
		],
	}),
	own("an invalid record, then a valid one", executed(), body(), {
		steps: [ownerJson(body({ method: "" })), ownerJson(body())],
	}),
	own(
		"record, then retry the copies (the alternate record does not stop the send)",
		delivered("pending"),
		body(),
		{
			...smallPackets,
			fetches: resendOk,
			omit: [],
			steps: [ownerJson(body()), ownerJson(forAgreement("retry-copy"))],
		},
	),
	own("record, then end the agreement", executed(), body(), {
		steps: [
			ownerJson(body()),
			ownerJson(
				forAgreement("end", { ended_on: "2026-11-13", confirmed: true }),
			),
		],
	}),
];

const cases: Case[] = [
	...wire,
	...methods,
	...states,
	...races,
	...outages,
	...sequences,
];

defineCorpus("owner-request-agreement-record-copy", POST, cases);
