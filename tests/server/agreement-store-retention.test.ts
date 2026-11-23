import { readFileSync } from "node:fs";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import { statementOf } from "../../scripts/sql-effects.mjs";
import { isText } from "../../src/lib/type-guards";
import {
	AgreementStoreFailed,
	type ClosingAgreement,
	closeRetiringArchive,
	deleteUnattachedRow,
	deleteUnusedClients,
	readOfferReferences,
	readOrphanReferences,
	readProjectEvidence,
	readRetainedAgreements,
	readRetentionFacts,
	readSharedReferences,
	readUnattachedFacts,
	readUnattachedRow,
	reserveOrphan,
	restoreUnattachedRow,
	retireAgreementRows,
} from "../../src/server/agreement-store";
import { GuardRefused } from "../../src/server/guarded-save";
import {
	namedByAgreement,
	orphanUnreferenced,
	pinnedByOpenOffer,
	retentionEligible,
	retentionRetiring,
	type UnattachedAttachment,
	unattachedRowKept,
	unattachedToDelete,
	unattachedUnchanged,
} from "../../src/server/rules/agreement-retention";
import { MusicDb } from "../../src/server/services";
import { boundStatement } from "../helpers/d1";
import { double } from "../helpers/doubles";
import { hookPatternsIn } from "../helpers/offers-golden";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";
import {
	agreementTables,
	attachmentKey,
	attachmentRow,
	detailsJson,
	EARLIER,
	evidenceOf,
	LONG_AGO,
	manifestJson,
	merge,
	msaAgreement,
	NOW,
	PDF,
	PDF_SHA,
	projectSql,
	sowScene,
} from "../golden/areas/agreement-admin";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";

// The retention store (src/server/agreement-store.ts, "retention") against the real schema on node:sqlite, held to what
// today's code (src/lib/agreement-retention.ts) did, as the golden corpora recorded it
// (tests/golden/owner-agreements-retention-preview.test.ts and -apply.test.ts, and their fixtures):
//
// - each read gives the rules (src/server/rules/agreement-retention.ts) the facts on which they answer what today's SQL
//   answered, on the scenes the corpora's headers list; today's SQL is the text the fixtures recorded, run on the same
//   database. Today's eligibility query is two reads here: the scan, which reads no text column of the agreements, and
//   the full rows of the ones the rule chose;
// - each batch and kept statement replays a recorded case of the apply corpus: the same SQL, statement for statement,
//   with the same binds, the same outcome, and the same refusal (a raised guard is GuardRefused, an outage
//   AgreementStoreFailed with its cause);
// - every SQL text the store runs is one today's code ran, or replaces one in a way the corpora's hooks cannot tell
//   apart (the same hooks meet the call, naming the same operation and table), except where listed below with the reason.

const DAY = 86_400_000;
const AT = NOW;
const now = new Date(AT);
const cutoff = new Date(now.getTime() - 30 * DAY).toISOString();

// ---------------------------------------------------------------------------------------------------------------------
// The recordings of the two corpora.

type Outcome = { readonly rows: number; readonly changes: number };

type RecordedStatement = {
	readonly sql: string;
	readonly args: readonly unknown[];
	readonly outcome?: Outcome | { readonly threw: string };
};

type RecordedEffect = {
	readonly kind: string;
	readonly step?: number;
	readonly via?: string;
	readonly sql?: string;
	readonly args?: readonly unknown[];
	readonly outcome?: Outcome | { readonly threw: string };
	readonly result?: string;
	readonly statements?: readonly RecordedStatement[];
};

type RecordedCase = {
	readonly name: string;
	readonly steps: readonly { readonly request: { readonly body: string } }[];
	readonly effects: readonly RecordedEffect[];
};

const CORPORA = ["preview", "apply"] as const;

const recordings = new Map(
	CORPORA.map((corpus) => [
		corpus,
		// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases in the shape above.
		JSON.parse(
			gunzipSync(
				readFileSync(
					new URL(
						`../golden/fixtures/owner-agreements-retention-${corpus}.json.gz`,
						import.meta.url,
					),
				),
			).toString("utf8"),
		) as RecordedCase[],
	]),
);

const allRecorded = CORPORA.flatMap((corpus) => recordings.get(corpus) ?? []);

/** Every SQL text run alone, and every batch's texts in order (as JSON), across both corpora. */
const recordedSingles = new Set<string>();
const recordedBatches = new Set<string>();

for (const recorded of allRecorded)
	for (const effect of recorded.effects) {
		if (effect.kind === "d1" && effect.sql !== undefined)
			recordedSingles.add(effect.sql);

		if (effect.kind === "d1-batch" && effect.statements)
			recordedBatches.add(
				JSON.stringify(effect.statements.map((statement) => statement.sql)),
			);
	}

/** The one text today's code ran alone that starts so. */
function todaysText(start: string): string {
	const found = [...recordedSingles].filter((sql) => sql.startsWith(start));
	const [text] = found;

	if (found.length !== 1 || text === undefined)
		throw new Error(`${found.length} recorded texts start "${start}".`);

	return text;
}

const TODAY = {
	preview: todaysText("SELECT a.* FROM software_agreements a WHERE"),
	shared: todaysText("SELECT 1 FROM software_agreements other,"),
	offered: todaysText("SELECT 1 FROM software_offers o,json_each"),
	evidence: todaysText(
		"SELECT request_id,external_signature_details_json FROM software_projects",
	),
	unattached: todaysText("SELECT attachment.id,attachment.object_key AS key"),
	orphan: todaysText("SELECT 1 WHERE"),
	metadata: todaysText("SELECT id,request_id,filename"),
};

function recordedCase(corpus: (typeof CORPORA)[number], name: string) {
	const found = recordings.get(corpus)?.find((one) => one.name === name);

	if (!found) throw new Error(`No recorded ${corpus} case named "${name}".`);

	return found;
}

/** The manifest a recorded apply step sent. */
function sentManifest(recorded: RecordedCase, step = 1) {
	// SAFETY: an apply step's body is the JSON the harness built with `applying` (tests/golden/areas/agreement-admin.ts).
	return JSON.parse(recorded.steps[step]?.request.body ?? "{}").manifest as {
		agreements: ClosingAgreement[];
		unattached_attachments: UnattachedAttachment[];
		orphan_attachments: { key: string }[];
	};
}

/** The recorded batches of a step that contain a statement starting so, in order. */
const recordedBatchesOf = (recorded: RecordedCase, start: string, step = 1) =>
	recorded.effects.filter(
		(effect) =>
			effect.step === step &&
			effect.kind === "d1-batch" &&
			effect.statements?.some((statement) => statement.sql.startsWith(start)),
	);

const argsOf = (batch: RecordedEffect | undefined, start: string) =>
	batch?.statements?.find((statement) => statement.sql.startsWith(start))
		?.args ?? [];

const textArg = (args: readonly unknown[], index: number) => {
	const value = args[index];

	if (!isText(value)) throw new Error(`Argument ${index} is not text.`);

	return value;
};

/** What a write call did, compared by SQL, binds, whether a batch committed, and each statement's outcome when it did. */
type Write =
	| {
			readonly kind: "d1";
			readonly via: string;
			readonly sql: string;
			readonly args: readonly unknown[];
			readonly outcome?: unknown;
	  }
	| {
			readonly kind: "d1-batch";
			readonly committed: boolean;
			readonly statements: readonly {
				readonly sql: string;
				readonly args: readonly unknown[];
				readonly outcome?: unknown;
			}[];
	  };

/** A recorded step's writes: every batch, and every statement run alone that is not a read (reads are the flow's to replay). */
function recordedWrites(recorded: RecordedCase, step = 1): Write[] {
	return recorded.effects.flatMap((effect): Write[] => {
		if (effect.step !== step) return [];

		if (effect.kind === "d1-batch") {
			const committed = effect.result === "committed";

			return [
				{
					kind: "d1-batch",
					committed,
					statements: (effect.statements ?? []).map((statement) => ({
						sql: statement.sql,
						args: statement.args,
						outcome: committed ? statement.outcome : undefined,
					})),
				},
			];
		}

		return effect.kind === "d1" &&
			effect.sql !== undefined &&
			!/^\s*SELECT/i.test(effect.sql)
			? [
					{
						kind: "d1",
						via: effect.via ?? "",
						sql: effect.sql,
						args: effect.args ?? [],
						outcome: effect.outcome,
					},
				]
			: [];
	});
}

// ---------------------------------------------------------------------------------------------------------------------
// A world: the real schema, every statement recorded, and optionally one statement failing when asked to.

type Logged =
	| {
			kind: "d1";
			via: "first" | "all" | "run";
			sql: string;
			args: SQLInputValue[];
			outcome: Outcome;
	  }
	| {
			kind: "d1-batch";
			committed: boolean;
			statements: { sql: string; args: SQLInputValue[]; outcome?: Outcome }[];
	  };

function retentionWorld(fail?: {
	readonly on: RegExp;
	readonly message: string;
}) {
	const sql = freshMusicDb();
	const log: Logged[] = [];
	let batching = false;

	const single = <T>(
		via: "first" | "all" | "run",
		query: string,
		args: SQLInputValue[],
		run: () => T,
		outcome: (answer: T) => Outcome,
	) => {
		const answer = run();

		if (!batching)
			log.push({ kind: "d1", via, sql: query, args, outcome: outcome(answer) });

		return answer;
	};

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			if (fail?.on.test(query)) throw new Error(fail.message);

			const statement = sql.prepare(query);

			// SAFETY: get, all and run are overloaded for named parameters; the store passes positional ones only, and each runs the real statement with exactly the arguments given.
			return double<StatementSync>({
				get: ((...args: SQLInputValue[]) =>
					single(
						"first",
						query,
						args,
						() => statement.get(...args),
						(row) => ({ rows: row === undefined ? 0 : 1, changes: 0 }),
					)) as StatementSync["get"],
				all: ((...args: SQLInputValue[]) =>
					single(
						"all",
						query,
						args,
						() => statement.all(...args),
						(found) => ({ rows: found.length, changes: 0 }),
					)) as StatementSync["all"],
				run: ((...args: SQLInputValue[]) =>
					single(
						"run",
						query,
						args,
						() => statement.run(...args),
						(result) => ({ rows: 0, changes: Number(result.changes) }),
					)) as StatementSync["run"],
			});
		},
		exec: (query: string) => {
			if (query === "BEGIN") batching = true;

			if (query === "COMMIT" || query === "ROLLBACK") batching = false;

			sql.exec(query);
		},
	});

	const inner = sqliteD1(recording);

	const db = double<D1Database>({
		prepare: (query: string) => inner.prepare(query),
		// SAFETY: batch() is generic over the row type; this records the statements and returns what the sqlite binding answered, unchanged.
		batch: (async (items: D1PreparedStatement[]) => {
			const entry: Logged = {
				kind: "d1-batch",
				committed: false,
				statements: items.map((item) => {
					const { query, args } = boundStatement(item);

					return { sql: query, args };
				}),
			};

			log.push(entry);
			const results = await inner.batch(items);

			entry.committed = true;
			results.forEach((result, index) => {
				const statement = entry.statements[index];

				if (statement)
					statement.outcome = {
						rows: result.results.length,
						changes: result.meta.changes ?? 0,
					};
			});

			return results;
		}) as D1Database["batch"],
	});

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		log,
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		/** Stores the shared tables and the scenes, one after the other (a scene's rows can need an earlier scene's). */
		seed: (...scenes: readonly Seed[]) => {
			for (const [index, scene] of scenes.entries())
				seed(sql, index === 0 ? merge(agreementTables(), scene) : scene);
		},
		/** Rows today's SQL reads, run on the same database. */
		today: (query: string, ...args: SQLInputValue[]) =>
			sql.prepare(query).all(...args),
		/** Whether today's lookup (`first()`) finds a row. */
		found: (query: string, ...args: SQLInputValue[]) =>
			sql.prepare(query).get(...args) !== undefined,
		/** The writes logged so far, as `recordedWrites` gives a recording's. */
		writes: (): Write[] =>
			log.flatMap((entry): Write[] =>
				entry.kind === "d1-batch"
					? [
							{
								kind: "d1-batch",
								committed: entry.committed,
								statements: entry.statements.map((statement) => ({
									sql: statement.sql,
									args: statement.args,
									outcome: entry.committed ? statement.outcome : undefined,
								})),
							},
						]
					: /^\s*SELECT/i.test(entry.sql)
						? []
						: [entry],
			),
	};
}

type World = ReturnType<typeof retentionWorld>;

const decided = <W>(answer: Effect.Effect<W, never>) => Effect.runSync(answer);

const succeeds = <W, E>(answer: Effect.Effect<W, E>) =>
	Effect.runSync(
		Effect.match(answer, { onFailure: () => false, onSuccess: () => true }),
	);

/** Seeds that hang off the retiring scene: a second request with an offer, its project, an MSA. */
const requestWith = (
	n: number,
	offer: { [column: string]: string | number | null } = {},
) => ({
	owner_requests: [rows.softwareRequest(`r${n}`)],
	software_offers: [rows.softwareOffer(`o${n}`, `r${n}`, offer)],
});

const request2 = (offer: { [column: string]: string | number | null } = {}) =>
	requestWith(2, offer);

const project = (
	requestId: string,
	offerId: string,
	over: { [column: string]: string | number | null } = {},
): Seed => ({
	software_projects: [rows.softwareProject(requestId, offerId, over)],
});

const withAttachments = (n: number, ...keys: readonly string[]) =>
	sowScene(n, {
		agreement: {
			attachment_manifest_json: manifestJson(
				...keys.map((key) => ({ key, sha256: PDF_SHA })),
			),
		},
	});

const msaReusedBy = (status: string, ...extra: Seed[]) =>
	merge(
		{ software_agreements: [msaAgreement("m1")] },
		request2({ status, reused_msa_id: "m1" }),
		...extra,
	);

// ---------------------------------------------------------------------------------------------------------------------

describe("the retention facts", () => {
	// The preview corpus's eligibility scenes (its header): every one, and the limit of 20 in id order. A shape whose rows
	// refer to each other across tables is stored in steps.
	const scenes: readonly (readonly [string, Seed | readonly Seed[]])[] = [
		["an eligible SOW", sowScene(1)],
		[
			"an abandoned SOW",
			sowScene(1, {
				agreement: {
					status: "abandoned",
					abandoned_at: "2026-11-01T00:00:00.000Z",
				},
			}),
		],
		[
			"a client-signed SOW",
			sowScene(1, { agreement: { status: "client_signed" } }),
		],
		[
			"a SOW that has not ended",
			sowScene(1, { agreement: { ended_at: null } }),
		],
		[
			"retain_until is the instant",
			sowScene(1, { agreement: { retain_until: AT } }),
		],
		[
			"retain_until is a millisecond after",
			sowScene(1, { agreement: { retain_until: "2026-11-13T12:00:00.001Z" } }),
		],
		["no retain_until", sowScene(1, { agreement: { retain_until: null } })],
		["a legal hold", sowScene(1, { agreement: { legal_hold: 1 } })],
		[
			"a rendering artifact",
			merge(sowScene(1), {
				software_agreement_artifacts: [
					{ agreement_id: "a1", status: "rendering" },
				],
			}),
		],
		[
			"a sending delivery and a sent notification",
			merge(sowScene(1), {
				software_agreement_deliveries: [
					{
						agreement_id: "a1",
						recipient_role: "client",
						email: "grace@example.test",
						status: "sending",
					},
				],
				software_agreement_notifications: [
					{
						agreement_id: "a1",
						kind: "signature-receipt",
						email: "grace@example.test",
						status: "sent",
					},
				],
			}),
		],
		[
			"a sending notification",
			merge(sowScene(1), {
				software_agreement_notifications: [
					{
						agreement_id: "a1",
						kind: "countersign-notice",
						email: "grace@example.test",
						status: "sending",
					},
				],
			}),
		],
		["a live project of its offer", merge(sowScene(1), project("r1", "o1"))],
		[
			"a project of its offer whose content was deleted",
			merge(
				sowScene(1),
				project("r1", "o1", {
					content_deleted_at: EARLIER,
					external_signature_details_json: "{}",
				}),
			),
		],
		[
			"a live project of another offer that names it",
			merge(
				sowScene(1),
				request2(),
				project("r2", "o2", { agreement_id: "a1" }),
			),
		],
		[
			"an MSA without signatures",
			{ software_agreements: [msaAgreement("m1")] },
		],
		[
			"a signed MSA that is not terminated",
			merge({ software_agreements: [msaAgreement("m1")] }, evidenceOf("m1")),
		],
		[
			"a terminated signed MSA",
			merge(
				{
					software_agreements: [
						msaAgreement("m1", { terminated_at: "2026-11-01T00:00:00.000Z" }),
					],
				},
				evidenceOf("m1"),
			),
		],
		[
			"an MSA a SOW names",
			[
				{ software_agreements: [msaAgreement("m1")] },
				sowScene(1, { agreement: { msa_id: "m1" } }),
			],
		],
		["an MSA a sent offer reuses", msaReusedBy("sent")],
		["an MSA a draft offer reuses", msaReusedBy("draft")],
		["an MSA a superseded offer reuses", msaReusedBy("superseded")],
		[
			"an MSA a sent offer with a deleted project reuses",
			msaReusedBy("sent", project("r2", "o2", { content_deleted_at: EARLIER })),
		],
		[
			"an MSA a superseded offer with a live project reuses",
			msaReusedBy("superseded", project("r2", "o2")),
		],
		[
			"an MSA a superseded offer with an SOW reuses",
			[
				{ software_agreements: [msaAgreement("m1")] },
				sowScene(2, { offer: { status: "superseded", reused_msa_id: "m1" } }),
			],
		],
		[
			"25 eligible SOWs",
			merge(
				...Array.from({ length: 25 }, (_, index) =>
					sowScene(index + 1, {
						agreement: { id: `a${String(25 - index).padStart(3, "0")}` },
					}),
				),
			),
		],
	];

	/** The two reads and the two stages of the choice, as the flow will run them; `between` runs between the reads. */
	async function retiringOf(world: World, between?: () => void) {
		const facts = await world.ok(readRetentionFacts());
		const chosen = decided(retentionEligible.decide({ now }, facts));

		between?.();

		const rows = await world.ok(readRetainedAgreements(chosen));

		return {
			chosen,
			retiring: decided(
				retentionRetiring.decide({ now, chosen }, { ...facts, rows }),
			),
		};
	}

	it.each(scenes)(
		"choose what today's eligibility query chose, every column of each row: %s",
		async (name, scene) => {
			const world = retentionWorld();

			world.seed(...(Array.isArray(scene) ? scene : [scene]));

			const { chosen, retiring } = await retiringOf(world);
			const today = world.today(TODAY.preview, AT).map((row) => ({ ...row }));

			expect(chosen, name).toEqual(today.map((row) => row.id));
			// The rows the flow hashes into `row_hash` are today's rows, column for column, value for value.
			expect(
				retiring.map((row) => ({ ...row })),
				name,
			).toStrictEqual(today);
		},
	);

	/** The columns of software_agreements, as the schema has them. */
	const agreementColumns = (world: World) =>
		world
			.today("SELECT name FROM pragma_table_info('software_agreements')")
			.map((column) => String(column.name));

	/** What the scan reads of each agreement: the condition's columns and the text's digest (`RetentionAgreementRow`). */
	const SCANNED = [
		"id",
		"kind",
		"offer_id",
		"msa_id",
		"status",
		"text_sha256",
		"ended_at",
		"retain_until",
		"legal_hold",
		"terminated_at",
	];

	it("scan no text column of the agreements: not canonical_text, values_json or attachment_manifest_json", async () => {
		const world = retentionWorld();

		world.seed(sowScene(1));
		await world.ok(readRetentionFacts());

		const [batch] = world.log;
		const scan = batch?.kind === "d1-batch" ? batch.statements[0]?.sql : "";

		// What the statement itself returns on the real schema, before any reader drops a column.
		const [returned] = world.today(scan ?? "");

		expect(Object.keys(returned ?? {})).toEqual(SCANNED);

		const left = agreementColumns(world).filter(
			(column) => !SCANNED.includes(column),
		);

		expect(left).toEqual(
			expect.arrayContaining([
				"canonical_text",
				"values_json",
				"attachment_manifest_json",
			]),
		);

		for (const column of [...left, "*"])
			expect(scan, column).not.toContain(column);
	});

	it("read the chosen agreements' full rows, every column, in id order, without one that is gone", async () => {
		const world = retentionWorld();

		world.seed({ software_agreements: [msaAgreement("m1")] }, sowScene(1));

		const full = await world.ok(readRetainedAgreements(["m1", "gone", "a1"]));

		expect(full.map((row) => row.id)).toEqual(["a1", "m1"]);

		for (const row of full)
			expect(Object.keys(row).sort()).toEqual(agreementColumns(world).sort());

		expect(full).toStrictEqual(
			world
				.today("SELECT * FROM software_agreements ORDER BY id")
				.map((row) => ({ ...row })),
		);
		expect(await world.ok(readRetainedAgreements([]))).toEqual([]);
	});

	it("between the two reads: an agreement put on hold is skipped, one whose archive another apply is closing kept as read", async () => {
		const world = retentionWorld();

		world.seed(sowScene(1), sowScene(2), sowScene(3));

		const { chosen, retiring } = await retiringOf(world, () =>
			world.sql.exec(
				`UPDATE software_agreements SET legal_hold=1 WHERE id='a1';
				UPDATE software_agreements SET archive_closed_at='${EARLIER}' WHERE id='a2'`,
			),
		);

		expect(chosen).toEqual(["a1", "a2", "a3"]);
		// a2 as read the second time, its archive_closed_at set: its `row_hash` will be of that row.
		expect(retiring).toStrictEqual(
			world
				.today(
					"SELECT * FROM software_agreements WHERE id IN ('a2','a3') ORDER BY id",
				)
				.map((row) => ({ ...row })),
		);
		expect(
			world.found(
				"SELECT 1 FROM software_agreements WHERE id='a2' AND archive_closed_at=?",
				EARLIER,
			),
		).toBe(true);
	});

	it("read the columns the condition reads of every agreement, and every row of the tables the condition looks at", async () => {
		const world = retentionWorld();

		world.seed(
			{ software_agreements: [msaAgreement("m1")] },
			merge(
				sowScene(1),
				evidenceOf("a1"),
				request2({ status: "sent", reused_msa_id: "m1" }),
				project("r2", "o2", {
					agreement_id: "a1",
					content_deleted_at: EARLIER,
				}),
			),
		);

		const facts = await world.ok(readRetentionFacts());

		for (const agreement of facts.agreements)
			expect(Object.keys(agreement)).toEqual(SCANNED);

		expect(facts.agreements.map((row) => row.id).sort()).toEqual(["a1", "m1"]);
		expect(facts.artifacts).toEqual([{ agreement_id: "a1", status: "ready" }]);
		expect(facts.deliveries).toEqual([{ agreement_id: "a1", status: "sent" }]);
		expect(facts.notifications).toEqual([
			{ agreement_id: "a1", status: "sent" },
		]);
		expect(facts.signatures).toEqual([{ agreement_id: "a1" }]);
		expect(facts.offers).toEqual([
			{ id: "o1", status: "superseded", reused_msa_id: null },
			{ id: "o2", status: "sent", reused_msa_id: "m1" },
		]);
		expect(facts.projects).toEqual([
			{
				request_id: "r2",
				offer_id: "o2",
				agreement_id: "a1",
				external_signature_details_json: null,
				content_deleted_at: EARLIER,
			},
		]);
	});

	it("read the project evidence with today's statement", async () => {
		const world = retentionWorld();

		world.seed(
			merge(
				sowScene(1),
				{ owner_requests: [rows.softwareRequest("r0")] },
				project("r1", "o1", {
					content_deleted_at: EARLIER,
					external_signature_details_json: '{"signed":"elsewhere"}',
				}),
				project("r0", "o1", { content_deleted_at: EARLIER }),
			),
		);

		expect(await world.ok(readProjectEvidence("o1"))).toEqual(
			world.today(TODAY.evidence, "o1").map((row) => ({ ...row })),
		);
		expect(await world.ok(readProjectEvidence(null))).toEqual([]);
		expect(world.log.map((entry) => entry.kind === "d1" && entry.sql)).toEqual([
			TODAY.evidence,
			TODAY.evidence,
		]);
	});
});

describe("the references to a retiring agreement's attachments", () => {
	const att1 = attachmentKey("att1");
	const other = attachmentKey("other");

	// The preview corpus's object scenes: shared with a kept agreement, pinned by an active offer, shared by two retiring
	// agreements; and offers that do not pin (a project, superseded, details whose items are odd).
	const scenes: readonly (readonly [string, Seed])[] = [
		["an attachment no one else names", withAttachments(1, att1)],
		[
			"an attachment shared with a kept agreement",
			merge(
				withAttachments(1, att1),
				sowScene(2, {
					agreement: {
						legal_hold: 1,
						attachment_manifest_json: manifestJson({
							key: att1,
							sha256: PDF_SHA,
						}),
					},
				}),
			),
		],
		[
			"an attachment shared by two retiring agreements",
			merge(withAttachments(1, att1, other), withAttachments(2, att1)),
		],
		[
			"an attachment an active offer pins",
			merge(
				withAttachments(1, att1),
				request2({ status: "sent", agreement_details_json: detailsJson(att1) }),
			),
		],
		[
			"an attachment a draft offer names twice",
			merge(
				withAttachments(1, att1),
				request2({
					status: "draft",
					agreement_details_json: detailsJson(att1, att1),
				}),
			),
		],
		[
			"an attachment a sent offer with a project names",
			merge(
				withAttachments(1, att1),
				request2({ status: "sent", agreement_details_json: detailsJson(att1) }),
				project("r2", "o2"),
			),
		],
		[
			"an attachment a superseded offer names",
			merge(
				withAttachments(1, att1),
				request2({
					status: "superseded",
					agreement_details_json: detailsJson(att1),
				}),
			),
		],
		[
			"an offer whose details have odd items",
			merge(
				withAttachments(1, att1),
				request2({
					status: "sent",
					agreement_details_json:
						'{"attachments":["text",{"key":null},{"key":7}]}',
				}),
			),
		],
	];

	it.each(scenes)(
		"answer today's shared-attachment and active-offer lookups: %s",
		async (name, scene) => {
			const world = retentionWorld();

			world.seed(scene);

			const facts = await world.ok(readRetentionFacts());

			const retiring = decided(retentionEligible.decide({ now }, facts));

			expect(retiring.length, name).toBeGreaterThan(0);

			for (const key of [att1, other, "agreements/a1/signed.pdf"]) {
				const agreements = await world.ok(readSharedReferences(retiring, key));
				const offers = await world.ok(readOfferReferences(key));

				expect(
					namedByAgreement(key, { agreements, offers: [] }, (id) =>
						retiring.includes(id),
					),
					`${name}: ${key} shared`,
				).toBe(world.found(TODAY.shared, JSON.stringify(retiring), key));

				expect(
					pinnedByOpenOffer(key, { agreements: [], offers }),
					`${name}: ${key} pinned`,
				).toBe(world.found(TODAY.offered, key));
			}
		},
	);

	it("read one row per naming item, with the offer's status and its projects", async () => {
		const world = retentionWorld();

		world.seed(
			merge(
				withAttachments(1, att1),
				sowScene(2, {
					agreement: {
						legal_hold: 1,
						attachment_manifest_json: manifestJson(
							{ key: att1, sha256: PDF_SHA },
							{ key: att1, sha256: PDF_SHA },
						),
					},
				}),
				requestWith(3, {
					status: "sent",
					agreement_details_json: detailsJson(att1, att1),
				}),
				project("r3", "o3"),
			),
		);

		expect(await world.ok(readSharedReferences(["a1"], att1))).toEqual([
			{ agreement_id: "a2", key: att1 },
			{ agreement_id: "a2", key: att1 },
		]);
		expect(await world.ok(readOfferReferences(att1))).toEqual([
			{ offer_id: "o3", status: "sent", key: att1, projects: 1 },
			{ offer_id: "o3", status: "sent", key: att1, projects: 1 },
		]);
	});
});

describe("the unattached PDFs", () => {
	const u1 = attachmentKey("u1");

	const unattached = (...extra: Seed[]) =>
		merge(
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [attachmentRow("u1", "r1")],
			},
			...extra,
		);

	// The preview corpus's unattached scenes: old, young, at the 30 day boundary, referenced, pinned, the limit of 100.
	const scenes: readonly (readonly [string, Seed])[] = [
		["an old unattached attachment", unattached()],
		[
			"a young one",
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [
					attachmentRow("u1", "r1", {
						created_at: new Date(now.getTime() - DAY).toISOString(),
					}),
				],
			},
		],
		[
			"one exactly 30 days old",
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [
					attachmentRow("u1", "r1", { created_at: cutoff }),
				],
			},
		],
		[
			"one an agreement names",
			merge(unattached(), {
				software_offers: [rows.softwareOffer("o1", "r1")],
				software_agreements: [
					rows.agreement("a1", "r1", "o1", {
						attachment_manifest_json: manifestJson({
							key: u1,
							sha256: PDF_SHA,
						}),
					}),
				],
			}),
		],
		[
			"one an active offer pins",
			merge(unattached(), {
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "sent",
						agreement_details_json: detailsJson(u1),
					}),
				],
			}),
		],
		[
			"one an offer with a project names",
			merge(
				unattached(),
				{
					software_offers: [
						rows.softwareOffer("o1", "r1", {
							status: "sent",
							agreement_details_json: detailsJson(u1),
						}),
					],
				},
				project("r1", "o1"),
			),
		],
		[
			"105 old ones",
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: Array.from(
					{ length: 105 },
					(_, index) =>
						attachmentRow(`u${String(105 - index).padStart(3, "0")}`, "r1"),
				),
			},
		],
	];

	it.each(scenes)("are today's unattached list: %s", async (name, scene) => {
		const world = retentionWorld();

		world.seed(scene);

		const facts = await world.ok(readUnattachedFacts());

		expect(decided(unattachedToDelete.decide({ now }, facts)), name).toEqual(
			world.today(TODAY.unattached, cutoff).map((row) => ({ ...row })),
		);
	});

	it("read a metadata row by its id, and the rule finds what today's read found", async () => {
		const world = retentionWorld();

		world.seed(unattached());

		const row = await world.ok(readUnattachedRow("u1"));
		const stored = world.today(TODAY.metadata, "u1", u1, PDF_SHA, LONG_AGO)[0];

		expect(row).toEqual({ ...stored });
		expect(await world.ok(readUnattachedRow("u9"))).toBeNull();

		const entry: UnattachedAttachment = {
			id: "u1",
			key: u1,
			sha256: PDF_SHA,
			created_at: LONG_AGO,
		};

		for (const variant of [
			entry,
			{ ...entry, key: attachmentKey("u2") },
			{ ...entry, sha256: "a".repeat(64) },
			{ ...entry, created_at: EARLIER },
			{ ...entry, id: "u9" },
		]) {
			const read = await world.ok(readUnattachedRow(variant.id));

			expect(
				succeeds(unattachedRowKept.decide({ entry: variant }, { row: read })),
				JSON.stringify(variant),
			).toBe(
				world.found(
					TODAY.metadata,
					variant.id,
					variant.key,
					variant.sha256,
					variant.created_at,
				),
			);
		}
	});
});

describe("the orphan reference check", () => {
	const lost = attachmentKey("lost");

	const scenes: readonly (readonly [string, Seed])[] = [
		["an object nothing references", {}],
		[
			"an object with metadata",
			{
				owner_requests: [rows.softwareRequest("r1")],
				software_agreement_attachments: [attachmentRow("lost", "r1")],
			},
		],
		[
			"an object an agreement names",
			sowScene(1, {
				agreement: {
					legal_hold: 1,
					attachment_manifest_json: manifestJson({
						key: lost,
						sha256: PDF_SHA,
					}),
				},
			}),
		],
		[
			"an object an active offer pins",
			request2({ status: "draft", agreement_details_json: detailsJson(lost) }),
		],
		[
			"an object an offer with a project names",
			merge(
				request2({ status: "sent", agreement_details_json: detailsJson(lost) }),
				project("r2", "o2"),
			),
		],
	];

	it.each(scenes)("is today's: %s", async (name, scene) => {
		const world = retentionWorld();

		world.seed(scene);

		const facts = await world.ok(readOrphanReferences(lost));

		expect(
			Option.isSome(decided(orphanUnreferenced.decide({ key: lost }, facts))),
			name,
		).toBe(!world.found(TODAY.orphan, lost, lost, lost));
	});
});

describe("the apply's writes replay today's", () => {
	const seedOf = {
		sow: merge(sowScene(1), evidenceOf("a1")),
		attachment: merge(withAttachments(1, attachmentKey("att1")), {
			software_agreement_attachments: [
				attachmentRow("att1", "r1", { created_at: EARLIER }),
			],
		}),
		two: merge(sowScene(1), sowScene(2), evidenceOf("a1"), evidenceOf("a2")),
		unattached: {
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [attachmentRow("u1", "r1")],
		},
	};

	/** Closes and retires each reviewed agreement as today's loop does, with the recorded ids, hash and time. */
	async function retireAll(world: World, recorded: RecordedCase) {
		const receipts = recordedBatchesOf(
			recorded,
			"INSERT INTO software_agreement_retention_receipts",
		);

		for (const [index, item] of sentManifest(recorded).agreements.entries()) {
			const receipt = argsOf(
				receipts[index],
				"INSERT INTO software_agreement_retention_receipts",
			);

			const event = argsOf(
				receipts[index],
				"INSERT INTO software_agreement_events",
			);

			await world.ok(closeRetiringArchive(item, AT));
			await world.ok(
				retireAgreementRows(item, {
					at: AT,
					receiptId: textArg(receipt, 0),
					manifestHash: textArg(receipt, 4),
					eventId: textArg(event, 0),
				}),
			);
			await world.ok(deleteUnusedClients());
		}
	}

	it.each([
		["a SOW is retired with its objects and rows", seedOf.sow],
		["an agreement with an attachment is retired with it", seedOf.attachment],
		["two agreements are retired one after the other", seedOf.two],
	] as const)("%s", async (name, scene) => {
		const recorded = recordedCase("apply", name);
		const world = retentionWorld();

		world.seed(scene);
		await retireAll(world, recorded);

		expect(world.writes()).toEqual(recordedWrites(recorded));
		expect(world.today("SELECT id FROM software_agreements")).toEqual([]);
	});

	it("an unattached attachment is deleted with its object", async () => {
		const recorded = recordedCase(
			"apply",
			"an unattached attachment is deleted with its object",
		);

		const world = retentionWorld();

		world.seed(seedOf.unattached);

		for (const entry of sentManifest(recorded).unattached_attachments) {
			const row = await world.ok(readUnattachedRow(entry.id));

			const kept = Effect.runSync(unattachedRowKept.decide({ entry }, { row }));

			const { cutoff: at } = Effect.runSync(
				unattachedUnchanged.decide({ entry, now }, { digest: entry.sha256 }),
			);

			expect(kept).toEqual(row);
			await world.ok(deleteUnattachedRow(entry, at));
		}

		expect(world.writes()).toEqual(recordedWrites(recorded));
	});

	it("the bucket refuses to delete an unattached object: the row is put back", async () => {
		const recorded = recordedCase(
			"apply",
			"the bucket refuses to delete an unattached object",
		);

		const world = retentionWorld();

		world.seed(seedOf.unattached);

		const [entry] = sentManifest(recorded).unattached_attachments;

		if (!entry) throw new Error("The recorded manifest has no unattached PDF.");

		const row = await world.ok(readUnattachedRow(entry.id));

		if (!row) throw new Error("The metadata row was not read.");

		await world.ok(deleteUnattachedRow(entry, cutoff));
		await world.ok(restoreUnattachedRow(row));

		expect(world.writes()).toEqual(recordedWrites(recorded));
		expect(await world.ok(readUnattachedRow(entry.id))).toEqual(row);

		// A second restore changes nothing: the row is there.
		await world.ok(restoreUnattachedRow(row));
		expect(world.log.at(-1)).toMatchObject({ outcome: { changes: 0 } });
	});

	it("an orphan object is deleted", async () => {
		const recorded = recordedCase("apply", "an orphan object is deleted");
		const world = retentionWorld();

		world.seed({});

		for (const orphan of sentManifest(recorded).orphan_attachments)
			await world.ok(reserveOrphan(orphan.key));

		expect(world.writes()).toEqual(recordedWrites(recorded));
	});
});

describe("the apply's batches are refused as today", () => {
	const raw =
		(statement: string) =>
		(world: World): void =>
			world.sql.exec(statement);

	it.each([
		[
			"a hold lands just before the closing batch",
			merge(sowScene(1)),
			raw("UPDATE software_agreements SET legal_hold=1 WHERE id='a1'"),
		],
		[
			"a project appears just before the closing batch",
			merge(sowScene(1)),
			raw(projectSql("r1", "o1", ",external_signature_details_json", ",'{}'")),
		],
	] as const)(
		"%s: GuardRefused, nothing changed",
		async (name, scene, race) => {
			const recorded = recordedCase("apply", name);
			const world = retentionWorld();

			world.seed(scene);
			race(world);

			const [item] = sentManifest(recorded).agreements;

			if (!item) throw new Error("The recorded manifest has no agreement.");

			expect(await world.failed(closeRetiringArchive(item, AT))).toBeInstanceOf(
				GuardRefused,
			);
			expect(world.writes()).toEqual(recordedWrites(recorded));
			expect(
				world.today("SELECT archive_closed_at FROM software_agreements"),
			).toEqual([{ archive_closed_at: null }]);
		},
	);

	it("an artifact starts rendering just before the receipts batch: GuardRefused, the archive stays closed", async () => {
		const name = "an artifact starts rendering just before the receipts batch";
		const recorded = recordedCase("apply", name);
		const world = retentionWorld();

		world.seed(merge(sowScene(1), evidenceOf("a1")));

		const [item] = sentManifest(recorded).agreements;

		if (!item) throw new Error("The recorded manifest has no agreement.");

		const [receipts] = recordedBatchesOf(
			recorded,
			"INSERT INTO software_agreement_retention_receipts",
		);

		const receipt = argsOf(
			receipts,
			"INSERT INTO software_agreement_retention_receipts",
		);

		const event = argsOf(receipts, "INSERT INTO software_agreement_events");

		await world.ok(closeRetiringArchive(item, AT));
		raw(
			"UPDATE software_agreement_artifacts SET status='rendering' WHERE agreement_id='a1'",
		)(world);

		expect(
			await world.failed(
				retireAgreementRows(item, {
					at: AT,
					receiptId: textArg(receipt, 0),
					manifestHash: textArg(receipt, 4),
					eventId: textArg(event, 0),
				}),
			),
		).toBeInstanceOf(GuardRefused);
		expect(world.writes()).toEqual(recordedWrites(recorded));
		expect(
			world.today("SELECT archive_closed_at FROM software_agreements"),
		).toEqual([{ archive_closed_at: AT }]);
	});

	it("an offer pins the unattached attachment before the delete batch: GuardRefused, the row kept", async () => {
		const name =
			"an offer pins the unattached attachment before the delete batch";

		const recorded = recordedCase("apply", name);
		const world = retentionWorld();

		world.seed({
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [attachmentRow("u1", "r1")],
			software_offers: [
				rows.softwareOffer("o1", "r1", { status: "superseded" }),
			],
		});

		const [entry] = sentManifest(recorded).unattached_attachments;

		if (!entry) throw new Error("The recorded manifest has no unattached PDF.");

		raw(
			`UPDATE software_offers SET status='sent',agreement_details_json='${detailsJson(attachmentKey("u1"))}' WHERE id='o1'`,
		)(world);

		expect(
			await world.failed(deleteUnattachedRow(entry, cutoff)),
		).toBeInstanceOf(GuardRefused);
		expect(world.writes()).toEqual(recordedWrites(recorded));
		expect(
			world.today("SELECT id FROM software_agreement_attachments"),
		).toEqual([{ id: "u1" }]);
	});

	it("metadata appears for an orphan before its guard: GuardRefused", async () => {
		const name = "metadata appears for an orphan before its guard";
		const recorded = recordedCase("apply", name);
		const world = retentionWorld();

		world.seed({
			owner_requests: [rows.softwareRequest("r1")],
			software_agreement_attachments: [
				attachmentRow("lost", "r1", {
					filename: "l.pdf",
					bytes: PDF.byteLength,
					created_at: EARLIER,
				}),
			],
		});

		const [orphan] = sentManifest(recorded).orphan_attachments;

		if (!orphan) throw new Error("The recorded manifest has no orphan.");

		expect(await world.failed(reserveOrphan(orphan.key))).toBeInstanceOf(
			GuardRefused,
		);
		expect(world.writes()).toEqual(recordedWrites(recorded));
	});
});

describe("an outage", () => {
	const item: ClosingAgreement = {
		id: "a1",
		sha256: "0".repeat(64),
		project_evidence: [],
		objects: [{ key: "agreements/a1/signed.pdf", sha256: "0".repeat(64) }],
	};

	const record = {
		at: AT,
		manifestHash: "f".repeat(64),
		receiptId: "receipt-1",
		eventId: "event-1",
	};

	const entry: UnattachedAttachment = {
		id: "u1",
		key: attachmentKey("u1"),
		sha256: PDF_SHA,
		created_at: LONG_AGO,
	};

	it.each([
		[
			"the scan",
			/^SELECT id,kind,offer_id,msa_id,/,
			() => readRetentionFacts(),
		],
		[
			"the chosen agreements' read",
			/WHERE id IN \(SELECT value FROM json_each/,
			() => readRetainedAgreements(["a1"]),
		],
		[
			"the shared lookup",
			/other\.id NOT IN/,
			() => readSharedReferences(["a1"], "k"),
		],
		[
			"the offer lookup",
			/FROM software_offers o,json_each/,
			() => readOfferReferences("k"),
		],
		[
			"the evidence read",
			/external_signature_details_json FROM software_projects/,
			() => readProjectEvidence("o1"),
		],
		[
			"the unattached read",
			/FROM software_agreement_attachments attachment/,
			() => readUnattachedFacts(),
		],
		["the orphan read", /WHERE object_key=\?/, () => readOrphanReferences("k")],
		[
			"the metadata read",
			/SELECT id,request_id,filename/,
			() => readUnattachedRow("u1"),
		],
		[
			"the closing batch",
			/SET archive_closed_at/,
			() => closeRetiringArchive(item, AT),
		],
		[
			"the receipts batch",
			/INSERT INTO software_agreement_retention_receipts/,
			() => retireAgreementRows(item, record),
		],
		[
			"the clients delete",
			/DELETE FROM software_agreement_clients/,
			() => deleteUnusedClients(),
		],
		[
			"the unattached delete",
			/DELETE FROM software_agreement_attachments WHERE id=\?/,
			() => deleteUnattachedRow(entry, cutoff),
		],
		[
			"the row put back",
			/INSERT OR IGNORE/,
			() =>
				restoreUnattachedRow({
					...entry,
					request_id: "r1",
					filename: "u1.pdf",
					version: "1",
					document_date: "2026-10-01",
					object_key: entry.key,
					bytes: 1,
					created_by: "owner@example.test",
				}),
		],
		[
			"the orphan guard",
			/SELECT CASE WHEN EXISTS\(SELECT 1 WHERE/,
			() => reserveOrphan("k"),
		],
	] as const)(
		"in %s is a store failure carrying its cause",
		async (_name, on, call) => {
			const world = retentionWorld({ on, message: "d1 down" });

			world.seed(
				merge(sowScene(1), {
					software_agreement_attachments: [attachmentRow("u1", "r1")],
				}),
			);

			const failure = await world.failed<unknown, unknown>(call());

			expect(failure).toBeInstanceOf(AgreementStoreFailed);
			expect(failure).toMatchObject({ failure: new Error("d1 down") });
		},
	);
});

describe("the SQL against the golden corpora's hooks", () => {
	const hookFiles = [
		...CORPORA.map(
			(corpus) => `tests/golden/owner-agreements-retention-${corpus}.test.ts`,
		),
		"tests/golden/areas/agreement-admin.ts",
	];

	/** A regular expression literal's text (`/source/flags`) as a RegExp. */
	const regExpOf = (literal: string) => {
		const end = literal.lastIndexOf("/");

		return new RegExp(literal.slice(1, end), literal.slice(end + 1));
	};

	const hooks = [
		...new Set(
			hookFiles.flatMap((file) =>
				hookPatternsIn(
					file,
					readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
				),
			),
		),
	].map((literal) => ({ literal, pattern: regExpOf(literal) }));

	/** What a hook's trigger-hit marker names for one call: the operation and table of each statement it matches. */
	const hits = (pattern: RegExp, sqls: readonly string[]) =>
		sqls.flatMap((sql) => {
			if (!pattern.test(sql)) return [];

			const { op, table, write } = statementOf(sql);

			return [{ op, table, write }];
		});

	/**
	 * Where a call that replaces one of today's reads meets a hook differently, and why. The marker of a hook that fired
	 * there would differ; the cases that fire it are named.
	 */
	const DIFFERENCES = [
		{
			call: "readRetentionFacts",
			hook: String.raw`/SELECT a\.\* FROM software_agreements a/`,
			reason:
				'today\'s eligibility query read `SELECT a.*`; the scan reads only the columns the condition reads, so the pattern of the preview case "the eligibility query fails" and the apply case "the fresh scan during apply fails" (nth: 2) changes in PR 4 to `REPOINTED`\'s, which the scan\'s first statement (the same SELECT on software_agreements) meets',
		},
		{
			call: "readOrphanReferences",
			hook: String.raw`/SELECT 1 WHERE\s+EXISTS/`,
			reason:
				"today's check was one `SELECT 1 WHERE EXISTS(...)` read; the rule needs the rows, so the pattern of the preview case \"the orphan reference check fails\" changes in PR 4 to one the batch's first statement (the metadata read, the same SELECT on software_agreement_attachments) meets",
		},
		{
			call: "readUnattachedFacts",
			hook: "/FROM software_offers o,json_each/",
			reason:
				"the call still counts as one match, but its statement is now the offers read; the one case with this hook fires on its first match, the open-offer lookup",
		},
		{
			call: "readOrphanReferences",
			hook: "/FROM software_offers o,json_each/",
			reason:
				"the call still counts as one match, but its statement is now the offers read; the one case with this hook fires on its first match, the open-offer lookup",
		},
	] as const;

	/** The pattern PR 4 re-points the eligibility hooks to: the scan's statement, and nothing else either corpus runs. */
	const REPOINTED = /^SELECT id,kind,offer_id,msa_id,/;

	/** Reads that replace none of today's: each must meet no hook. */
	const NEW_READS = new Set(["readRetainedAgreements"]);

	it("every hook literal is a pattern of the two corpora", () => {
		expect(hooks.length).toBeGreaterThan(10);

		for (const difference of DIFFERENCES)
			expect(hooks.map((hook) => hook.literal)).toContain(difference.hook);
	});

	it("are today's text, or replace a read so that every hook meets the call as it met today's, except as listed", async () => {
		const world = retentionWorld();
		const lost = attachmentKey("lost");

		world.seed(
			merge(sowScene(1), evidenceOf("a1"), {
				software_agreement_attachments: [attachmentRow("u1", "r1")],
			}),
		);

		const calls: { name: string; sqls: string[] }[] = [];

		const run = async <A, E>(
			name: string,
			effect: Effect.Effect<A, E, MusicDb>,
		) => {
			const before = world.log.length;

			await world.ok(effect);

			for (const entry of world.log.slice(before))
				calls.push({
					name,
					sqls:
						entry.kind === "d1-batch"
							? entry.statements.map((statement) => statement.sql)
							: [entry.sql],
				});
		};

		const item: ClosingAgreement = {
			id: "a1",
			sha256: "0".repeat(64),
			project_evidence: [],
			objects: [
				{ key: "agreements/a1/certificate.pdf", sha256: "0".repeat(64) },
				{ key: "agreements/a1/signed.pdf", sha256: "0".repeat(64) },
			],
		};

		const entry: UnattachedAttachment = {
			id: "u1",
			key: attachmentKey("u1"),
			sha256: PDF_SHA,
			created_at: LONG_AGO,
		};

		await run("readRetentionFacts", readRetentionFacts());
		await run("readRetainedAgreements", readRetainedAgreements(["a1"]));
		await run("readSharedReferences", readSharedReferences(["a1"], lost));
		await run("readOfferReferences", readOfferReferences(lost));
		await run("readProjectEvidence", readProjectEvidence("o1"));
		await run("readUnattachedFacts", readUnattachedFacts());
		await run("readOrphanReferences", readOrphanReferences(lost));
		await run("closeRetiringArchive", closeRetiringArchive(item, AT));
		await run(
			"retireAgreementRows",
			retireAgreementRows(item, {
				at: AT,
				manifestHash: "f".repeat(64),
				receiptId: "receipt-1",
				eventId: "event-1",
			}),
		);
		await run("deleteUnusedClients", deleteUnusedClients());

		const row = await world.ok(readUnattachedRow("u1"));

		if (!row) throw new Error("The metadata row was not read.");

		await run("readUnattachedRow", readUnattachedRow("u1"));
		await run("deleteUnattachedRow", deleteUnattachedRow(entry, cutoff));
		await run("restoreUnattachedRow", restoreUnattachedRow(row));
		await run("reserveOrphan", reserveOrphan(lost));

		// Each read that replaces one of today's, with the text it replaces.
		const replaces = new Map([
			["readRetentionFacts", TODAY.preview],
			["readSharedReferences", TODAY.shared],
			["readOfferReferences", TODAY.offered],
			["readUnattachedFacts", TODAY.unattached],
			["readOrphanReferences", TODAY.orphan],
			["readUnattachedRow", TODAY.metadata],
		]);

		const differences: { call: string; hook: string }[] = [];

		expect(calls.map((call) => call.name)).toEqual([
			"readRetentionFacts",
			"readRetainedAgreements",
			"readSharedReferences",
			"readOfferReferences",
			"readProjectEvidence",
			"readUnattachedFacts",
			"readOrphanReferences",
			"closeRetiringArchive",
			"retireAgreementRows",
			"deleteUnusedClients",
			"readUnattachedRow",
			"deleteUnattachedRow",
			"restoreUnattachedRow",
			"reserveOrphan",
		]);

		for (const call of calls) {
			const today = replaces.get(call.name);

			if (NEW_READS.has(call.name)) {
				// A new read: the same operation and table as the query it completes, and no hook meets it.
				for (const sql of call.sqls) {
					expect(statementOf(sql), call.name).toEqual(
						statementOf(TODAY.preview),
					);
					expect(
						hooks.filter(({ pattern }) => pattern.test(sql)),
						call.name,
					).toEqual([]);
				}

				continue;
			}

			if (today === undefined) {
				// Kept: today's text, and today's statements in today's order.
				if (call.sqls.length === 1 && recordedSingles.has(call.sqls[0] ?? ""))
					continue;

				expect(
					recordedBatches.has(JSON.stringify(call.sqls)),
					`${call.name} runs a batch today's code ran`,
				).toBe(true);

				continue;
			}

			for (const { literal, pattern } of hooks) {
				const now = hits(pattern, call.sqls);
				const then = hits(pattern, [today]);

				if (JSON.stringify(now) !== JSON.stringify(then))
					differences.push({ call: call.name, hook: literal });
			}
		}

		const byName = (left: { call: string; hook: string }, right: typeof left) =>
			`${left.call} ${left.hook}`.localeCompare(`${right.call} ${right.hook}`);

		expect(differences.sort(byName)).toEqual(
			DIFFERENCES.map(({ call, hook }) => ({ call, hook })).sort(byName),
		);

		// The eligibility hooks' new pattern meets the scan's first statement, which reads as today's query did (a SELECT
		// on software_agreements), and no other statement the store runs or either corpus recorded.
		const scan = calls.find((call) => call.name === "readRetentionFacts");

		expect(statementOf(scan?.sqls[0] ?? ""), "the scan").toEqual(
			statementOf(TODAY.preview),
		);
		expect(
			calls.flatMap((call) => call.sqls.filter((sql) => REPOINTED.test(sql))),
		).toEqual([scan?.sqls[0]]);
		expect(
			[
				...recordedSingles,
				...[...recordedBatches].flatMap((batch): string[] => JSON.parse(batch)),
			].filter((sql) => REPOINTED.test(sql)),
		).toEqual([]);
	});
});
