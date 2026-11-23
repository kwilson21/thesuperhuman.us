import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { softwareGuard } from "../../src/lib/software-guard";
import { POST } from "../../src/pages/api/owner/requests/[id]/agreement";
import { AGREEMENT_MOVES } from "../../src/server/machines/agreement-document";
import { CHANGED_OR_FAILED } from "../../src/server/rules/agreement-countersign";
import {
	afterRefusedEnd,
	type EndFacts,
	type EndRequest,
	endAgreement,
	endFront,
	holdAgreement,
	newYorkDay,
	type RecordAgreementRow,
	recordCopy,
	type ReusingOfferRow,
} from "../../src/server/rules/agreement-record";
import type { Refusal } from "../../src/server/terms";
import { double, partial } from "../helpers/doubles";
import { testRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The owner's records on an agreement as stories: an end in today's order (the agreement, its status, the days it may
// end, the MSA's use, a day that does not exist, a closed archive) with the values it writes, a hold and a copy record.
// Then today's route runs on sqlite beside the rules over the same rows, for every status, kind, signing time, archive,
// reuse and end date that matters, and the guards that re-check them (A13, A14 and the cleanup lock) run against the rules.

const said = <W, E extends Refusal>(decided: Effect.Effect<W, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

const ID = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-23";

const row = (over: Partial<RecordAgreementRow> = {}): RecordAgreementRow => ({
	status: "executed",
	kind: "sow",
	effective_on: "2026-11-01",
	client_signed_at: "2026-11-01T12:00:00.000Z",
	executed_at: "2026-11-01T12:00:00.000Z",
	archive_closed_at: null,
	...over,
});

const OPEN: ReusingOfferRow = {
	status: "sent",
	request_status: "new",
	project_offer_id: null,
};

const end = (
	endedOn: string,
	agreement: RecordAgreementRow | null = row(),
	reusingOffers: ReusingOfferRow[] = [],
) =>
	said(
		endAgreement.decide(
			{ agreementId: ID, endedOn, today: TODAY },
			{ agreement, reusingOffers },
		),
	);

const front = (endedOn: string, agreement: RecordAgreementRow | null = row()) =>
	said(
		endFront.decide({ agreementId: ID, endedOn, today: TODAY }, { agreement }),
	);

const NOT_FOUND = { refused: "AgreementNotFound", say: "" };
const NOT_ENDABLE = { refused: "NotEndable", say: "" };

const OUTSIDE = {
	refused: "EndDateOutside",
	say: "Use an end date from signing through today.",
};

const IN_USE = {
	refused: "MsaInUse",
	say: "An open offer uses this agreement. Withdraw that offer first.",
};

const NO_SUCH_DAY = { refused: "DateDoesNotExist", say: CHANGED_OR_FAILED };
const CLOSED = { refused: "ArchiveClosed", say: CHANGED_OR_FAILED };

describe("New York days", () => {
	it("reads the day of a time in New York, across midnight and summer time", () => {
		expect(newYorkDay(new Date("2026-11-13T04:59:59.000Z"))).toBe("2026-11-12");
		expect(newYorkDay(new Date("2026-11-13T05:00:00.000Z"))).toBe("2026-11-13");
		expect(newYorkDay(new Date("2026-07-01T03:59:59.000Z"))).toBe("2026-06-30");
		expect(newYorkDay(new Date("2026-07-01T04:00:00.000Z"))).toBe("2026-07-01");
	});
});

describe("ending an agreement", () => {
	it("is refused with no sentence when the request has no such agreement", () => {
		expect(end(TODAY, null)).toEqual(NOT_FOUND);
		expect(front(TODAY, null)).toEqual(NOT_FOUND);
	});

	it("is refused with no sentence unless the agreement is executed or abandoned", () => {
		expect(end(TODAY, row({ status: "review" }))).toEqual(NOT_ENDABLE);
		expect(end(TODAY, row({ status: "client_signed" }))).toEqual(NOT_ENDABLE);
		expect(end(TODAY, row({ status: "abandoned" }))).toHaveProperty("wrote");
		expect(AGREEMENT_MOVES.END).toEqual(["executed", "abandoned"]);
	});

	it("takes a day from the day of signing through today in New York", () => {
		expect(end("2026-11-01")).toHaveProperty("wrote");
		expect(end(TODAY)).toHaveProperty("wrote");
		expect(end("2026-10-31")).toEqual(OUTSIDE);
		expect(end("2026-11-24")).toEqual(OUTSIDE);
		expect(end("1999-01-01")).toEqual(OUTSIDE);
		expect(end("2099-01-01")).toEqual(OUTSIDE);
	});

	it("reads the day of signing from the execution, else the client's signature, else the effective day", () => {
		const late = row({
			executed_at: "2026-11-10T12:00:00.000Z",
			client_signed_at: "2026-11-01T12:00:00.000Z",
		});

		expect(end("2026-11-05", late)).toEqual(OUTSIDE);
		expect(
			end(
				"2026-11-04",
				row({
					executed_at: null,
					client_signed_at: "2026-11-05T12:00:00.000Z",
				}),
			),
		).toEqual(OUTSIDE);
		expect(
			end(
				"2026-11-05",
				row({
					executed_at: null,
					client_signed_at: null,
					effective_on: "2026-11-05",
				}),
			),
		).toHaveProperty("wrote");
		expect(
			end(
				"2026-11-04",
				row({
					executed_at: null,
					client_signed_at: null,
					effective_on: "2026-11-05",
				}),
			),
		).toEqual(OUTSIDE);
		expect(
			end("2026-11-12", row({ executed_at: "2026-11-13T04:59:59.000Z" })),
		).toHaveProperty("wrote");
		expect(
			end("2026-11-12", row({ executed_at: "2026-11-13T05:00:00.000Z" })),
		).toEqual(OUTSIDE);
	});

	it("reads an empty execution time as no time, as the route's truth test does", () => {
		expect(
			end(
				"2026-11-05",
				row({
					executed_at: "",
					client_signed_at: "2026-11-20T12:00:00.000Z",
					effective_on: "2026-11-05",
				}),
			),
		).toHaveProperty("wrote");
	});

	it("is refused with the generic sentence for a day that does not exist, once the day is in range", () => {
		const signed = row({ executed_at: "2025-01-01T12:00:00.000Z" });

		for (const day of [
			"2025-02-30",
			"2025-02-29",
			"2025-04-31",
			"2025-13-01",
			"2025-05-00",
			"2025-05-32",
		])
			expect(end(day, signed), day).toEqual(NO_SUCH_DAY);
		expect(end("2025-00-10", signed)).toEqual(OUTSIDE);
		expect(
			end("2024-02-29", row({ executed_at: "2024-01-01T12:00:00.000Z" })),
		).toHaveProperty("wrote");
	});

	it("is refused with the generic sentence when the stored signing time is not a time, before the range", () => {
		expect(end("1999-01-01", row({ executed_at: "not a time" }))).toEqual(
			NO_SUCH_DAY,
		);
	});

	it("is refused with the MSA's sentence while an open offer reuses an MSA", () => {
		const msa = row({ kind: "msa" });

		expect(end(TODAY, msa, [OPEN])).toEqual(IN_USE);
		expect(end(TODAY, msa, [{ ...OPEN, status: "draft" }])).toEqual(IN_USE);
		expect(end(TODAY, msa, [{ ...OPEN, request_status: "reviewed" }])).toEqual(
			IN_USE,
		);

		for (const closed of [
			{ ...OPEN, status: "superseded" },
			{ ...OPEN, status: "withdrawn" },
			{ ...OPEN, request_status: "resolved" },
			{ ...OPEN, request_status: "withdrawn" },
			{ ...OPEN, project_offer_id: "o1" },
		])
			expect(end(TODAY, msa, [closed]), JSON.stringify(closed)).toHaveProperty(
				"wrote",
			);
	});

	it("answers the MSA's sentence for a day that does not exist on an MSA in use, as today's catch does", () => {
		const msa = row({ kind: "msa", executed_at: "2025-01-01T12:00:00.000Z" });

		expect(end("2025-02-30", msa, [OPEN])).toEqual(IN_USE);
		expect(end("2025-02-30", msa)).toEqual(NO_SUCH_DAY);
		expect(
			end(TODAY, row({ kind: "msa", executed_at: "not a time" }), [OPEN]),
		).toEqual(IN_USE);
	});

	it("looks at the use only where today's code reads it: for an MSA, or whatever the kind once today's code reaches its catch", () => {
		const early = row({ executed_at: "2025-01-01T12:00:00.000Z" });
		const closed = row({ archive_closed_at: "2026-11-20T00:00:00.000Z" });

		expect(end(TODAY, row(), [OPEN])).toHaveProperty("wrote");
		expect(end("2025-02-30", early, [OPEN])).toEqual(IN_USE);
		expect(end(TODAY, closed, [OPEN])).toEqual(IN_USE);
		expect(front(TODAY, row({ kind: "msa" }))).toEqual({
			wrote: { readsMsaUse: true },
		});
		expect(front(TODAY, row())).toEqual({ wrote: { readsMsaUse: false } });
		expect(front("2025-02-30", early)).toEqual({
			wrote: { readsMsaUse: true },
		});
		expect(front(TODAY, row({ executed_at: "not a time" }))).toEqual({
			wrote: { readsMsaUse: true },
		});
		expect(front(TODAY, closed)).toEqual({ wrote: { readsMsaUse: true } });
	});

	it("is refused with the generic sentence when the archive is closed, last", () => {
		const closed = { archive_closed_at: "2026-11-20T00:00:00.000Z" };

		expect(end(TODAY, row(closed))).toEqual(CLOSED);
		expect(end(TODAY, row({ ...closed, status: "abandoned" }))).toEqual(CLOSED);
		expect(end(TODAY, row({ ...closed, status: "review" }))).toEqual(
			NOT_ENDABLE,
		);
		expect(end("2026-10-31", row(closed))).toEqual(OUTSIDE);
		expect(end(TODAY, row({ ...closed, kind: "msa" }), [OPEN])).toEqual(IN_USE);
		expect(
			end(
				"2025-02-30",
				row({ ...closed, executed_at: "2025-01-01T12:00:00.000Z" }),
			),
		).toEqual(NO_SUCH_DAY);
	});

	it("writes the end, ten years of retention from noon UTC, and an MSA's termination", () => {
		expect(end(TODAY)).toEqual({
			wrote: {
				agreementId: ID,
				endedOn: TODAY,
				retainUntil: "2036-11-23T12:00:00.000Z",
				terminatedOn: null,
				guardsMsaUse: false,
			},
		});
		expect(end("2026-11-05", row({ kind: "msa" }))).toEqual({
			wrote: {
				agreementId: ID,
				endedOn: "2026-11-05",
				retainUntil: "2036-11-05T12:00:00.000Z",
				terminatedOn: "2026-11-05",
				guardsMsaUse: true,
			},
		});
		expect(
			end(
				"2024-02-29",
				row({ kind: "msa", executed_at: "2024-01-01T12:00:00.000Z" }),
			),
		).toMatchObject({ wrote: { retainUntil: "2034-03-01T12:00:00.000Z" } });
	});

	it("explains a refused batch by an open offer that reuses the agreement now, and otherwise leaves it", () => {
		expect(
			said(afterRefusedEnd.decide(null, { reusingOffers: [OPEN] })),
		).toEqual(IN_USE);
		expect(
			said(
				afterRefusedEnd.decide(null, {
					reusingOffers: [{ ...OPEN, status: "superseded" }],
				}),
			),
		).toEqual({ wrote: {} });
	});
});

describe("a hold and a copy record", () => {
	const hold = (agreement: RecordAgreementRow | null, held = true) =>
		said(
			holdAgreement.decide(
				{
					agreementId: ID,
					held,
					actor: "Owner@Example.TEST",
					at: "2026-11-23T15:00:00.000Z",
				},
				{ agreement },
			),
		);

	const copy = (agreement: RecordAgreementRow | null) =>
		said(
			recordCopy.decide(
				{
					agreementId: ID,
					role: "client",
					method: "Sent by post",
					actor: "Owner@Example.TEST",
					at: "2026-11-23T15:00:00.000Z",
				},
				{ agreement },
			),
		);

	it("holds any agreement, whatever its status, and takes the hold off", () => {
		for (const status of ["review", "client_signed", "executed", "abandoned"])
			expect(hold(row({ status }))).toEqual({
				wrote: {
					agreementId: ID,
					legalHold: 1,
					actor: "Owner@Example.TEST",
					at: "2026-11-23T15:00:00.000Z",
					event: "hold-changed",
				},
			});
		expect(hold(row(), false)).toMatchObject({ wrote: { legalHold: 0 } });
	});

	it("refuses a hold with no agreement, then one whose archive is closed", () => {
		expect(hold(null)).toEqual(NOT_FOUND);
		expect(
			hold(row({ archive_closed_at: "2026-11-20T00:00:00.000Z" })),
		).toEqual(CLOSED);
	});

	it("records a copy of any agreement, its archive closed or not, and refuses only a missing one", () => {
		expect(
			copy(row({ archive_closed_at: "2026-11-20T00:00:00.000Z" })),
		).toEqual({
			wrote: {
				agreementId: ID,
				role: "client",
				method: "Sent by post",
				actor: "Owner@Example.TEST",
				at: "2026-11-23T15:00:00.000Z",
				event: "copy-delivered",
			},
		});
		expect(copy(row({ status: "review" }))).toHaveProperty("wrote");
		expect(copy(null)).toEqual(NOT_FOUND);
	});
});

// ---- today's route and the guards, on sqlite ----

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

/** The cleanup lock, as the migration creates it. */
const CLEANUP_LOCK = migration
	.split("\n")
	.find((line) =>
		line.startsWith("CREATE TRIGGER software_agreement_cleanup_lock "),
	);

const database = new DatabaseSync(":memory:");
const real = sqliteD1(database);

/** The statements today's route prepared, in order. */
let prepared: string[] = [];

const db = double<D1Database>({
	prepare: (query: string) => {
		prepared.push(query);

		return real.prepare(query);
	},
	batch: real.batch,
});

beforeEach(() => {
	prepared = [];
	database.exec(
		`DROP TABLE IF EXISTS owner_requests; DROP TABLE IF EXISTS software_offers; DROP TABLE IF EXISTS software_projects;
		DROP TABLE IF EXISTS software_agreements; DROP TABLE IF EXISTS software_agreement_deliveries;
		DROP TABLE IF EXISTS software_agreement_events;
		CREATE TABLE owner_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL);
		CREATE TABLE software_offers (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL, reused_msa_id TEXT);
		CREATE TABLE software_projects (request_id TEXT PRIMARY KEY, offer_id TEXT NOT NULL);
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, kind TEXT NOT NULL,
			status TEXT NOT NULL, effective_on TEXT NOT NULL, client_signed_at TEXT, executed_at TEXT, ended_at TEXT,
			retain_until TEXT, legal_hold INTEGER NOT NULL DEFAULT 0, terminated_at TEXT, archive_closed_at TEXT);
		CREATE TABLE software_agreement_deliveries (agreement_id TEXT NOT NULL, recipient_role TEXT NOT NULL,
			alternate_delivered_at TEXT, alternate_method TEXT, PRIMARY KEY(agreement_id, recipient_role));
		CREATE TABLE software_agreement_events (id TEXT PRIMARY KEY, agreement_id TEXT, offer_id TEXT, action TEXT NOT NULL,
			actor TEXT NOT NULL, occurred_at TEXT NOT NULL, reason TEXT);
		${CLEANUP_LOCK}`,
	);
});

afterEach(() => {
	vi.useRealTimers();
});

/** Stores the agreement for request r1 (when given) and an offer of another request that reuses it as its MSA. */
function store(
	agreement: RecordAgreementRow | null,
	reusing: ReusingOfferRow[] = [],
) {
	database.exec(
		"DELETE FROM owner_requests; DELETE FROM software_offers; DELETE FROM software_projects; DELETE FROM software_agreements; DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_events",
	);
	database.prepare("INSERT INTO owner_requests VALUES ('r1','new')").run();

	if (agreement)
		database
			.prepare(
				"INSERT INTO software_agreements(id,request_id,kind,status,effective_on,client_signed_at,executed_at,terminated_at,archive_closed_at) VALUES (?,?,?,?,?,?,?,?,?)",
			)
			.run(
				ID,
				"r1",
				agreement.kind,
				agreement.status,
				agreement.effective_on,
				agreement.client_signed_at,
				agreement.executed_at,
				"2020-01-01",
				agreement.archive_closed_at,
			);
	database
		.prepare(
			"INSERT INTO software_agreement_deliveries(agreement_id,recipient_role) VALUES (?,'client')",
		)
		.run(ID);

	reusing.forEach((offer, index) => {
		database
			.prepare("INSERT INTO owner_requests VALUES (?,?)")
			.run(`q${index}`, offer.request_status);
		database
			.prepare("INSERT INTO software_offers VALUES (?,?,?,?)")
			.run(`p${index}`, `q${index}`, offer.status, ID);

		if (offer.project_offer_id !== null)
			database
				.prepare("INSERT INTO software_projects VALUES (?,?)")
				.run(`q${index}`, `p${index}`);
	});
}

/** The agreement, read as the store will read it for the rules: by its id and the request's id. */
const readAgreement = () =>
	real
		.prepare(
			"SELECT status,kind,effective_on,client_signed_at,executed_at,archive_closed_at FROM software_agreements WHERE id=? AND request_id=?",
		)
		.bind(ID, "r1")
		.first<RecordAgreementRow>();

/** The offers that reuse the agreement as their MSA, read as the store will read them for the rules. */
const readReusing = async () =>
	(
		await real
			.prepare(
				"SELECT o.status,r.status AS request_status,p.offer_id AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id LEFT JOIN software_projects p ON p.offer_id=o.id WHERE o.reused_msa_id=?",
			)
			.bind(ID)
			.all<ReusingOfferRow>()
	).results;

/** Calls today's route as the signed-in owner at `now`, with the action's body. */
async function route(now: string, body: { [field: string]: string | boolean }) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(now));
	prepared = [];

	const response = await POST(
		partial<APIContext>({
			params: { id: "r1" },
			request: new Request(
				"https://example.test/api/owner/requests/r1/agreement",
				{
					method: "POST",
					headers: {
						origin: "https://example.test",
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				},
			),
			locals: {
				owner: { email: "Owner@Example.TEST" },
				runtime: testRuntime({ MUSIC_DB: db }),
			},
		}),
	);

	vi.useRealTimers();

	return { status: response.status, body: await response.json() };
}

/** The answer today's route gives for a rule's refusal or write, as the converted route will map it. */
const answerFor = (
	rule: { refused: string; say: string } | { wrote: unknown },
) => {
	if ("wrote" in rule) return { status: 200, body: { ok: true } };

	if (rule.refused === "AgreementNotFound")
		return { status: 404, body: { ok: false } };

	if (rule.refused === "NotEndable")
		return { status: 409, body: { ok: false } };

	return { status: 409, body: { ok: false, error: rule.say } };
};

/** Today's plain read of the MSA's use (not the guard that wraps it). */
const MSA_USE =
	"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.reused_msa_id=? AND o.status IN ('draft','sent') AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)";

describe("today's route and the rules, over the same rows", () => {
	const NOW = "2026-11-23T15:00:00.000Z";

	it("end: the same answer, the same row written, and the MSA's use read where endFront says", async () => {
		const times: Partial<RecordAgreementRow>[] = [
			{},
			{ executed_at: null, client_signed_at: "2026-11-05T12:00:00.000Z" },
			{ executed_at: null, client_signed_at: null, effective_on: "2026-11-10" },
			{ executed_at: "not a time" },
			{ executed_at: "2026-11-13T04:59:59.000Z" },
			{ executed_at: "2025-01-01T12:00:00.000Z" },
		];

		const days = [
			"2026-11-01",
			"2026-10-31",
			"2026-11-12",
			TODAY,
			"2026-11-24",
			"2026-02-30",
			"2026-11-31",
			"2026-13-01",
		];

		let runs = 0;

		for (const kind of ["sow", "msa"])
			for (const status of ["client_signed", "executed", "abandoned"])
				for (const time of times)
					for (const archive of [null, "2026-11-20T00:00:00.000Z"])
						for (const reusing of [[], [OPEN]])
							for (const day of days) {
								const stored = row({
									kind,
									status,
									archive_closed_at: archive,
									...time,
								});

								store(stored, reusing);

								const agreement = await readAgreement();
								const reusingOffers = await readReusing();

								const request: EndRequest = {
									agreementId: ID,
									endedOn: day,
									today: newYorkDay(new Date(NOW)),
								};

								const facts: EndFacts = { agreement, reusingOffers };
								const rule = said(endAgreement.decide(request, facts));
								const first = said(endFront.decide(request, { agreement }));

								const label = JSON.stringify({
									kind,
									status,
									time,
									archive,
									reusing,
									day,
								});

								const today = await route(NOW, {
									action: "end",
									agreement_id: ID,
									ended_on: day,
									confirmed: true,
								});

								expect(today, label).toEqual(answerFor(rule));
								runs += 1;

								const after = database
									.prepare(
										"SELECT ended_at,retain_until,terminated_at FROM software_agreements WHERE id=?",
									)
									.get(ID);

								if ("wrote" in rule)
									expect(after, label).toEqual({
										ended_at: rule.wrote.endedOn,
										retain_until: rule.wrote.retainUntil,
										terminated_at: rule.wrote.terminatedOn ?? "2020-01-01",
									});
								else
									expect(after, label).toEqual({
										ended_at: null,
										retain_until: null,
										terminated_at: "2020-01-01",
									});

								// Today the use is read (once or more) exactly where endFront says it is read.
								const readUse = prepared.includes(MSA_USE);

								expect(readUse, label).toBe(
									"wrote" in first && first.wrote.readsMsaUse,
								);
							}

		expect(runs).toBe(1152);
	});

	it("end: an agreement of another request is not found", async () => {
		store(null);

		const rule = said(
			endAgreement.decide(
				{ agreementId: ID, endedOn: TODAY, today: TODAY },
				{ agreement: await readAgreement(), reusingOffers: [] },
			),
		);

		expect(rule).toEqual(NOT_FOUND);
		expect(
			await route(NOW, {
				action: "end",
				agreement_id: ID,
				ended_on: TODAY,
				confirmed: true,
			}),
		).toEqual(answerFor(rule));
	});

	it("hold and copy record: the same answer and the same rows, for every status and archive", async () => {
		for (const status of ["review", "client_signed", "executed", "abandoned"])
			for (const archive of [null, "2026-11-20T00:00:00.000Z"])
				for (const held of [true, false]) {
					const label = `${status} ${archive} ${held}`;
					store(row({ status, archive_closed_at: archive }));

					const holding = said(
						holdAgreement.decide(
							{ agreementId: ID, held, actor: "Owner@Example.TEST", at: NOW },
							{ agreement: await readAgreement() },
						),
					);

					expect(
						await route(NOW, { action: "hold", agreement_id: ID, held }),
						label,
					).toEqual(answerFor(holding));
					expect(
						database
							.prepare("SELECT legal_hold FROM software_agreements WHERE id=?")
							.get(ID),
						label,
					).toEqual({ legal_hold: "wrote" in holding ? (held ? 1 : 0) : 0 });
					expect(
						database
							.prepare(
								"SELECT agreement_id,offer_id,action,actor,occurred_at,reason FROM software_agreement_events",
							)
							.all(),
						label,
					).toEqual(
						"wrote" in holding
							? [
									{
										agreement_id: ID,
										offer_id: null,
										action: "hold-changed",
										actor: "Owner@Example.TEST",
										occurred_at: NOW,
										reason: null,
									},
								]
							: [],
					);

					store(row({ status, archive_closed_at: archive }));

					const copying = said(
						recordCopy.decide(
							{
								agreementId: ID,
								role: "client",
								method: "Sent by post",
								actor: "Owner@Example.TEST",
								at: NOW,
							},
							{ agreement: await readAgreement() },
						),
					);

					expect(
						await route(NOW, {
							action: "record-alternate-copy",
							agreement_id: ID,
							role: "client",
							method: "Sent by post",
							confirmed: true,
						}),
						label,
					).toEqual(answerFor(copying));
					expect(
						database
							.prepare(
								"SELECT alternate_delivered_at,alternate_method FROM software_agreement_deliveries",
							)
							.all(),
						label,
					).toEqual([
						{ alternate_delivered_at: NOW, alternate_method: "Sent by post" },
					]);
					expect(
						database
							.prepare(
								"SELECT agreement_id,action,actor,occurred_at FROM software_agreement_events WHERE action='copy-delivered'",
							)
							.all(),
						label,
					).toEqual(
						"wrote" in copying
							? [
									{
										agreement_id: ID,
										action: "copy-delivered",
										actor: "Owner@Example.TEST",
										occurred_at: NOW,
									},
								]
							: [],
					);
				}
	});

	it("hold and copy record: an agreement of another request is not found", async () => {
		store(null);

		const agreement = await readAgreement();

		expect(
			await route(NOW, { action: "hold", agreement_id: ID, held: true }),
		).toEqual(
			answerFor(
				said(
					holdAgreement.decide(
						{ agreementId: ID, held: true, actor: "o", at: NOW },
						{ agreement },
					),
				),
			),
		);
		expect(
			await route(NOW, {
				action: "record-alternate-copy",
				agreement_id: ID,
				role: "client",
				method: "Sent by post",
				confirmed: true,
			}),
		).toEqual(
			answerFor(
				said(
					recordCopy.decide(
						{
							agreementId: ID,
							role: "client",
							method: "Sent by post",
							actor: "o",
							at: NOW,
						},
						{ agreement },
					),
				),
			),
		);
	});
});

describe("the guards, on sqlite", () => {
	/** Whether a guard refuses: it raises, and its batch rolls back. */
	const refuses = (guard: D1PreparedStatement) =>
		guard.first().then(
			() => false,
			() => true,
		);

	const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"];
	const REQUEST_STATUSES = ["new", "reviewed", "resolved", "withdrawn"];

	/** Every offer that can reuse the MSA: each status, its request's status, and a project or none. */
	const everyOffer: ReusingOfferRow[] = OFFER_STATUSES.flatMap((status) =>
		REQUEST_STATUSES.flatMap((request_status) =>
			[null, "p"].map((project_offer_id) => ({
				status,
				request_status,
				project_offer_id,
			})),
		),
	);

	it("A13 refuses exactly when the rules find an open offer reusing the MSA, alone and in pairs", async () => {
		const guard = () =>
			refuses(softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${MSA_USE})`, [ID]));

		let inUse = 0;

		for (const first of everyOffer)
			for (const second of [null, ...everyOffer]) {
				store(
					row({ kind: "msa" }),
					second === null ? [first] : [first, second],
				);

				const reusingOffers = await readReusing();
				const after = said(afterRefusedEnd.decide(null, { reusingOffers }));

				const ending = said(
					endAgreement.decide(
						{ agreementId: ID, endedOn: TODAY, today: TODAY },
						{ agreement: row({ kind: "msa" }), reusingOffers },
					),
				);

				const refused = await guard();

				if (refused) inUse += 1;
				expect("refused" in after, JSON.stringify([first, second])).toBe(
					refused,
				);
				expect("refused" in ending && ending.refused === "MsaInUse").toBe(
					refused,
				);
			}

		expect(inUse).toBeGreaterThan(0);
	});

	it("A13 does not look at an offer that reuses another MSA", async () => {
		store(row({ kind: "msa" }));
		database.exec(
			"INSERT INTO owner_requests VALUES ('q9','new'); INSERT INTO software_offers VALUES ('p9','q9','sent','another')",
		);

		expect(await readReusing()).toEqual([]);
		expect(
			await refuses(
				softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${MSA_USE})`, [ID]),
			),
		).toBe(false);
	});

	it("A14 and the cleanup lock: the end's update changes the row exactly when the rule writes, and raises exactly at ArchiveClosed", async () => {
		/** The end's update, copied from the route (src/pages/api/owner/requests/[id]/agreement.ts), which does not export it. */
		const UPDATE =
			"UPDATE software_agreements SET ended_at=?,retain_until=?,terminated_at=CASE WHEN kind='msa' THEN ? ELSE terminated_at END WHERE id=? AND status IN ('executed','abandoned')";

		for (const status of ["review", "client_signed", "executed", "abandoned"])
			for (const archive of [null, "2026-11-20T00:00:00.000Z"]) {
				store(row({ status, archive_closed_at: archive }));
				const rule = end(TODAY, await readAgreement());

				const outcome = await real
					.prepare(UPDATE)
					.bind(TODAY, "2036-11-23T12:00:00.000Z", TODAY, ID)
					.run()
					.then(
						(result) => (result.meta.changes === 1 ? "changed" : "no row"),
						(error: Error) => error.message,
					);

				expect(outcome, `${status} ${archive}`).toBe(
					"wrote" in rule
						? "changed"
						: rule.refused === "ArchiveClosed"
							? "Archive cleanup is reserved"
							: "no row",
				);
			}
	});
});
