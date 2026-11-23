import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgreementSession } from "../../src/lib/agreement-access";
import { templateFields } from "../../src/lib/agreement-templates";
import {
	offerAgreements,
	sessionGuard,
} from "../../src/lib/software-agreements";
import { signingStatusIs } from "../../src/server/agreement-store";
import { AGREEMENT_SIGNED } from "../../src/server/machines/agreement-document";
import { softwareGuard } from "../../src/lib/software-guard";
import type { SoftwareOffer } from "../../src/lib/software-offers";
import {
	openSession,
	type StoredAgreementSession,
} from "../../src/server/rules/agreement-session";
import {
	type ClientKey,
	clientChangedElsewhere,
	type OfferAgreementRow,
	type PendingMsaRow,
	type ReusedMsaRow,
	reviewDocument,
	reviewExisting,
	reviewParty,
	reviewPendingMsa,
} from "../../src/server/rules/signing-review";
import {
	agreementDetails,
	contractorValues,
	offerTerms,
	run,
} from "../helpers/offer-rules";
import {
	DatabaseSync,
	type SqliteDatabase,
	type SqliteRow,
	sqliteD1,
} from "../helpers/sqlite-d1";

// The review's decisions against the SQL they replace or that re-checks them, on sqlite with the real schema
// (docs/plans/2026-11-signing-conversion.md, section 4: "a test runs each kept guard's SQL on sqlite against its rule").
// Kept guards: A2 (`sessionGuard`, imported from src/lib/software-agreements.ts) against `openSession`, and A3 (the
// review's own guard, copied from `reviewOnce`) against `reviewExisting`; A1 is held to `openForSigning` elsewhere. Reads
// whose SQL decided and whose rule now decides on plain rows: `offerAgreements`' filter (imported), the reused MSA's six
// conditions, the pending MSA's statuses and `otherRequestChangedClient`'s evidence (copied from `reviewOnce` and
// `otherRequestChangedClient`, src/lib/software-agreements.ts, which the review's conversion deleted; A3 is held to the
// store's own text). Until that conversion, today's `reviewAgreements` and the staged rules also ran here on the same
// database, clock and ids; the review flow (src/server/flows/signing-review.ts) now runs the staged rules, and the
// offer-review golden corpus holds it to what `reviewAgreements` answered and wrote (`pnpm run golden:neutral`).

/** The store, whose review batch builds A3 (src/server/agreement-store.ts, `reviewStatements`). */
const STORE = readFileSync("src/server/agreement-store.ts", "utf8");

/** A3, the review's own guard, as `reviewOnce` passes it to `softwareGuard`. */
const A3 =
	"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed'))";

/** Today's read of the reused MSA, bound to its id and the client chosen. */
const REUSED_SQL =
	"SELECT * FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL AND archive_closed_at IS NULL AND EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=software_agreements.id AND f.status='ready') AND client_id=?";

/** Today's read of a pending MSA, bound to the client, the MSA template and the offer. */
const PENDING_SQL =
	"SELECT * FROM software_agreements WHERE client_id=? AND template_id=? AND kind='msa' AND status IN ('review','client_signed') AND offer_id<>?";

/** Today's evidence after a FOREIGN KEY failure: the earlier client by its id, or another row with the key. */
const EARLIER_SQL = "SELECT 1 FROM software_agreement_clients WHERE id=?";

const OTHER_SQL =
	"SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=? AND id<>?";

const STATUSES = ["review", "client_signed", "executed", "abandoned"] as const;

const NOW = "2026-11-14T03:30:00.000Z";
const EMAIL = "client@example.com";
const TOKEN_HASH = "a".repeat(64);
const LINK_HASH = "b".repeat(64);

const SESSION: AgreementSession = {
	token_hash: TOKEN_HASH,
	purpose: "agreement",
	offer_id: "o",
	link_hash: LINK_HASH,
	recipient_email: EMAIL,
	verified_at: "2026-11-14T03:00:00.000Z",
	expires_at: "2099-01-01T00:00:00.000Z",
	csrf_nonce: "csrf",
};

/** A template that names every field it must, one per line. */
const fieldsOf = (kind: "msa" | "sow") =>
	templateFields[kind]
		.filter((field) => !field.startsWith("milestone."))
		.map((field) => `${field}: {{${field}}}`)
		.join("\n") +
	(kind === "sow"
		? `\n{{#milestones}}\n${templateFields.sow
				.filter((field) => field.startsWith("milestone."))
				.map((field) => `${field}: {{${field}}}`)
				.join("\n")}\n{{/milestones}}`
		: "");

const text = (row: SqliteRow, column: string) => String(row[column]);

const maybeText = (row: SqliteRow, column: string) =>
	row[column] === null ? null : String(row[column]);

const kindOf = (row: SqliteRow) => (row.kind === "msa" ? "msa" : "sow");

/** A new database with today's schema, signing on, a software request with a sent offer and its link, and a session. */
function seeded(offer: Partial<SoftwareOffer> = {}) {
	const database = new DatabaseSync(":memory:");

	database.exec("PRAGMA foreign_keys=ON");
	database.exec(readFileSync("db/music.sql", "utf8"));
	database.exec(
		`UPDATE software_signing_settings SET software_signing_enabled=1;
		INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES
			('r','software','Example','${EMAIL}','Tool','reviewed','now','now'),
			('r2','software','Example','${EMAIL}','Tool','reviewed','now','now');
		INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label,source_revision) VALUES
			('t-msa','msa',1,'${fieldsOf("msa")}','${"c".repeat(64)}','2026-11-01T00:00:00.000Z','owner','msa-v1','msa-rev'),
			('t-msa2','msa',2,'${fieldsOf("msa")}','${"d".repeat(64)}','2026-11-02T00:00:00.000Z','owner',NULL,NULL),
			('t-sow','sow',1,'${fieldsOf("sow")}','${"e".repeat(64)}','2026-11-01T00:00:00.000Z','owner','sow-v1',NULL);
		INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES
			('o-old','r',1,'superseded','{}','now','now'),
			('o2','r2',1,'sent','{}','now','now');
		INSERT INTO software_offer_links VALUES('r','${LINK_HASH}','now',NULL);
		INSERT INTO software_agreement_clients VALUES
			('c1','${EMAIL}','Sample LLC','sample llc','LLC','Wyoming','100 Example Street','${EMAIL}','now'),
			('c2','${EMAIL}','Other LLC','other llc','LLC','Wyoming','100 Example Street','${EMAIL}','now');`,
	);

	const sent = {
		...OFFER,
		...offer,
	};

	database
		.prepare(
			"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,agreement_details_json,msa_template_id,sow_template_id,contractor_snapshot_json,recipient_email_snapshot,reused_msa_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
		)
		.run(
			sent.id,
			sent.request_id,
			sent.version,
			sent.status,
			sent.terms_json,
			sent.created_at,
			sent.updated_at,
			sent.agreement_details_json ?? null,
			sent.msa_template_id ?? null,
			sent.sow_template_id ?? null,
			sent.contractor_snapshot_json ?? null,
			sent.recipient_email_snapshot ?? null,
		);
	database.exec(
		`INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('link','agreement','o','${LINK_HASH}','${EMAIL}','${"f".repeat(64)}','2026-11-14T02:00:00.000Z','2026-11-14T04:00:00.000Z');`,
	);

	return { database, db: sqliteD1(database), offer: sent };
}

const OFFER: SoftwareOffer = {
	id: "o",
	request_id: "r",
	version: 2,
	status: "sent",
	terms_json: JSON.stringify(offerTerms),
	created_at: "now",
	updated_at: "now",
	sent_at: null,
	sent_by: null,
	agreement_details_json: JSON.stringify(agreementDetails),
	msa_template_id: "t-msa",
	sow_template_id: "t-sow",
	contractor_snapshot_json: JSON.stringify({
		...contractorValues,
		config_version: 4,
	}),
	recipient_email_snapshot: EMAIL,
	reused_msa_id: null,
};

/** An agreement row; every other column takes a value the schema accepts. */
function insertAgreement(
	database: SqliteDatabase,
	row: {
		readonly id: string;
		readonly kind?: string;
		readonly status?: string;
		readonly offer_id?: string | null;
		readonly client_id?: string;
		readonly template_id?: string;
		readonly terminated_at?: string | null;
		readonly archive_closed_at?: string | null;
		readonly review_session_hash?: string;
		readonly msa_id?: string | null;
	},
) {
	database
		.prepare(
			"INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,msa_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash,terminated_at,archive_closed_at) VALUES(?,?,?,'r',?,?,?,?,?,?,'{}','now','2026-10-02',?,?,?)",
		)
		.run(
			row.id,
			row.kind ?? "msa",
			row.offer_id === undefined ? "o" : row.offer_id,
			row.client_id ?? "c1",
			row.template_id ?? "t-msa",
			row.msa_id ?? null,
			row.status ?? "review",
			`Text of ${row.id}`,
			"9".repeat(64),
			row.review_session_hash ?? TOKEN_HASH,
			row.terminated_at ?? null,
			row.archive_closed_at ?? null,
		);
}

/** The offer's agreements, every status, ordered by kind: what the store reads for the review's rules. */
const agreementsOf = (database: SqliteDatabase, offerId: string) =>
	database
		.prepare(
			"SELECT id,kind,status,client_id,canonical_text,review_session_hash FROM software_agreements WHERE offer_id=? ORDER BY kind",
		)
		.all(offerId)
		.map(
			(row): OfferAgreementRow => ({
				id: text(row, "id"),
				kind: kindOf(row),
				status: text(row, "status"),
				client_id: text(row, "client_id"),
				canonical_text: text(row, "canonical_text"),
				review_session_hash: text(row, "review_session_hash"),
			}),
		);

/** The MSA an offer reuses, read by its id with its signed copy's status. */
function reusedRow(database: SqliteDatabase, id: string): ReusedMsaRow | null {
	const row = database
		.prepare(
			"SELECT a.id,a.kind,a.status,a.client_id,a.template_id,a.terminated_at,a.archive_closed_at,a.effective_on,a.canonical_text,a.text_sha256,f.status AS artifact_status FROM software_agreements a LEFT JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.id=?",
		)
		.get(id);

	return row === undefined
		? null
		: {
				id: text(row, "id"),
				kind: text(row, "kind"),
				status: text(row, "status"),
				client_id: text(row, "client_id"),
				template_id: text(row, "template_id"),
				terminated_at: maybeText(row, "terminated_at"),
				archive_closed_at: maybeText(row, "archive_closed_at"),
				effective_on: text(row, "effective_on"),
				canonical_text: text(row, "canonical_text"),
				text_sha256: text(row, "text_sha256"),
				artifact_status: maybeText(row, "artifact_status"),
			};
}

/** Every agreement as a pending-MSA fact, so the rule's whole condition decides. */
const pendingRows = (database: SqliteDatabase) =>
	database
		.prepare(
			"SELECT id,kind,status,offer_id,client_id,template_id FROM software_agreements",
		)
		.all()
		.map(
			(row): PendingMsaRow => ({
				id: text(row, "id"),
				kind: text(row, "kind"),
				status: text(row, "status"),
				offer_id: maybeText(row, "offer_id"),
				client_id: text(row, "client_id"),
				template_id: text(row, "template_id"),
			}),
		);

/** The clients with the natural key. */
const clientsByKey = (database: SqliteDatabase, key: ClientKey) =>
	database
		.prepare(
			"SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=?",
		)
		.all(
			key.recipient_email,
			key.legal_name_key,
			key.entity_type,
			key.jurisdiction,
		)
		.map((row) => ({ id: text(row, "id") }));

/** Whether a statement raises, as a guard does when what it checks no longer holds. */
const raises = (statement: D1PreparedStatement) =>
	statement.first().then(
		() => false,
		() => true,
	);

describe("A3 as copied here", () => {
	it("is the store's review guard, its status list from the agreement document machine", () => {
		const built = "status IN ('client_signed','executed')";

		expect(signingStatusIs(AGREEMENT_SIGNED)).toBe(built);
		expect(STORE).toContain(
			A3.replace(built, "${signingStatusIs(AGREEMENT_SIGNED)}"),
		);
	});
});

describe("A3, the review's guard, and the signed agreements stage 2 refuses", () => {
	it("agree for every pair of agreements of this offer and another", async () => {
		const { database, db } = seeded();

		const one = STATUSES.flatMap((status) =>
			["o", "o2"].map((offer) => ({ status, offer })),
		);

		const sets = [
			[],
			...one.map((row) => [row]),
			...one.flatMap((a) => one.map((b) => [a, b])),
		];

		for (const set of sets) {
			database.exec("DELETE FROM software_agreements");
			set.forEach((row, index) =>
				insertAgreement(database, {
					id: `a${index}`,
					status: row.status,
					offer_id: row.offer,
					template_id: index === 0 ? "t-msa" : "t-msa2",
				}),
			);

			const refused =
				"refused" in
				run(reviewExisting.decide(null, agreementsOf(database, "o")));

			expect(await raises(softwareGuard(db, A3, ["o"]))).toBe(refused);
		}

		expect(sets).toHaveLength(73);
	});
});

describe("A2, the session guard, and the session the route read", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("agree on every expiry around the batch's time, revoked or not; and the guard refuses a session that is gone", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(NOW));

		const { database, db } = seeded();
		const later = new Date(Date.parse(NOW) + 1).toISOString();
		const earlier = new Date(Date.parse(NOW) - 1).toISOString();

		for (const expires_at of [earlier, NOW, later, "2099-01-01T00:00:00.000Z"])
			for (const revoked_at of [null, earlier]) {
				database.exec("DELETE FROM software_agreement_sessions");

				const session: StoredAgreementSession = {
					token_hash: TOKEN_HASH,
					purpose: "agreement",
					offer_id: "o",
					link_hash: LINK_HASH,
					recipient_email: EMAIL,
					verified_at: earlier,
					expires_at,
					revoked_at,
					csrf_nonce: "csrf",
				};

				database
					.prepare(
						"INSERT INTO software_agreement_sessions VALUES(?,?,?,?,?,'link',?,?,?,?)",
					)
					.run(
						session.token_hash,
						session.purpose,
						session.offer_id,
						session.link_hash,
						session.recipient_email,
						session.verified_at,
						session.expires_at,
						session.revoked_at,
						session.csrf_nonce,
					);

				const refused =
					"refused" in run(openSession.decide({ now: new Date() }, session));

				expect(await raises(sessionGuard(db, { ...SESSION, expires_at }))).toBe(
					refused,
				);
			}

		database.exec("DELETE FROM software_agreement_sessions");
		expect(await raises(sessionGuard(db, SESSION))).toBe(true);
	});
});

describe("offerAgreements' filter and the rules' view of the offer's agreements", () => {
	it("agree on every status: the GET finds exactly the documents today's read returned", async () => {
		const { database, db } = seeded();

		for (const status of STATUSES) {
			database.exec("DELETE FROM software_agreements");
			insertAgreement(database, { id: "a1", kind: "sow", status });

			const todays = (await offerAgreements(db, "o")).map((row) => row.id);

			const found = run(
				reviewDocument.decide(
					{ documentId: "a1", sessionTokenHash: TOKEN_HASH },
					agreementsOf(database, "o"),
				),
			);

			expect("wrote" in found).toBe(todays.includes("a1"));
		}
	});
});

describe("today's read of the reused MSA and stage 3", () => {
	it("agree on every kind, status, termination, archive, signed copy and client", () => {
		const { database } = seeded();
		let cases = 0;

		for (const kind of ["msa", "sow"])
			for (const status of STATUSES)
				for (const terminated_at of [null, "2026-11-01"])
					for (const archive_closed_at of [null, "2026-11-01"])
						for (const artifact of [
							null,
							"pending",
							"rendering",
							"ready",
							"failed",
						])
							for (const client_id of ["c1", "c2"]) {
								database.exec(
									"DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements",
								);
								insertAgreement(database, {
									id: "m1",
									kind,
									status,
									offer_id: "o-old",
									client_id,
									terminated_at,
									archive_closed_at,
								});

								if (artifact !== null)
									database
										.prepare(
											"INSERT INTO software_agreement_artifacts(agreement_id,status) VALUES('m1',?)",
										)
										.run(artifact);

								const todays = database.prepare(REUSED_SQL).get("m1", "c1");

								const decided = run(
									reviewParty.decide(
										{
											offer: { reused_msa_id: "m1", msa_template_id: "t-msa" },
											newClientId: null,
										},
										{
											client: { id: "c1" },
											reusedMsa: reusedRow(database, "m1"),
										},
									),
								);

								expect("wrote" in decided).toBe(todays !== undefined);

								if ("wrote" in decided)
									expect(decided.wrote.reused?.id).toBe("m1");

								cases += 1;
							}

		expect(cases).toBe(320);
		database.exec(
			"DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements",
		);
		expect(database.prepare(REUSED_SQL).get("m1", "c1")).toBeUndefined();
		expect(
			"refused" in
				run(
					reviewParty.decide(
						{
							offer: { reused_msa_id: "m1", msa_template_id: "t-msa" },
							newClientId: null,
						},
						{ client: { id: "c1" }, reusedMsa: reusedRow(database, "m1") },
					),
				),
		).toBe(true);
	});
});

describe("today's read of a pending MSA, the pending-MSA index, and stage 6", () => {
	const templates = {
		msa: {
			id: "t-msa",
			kind: "msa" as const,
			version: 1,
			text: "",
			sha256: "",
			version_label: null,
			source_revision: null,
			published_at: "",
		},
		sow: {
			id: "t-sow",
			kind: "sow" as const,
			version: 1,
			text: "",
			sha256: "",
			version_label: null,
			source_revision: null,
			published_at: "",
		},
	};

	it("agree on every kind, status, offer, client and template; the index refuses those and an MSA of no offer", () => {
		const { database } = seeded();
		let cases = 0;

		for (const kind of ["msa", "sow"])
			for (const status of STATUSES)
				for (const offer_id of ["o", "o2", null])
					for (const client_id of ["c1", "c2"])
						for (const template_id of ["t-msa", "t-msa2"]) {
							database.exec("DELETE FROM software_agreements");
							insertAgreement(database, {
								id: "m-other",
								kind,
								status,
								offer_id,
								client_id,
								template_id,
							});

							const todays = database
								.prepare(PENDING_SQL)
								.get("c1", "t-msa", "o");

							const refused =
								"refused" in
								run(
									reviewPendingMsa.decide(
										{
											offer: { id: "o" },
											party: { clientId: "c1" },
											templates,
										},
										pendingRows(database),
									),
								);

							expect(refused).toBe(todays !== undefined);

							// The batch: this offer's documents in review deleted, then its new MSA inserted.
							database.exec("SAVEPOINT batch");
							database.exec(
								"DELETE FROM software_agreements WHERE offer_id='o' AND status='review'",
							);

							let unique = false;

							try {
								insertAgreement(database, { id: "m-new", status: "review" });
							} catch (error) {
								unique =
									/UNIQUE constraint failed: software_agreements\.client_id, software_agreements\.template_id/.test(
										String(error),
									);
							}

							database.exec("ROLLBACK TO batch; RELEASE batch");

							const indexOnly =
								kind === "msa" &&
								(status === "review" || status === "client_signed") &&
								client_id === "c1" &&
								template_id === "t-msa" &&
								(offer_id === null ||
									(offer_id === "o" && status === "client_signed"));

							// An MSA of no offer is not counted by the read, but the index refuses the batch: three tries, then the
							// 409 a third failure gave today. This offer's own client_signed MSA is SignatureSaved, and A3 refuses first.
							expect(unique).toBe(refused || indexOnly);
							cases += 1;
						}

		expect(cases).toBe(96);
	});
});

describe("otherRequestChangedClient's evidence and clientChangedElsewhere", () => {
	const KEY: ClientKey = {
		recipient_email: EMAIL,
		legal_name_key: "sample llc",
		entity_type: "LLC",
		jurisdiction: "Wyoming",
	};

	const client = (id: string, name = "Sample LLC") => [
		id,
		EMAIL,
		name,
		name.toLowerCase(),
		"LLC",
		"Wyoming",
		"100 Example Street",
		EMAIL,
		"now",
	];

	const write = (id: string, earlierClientId: string | null) => ({
		earlierClientId,
		client: {
			id,
			recipient_email: KEY.recipient_email,
			legal_name: "Sample LLC",
			legal_name_key: KEY.legal_name_key,
			entity_type: KEY.entity_type,
			jurisdiction: KEY.jurisdiction,
			business_address: "100 Example Street",
			notice_email: EMAIL,
			created_at: NOW,
		},
	});

	it("agree for a client the review found before and for a new one, whatever another request left", () => {
		const { database } = seeded();

		const states: readonly (readonly string[][])[] = [
			[],
			[client("c-old")],
			[client("c-new")],
			[client("c-mine")],
			[client("c-other")],
			[client("c-other", "Elsewhere LLC")],
		];

		for (const rows of states) {
			database.exec(
				"DELETE FROM software_agreements; DELETE FROM software_agreement_clients",
			);

			for (const row of rows)
				database
					.prepare(
						"INSERT INTO software_agreement_clients VALUES(?,?,?,?,?,?,?,?,?)",
					)
					.run(...row);

			// A client the key named before the batch: today reads it by its id; so does the store.
			const earlierToday = !database.prepare(EARLIER_SQL).get("c-old");

			const earlierFound = database
				.prepare("SELECT id FROM software_agreement_clients WHERE id=?")
				.all("c-old")
				.map((row) => ({ id: text(row, "id") }));

			expect(
				clientChangedElsewhere(write("c-old", "c-old"), earlierFound),
			).toBe(earlierToday);

			// A new client: today reads another row with the key; the store reads the rows with the key.
			const newToday = Boolean(
				database
					.prepare(OTHER_SQL)
					.get(
						KEY.recipient_email,
						KEY.legal_name_key,
						KEY.entity_type,
						KEY.jurisdiction,
						"c-mine",
					),
			);

			expect(
				clientChangedElsewhere(
					write("c-mine", null),
					clientsByKey(database, KEY),
				),
			).toBe(newToday);
		}
	});
});
