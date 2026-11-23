import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { statementOf } from "../../scripts/sql-effects.mjs";
import { templateFields } from "../../src/lib/agreement-templates";
import {
	AgreementStoreFailed,
	cleanupBatch,
	insertAttachment,
	publishBatch,
	readAccessRows,
	readAttachmentSaved,
	readCurrentTemplate,
	readLabelUse,
	readNewestContractorConfig,
	readOwnerAttachment,
	readOwnerCopy,
	readSignedCopy,
	readSigningEnabled,
	readTemplateVersion,
	readUploadRequest,
	saveContractorBatch,
	saveSetting,
} from "../../src/server/agreement-store";
import {
	alwaysDecideAndSave,
	ChangedSinceRead,
	GuardRefused,
} from "../../src/server/guarded-save";
import { ownerCopy } from "../../src/server/rules/agreement-download";
import { accessCleanup } from "../../src/server/rules/agreement-retention";
import {
	type ContractorSave,
	LabelUsed,
	type PublishInputs,
	publishTemplate,
	saveContractor,
	type TemplatePublication,
} from "../../src/server/rules/agreement-templates";
import {
	type AttachmentRow,
	acceptAttachment,
} from "../../src/server/rules/agreement-upload";
import { MusicDb } from "../../src/server/services";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";
import { double } from "../helpers/doubles";
import { hookPatternsIn } from "../helpers/offers-golden";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";

// The signing store's templates, settings, access clean-up, uploads and the owner's downloads
// (src/server/agreement-store.ts, the block "templates, settings, access cleanup, uploads and the owner's downloads")
// against the real schema on node:sqlite: what each read finds, what each batch writes, and the failure each answers
// with (AgreementStoreFailed for a rejection, GuardRefused for a refused guard or the config's taken version,
// ChangedSinceRead for the template label's index). Then its SQL against the golden corpora of the routes it serves:
// every text it runs is one today's routes ran (and the fixtures recorded), or one listed below, each changed text picked
// by the hooks that picked its old one, and each added read by none.

const EARLIER = "2026-11-13T11:00:00.000Z";
const AT = "2026-11-13T12:00:00.000Z";
const OWNER = "owner@example.test";
const SHA = "a".repeat(64);
const DAY = 86_400_000;
const NOW = new Date(AT);

const at = (offsetMs: number) =>
	new Date(NOW.getTime() + offsetMs).toISOString();

/** A world: the real schema, every statement the store runs recorded, and one statement failing when asked to. */
function storeWorld(fail?: { readonly on: RegExp; readonly message: string }) {
	const sql = freshMusicDb();
	const executed: string[] = [];

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (fail?.on.test(query)) throw new Error(fail.message);

			return sql.prepare(query);
		},
		exec: (query: string) => sql.exec(query),
	});

	const db = sqliteD1(recording);

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		executed,
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		seed: (tables: Seed) => seed(sql, tables),
		all: (query: string, ...args: string[]) => sql.prepare(query).all(...args),
	};
}

type World = ReturnType<typeof storeWorld>;

/** A text that passes validateTemplate: every MSA field once. */
const MSA = [
	"Master Services Agreement",
	...templateFields.msa.map((field) => `${field}: {{${field}}}`),
].join("\n");

const templateRow = (
	id: string,
	kind: "msa" | "sow",
	version: number,
	label: string | null,
) => ({
	id,
	kind,
	version,
	text: `${kind} ${version}`,
	sha256: SHA,
	published_at: EARLIER,
	published_by: "earlier@example.test",
	version_label: label,
	source_revision: version === 2 ? "abc123" : null,
});

const publication = (
	over: { readonly version?: number; readonly label?: string } = {},
): TemplatePublication => {
	const version = over.version ?? 1;
	const versionLabel = over.label ?? "m-new";

	return {
		row: {
			id: "t-new",
			kind: "msa",
			version,
			text: MSA,
			sha256: SHA,
			published_at: AT,
			published_by: OWNER,
			version_label: versionLabel,
			source_revision: null,
		},
		expectedVersion: version - 1,
		event: { action: "template-published", actor: OWNER, at: AT },
		answer: { id: "t-new", sha256: SHA, version, versionLabel },
	};
};

const contractorSave = (expectedVersion: number): ContractorSave => ({
	row: {
		version: expectedVersion + 1,
		values_json: '{"legal_name":"Kazon"}',
		created_at: AT,
		created_by: OWNER,
	},
	expectedVersion,
});

const attachment = (requestId: string, id = "f-new"): AttachmentRow => ({
	id,
	request_id: requestId,
	filename: "msa.pdf",
	version: "2",
	document_date: "2026-10-01",
	object_key: `agreements/attachments/${id}.pdf`,
	sha256: SHA,
	bytes: 1234,
	created_at: AT,
	created_by: OWNER,
});

const linkRow = (id: string, expiresAt: string) => ({
	id,
	purpose: "archive",
	offer_id: null,
	link_hash: null,
	recipient_email: "grace@example.test",
	token_hash: `token-${id}`,
	issued_at: at(-40 * DAY),
	expires_at: expiresAt,
});

const sessionRow = (
	hash: string,
	linkId: string,
	expiresAt: string,
	revokedAt: string | null = null,
) => ({
	token_hash: hash,
	purpose: "archive",
	offer_id: null,
	link_hash: null,
	recipient_email: "grace@example.test",
	link_id: linkId,
	verified_at: at(-40 * DAY),
	expires_at: expiresAt,
	revoked_at: revokedAt,
	csrf_nonce: "nonce",
});

describe("the templates", () => {
	it("read the kind's newest version with the offers store's read, today's `currentTemplate`, failing as this store fails", async () => {
		const world = storeWorld();

		world.seed({
			software_agreement_templates: [
				templateRow("m1", "msa", 1, "m1"),
				templateRow("m2", "msa", 2, null),
				templateRow("s1", "sow", 1, "s1"),
			],
		});

		expect(await world.ok(readCurrentTemplate("msa"))).toMatchObject({
			id: "m2",
			version: 2,
		});
		expect(await world.ok(readCurrentTemplate("sow"))).toMatchObject({
			id: "s1",
		});
		expect(world.executed).toEqual([
			"SELECT * FROM software_agreement_templates WHERE kind=? ORDER BY version DESC LIMIT 1",
			"SELECT * FROM software_agreement_templates WHERE kind=? ORDER BY version DESC LIMIT 1",
		]);
		expect(await storeWorld().ok(readCurrentTemplate("msa"))).toBeNull();

		// The offers store's failure is this store's, with the same cause, so a signing route maps one tag.
		const down = storeWorld({
			on: /FROM software_agreement_templates WHERE kind=\? ORDER BY/,
			message: "d1 down",
		});

		expect(await down.failed(readCurrentTemplate("msa"))).toEqual(
			new AgreementStoreFailed({ failure: new Error("d1 down") }),
		);
	});

	it("read a stored version of a kind as the rule's row, or null", async () => {
		const world = storeWorld();

		world.seed({
			software_agreement_templates: [
				templateRow("m1", "msa", 1, "m1"),
				templateRow("m2", "msa", 2, null),
				templateRow("s1", "sow", 1, "s1"),
			],
		});

		expect(await world.ok(readTemplateVersion("msa", 2))).toEqual({
			id: "m2",
			kind: "msa",
			version: 2,
			text: "msa 2",
			sha256: SHA,
			version_label: null,
			source_revision: "abc123",
			published_at: EARLIER,
		});
		expect(await world.ok(readTemplateVersion("sow", 1))).toMatchObject({
			id: "s1",
			version_label: "s1",
		});
		expect(await world.ok(readTemplateVersion("sow", 2))).toBeNull();
		expect(await world.ok(readTemplateVersion("msa", 0))).toBeNull();
	});

	it("say whether a label is used by any version of the kind, and only of that kind", async () => {
		const world = storeWorld();

		world.seed({
			software_agreement_templates: [
				templateRow("m1", "msa", 1, "m1"),
				templateRow("m2", "msa", 2, null),
				templateRow("s1", "sow", 1, "s1"),
			],
		});

		expect(await world.ok(readLabelUse("msa", "m1"))).toBe(true);
		expect(await world.ok(readLabelUse("msa", "M1"))).toBe(false);
		expect(await world.ok(readLabelUse("msa", "s1"))).toBe(false);
		expect(await world.ok(readLabelUse("sow", "s1"))).toBe(true);
	});

	it("publish the row and its template-published event in one batch, the event's id drawn as it is built", async () => {
		const world = storeWorld();

		await world.ok(publishBatch(publication()));

		expect(
			world.all(
				"SELECT id,kind,version,text,sha256,published_at,published_by,version_label,source_revision FROM software_agreement_templates",
			),
		).toEqual([{ ...publication().row }]);

		const events = world.all(
			"SELECT id,agreement_id,offer_id,action,actor,occurred_at,reason FROM software_agreement_events",
		);

		expect(events).toEqual([
			{
				id: expect.stringMatching(/^[0-9a-f-]{36}$/),
				agreement_id: null,
				offer_id: null,
				action: "template-published",
				actor: OWNER,
				occurred_at: AT,
				reason: null,
			},
		]);
	});

	it("refuse a publish whose expected version is no longer the kind's newest (A22), writing nothing", async () => {
		const world = storeWorld();

		world.seed({
			software_agreement_templates: [
				templateRow("m1", "msa", 1, "m1"),
				templateRow("s3", "sow", 3, "s3"),
			],
		});

		expect(await world.failed(publishBatch(publication()))).toBeInstanceOf(
			GuardRefused,
		);
		expect(
			await world.failed(publishBatch(publication({ version: 3 }))),
		).toBeInstanceOf(GuardRefused);
		await world.ok(publishBatch(publication({ version: 2 })));
		expect(world.all("SELECT id FROM software_agreement_templates")).toEqual([
			{ id: "m1" },
			{ id: "s3" },
			{ id: "t-new" },
		]);
		expect(world.all("SELECT id FROM software_agreement_events")).toHaveLength(
			1,
		);
	});

	it("read again when the label's index refuses the insert, and the rule then answers LabelUsed", async () => {
		const world = storeWorld();

		world.seed({
			software_agreement_templates: [
				templateRow("m1", "msa", 1, "m1"),
				templateRow("m3", "msa", 3, "m3"),
			],
		});

		// Another publish takes the label, at the missing version 2, between the read and the batch.
		world.sql.exec(
			`INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label) VALUES('x','msa',2,'other','${SHA}','${EARLIER}','other@example.test','race')`,
		);

		expect(
			await world.failed(
				publishBatch(publication({ version: 4, label: "race" })),
			),
		).toBeInstanceOf(ChangedSinceRead);

		const inputs: PublishInputs = {
			kind: "msa",
			text: MSA,
			confirmed: true,
			versionLabel: "race",
			expectedVersion: 3,
			sha256: "b".repeat(64),
			id: "t-new",
			at: AT,
			actor: OWNER,
		};

		let reads = 0;

		const answer = await world.failed(
			alwaysDecideAndSave({
				facts: Effect.all({
					current: readCurrentTemplate("msa"),
					labelUsed: readLabelUse("msa", "race").pipe(
						// The first read is before the other publish took the label.
						Effect.map((used) => {
							reads += 1;

							return reads === 1 ? false : used;
						}),
					),
				}),
				decide: (facts) => publishTemplate.decide(inputs, facts),
				save: publishBatch,
			}),
		);

		expect(reads).toBe(2);
		expect(answer).toBeInstanceOf(LabelUsed);
		expect(answer).toMatchObject({
			say: "race is already used for the MSA. Choose another label.",
		});
		expect(world.all("SELECT id FROM software_agreement_events")).toEqual([]);
	});

	it("fail with the cause for anything else, and a UNIQUE failure of another index is not the label's", async () => {
		const outage = storeWorld({
			on: /INSERT INTO software_agreement_templates/,
			message: "d1 down",
		});

		const failure = await outage.failed(publishBatch(publication()));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({ failure: new Error("d1 down") });

		const clash = storeWorld();

		clash.seed({
			software_agreement_templates: [templateRow("t-new", "sow", 1, null)],
		});

		expect(await clash.failed(publishBatch(publication()))).toBeInstanceOf(
			AgreementStoreFailed,
		);
	});
});

describe("the contractor's details", () => {
	it("read the newest config's version, or null when none is stored", async () => {
		const world = storeWorld();

		expect(await world.ok(readNewestContractorConfig())).toBeNull();

		for (const version of [2, 1])
			world.sql
				.prepare("INSERT INTO software_contractor_config VALUES(?,?,?,?)")
				.run(version, "{}", EARLIER, "earlier@example.test");

		expect(await world.ok(readNewestContractorConfig())).toEqual({
			version: 2,
		});
	});

	it("save the version the rule wrote, guarded by A23 over the newest version the rule read", async () => {
		let refused = 0;

		for (const versions of [[], [1], [1, 2], [2]])
			for (const expectedVersion of [0, 1, 2, 3]) {
				const world = storeWorld();

				for (const version of versions)
					world.sql
						.prepare("INSERT INTO software_contractor_config VALUES(?,?,?,?)")
						.run(version, "{}", EARLIER, "earlier@example.test");

				const newest = await world.ok(readNewestContractorConfig());

				const decided = await Effect.runPromise(
					Effect.result(
						saveContractor.decide(
							{
								values: JSON.parse(contractorSave(0).row.values_json),
								expectedVersion,
								at: AT,
								actor: OWNER,
							},
							newest,
						),
					),
				);

				const save = contractorSave(expectedVersion);
				const where = JSON.stringify({ versions, expectedVersion });

				const answer = await world.ok(Effect.result(saveContractorBatch(save)));

				expect(Result.isFailure(answer), where).toBe(Result.isFailure(decided));

				if (Result.isFailure(answer)) {
					refused += 1;
					expect(answer.failure, where).toBeInstanceOf(GuardRefused);
					continue;
				}

				expect(
					world.all(
						"SELECT * FROM software_contractor_config WHERE version=?",
						String(expectedVersion + 1),
					),
					where,
				).toEqual([{ ...save.row }]);
			}

		expect(refused).toBeGreaterThan(0);
	});

	it("refuse a save whose version another save took (the primary key), and fail with the cause for anything else", async () => {
		const taken = storeWorld({
			on: /INSERT INTO software_contractor_config/,
			message:
				"D1_ERROR: UNIQUE constraint failed: software_contractor_config.version: SQLITE_CONSTRAINT",
		});

		expect(
			await taken.failed(saveContractorBatch(contractorSave(0))),
		).toBeInstanceOf(GuardRefused);

		const outage = storeWorld({
			on: /INSERT INTO software_contractor_config/,
			message: "d1 down",
		});

		const failure = await outage.failed(saveContractorBatch(contractorSave(0)));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({ failure: new Error("d1 down") });
	});
});

describe("the signing setting", () => {
	it("is switched on and off with the time and the owner, and a missing row changes nothing", async () => {
		const world = storeWorld();

		await world.ok(saveSetting({ enabled: true, at: AT, actor: OWNER }));
		expect(await world.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 1,
		});
		expect(world.all("SELECT * FROM software_signing_settings")).toEqual([
			{
				id: 1,
				software_signing_enabled: 1,
				updated_at: AT,
				updated_by: OWNER,
			},
		]);

		await world.ok(saveSetting({ enabled: false, at: AT, actor: OWNER }));
		expect(await world.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 0,
		});

		world.sql.exec("DELETE FROM software_signing_settings");
		await world.ok(saveSetting({ enabled: true, at: AT, actor: OWNER }));
		expect(await world.ok(readSigningEnabled())).toBeNull();
	});

	it("fails with the cause when the update or the read fails", async () => {
		const world = storeWorld({
			on: /software_signing_settings/,
			message: "d1 down",
		});

		for (const effect of [
			saveSetting({ enabled: true, at: AT, actor: OWNER }),
			readSigningEnabled(),
		])
			expect(await world.failed(effect)).toEqual(
				new AgreementStoreFailed({ failure: new Error("d1 down") }),
			);
	});
});

describe("the access clean-up", () => {
	const TIMES = [
		at(-31 * DAY),
		at(-30 * DAY - 1),
		at(-30 * DAY),
		at(-30 * DAY + 1),
		at(3_600_000),
	];

	/** One link per time, each with one session per expiry and revocation, plus links with no session. */
	function agedWorld() {
		const world = storeWorld();
		const links = TIMES.map((time, index) => linkRow(`l${index}`, time));

		const sessions = TIMES.flatMap((time, index) =>
			[null, ...TIMES].map((revoked, revokedIndex) =>
				sessionRow(`s${index}-${revokedIndex}`, `l${index}`, time, revoked),
			),
		);

		world.seed({
			software_agreement_links: [
				...links,
				linkRow("lonely-old", at(-31 * DAY)),
				linkRow("lonely-new", at(3_600_000)),
			],
			software_agreement_sessions: sessions,
		});

		return world;
	}

	it("reads every session and link, and deletes exactly the rows the rule chose, with today's two DELETEs", async () => {
		const world = agedWorld();
		const facts = await world.ok(readAccessRows());

		expect(facts.sessions).toHaveLength(TIMES.length * (TIMES.length + 1));
		expect(facts.links).toHaveLength(TIMES.length + 2);
		expect(facts.sessions[0]).toEqual({
			token_hash: "s0-0",
			link_id: "l0",
			expires_at: TIMES[0],
			revoked_at: null,
		});

		const chosen = Effect.runSync(accessCleanup.decide({ now: NOW }, facts));

		expect(chosen.sessions.length).toBeGreaterThan(0);
		expect(chosen.links).toContain("lonely-old");

		const asked = world.executed.length;

		await world.ok(cleanupBatch(chosen));

		expect(world.executed.slice(asked)).toEqual([
			"DELETE FROM software_agreement_sessions WHERE expires_at<? OR revoked_at<?",
			"DELETE FROM software_agreement_links WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM software_agreement_sessions s WHERE s.link_id=software_agreement_links.id)",
		]);

		const left = await world.ok(readAccessRows());

		expect(
			facts.sessions
				.map((row) => row.token_hash)
				.filter(
					(hash) => !left.sessions.some((row) => row.token_hash === hash),
				),
		).toEqual(chosen.sessions);
		expect(
			facts.links
				.map((row) => row.id)
				.filter((id) => !left.links.some((row) => row.id === id)),
		).toEqual(chosen.links);
	});

	it("runs both DELETEs when the rule chose nothing, and fails with the cause when either fails", async () => {
		const empty = storeWorld();

		const chosen = Effect.runSync(
			accessCleanup.decide({ now: NOW }, await empty.ok(readAccessRows())),
		);

		expect(chosen).toEqual({ before: at(-30 * DAY), sessions: [], links: [] });

		const asked = empty.executed.length;

		await empty.ok(cleanupBatch(chosen));
		expect(empty.executed.slice(asked)).toHaveLength(2);

		for (const on of [
			/DELETE FROM software_agreement_sessions/,
			/DELETE FROM software_agreement_links/,
		]) {
			const world = storeWorld({ on, message: "d1 down" });

			world.seed({
				software_agreement_links: [linkRow("l", at(-31 * DAY))],
				software_agreement_sessions: [sessionRow("s", "l", at(-31 * DAY))],
			});

			expect(await world.failed(cleanupBatch(chosen))).toEqual(
				new AgreementStoreFailed({ failure: new Error("d1 down") }),
			);
			// The batch rolls back.
			expect(
				world.all("SELECT token_hash FROM software_agreement_sessions"),
			).toHaveLength(1);
		}
	});
});

describe("the upload", () => {
	const REQUESTS = [
		rows.softwareRequest("open", { status: "reviewed" }),
		rows.softwareRequest("new", { status: "new" }),
		rows.softwareRequest("withdrawn", { status: "withdrawn" }),
		rows.softwareRequest("resolved", { status: "resolved" }),
		rows.ownerRequest("service", { status: "new" }),
	];

	it("reads the request's kind and status, or null", async () => {
		const world = storeWorld();

		world.seed({ owner_requests: REQUESTS });

		expect(await world.ok(readUploadRequest("withdrawn"))).toEqual({
			kind: "software",
			status: "withdrawn",
		});
		expect(await world.ok(readUploadRequest("service"))).toEqual({
			kind: "service",
			status: "new",
		});
		expect(await world.ok(readUploadRequest("nope"))).toBeNull();
		expect(await world.ok(readUploadRequest(""))).toBeNull();
	});

	it("inserts the row the rule wrote exactly when the rule accepts the request (A24), else GuardRefused", async () => {
		const accepted: string[] = [];

		for (const requestId of [
			"open",
			"new",
			"withdrawn",
			"resolved",
			"service",
			"nope",
			"",
			"open' OR '1'='1",
		]) {
			const world = storeWorld();

			world.seed({ owner_requests: REQUESTS });

			const request = await world.ok(readUploadRequest(requestId));
			const row = attachment(requestId);

			const decided = await Effect.runPromise(
				Effect.result(
					acceptAttachment.decide(
						{
							id: row.id,
							requestId,
							query: {
								filename: row.filename,
								version: row.version,
								date: row.document_date,
							},
							sha256: row.sha256,
							bytes: row.bytes,
							at: NOW,
							owner: OWNER,
						},
						request,
					),
				),
			);

			const answer = await world.ok(Effect.result(insertAttachment(row)));

			expect(Result.isFailure(answer), requestId).toBe(
				Result.isFailure(decided),
			);

			if (Result.isFailure(answer)) {
				expect(answer.failure, requestId).toBeInstanceOf(GuardRefused);
				expect(await world.ok(readAttachmentSaved(row.id)), requestId).toBe(
					false,
				);
				continue;
			}

			expect(Result.isSuccess(decided) && decided.success, requestId).toEqual(
				row,
			);
			expect(world.all("SELECT * FROM software_agreement_attachments")).toEqual(
				[{ ...row }],
			);
			expect(await world.ok(readAttachmentSaved(row.id))).toBe(true);
			accepted.push(requestId);
		}

		expect(accepted).toEqual(["open", "new"]);
	});

	it("fails with the cause for anything else, the checks after it included", async () => {
		const world = storeWorld({
			on: /software_agreement_attachments/,
			message: "d1 down",
		});

		world.seed({ owner_requests: REQUESTS });

		for (const effect of [
			insertAttachment(attachment("open")),
			readAttachmentSaved("f-new"),
		])
			expect(await world.failed(effect)).toEqual(
				new AgreementStoreFailed({ failure: new Error("d1 down") }),
			);
	});
});

describe("the owner's downloads", () => {
	it("read an attachment's object only on the request named, and nothing for a missing id", async () => {
		const world = storeWorld();

		world.seed({
			owner_requests: [rows.softwareRequest("r1"), rows.softwareRequest("r2")],
			software_agreement_attachments: [attachment("r1", "att1")],
		});

		expect(await world.ok(readOwnerAttachment("att1", "r1"))).toEqual({
			object_key: "agreements/attachments/att1.pdf",
		});
		expect(await world.ok(readOwnerAttachment("att1", "r2"))).toBeNull();
		expect(await world.ok(readOwnerAttachment(null, "r1"))).toBeNull();
		expect(await world.ok(readOwnerAttachment("att1", null))).toBeNull();
		expect(await world.ok(readOwnerAttachment("ATT1", "r1"))).toBeNull();
	});

	it("read the agreement's status and archive, which the rule judges as today's filtered read did", async () => {
		const TODAY =
			"SELECT a.id,a.offer_id,a.request_id,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=? AND a.status='executed' AND a.archive_closed_at IS NULL";

		const world = storeWorld();

		const agreements = [
			"review",
			"client_signed",
			"executed",
			"abandoned",
		].flatMap((status) =>
			[null, EARLIER].map((closed) =>
				rows.agreement(`${status}-${closed ? "closed" : "open"}`, "r1", "o1", {
					// An SOW of no offer: the one-pending-MSA and one-SOW-per-offer indexes hold any number of them.
					kind: "sow",
					offer_id: null,
					status,
					archive_closed_at: closed,
				}),
			),
		);

		world.seed({
			owner_requests: [rows.softwareRequest("r1")],
			software_offers: [rows.softwareOffer("o1", "r1")],
			...rows.agreementBase(),
			software_agreements: agreements,
		});

		const allowedIds: string[] = [];

		for (const id of [...agreements.map((row) => String(row.id)), "nope"]) {
			const agreement = await world.ok(readOwnerCopy(id));

			const allowed = Effect.runSync(
				Effect.result(ownerCopy.decide(null, { agreement })),
			);

			expect(Result.isSuccess(allowed), id).toBe(
				world.all(TODAY, id).length === 1,
			);

			if (Result.isSuccess(allowed)) allowedIds.push(id);
		}

		expect(allowedIds).toEqual(["executed-open"]);

		expect(await world.ok(readOwnerCopy("executed-closed"))).toEqual({
			status: "executed",
			archive_closed_at: EARLIER,
		});
		expect(await world.ok(readOwnerCopy("nope"))).toBeNull();
	});
});

// ---- the SQL against the golden corpora ----

/** The corpora of the routes this block serves: POST /api/owner/agreements, the owner's attachments and signed copy. */
const CORPORA = [
	"owner-agreements-access",
	"owner-agreements-config",
	"owner-agreements-preview",
	"owner-agreements-publish",
	"owner-agreements-template-version",
	"owner-agreements-wire",
	"owner-agreement-attachments-put",
	"owner-agreement-attachments-get",
	"owner-agreement-file",
] as const;

/** Every corpus whose test file runs one of these routes, retention's included: their hooks must not pick an added read. */
const HOOKED = [
	...CORPORA,
	"owner-agreements-retention-preview",
	"owner-agreements-retention-apply",
] as const;

const root = new URL("../../", import.meta.url);

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly { readonly sql: string }[];
};

function recorded() {
	const texts = new Set<string>();
	const batches = new Set<string>();

	for (const corpus of CORPORA) {
		// SAFETY: the fixture files are written only by the golden harness, as a JSON array of recorded cases with their effects.
		const cases = JSON.parse(
			gunzipSync(
				readFileSync(new URL(`tests/golden/fixtures/${corpus}.json.gz`, root)),
			).toString("utf8"),
		) as { readonly effects: readonly RecordedEffect[] }[];

		for (const recordedCase of cases)
			for (const effect of recordedCase.effects) {
				if (effect.kind === "d1" && effect.sql !== undefined)
					texts.add(effect.sql);

				for (const statement of effect.statements ?? [])
					texts.add(statement.sql);

				if (effect.kind === "d1-batch" && effect.statements)
					batches.add(
						JSON.stringify(effect.statements.map((statement) => statement.sql)),
					);
			}
	}

	return { texts, batches };
}

function hookPatterns(): RegExp[] {
	const found = new Map<string, RegExp>();

	for (const corpus of HOOKED) {
		const file = `tests/golden/${corpus}.test.ts`;

		for (const literal of hookPatternsIn(
			file,
			readFileSync(new URL(file, root), "utf8"),
		)) {
			const end = literal.lastIndexOf("/");

			found.set(
				literal,
				new RegExp(literal.slice(1, end), literal.slice(end + 1)),
			);
		}
	}

	return [...found.values()];
}

/** The old texts this block's reads change, each with the new text and why. A hook that picked the old must pick the new. */
const CHANGED = [
	{
		old: "SELECT a.id,a.offer_id,a.request_id,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=? AND a.status='executed' AND a.archive_closed_at IS NULL",
		new: "SELECT a.status,a.archive_closed_at FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=?",
		why: "readOwnerCopy reads the status and archive `ownerCopy` judges, which today's read filtered in SQL",
	},
	{
		old: "SELECT * FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'",
		new: "SELECT status,pdf_key,pdf_sha256 FROM software_agreement_artifacts WHERE agreement_id=?",
		why: "the owner's copy row is the visitor download's `readSignedCopy`, whatever its status, which `ownerCopy` judges",
	},
	{
		old: "SELECT kind FROM owner_requests WHERE id=?",
		new: "SELECT kind,status FROM owner_requests WHERE id=?",
		why: "readUploadRequest reads the kind and status `acceptAttachment` and `refusedUpload` take, before the batch and after a raised guard",
	},
] as const;

/** The texts this block adds, each with why; no hook may pick one, since hooks count their matches. */
const ADDED = [
	{
		sql: "SELECT version FROM software_contractor_config ORDER BY version DESC LIMIT 1",
		why: "VersionChanged's fact for the config, read before the batch A23 re-checks",
	},
	{
		sql: "SELECT token_hash,link_id,expires_at,revoked_at FROM software_agreement_sessions",
		why: "accessCleanup's sessions, read before today's DELETEs",
	},
	{
		sql: "SELECT id,expires_at FROM software_agreement_links",
		why: "accessCleanup's links, read in the same batch as the sessions",
	},
] as const;

/** Runs every function of the block once, each to its end, and answers every text it ran and the texts of each batch. */
async function tour() {
	const world: World = storeWorld();

	world.seed({
		owner_requests: [rows.softwareRequest("r1")],
		software_offers: [rows.softwareOffer("o1", "r1")],
		...rows.agreementBase(),
		software_agreements: [
			rows.agreement("a1", "r1", "o1", { status: "executed" }),
		],
		software_agreement_attachments: [attachment("r1", "att1")],
	});

	const batches: string[] = [];

	const batch = async <A, E>(effect: Effect.Effect<A, E, MusicDb>) => {
		const asked = world.executed.length;

		await world.ok(effect);
		batches.push(JSON.stringify(world.executed.slice(asked)));
	};

	await world.ok(readCurrentTemplate("msa"));
	await world.ok(readTemplateVersion("msa", 1));
	await world.ok(readLabelUse("msa", "m1"));
	await batch(publishBatch(publication({ version: 2 })));
	await world.ok(readNewestContractorConfig());
	await batch(saveContractorBatch(contractorSave(0)));
	await world.ok(saveSetting({ enabled: true, at: AT, actor: OWNER }));
	await world.ok(readAccessRows());
	await batch(cleanupBatch({ before: at(-30 * DAY) }));
	await world.ok(readSigningEnabled());
	await world.ok(readUploadRequest("r1"));
	await batch(insertAttachment(attachment("r1")));
	await world.ok(readAttachmentSaved("f-new"));
	await world.ok(readOwnerAttachment("att1", "r1"));
	await world.ok(readOwnerCopy("a1"));
	await world.ok(readSignedCopy("a1"));

	return { texts: new Set(world.executed), batches };
}

describe("the block's SQL against the golden corpora", () => {
	it("runs only texts today's routes ran, and the changed and added texts listed", async () => {
		const { texts } = recorded();
		const ran = await tour();

		const listed = new Set<string>([
			...CHANGED.map((change) => change.new),
			...ADDED.map((added) => added.sql),
		]);

		expect(
			[...ran.texts].filter((text) => !texts.has(text) && !listed.has(text)),
		).toEqual([]);

		for (const change of CHANGED) {
			expect(ran.texts.has(change.new), change.why).toBe(true);
			expect(texts.has(change.old), change.why).toBe(true);
			expect(texts.has(change.new), change.why).toBe(false);
		}

		for (const added of ADDED) {
			expect(ran.texts.has(added.sql), added.why).toBe(true);
			expect(texts.has(added.sql), added.why).toBe(false);
		}
	});

	it("runs each write batch's statements in the order today's routes ran them", async () => {
		const { batches } = recorded();
		const ran = await tour();

		expect(ran.batches).toHaveLength(4);
		expect(ran.batches.filter((sql) => !batches.has(sql))).toEqual([]);
	});

	it("leaves every hook's count as it was: a changed text matches the patterns its old text matched, an added one none", () => {
		const patterns = hookPatterns();

		const matching = (sql: string) =>
			patterns.filter((pattern) => pattern.test(sql)).map(String);

		expect(patterns.length).toBeGreaterThan(20);

		for (const change of CHANGED) {
			expect(matching(change.new), change.why).toEqual(matching(change.old));
			// The trigger-hit marker a hook writes names the statement's operation, table and access.
			expect(statementOf(change.new), change.why).toEqual(
				statementOf(change.old),
			);
		}

		for (const added of ADDED)
			expect(matching(added.sql), added.why).toEqual([]);
	});
});
