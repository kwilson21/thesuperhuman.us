import { vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	MSA_ID,
	OLD_MSA_ID,
	OTHER_ID,
	PAST,
	SOW_ID,
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

vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "end": the owner ends an executed or abandoned
// agreement on a day between its signing and today (New York dates), which starts its ten-year retention. Ending an MSA
// also records its termination, unless an open offer still reuses it. One batch writes ended_at, retain_until and
// terminated_at. The action does not look at an earlier ending, a legal hold or the delivery state.
//
//   200 {ok:true}   the batch ran (a form gets a 303 to /owner/requests/r1), also when its UPDATE changed no row
//   400             agreement_id missing or not a uuid; ended_on not YYYY-MM-DD; confirmed not literally true
//   404 {ok:false}  no agreement with this id for this request
//   409 {ok:false}  the agreement is not executed or abandoned
//   409 "Use an end date from signing through today."    before the day of signing (executed_at, else client_signed_at,
//                   else effective_on) or after today in New York; the comparison is on the text of the date
//   409 "An open offer uses this agreement. Withdraw that offer first."   an MSA that a draft or sent offer of an open
//                   request without a project still reuses: before the batch, and after a batch whose guard lost a race
//   409 "The agreement changed or the operation failed. Reload before retrying."   a date that does not exist
//                   (2025-02-30), a batch outage, an agreement whose archive was closed (trigger), the lookup failing
//   rejected        the offer lookup; the lookup of an open offer after a failed batch

const END = /UPDATE software_agreements SET ended_at/;

const end = (
	ended_on: string | number | null,
	over: { [name: string]: string | boolean | number | null } = {},
	id: string = SOW_ID,
) => ({
	action: "end",
	agreement_id: id,
	ended_on,
	confirmed: true,
	...over,
});

/** Both documents executed (and signed) at this time. */
const signed = (at: string, extra: Scene = {}): Scene => ({
	msa: doc("executed", { row: { executed_at: at, client_signed_at: at } }),
	sow: doc("executed", { row: { executed_at: at, client_signed_at: at } }),
	...extra,
});

const old = signed("2026-11-01T12:00:00.000Z");

const dates: Case[] = [
	...ownBoth("end the SOW today", executed(), end("2026-11-13")),
	own("end the MSA today", executed(), end("2026-11-13", {}, MSA_ID)),
	own("end the SOW on a day after signing", old, end("2026-11-05")),
	own("end the SOW on the day of signing", old, end("2026-11-01")),
	own("end the SOW the day before signing", old, end("2026-10-31")),
	own("end the SOW a day after today", old, end("2026-11-14")),
	own("end the SOW far in the future", old, end("2099-01-01")),
	own("end the SOW long before signing", old, end("1999-01-01")),
	own(
		"end the SOW before it was executed on the day of the client signature",
		{
			...old,
			sow: doc("executed", {
				row: {
					executed_at: "2026-11-10T12:00:00.000Z",
					client_signed_at: "2026-11-01T12:00:00.000Z",
				},
			}),
		},
		end("2026-11-05"),
	),
	own(
		"an executed agreement with no executed_at uses the client signature day",
		{
			...old,
			sow: doc("executed", {
				row: {
					executed_at: null,
					client_signed_at: "2026-11-05T12:00:00.000Z",
				},
			}),
		},
		end("2026-11-04"),
	),
	own(
		"an executed agreement with neither time uses the effective day",
		{
			...old,
			sow: doc("executed", {
				row: {
					executed_at: null,
					client_signed_at: null,
					effective_on: "2026-11-05",
				},
			}),
		},
		end("2026-11-05"),
	),
	own(
		"an executed agreement with neither time, a day before the effective day",
		{
			...old,
			sow: doc("executed", {
				row: {
					executed_at: null,
					client_signed_at: null,
					effective_on: "2026-11-05",
				},
			}),
		},
		end("2026-11-04"),
	),
	own(
		"signed at 23:59:59 New York time the night before",
		signed("2026-11-13T04:59:59.000Z"),
		end("2026-11-12"),
	),
	own(
		"signed at midnight New York time, the day before is refused",
		signed("2026-11-13T05:00:00.000Z"),
		end("2026-11-12"),
	),
	own(
		"signed at midnight New York time, the same day is accepted",
		signed("2026-11-13T05:00:00.000Z"),
		end("2026-11-13"),
	),
	own(
		"signed in summer time at 23:59 the night before",
		signed("2026-07-01T03:59:59.000Z"),
		end("2026-06-30"),
	),
	own(
		"signed in summer time at midnight, the day before is refused",
		signed("2026-07-01T04:00:00.000Z"),
		end("2026-06-30"),
	),
	own(
		"today in New York ends at 05:00 UTC: just before",
		old,
		end("2026-11-14"),
		{},
		{ advanceMs: 16 * 3_600_000 + 59 * 60_000 },
	),
	own(
		"today in New York ends at 05:00 UTC: just after",
		old,
		end("2026-11-14"),
		{},
		{ advanceMs: 17 * 3_600_000 },
	),
	own(
		"the day before today is accepted after midnight in New York",
		old,
		end("2026-11-13"),
		{},
		{ advanceMs: 17 * 3_600_000 },
	),
	own(
		"a day in a leap year",
		signed("2024-01-01T12:00:00.000Z"),
		end("2024-02-29"),
	),
	own(
		"the day after a leap day",
		signed("2024-01-01T12:00:00.000Z"),
		end("2024-03-01"),
	),
	own(
		"a retention that starts on a leap day lands on March 1",
		signed("2024-01-01T12:00:00.000Z"),
		end("2024-02-29", {}, MSA_ID),
	),
	own(
		"a day that does not exist (February 30)",
		signed("2025-01-01T12:00:00.000Z"),
		end("2025-02-30"),
	),
	own(
		"a day that does not exist (February 29 of a common year)",
		signed("2025-01-01T12:00:00.000Z"),
		end("2025-02-29"),
	),
	own(
		"a day that does not exist (April 31)",
		signed("2025-01-01T12:00:00.000Z"),
		end("2025-04-31"),
	),
	own(
		"a month that does not exist",
		signed("2025-01-01T12:00:00.000Z"),
		end("2025-13-01"),
	),
	own("month zero", signed("2025-01-01T12:00:00.000Z"), end("2025-00-10")),
	own("day zero", signed("2025-01-01T12:00:00.000Z"), end("2025-05-00")),
	own("day thirty-two", signed("2025-01-01T12:00:00.000Z"), end("2025-05-32")),
];

const formats: Case[] = [
	own("no ended_on", executed(), {
		action: "end",
		agreement_id: SOW_ID,
		confirmed: true,
	}),
	own("ended_on with a single-digit month", executed(), end("2026-1-3")),
	own("ended_on with a two-digit year", executed(), end("26-11-13")),
	own("ended_on with a time", executed(), end("2026-11-13T00:00:00Z")),
	own("ended_on with a leading space", executed(), end(" 2026-11-13")),
	own("ended_on with a trailing space", executed(), end("2026-11-13 ")),
	own("ended_on with a trailing line break", executed(), end("2026-11-13\n")),
	own("ended_on without dashes", executed(), end("20261113")),
	own("ended_on as a slash date", executed(), end("11/13/2026")),
	own("ended_on empty", executed(), end("")),
	own("ended_on as a number", executed(), end(20261113)),
	own("ended_on null", executed(), end(null)),
	own("ended_on in Arabic-Indic digits", executed(), end("٢٠٢٦-١١-١٣")),
	own("ended_on with markup", executed(), end("<b>2026-11-13</b>")),
	own("confirmed false", executed(), end("2026-11-13", { confirmed: false })),
	own(
		"confirmed as text",
		executed(),
		end("2026-11-13", { confirmed: "true" }),
	),
	own("no confirmation", executed(), {
		action: "end",
		agreement_id: SOW_ID,
		ended_on: "2026-11-13",
	}),
	own("no agreement id", executed(), {
		action: "end",
		ended_on: "2026-11-13",
		confirmed: true,
	}),
	own(
		"an agreement id that is not a uuid",
		executed(),
		end("2026-11-13", {}, "x"),
	),
	...ownBoth(
		"an agreement id that does not exist",
		executed(),
		end("2026-11-13", {}, OTHER_ID),
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
		end("2026-11-13", {}, OTHER_ID),
	),
	own(
		"a visitor cannot end an agreement",
		executed(),
		end("2026-11-13"),
		{},
		{ as: asVisitor() },
	),
	ownForm("an invalid date", old, end("2025-02-30")),
	ownForm("an end date before signing", old, end("2026-10-31")),
];

const states: Case[] = [
	own(
		"end an agreement in review",
		{ msa: doc("review"), sow: doc("review") },
		end("2026-11-13"),
	),
	own(
		"end a client_signed agreement",
		{ msa: doc("client_signed"), sow: doc("client_signed") },
		end("2026-11-13"),
	),
	...ownBoth(
		"end an abandoned agreement",
		{ msa: doc("abandoned"), sow: doc("abandoned") },
		end("2026-11-13"),
	),
	own(
		"end an abandoned agreement the day its effective date allows",
		{
			msa: doc("abandoned"),
			sow: doc("abandoned", { row: { effective_on: "2026-11-05" } }),
		},
		end("2026-11-05"),
	),
	own(
		"end an abandoned agreement before its effective date",
		{
			msa: doc("abandoned"),
			sow: doc("abandoned", { row: { effective_on: "2026-11-05" } }),
		},
		end("2026-11-04"),
	),
	own(
		"end an agreement that has ended already (the dates are overwritten)",
		{
			msa: doc("executed", {
				row: { executed_at: "2026-11-01T12:00:00.000Z" },
			}),
			sow: doc("executed", {
				row: {
					executed_at: "2026-11-01T12:00:00.000Z",
					ended_at: "2026-11-02",
					retain_until: "2036-11-02T12:00:00.000Z",
				},
			}),
		},
		end("2026-11-10"),
	),
	own(
		"end an agreement that is on legal hold",
		{ msa: doc("executed"), sow: doc("executed", { row: { legal_hold: 1 } }) },
		end("2026-11-13"),
	),
	own(
		"end an agreement whose archive was closed",
		{
			msa: doc("executed"),
			sow: doc("executed", { row: { archive_closed_at: PAST } }),
		},
		end("2026-11-13"),
	),
	own(
		"end an abandoned agreement whose archive was closed",
		{
			msa: doc("abandoned"),
			sow: doc("abandoned", { row: { archive_closed_at: PAST } }),
		},
		end("2026-11-13"),
	),
	own(
		"end an agreement with its copies still pending",
		executed(),
		end("2026-11-13"),
	),
	own(
		"end the MSA of the same request with the SOW still open",
		{ msa: doc("executed"), sow: doc("executed") },
		end("2026-11-13", {}, MSA_ID),
	),
	own(
		"end by an owner email in capitals",
		executed(),
		end("2026-11-13"),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
];

const reusedBy = (
	offer: { [column: string]: string | number | null } = {},
	request: { [column: string]: string } = {},
	extra: Scene["extra"] = {},
): Scene => ({
	reused: doc("executed"),
	msa: false,
	sow: doc("client_signed"),
	offer,
	request,
	extra,
});

const endOld = (name: string, sc: Scene, extra: Partial<Case> = {}) =>
	own(
		name,
		sc,
		end("2026-11-13", {}, OLD_MSA_ID),
		{ ...extra },
		{ path: "/api/owner/requests/r0/agreement", params: { id: "r0" } },
	);

const reuse: Case[] = [
	endOld("end an MSA that a sent offer reuses", reusedBy()),
	ownForm(
		"end an MSA that a sent offer reuses",
		reusedBy(),
		end("2026-11-13", {}, OLD_MSA_ID),
		{},
		{ path: "/api/owner/requests/r0/agreement", params: { id: "r0" } },
	),
	endOld("end an MSA that a draft offer reuses", reusedBy({ status: "draft" })),
	endOld(
		"end an MSA that a superseded offer reused",
		reusedBy({ status: "superseded" }),
	),
	endOld(
		"end an MSA that a withdrawn offer reused",
		reusedBy({ status: "withdrawn" }),
	),
	endOld(
		"end an MSA whose reusing request was resolved",
		reusedBy({}, { status: "resolved" }),
	),
	endOld(
		"end an MSA whose reusing request was withdrawn",
		reusedBy({}, { status: "withdrawn" }),
	),
	endOld(
		"end an MSA whose reusing offer already has a project",
		reusedBy(
			{},
			{},
			{
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
		),
	),
	own(
		"the SOW of a reusing offer can end while its MSA is reused",
		{ reused: doc("executed"), msa: false, sow: doc("executed") },
		end("2026-11-13"),
	),
];

const raceCase = (
	name: string,
	on: RegExp,
	sql: string,
	sc: Scene = executed(),
	id: string = SOW_ID,
	path = "r1",
): Case =>
	own(
		name,
		sc,
		end("2026-11-13", {}, id),
		{ interleave: [{ on, label: name, run: (sqlite) => sqlite.exec(sql) }] },
		{ path: `/api/owner/requests/${path}/agreement`, params: { id: path } },
	);

const races: Case[] = [
	raceCase(
		"an offer starts to reuse the MSA before the batch",
		END,
		"UPDATE software_offers SET reused_msa_id='" + MSA_ID + "'",
		executed(),
		MSA_ID,
	),
	raceCase(
		"the agreement stops being executed before the batch (no rows change)",
		END,
		"UPDATE software_agreements SET status='client_signed' WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"the agreement is abandoned before the batch",
		END,
		"UPDATE software_agreements SET status='abandoned' WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"the archive is closed before the batch",
		END,
		"UPDATE software_agreements SET archive_closed_at='2026-11-13T12:00:00.000Z' WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"another request ends the agreement first",
		END,
		"UPDATE software_agreements SET ended_at='2026-11-12',retain_until='2036-11-12T12:00:00.000Z' WHERE id='" +
			SOW_ID +
			"'",
	),
	raceCase(
		"the agreement is deleted before the batch (no rows change)",
		END,
		"DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_artifacts; DELETE FROM software_agreement_signatures WHERE agreement_id='" +
			SOW_ID +
			"'; DELETE FROM software_agreements WHERE id='" +
			SOW_ID +
			"'",
	),
];

const fail = (
	name: string,
	on: RegExp,
	extra: Partial<Case> = {},
	sc: Scene = executed(),
	id: string = SOW_ID,
): Case =>
	own(name, sc, end("2026-11-13", {}, id), {
		failures: [{ on, message: "d1 unavailable" }],
		...extra,
	});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail("outage: the agreement lookup", /SELECT status,kind,effective_on/),
	fail("outage: the batch", END),
	fail(
		"outage: the batch of an MSA with nothing reusing it",
		END,
		{},
		executed(),
		MSA_ID,
	),
	fail(
		"outage: the open-offer check of an MSA",
		/SELECT 1 FROM software_offers o JOIN owner_requests r/,
		{},
		executed(),
		MSA_ID,
	),
	fail(
		"outage: the batch of an MSA, and the recheck",
		END,
		{
			failures: [
				{ on: END, message: "d1 unavailable" },
				{
					on: /^SELECT 1 FROM software_offers o JOIN owner_requests r/,
					nth: 2,
					message: "d1 unavailable",
				},
			],
		},
		executed(),
		MSA_ID,
	),
	ownForm("outage: the batch", executed(), end("2026-11-13"), {
		failures: [{ on: END, message: "d1 unavailable" }],
	}),
	fail("outage: the batch, then the same request again", END, {
		steps: [ownerJson(end("2026-11-13")), ownerJson(end("2026-11-13"))],
	}),
];

const sequences: Case[] = [
	own(
		"end twice on the same day (a double click)",
		executed(),
		end("2026-11-13"),
		{ steps: [ownerJson(end("2026-11-13")), ownerJson(end("2026-11-13"))] },
	),
	own("end, then end on another day", old, end("2026-11-05"), {
		steps: [ownerJson(end("2026-11-05")), ownerJson(end("2026-11-10"), {})],
	}),
	own("end the SOW, then the MSA", executed(), end("2026-11-13"), {
		steps: [
			ownerJson(end("2026-11-13")),
			ownerJson(end("2026-11-13", {}, MSA_ID)),
		],
	}),
	own("end, then place a hold", executed(), end("2026-11-13"), {
		steps: [
			ownerJson(end("2026-11-13")),
			ownerJson(forAgreement("hold", { held: true })),
		],
	}),
	own("an invalid end, then a valid one", executed(), end("2026-11-13"), {
		steps: [ownerJson(end("2026-11-14")), ownerJson(end("2026-11-13"))],
	}),
	own("end, then retry the copies", executed(), end("2026-11-13"), {
		steps: [
			ownerJson(end("2026-11-13")),
			ownerJson(forAgreement("retry-copy")),
		],
	}),
	own("abandon is refused after an end", executed(), end("2026-11-13"), {
		steps: [
			ownerJson(end("2026-11-13")),
			ownerJson({
				action: "abandon",
				documents: [],
				reason: "x",
				confirmed: true,
			}),
		],
	}),
];

void OLD_MSA_ID;

const cases: Case[] = [
	...dates,
	...formats,
	...states,
	...reuse,
	...races,
	...outages,
	...sequences,
];

defineCorpus("owner-request-agreement-end", POST, cases);
