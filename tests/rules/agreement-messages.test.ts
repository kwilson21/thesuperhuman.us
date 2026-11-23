import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { beforeEach, describe, expect, it } from "vitest";
import { currentSigningNotification } from "../../src/lib/agreement-artifacts";
import { closeObsoleteAgreementNotifications } from "../../src/lib/software-agreements";
import type { MailOutcome } from "../../src/server/agreement-services";
import {
	agreementMessage,
	MESSAGE_STATUSES,
	type MessageStatus,
	messageAllows,
} from "../../src/server/machines/agreement-message";
import { next } from "../../src/server/machines/next";
import {
	type CopyClaimFacts,
	copyClaimable,
	MESSAGE_STALE_MS,
	type MessageAgreement,
	messageOutcome,
	messagesToReset,
	type NoticeClaimFacts,
	noticeClaimable,
	type ResetFacts,
	type StoredCopy,
	type StoredNotice,
} from "../../src/server/rules/agreement-messages";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The email rules as stories (claiming a copy or a notice, settling a send, and the owner's reset), and the statements
// that re-check them at write time held to them on sqlite: the copy's claim and outcome (A18), the notice's claim and
// outcome (A19), the two reset statements (A20) and the obsolete notices (A21). The SQL of A18, A19's outcome and A20 is
// copied below from `deliverAgreementCopies` and `deliverAgreementNotifications` (src/lib/agreement-artifacts.ts) and from
// the retry-copy action (src/pages/api/owner/requests/[id]/agreement.ts); A19's claim and the notices' reset join it with
// today's exported `currentSigningNotification`; A21 runs today's exported `closeObsoleteAgreementNotifications`. The
// three message tables and the events are the migration's own CREATE statements.

type Said = { nothing: true } | { wrote: unknown };

const said = <W>(decided: Effect.Effect<Option.Option<W>, never>): Said =>
	Effect.runSync(
		Effect.map(decided, (value) =>
			Option.isSome(value) ? { wrote: value.value } : { nothing: true },
		),
	);

const NOW = new Date("2026-11-23T15:00:00.000Z");
const AT = "2026-11-23T15:00:00.000Z";

/** An attempted_at this many milliseconds before NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const agreement = (over: Partial<MessageAgreement> = {}): MessageAgreement => ({
	status: "executed",
	archive_closed_at: null,
	project_request_id: null,
	...over,
});

const copy = (over: Partial<StoredCopy> = {}): StoredCopy => ({
	recipient_role: "client",
	status: "pending",
	attempted_at: null,
	...over,
});

const notice = (over: Partial<StoredNotice> = {}): StoredNotice => ({
	kind: "signature-receipt",
	status: "pending",
	attempted_at: null,
	...over,
});

const sending = {
	wrote: { status: "sending", attempt_id: "mine", attempted_at: AT },
};

const claimCopy = (over: Partial<CopyClaimFacts> = {}) =>
	said(
		copyClaimable.decide(
			{ attempt: "mine", at: NOW },
			{
				signature: { receipt_id: "receipt" },
				copy: copy(),
				agreement: agreement(),
				...over,
			},
		),
	);

describe("claiming a party's copy", () => {
	it("claims a pending copy of an executed agreement whose archive is open, once the party signed", () => {
		expect(claimCopy()).toEqual(sending);
		expect(next(agreementMessage, "pending", "CLAIM")).toBe("sending");
	});

	it("skips a party with no signature", () => {
		expect(claimCopy({ signature: null })).toEqual({ nothing: true });
	});

	it("skips a copy that is not pending, or missing", () => {
		for (const status of ["sending", "sent", "failed"] as const)
			expect(claimCopy({ copy: copy({ status }) })).toEqual({ nothing: true });

		expect(claimCopy({ copy: null })).toEqual({ nothing: true });
	});

	it("skips a copy of an agreement that is not executed, closed, or missing", () => {
		for (const status of ["review", "client_signed", "abandoned"])
			expect(claimCopy({ agreement: agreement({ status }) })).toEqual({
				nothing: true,
			});

		expect(
			claimCopy({ agreement: agreement({ archive_closed_at: AT }) }),
		).toEqual({ nothing: true });
		expect(claimCopy({ agreement: null })).toEqual({ nothing: true });
	});

	it("claims whatever the agreement's request's project, which a copy does not look at", () => {
		expect(
			claimCopy({ agreement: agreement({ project_request_id: "r1" }) }),
		).toEqual(sending);
	});
});

const current = agreement({ status: "client_signed" });

const claimNotice = (over: Partial<NoticeClaimFacts> = {}) =>
	said(
		noticeClaimable.decide(
			{ attempt: "mine", at: NOW },
			{ notice: notice(), agreement: current, ...over },
		),
	);

describe("claiming a signing notice", () => {
	it("claims a pending notice while its agreement awaits the countersignature, open and with no project", () => {
		expect(claimNotice()).toEqual(sending);
		expect(
			claimNotice({ notice: notice({ kind: "countersign-notice" }) }),
		).toEqual(sending);
	});

	it("skips a notice that is not pending, or missing", () => {
		for (const status of ["sending", "sent", "failed"] as const)
			expect(claimNotice({ notice: notice({ status }) })).toEqual({
				nothing: true,
			});

		expect(claimNotice({ notice: null })).toEqual({ nothing: true });
	});

	it("skips a notice that is no longer current", () => {
		for (const status of ["review", "executed", "abandoned"])
			expect(claimNotice({ agreement: agreement({ status }) })).toEqual({
				nothing: true,
			});

		expect(
			claimNotice({
				agreement: { ...current, archive_closed_at: AT },
			}),
		).toEqual({ nothing: true });
		expect(
			claimNotice({
				agreement: { ...current, project_request_id: "r1" },
			}),
		).toEqual({ nothing: true });
		expect(claimNotice({ agreement: null })).toEqual({ nothing: true });
	});
});

const settle = (mail: MailOutcome) =>
	said(messageOutcome.decide({ mail, at: NOW }, null));

describe("settling a send", () => {
	it("is sent, with the time, when the provider accepted", () => {
		expect(settle("sent")).toEqual({
			wrote: { status: "sent", sent_at: AT, action: "copy-delivered" },
		});
	});

	it("is failed, with no time, when the provider refused", () => {
		expect(settle("refused")).toEqual({
			wrote: { status: "failed", sent_at: null, action: "delivery-failed" },
		});
	});

	it("writes nothing when the provider's answer is uncertain", () => {
		expect(settle("uncertain")).toEqual({ nothing: true });
	});

	it("ends in the states the machine's SEND and FAIL lead to", () => {
		expect(next(agreementMessage, "sending", "SEND")).toBe("sent");
		expect(next(agreementMessage, "sending", "FAIL")).toBe("failed");
	});
});

const STALE_BEFORE = "2026-11-23T14:59:00.000Z";

const reset = (facts: ResetFacts, confirmedNotSent = true) =>
	Effect.runSync(messagesToReset.decide({ confirmedNotSent, now: NOW }, facts));

describe("the owner's reset", () => {
	it("moves failed copies back to pending, confirmed or not", () => {
		const copies = [
			copy({ status: "failed" }),
			copy({ recipient_role: "contractor", status: "sent" }),
		];

		expect(reset({ copies }, false)).toEqual({
			status: "pending",
			keys: ["client"],
			confirmed: false,
			staleBefore: STALE_BEFORE,
		});
		expect(reset({ copies }).keys).toEqual(["client"]);
	});

	it("moves a copy stuck sending only once the owner confirmed and the attempt is a minute old", () => {
		const at = (attempted_at: string | null) => ({
			copies: [copy({ status: "sending", attempted_at })],
		});

		expect(reset(at(ago(MESSAGE_STALE_MS))).keys).toEqual(["client"]);
		expect(reset(at(ago(MESSAGE_STALE_MS + 1))).keys).toEqual(["client"]);
		expect(reset(at(ago(MESSAGE_STALE_MS - 1))).keys).toEqual([]);
		expect(reset(at(null)).keys).toEqual([]);
		expect(reset(at(ago(MESSAGE_STALE_MS)), false).keys).toEqual([]);
	});

	it("never moves a pending or sent copy", () => {
		expect(
			reset({
				copies: [
					copy({ status: "pending", attempted_at: ago(3_600_000) }),
					copy({
						recipient_role: "contractor",
						status: "sent",
						attempted_at: ago(3_600_000),
					}),
				],
			}).keys,
		).toEqual([]);
	});

	it("moves notices only while they are current", () => {
		const notices = [
			notice({ status: "failed" }),
			notice({
				kind: "countersign-notice",
				status: "sending",
				attempted_at: ago(MESSAGE_STALE_MS),
			}),
		];

		expect(reset({ notices, agreement: current }).keys).toEqual([
			"signature-receipt",
			"countersign-notice",
		]);
		expect(reset({ notices, agreement: current }, false).keys).toEqual([
			"signature-receipt",
		]);

		for (const stale of [
			agreement({ status: "executed" }),
			{ ...current, archive_closed_at: AT },
			{ ...current, project_request_id: "r1" },
			null,
		])
			expect(reset({ notices, agreement: stale }).keys).toEqual([]);
	});

	it("moves nothing when there is nothing to move, and still answers what the statement binds", () => {
		expect(reset({ copies: [] })).toEqual({
			status: "pending",
			keys: [],
			confirmed: true,
			staleBefore: STALE_BEFORE,
		});
	});
});

// ---- the statements on sqlite ----

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

/** The migration's own CREATE TABLE statement for a table. */
const createOf = (table: string) => {
	const line = migration
		.split("\n")
		.find((candidate) => candidate.startsWith(`CREATE TABLE ${table} (`));

	if (!line) throw new Error(`No CREATE TABLE ${table} in the migration.`);

	return line;
};

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS software_agreement_events; DROP TABLE IF EXISTS software_agreement_deliveries;
		DROP TABLE IF EXISTS software_agreement_notifications; DROP TABLE IF EXISTS software_projects;
		DROP TABLE IF EXISTS software_agreements;
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('review','client_signed','executed','abandoned')), archive_closed_at TEXT);
		CREATE TABLE software_projects (request_id TEXT PRIMARY KEY);
		${createOf("software_agreement_deliveries")}
		${createOf("software_agreement_notifications")}
		${createOf("software_agreement_events")}`,
	);
});

const ID = "a1";
const REQUEST = "r1";

function clear() {
	database.exec(
		"DELETE FROM software_agreement_events; DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_notifications; DELETE FROM software_projects; DELETE FROM software_agreements",
	);
}

/** Stores the agreement as the facts say (its request's project included). */
function storeAgreement(facts: MessageAgreement) {
	database
		.prepare("INSERT INTO software_agreements VALUES (?,?,?,?)")
		.run(ID, REQUEST, facts.status, facts.archive_closed_at);

	if (facts.project_request_id !== null)
		database.prepare("INSERT INTO software_projects VALUES (?)").run(REQUEST);
}

function storeCopy(row: StoredCopy, attempt: string | null = "old") {
	database
		.prepare(
			"INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email,status,attempt_id,attempted_at) VALUES (?,?,?,?,?,?)",
		)
		.run(
			ID,
			row.recipient_role,
			"copy@example.test",
			row.status,
			attempt,
			row.attempted_at,
		);
}

function storeNotice(row: StoredNotice, attempt: string | null = "old") {
	database
		.prepare(
			"INSERT INTO software_agreement_notifications(agreement_id,kind,email,status,attempt_id,attempted_at) VALUES (?,?,?,?,?,?)",
		)
		.run(
			ID,
			row.kind,
			"notice@example.test",
			row.status,
			attempt,
			row.attempted_at,
		);
}

/** The agreement, as the store reads it for a copy or a notice: its status, archive, and its request's project. */
const readAgreement = () =>
	db
		.prepare(
			"SELECT a.status,a.archive_closed_at,p.request_id AS project_request_id FROM software_agreements a LEFT JOIN software_projects p ON p.request_id=a.request_id WHERE a.id=?",
		)
		.bind(ID)
		.first<MessageAgreement>();

const readCopies = () =>
	db
		.prepare(
			"SELECT recipient_role,status,attempted_at FROM software_agreement_deliveries WHERE agreement_id=? ORDER BY recipient_role",
		)
		.bind(ID)
		.all<StoredCopy>()
		.then((result) => result.results);

const readNotices = () =>
	db
		.prepare(
			"SELECT kind,status,attempted_at FROM software_agreement_notifications WHERE agreement_id=? ORDER BY kind DESC",
		)
		.bind(ID)
		.all<StoredNotice>()
		.then((result) => result.results);

const AGREEMENTS: MessageAgreement[] = [
	"review",
	"client_signed",
	"executed",
	"abandoned",
].flatMap((status) =>
	[null, AT].flatMap((archive_closed_at) =>
		[null, REQUEST].map((project_request_id) => ({
			status,
			archive_closed_at,
			project_request_id,
		})),
	),
);

const TIMES = [
	null,
	ago(MESSAGE_STALE_MS + 1),
	ago(MESSAGE_STALE_MS),
	ago(MESSAGE_STALE_MS - 1),
];

/** Every status and attempt time a copy or notice can hold. */
const STATES = MESSAGE_STATUSES.flatMap((status) =>
	TIMES.map((attempted_at) => ({ status, attempted_at })),
);

// Copied from deliverAgreementCopies (src/lib/agreement-artifacts.ts): the claim and the outcome by attempt (A18).
const CLAIM_COPY =
	"UPDATE software_agreement_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND recipient_role=? AND status='pending' AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_deliveries.agreement_id AND a.archive_closed_at IS NULL AND a.status='executed') RETURNING email";

const COPY_OUTCOME =
	"UPDATE software_agreement_deliveries SET status=?,sent_at=? WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status='sending'";

const COPY_EVENT =
	"INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_deliveries WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status=?)";

// From deliverAgreementNotifications: the claim (with today's exported condition) and the outcome by attempt (A19).
const CLAIM_NOTICE = `UPDATE software_agreement_notifications SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND kind=? AND status='pending' AND ${currentSigningNotification} RETURNING email`;

const NOTICE_OUTCOME =
	"UPDATE software_agreement_notifications SET status=?,sent_at=? WHERE agreement_id=? AND kind=? AND attempt_id=? AND status='sending'";

// From the retry-copy action (src/pages/api/owner/requests/[id]/agreement.ts): the two resets (A20).
const RESET_COPIES =
	"UPDATE software_agreement_deliveries SET status='pending' WHERE agreement_id=? AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))";

const RESET_NOTICES = `UPDATE software_agreement_notifications SET status='pending' WHERE agreement_id=? AND ${currentSigningNotification} AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))`;

/** The cutoff the retry-copy action binds, as it works it out from the clock. */
const routeCutoff = (now: Date) =>
	new Date(now.getTime() - 60000).toISOString();

describe("a copy's claim (A18) and its rule", () => {
	it("agree on every copy and agreement, once the party signed", async () => {
		let claims = 0;

		for (const facts of AGREEMENTS)
			for (const state of [...STATES, null]) {
				clear();
				storeAgreement(facts);

				if (state) storeCopy(copy(state));

				const read = {
					signature: { receipt_id: "receipt" },
					copy: (await readCopies())[0] ?? null,
					agreement: await readAgreement(),
				};

				expect(read.agreement).toEqual(facts);

				const decided = said(
					copyClaimable.decide({ attempt: "mine", at: NOW }, read),
				);

				const returned = await db
					.prepare(CLAIM_COPY)
					.bind("mine", AT, ID, "client")
					.first<{ email: string }>();

				expect(returned !== null, JSON.stringify({ facts, state })).toBe(
					"wrote" in decided,
				);

				if ("wrote" in decided) {
					claims += 1;
					expect(returned?.email).toBe("copy@example.test");
					expect(
						database
							.prepare(
								"SELECT status,attempt_id,attempted_at FROM software_agreement_deliveries WHERE agreement_id=?",
							)
							.get(ID),
					).toEqual(decided.wrote);
				}
			}

		// A pending copy (four attempt times) of an executed agreement with its archive open, with or without a project.
		expect(claims).toBe(8);
	});
});

describe("a notice's claim (A19) and its rule", () => {
	it("agree on every notice and agreement", async () => {
		let claims = 0;

		for (const facts of AGREEMENTS)
			for (const state of [...STATES, null]) {
				clear();
				storeAgreement(facts);

				if (state) storeNotice(notice(state));

				const read = {
					notice: (await readNotices())[0] ?? null,
					agreement: await readAgreement(),
				};

				const decided = said(
					noticeClaimable.decide({ attempt: "mine", at: NOW }, read),
				);

				const returned = await db
					.prepare(CLAIM_NOTICE)
					.bind("mine", AT, ID, "signature-receipt")
					.first<{ email: string }>();

				expect(returned !== null, JSON.stringify({ facts, state })).toBe(
					"wrote" in decided,
				);

				if ("wrote" in decided) {
					claims += 1;
					expect(returned?.email).toBe("notice@example.test");
				}
			}

		// A pending notice (four attempt times) of a client_signed agreement, its archive open and no project.
		expect(claims).toBe(4);
	});
});

describe("a send's outcome by attempt (A18, A19)", () => {
	const MAIL: MailOutcome[] = ["sent", "refused", "uncertain"];

	it("is written only by the claiming attempt while sending, with what the rule settles", async () => {
		for (const status of MESSAGE_STATUSES)
			for (const attempt of ["mine", "other"])
				for (const mail of MAIL) {
					const decided = Effect.runSync(
						messageOutcome.decide({ mail, at: NOW }, null),
					);

					clear();
					storeAgreement(agreement());
					storeCopy(copy({ status }), attempt);
					storeNotice(notice({ status }), attempt);

					// Today's code writes nothing for an uncertain answer; otherwise it binds what the rule settles.
					if (Option.isSome(decided)) {
						const settled = decided.value;

						await db.batch([
							db
								.prepare(COPY_OUTCOME)
								.bind(settled.status, settled.sent_at, ID, "client", "mine"),
							db
								.prepare(COPY_EVENT)
								.bind(
									"event",
									ID,
									settled.action,
									"client",
									AT,
									ID,
									"client",
									"mine",
									settled.status,
								),
						]);
						await db
							.prepare(NOTICE_OUTCOME)
							.bind(
								settled.status,
								settled.sent_at,
								ID,
								"signature-receipt",
								"mine",
							)
							.run();
					}

					const moved =
						Option.isSome(decided) &&
						attempt === "mine" &&
						messageAllows(status, mail === "sent" ? "SEND" : "FAIL");

					const after = {
						status: moved ? (mail === "sent" ? "sent" : "failed") : status,
					};

					const label = JSON.stringify({ status, attempt, mail });

					expect((await readCopies())[0]?.status, label).toBe(after.status);
					expect((await readNotices())[0]?.status, label).toBe(after.status);

					const events = database
						.prepare("SELECT action FROM software_agreement_events")
						.all()
						.map((row) => row.action);

					// The event follows the copy that ends in the settled status under this attempt.
					expect(events, label).toEqual(
						Option.isSome(decided) &&
							attempt === "mine" &&
							(moved || status === (mail === "sent" ? "sent" : "failed"))
							? [mail === "sent" ? "copy-delivered" : "delivery-failed"]
							: [],
					);
				}
	});
});

describe("the owner's resets (A20) and their rule", () => {
	it("agree on every pair of copies, confirmed or not", async () => {
		let moved = 0;

		for (const client of STATES)
			for (const contractor of STATES)
				for (const confirmed of [true, false]) {
					clear();
					storeAgreement(agreement());
					storeCopy(copy(client));
					storeCopy(copy({ ...contractor, recipient_role: "contractor" }));

					const before = await readCopies();

					const decided = Effect.runSync(
						messagesToReset.decide(
							{ confirmedNotSent: confirmed, now: NOW },
							{ copies: before },
						),
					);

					expect(decided.staleBefore).toBe(routeCutoff(NOW));

					await db
						.prepare(RESET_COPIES)
						.bind(ID, confirmed ? 1 : 0, routeCutoff(NOW))
						.run();

					const after = await readCopies();

					for (const [index, row] of before.entries()) {
						const label = JSON.stringify({ row, confirmed });

						expect(after[index]?.status !== row.status, label).toBe(
							decided.keys.includes(row.recipient_role),
						);

						if (decided.keys.includes(row.recipient_role)) {
							moved += 1;
							expect(after[index]?.status).toBe("pending");
						}
					}
				}

		expect(moved).toBeGreaterThan(0);
	});

	it("agree on every notice and agreement, confirmed or not", async () => {
		let moved = 0;

		for (const facts of AGREEMENTS)
			for (const receipt of STATES)
				for (const confirmed of [true, false]) {
					clear();
					storeAgreement(facts);
					storeNotice(notice(receipt));
					storeNotice(
						notice({
							kind: "countersign-notice",
							status: "failed",
							attempted_at: null,
						}),
					);

					const before = await readNotices();

					const decided = Effect.runSync(
						messagesToReset.decide(
							{ confirmedNotSent: confirmed, now: NOW },
							{ notices: before, agreement: await readAgreement() },
						),
					);

					await db
						.prepare(RESET_NOTICES)
						.bind(ID, confirmed ? 1 : 0, routeCutoff(NOW))
						.run();

					const after = await readNotices();

					for (const [index, row] of before.entries()) {
						const label = JSON.stringify({ facts, row, confirmed });

						expect(after[index]?.status !== row.status, label).toBe(
							decided.keys.includes(row.kind),
						);

						if (decided.keys.includes(row.kind)) moved += 1;
					}
				}

		expect(moved).toBeGreaterThan(0);
	});
});

describe("the obsolete notices (A21)", () => {
	it("fail exactly the notices the machine's OBSOLETE leaves, with one event when there is one", async () => {
		for (const receipt of MESSAGE_STATUSES)
			for (const countersign of MESSAGE_STATUSES)
				for (const state of ["executed", "abandoned"] as const) {
					clear();
					storeAgreement(agreement({ status: "client_signed" }));
					storeNotice(notice({ status: receipt }));
					storeNotice(
						notice({ kind: "countersign-notice", status: countersign }),
					);

					await db.batch(
						closeObsoleteAgreementNotifications(
							db,
							ID,
							state,
							"owner@example.test",
							AT,
						),
					);

					const statuses: MessageStatus[] = [receipt, countersign];
					const after = (await readNotices()).map((row) => row.status);
					const label = JSON.stringify({ receipt, countersign, state });

					expect(after, label).toEqual(
						statuses.map((status) =>
							messageAllows(status, "OBSOLETE")
								? next(agreementMessage, status, "OBSOLETE")
								: status,
						),
					);
					expect(
						database
							.prepare("SELECT action,reason FROM software_agreement_events")
							.all()
							.map((row) => ({ ...row })),
						label,
					).toEqual(
						statuses.some((status) => messageAllows(status, "OBSOLETE"))
							? [
									{
										action: "delivery-failed",
										reason: `obsolete-signing-notice:${state}`,
									},
								]
							: [],
					);
				}
	});
});
