import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { recoverAgreementRendering } from "../../src/lib/agreement-artifacts";
import {
	agreementPacket,
	PACKET_STATUSES,
	packetAllows,
} from "../../src/server/machines/agreement-packet";
import { next } from "../../src/server/machines/next";
import {
	PACKET_STALE_MS,
	packetClaimable,
	packetRecoverable,
	type StoredPacket,
	type StoredPacketAttempt,
} from "../../src/server/rules/agreement-packet";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The packet rules as stories (the claim and the owner's recovery of a stale attempt), and the guards that re-check them
// at write time held to them on sqlite: the claim (A15) and the outcome written by attempt (A16), whose SQL is copied
// below from `prepareAgreementArtifact` (src/lib/agreement-artifacts.ts), and the recovery (A17), run through today's
// exported `recoverAgreementRendering` itself. The packet table is the migration's own CREATE statement.

type Said =
	| { refused: string; say: string }
	| { nothing: true }
	| { wrote: unknown };

const said = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<Option.Option<W>, E>,
): Said =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (value) =>
				Option.isSome(value) ? { wrote: value.value } : { nothing: true },
		}),
	);

const NOW = new Date("2026-11-23T15:00:00.000Z");
const AT = "2026-11-23T15:00:00.000Z";

/** An attempted_at this many milliseconds before NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const packet = (over: Partial<StoredPacket> = {}): StoredPacket => ({
	status: "pending",
	attempt_id: null,
	attempted_at: null,
	archive_closed_at: null,
	...over,
});

const claim = (facts: StoredPacket | null) =>
	said(packetClaimable.decide({ attempt: "mine", at: NOW }, facts));

const claimed = {
	wrote: {
		status: "rendering",
		attempt_id: "mine",
		attempted_at: AT,
		error_code: null,
	},
};

describe("claiming a packet", () => {
	it("claims a pending packet, and a failed one, while the archive is open", () => {
		expect(claim(packet())).toEqual(claimed);
		expect(
			claim(
				packet({
					status: "failed",
					attempt_id: "old",
					attempted_at: ago(5_000),
				}),
			),
		).toEqual(claimed);
	});

	it("moves it to the state the machine's CLAIM leads to", () => {
		expect(next(agreementPacket, "pending", "CLAIM")).toBe("rendering");
		expect(next(agreementPacket, "failed", "CLAIM")).toBe("rendering");
	});

	it("does nothing for a packet that is rendering or ready", () => {
		expect(claim(packet({ status: "rendering" }))).toEqual({ nothing: true });
		expect(claim(packet({ status: "ready" }))).toEqual({ nothing: true });
	});

	it("does nothing when the agreement's archive is closed, or there is no packet", () => {
		expect(claim(packet({ archive_closed_at: AT }))).toEqual({
			nothing: true,
		});
		expect(claim(packet({ status: "failed", archive_closed_at: AT }))).toEqual({
			nothing: true,
		});
		expect(claim(null)).toEqual({ nothing: true });
	});
});

const stale = (
	over: Partial<StoredPacketAttempt> = {},
): StoredPacketAttempt => ({
	status: "rendering",
	attempt_id: "seen",
	attempted_at: ago(PACKET_STALE_MS),
	...over,
});

const recover = (
	facts: StoredPacketAttempt | null,
	request: { expectedAttempt?: string; confirmedStale?: boolean } = {},
) =>
	said(
		packetRecoverable.decide(
			{
				expectedAttempt:
					"expectedAttempt" in request ? request.expectedAttempt : "seen",
				confirmedStale: request.confirmedStale ?? true,
				now: NOW,
			},
			facts,
		),
	);

const refusedStale = {
	refused: "StaleAttemptUnconfirmed",
	say: "Check the stale preparation attempt before recovery.",
};

describe("recovering a stale attempt", () => {
	it("does nothing when the owner named no attempt, confirmed or not", () => {
		expect(recover(stale(), { expectedAttempt: undefined })).toEqual({
			nothing: true,
		});
		expect(recover(stale(), { expectedAttempt: "" })).toEqual({
			nothing: true,
		});
		expect(
			recover(null, { expectedAttempt: undefined, confirmedStale: false }),
		).toEqual({ nothing: true });
	});

	it("fails the attempt the owner saw at render, once it is a minute old", () => {
		expect(recover(stale())).toEqual({
			wrote: {
				status: "failed",
				error_code: "render",
				attempt_id: "seen",
				staleBefore: "2026-11-23T14:59:00.000Z",
			},
		});
		expect(recover(stale({ attempted_at: ago(3_600_000) }))).toMatchObject({
			wrote: { status: "failed" },
		});
		expect(
			next(agreementPacket, "rendering", "RECOVER", { recoverable: true }),
		).toBe("failed");
	});

	it("is refused when the owner did not confirm, even for a stale attempt", () => {
		expect(recover(stale(), { confirmedStale: false })).toEqual(refusedStale);
		expect(recover(null, { confirmedStale: false })).toEqual(refusedStale);
	});

	it("is refused for an attempt under a minute old, or with no time", () => {
		expect(recover(stale({ attempted_at: ago(PACKET_STALE_MS - 1) }))).toEqual(
			refusedStale,
		);
		expect(recover(stale({ attempted_at: AT }))).toEqual(refusedStale);
		expect(recover(stale({ attempted_at: null }))).toEqual(refusedStale);
	});

	it("is refused for another attempt, a packet that is not rendering, or no packet", () => {
		expect(recover(stale({ attempt_id: "other" }))).toEqual(refusedStale);
		expect(recover(stale({ attempt_id: null }))).toEqual(refusedStale);

		for (const status of ["pending", "ready", "failed"] as const)
			expect(recover(stale({ status }))).toEqual(refusedStale);

		expect(recover(null)).toEqual(refusedStale);
	});
});

// ---- the guards on sqlite ----

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
		`DROP TABLE IF EXISTS software_agreement_events; DROP TABLE IF EXISTS software_agreement_artifacts;
		DROP TABLE IF EXISTS software_agreements;
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, archive_closed_at TEXT);
		${createOf("software_agreement_artifacts")}
		${createOf("software_agreement_events")}`,
	);
});

const ID = "a1";

/** Stores the agreement and, unless `null`, its packet. */
function store(row: StoredPacket | null, archiveClosedAt: string | null) {
	database
		.prepare("INSERT INTO software_agreements VALUES (?,?)")
		.run(ID, archiveClosedAt);

	if (row)
		database
			.prepare(
				"INSERT INTO software_agreement_artifacts(agreement_id,status,attempt_id,attempted_at,error_code) VALUES (?,?,?,?,?)",
			)
			.run(
				ID,
				row.status,
				row.attempt_id,
				row.attempted_at,
				row.status === "failed" ? "storage" : null,
			);
}

/** The packet and its archive, as the store reads them for the claim. */
const readClaimFacts = () =>
	db
		.prepare(
			"SELECT p.status,p.attempt_id,p.attempted_at,a.archive_closed_at FROM software_agreement_artifacts p JOIN software_agreements a ON a.id=p.agreement_id WHERE p.agreement_id=?",
		)
		.bind(ID)
		.first<StoredPacket>();

const readPacket = () =>
	database
		.prepare(
			"SELECT status,attempt_id,attempted_at,error_code FROM software_agreement_artifacts WHERE agreement_id=?",
		)
		.get(ID);

// Copied from prepareAgreementArtifact (src/lib/agreement-artifacts.ts): the claim (A15).
const CLAIM =
	"UPDATE software_agreement_artifacts SET status='rendering',attempt_id=?,attempted_at=?,error_code=NULL WHERE agreement_id=? AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_artifacts.agreement_id AND a.archive_closed_at IS NULL) RETURNING agreement_id";

// Copied from prepareAgreementArtifact: the outcome by attempt (A16), ready with its event, or failed.
const READY =
	"UPDATE software_agreement_artifacts SET status='ready',pdf_key=?,pdf_sha256=?,certificate_key=?,certificate_sha256=?,manifest_json=?,bytes=?,renderer_version='website-pdf-v2',ready_at=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'";

const READY_EVENT =
	"INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,'artifact-ready','system',? WHERE EXISTS(SELECT 1 FROM software_agreement_artifacts WHERE agreement_id=? AND attempt_id=? AND status='ready')";

const FAIL =
	"UPDATE software_agreement_artifacts SET status='failed',error_code=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'";

/** Every packet row the columns allow for these tests, and no packet at all. */
const ROWS: (StoredPacket | null)[] = [
	null,
	...PACKET_STATUSES.flatMap((status) =>
		[null, "other", "mine"].flatMap((attempt_id) =>
			[null, ago(PACKET_STALE_MS + 1)].map((attempted_at) =>
				packet({ status, attempt_id, attempted_at }),
			),
		),
	),
];

describe("the claim (A15) and its rule", () => {
	it("agree on every packet, with the archive open or closed", async () => {
		let claims = 0;

		for (const row of ROWS)
			for (const closed of [null, AT]) {
				database.exec(
					"DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements",
				);
				store(row, closed);

				const facts = await readClaimFacts();

				expect(facts).toEqual(
					row ? { ...row, archive_closed_at: closed } : null,
				);

				const decided = said(
					packetClaimable.decide({ attempt: "mine", at: NOW }, facts),
				);

				const returned = await db.prepare(CLAIM).bind("mine", AT, ID).first();

				expect(returned !== null, JSON.stringify({ row, closed })).toBe(
					"wrote" in decided,
				);

				if ("wrote" in decided) {
					claims += 1;
					expect(readPacket()).toEqual(decided.wrote);
				}
			}

		expect(claims).toBe(12);
	});
});

describe("the outcome by attempt (A16)", () => {
	it("is written only by the attempt that claimed the packet, while it is rendering", async () => {
		for (const status of PACKET_STATUSES)
			for (const attempt_id of ["mine", "other"]) {
				const changes = { ready: 0, fail: 0 };

				for (const outcome of ["ready", "fail"] as const) {
					database.exec(
						"DELETE FROM software_agreement_events; DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements",
					);
					store(packet({ status, attempt_id, attempted_at: AT }), null);

					if (outcome === "ready") {
						await db.batch([
							db
								.prepare(READY)
								.bind("key", "sha", "cert", "csha", "{}", 10, AT, ID, "mine"),
							db.prepare(READY_EVENT).bind("event", ID, AT, ID, "mine"),
						]);

						const after = readPacket();

						const events = database
							.prepare("SELECT count(*) AS n FROM software_agreement_events")
							.get();

						changes.ready = after?.status !== status ? 1 : 0;
						// The event follows the packet ready under this attempt.
						expect(events?.n).toBe(
							after?.status === "ready" && after.attempt_id === "mine" ? 1 : 0,
						);
					} else {
						const run = await db.prepare(FAIL).bind("render", ID, "mine").run();

						changes.fail = run.meta.changes;
					}
				}

				const mine = attempt_id === "mine";

				expect(changes.ready === 1, `${status} ${attempt_id}`).toBe(
					mine && packetAllows(status, "READY"),
				);
				expect(changes.fail === 1, `${status} ${attempt_id}`).toBe(
					mine && packetAllows(status, "FAIL"),
				);
			}
	});
});

describe("the recovery (A17) and its rule", () => {
	beforeAll(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	const TIMES = [
		null,
		ago(PACKET_STALE_MS + 1),
		ago(PACKET_STALE_MS),
		ago(PACKET_STALE_MS - 1),
		AT,
	];

	it("agree on every packet, attempt, time and confirmation", async () => {
		let recovered = 0;

		for (const status of PACKET_STATUSES)
			for (const attempt_id of [null, "seen", "other"])
				for (const attempted_at of TIMES)
					for (const confirmed of [true, false]) {
						database.exec(
							"DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements",
						);

						const row = packet({ status, attempt_id, attempted_at });

						store(row, null);

						const decided = said(
							packetRecoverable.decide(
								{
									expectedAttempt: "seen",
									confirmedStale: confirmed,
									now: NOW,
								},
								{ status, attempt_id, attempted_at },
							),
						);

						const today = await recoverAgreementRendering(
							db,
							ID,
							"seen",
							confirmed,
						);

						const label = JSON.stringify({ row, confirmed });

						if ("wrote" in decided) {
							recovered += 1;
							expect(today, label).toBe(true);
							expect(readPacket(), label).toEqual({
								status: "failed",
								attempt_id: "seen",
								attempted_at,
								error_code: "render",
							});
						} else {
							expect(decided, label).toEqual(refusedStale);
							expect(today, label).toBe(false);
							expect(readPacket(), label).toEqual({
								status,
								attempt_id,
								attempted_at,
								error_code: status === "failed" ? "storage" : null,
							});
						}
					}

		expect(recovered).toBe(2);
	});

	it("agree that a recovery of no packet changes nothing", async () => {
		store(null, null);

		expect(
			said(
				packetRecoverable.decide(
					{ expectedAttempt: "seen", confirmedStale: true, now: NOW },
					null,
				),
			),
		).toEqual(refusedStale);
		expect(await recoverAgreementRendering(db, ID, "seen", true)).toBe(false);
	});
});

describe("the claim's moves", () => {
	it("claim exactly from the statuses the machine's CLAIM leaves", () => {
		for (const status of PACKET_STATUSES)
			expect("wrote" in claim(packet({ status }))).toBe(
				packetAllows(status, "CLAIM"),
			);
	});
});
