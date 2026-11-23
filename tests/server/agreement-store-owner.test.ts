import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { abandonBlocked } from "../../src/lib/software-deposit-block";
import {
	type AbandonIds,
	AgreementStoreFailed,
	abandonBatch,
	type CountersignIds,
	countersignBatch,
	endBatch,
	holdBatch,
	readAgreement,
	readMsaUse,
	readOfferAgreements,
	readOfferDeposits,
	readSentOffer,
	readSigningEnabled,
	recordCopyBatch,
} from "../../src/server/agreement-store";
import { GuardRefused } from "../../src/server/guarded-save";
import {
	type AbandonWrite,
	abandonSigning,
} from "../../src/server/rules/agreement-abandon";
import {
	countersign,
	type NamedDocument,
} from "../../src/server/rules/agreement-countersign";
import {
	type EndRequest,
	type EndWrite,
	endAgreement,
	endFront,
	holdAgreement,
	recordCopy,
} from "../../src/server/rules/agreement-record";
import { MusicDb } from "../../src/server/services";
import { type BoundStatement, boundStatement, fakeBatch } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import type { JsonValue } from "../helpers/json";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";
import {
	BOTH,
	CLIENT_EMAIL,
	CONTRACTOR,
	clientSigned,
	contractorSignature,
	doc,
	EARLIER,
	executed,
	MSA_HASH,
	MSA_ID,
	OLD_MSA_ID,
	OWNER,
	openLink,
	reusedReady,
	type Scene,
	SOW_HASH,
	SOW_ID,
	SOW_ONLY,
	scene,
} from "../golden/areas/signing";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import { START, uuidFor } from "../golden/harness/determinism";
import * as rows from "../golden/harness/rows";
import type { World } from "../golden/harness/world";

// The owner's actions in the agreement store (src/server/agreement-store.ts, "the owner's actions"): countersign,
// abandon, end, hold and record-alternate-copy, against the real schema on node:sqlite, seeded with the golden corpora's
// own scenes (tests/golden/areas/signing.ts). What each read finds; what each batch writes, held statement for statement
// and value for value to the batch the old route ran in the recorded golden case, with the ids drawn in the order the
// recording drew them; what each guard and constraint refuses (GuardRefused) and what a failed call answers
// (AgreementStoreFailed); the two guards the rules now decide first (A12, A13) against their rules; and every SQL text
// against the golden corpora: recorded, or one of the changed texts listed here, matched by the hook patterns that
// matched the old text, less the ones PR 4 re-points.

const AT = START;

const ENDED = "2026-11-13";

/** A SOW of the offer that was abandoned before. */
const OTHER_SOW = uuidFor(0xc2);

/** The scene of an offer that reuses a ready MSA from an earlier offer: the SOW alone is client-signed. */
const reusing: Scene = {
	reused: reusedReady,
	msa: false,
	sow: doc("client_signed"),
};

/** A world: a golden scene on the real schema; every statement run, and every batch with its values, recorded; one statement failing when asked to. */
async function ownerWorld(
	sc: Scene,
	fail?: { readonly on: RegExp; readonly message: string },
) {
	const sql = freshMusicDb();
	const built = scene(sc);

	seed(sql, built.music?.seed ?? {});
	await built.setup?.(partial<World>({ music: sql }));

	const executed: string[] = [];
	const batches: BoundStatement[][] = [];

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (fail?.on.test(query)) throw new Error(fail.message);

			return sql.prepare(query);
		},
		exec: (query: string) => sql.exec(query),
	});

	const d1 = sqliteD1(recording);

	const db = double<D1Database>({
		prepare: (query: string) => d1.prepare(query),
		batch: fakeBatch((statements) => {
			batches.push(statements.map(boundStatement));

			return d1.batch(statements);
		}),
	});

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		executed,
		batches,
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		/** How the effect ends. */
		exit: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromiseExit(provided(effect)),
		run: (query: string) => sql.exec(query),
		insert: (tables: Seed) => seed(sql, tables),
		all: (query: string, ...args: string[]) => sql.prepare(query).all(...args),
	};
}

type OwnerWorld = Awaited<ReturnType<typeof ownerWorld>>;

// ---- what the golden corpora recorded ----

const CORPORA = [
	"countersign",
	"abandon",
	"end",
	"hold",
	"record-copy",
	"retry-artifact",
	"retry-copy",
	"wire",
] as const;

type RecordedStatement = { readonly sql: string; readonly args: JsonValue[] };

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly RecordedStatement[];
};

type RecordedCase = {
	readonly name: string;
	readonly effects: readonly RecordedEffect[];
};

const root = new URL("../../", import.meta.url);

const recorded = new Map(
	CORPORA.map((corpus) => [
		corpus,
		// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases in the shape above.
		JSON.parse(
			gunzipSync(
				readFileSync(
					new URL(
						`tests/golden/fixtures/owner-request-agreement-${corpus}.json.gz`,
						root,
					),
				),
			).toString("utf8"),
		) as RecordedCase[],
	]),
);

/** The statements and values of the first batch a recorded case ran. */
function recordedBatch(
	corpus: (typeof CORPORA)[number],
	name: string,
): RecordedStatement[] {
	const found = recorded.get(corpus)?.find((c) => c.name === name);

	const batch = found?.effects.find((effect) => effect.kind === "d1-batch");

	if (!batch?.statements)
		throw new Error(`No recorded batch in the ${corpus} case "${name}".`);

	return batch.statements.map(({ sql, args }) => ({ sql, args }));
}

/** A batch the store ran, as the recorder writes one. */
const asRecorded = (batch: BoundStatement[] | undefined) =>
	(batch ?? []).map(({ query, args }) => ({ sql: query, args }));

/** Every SQL text the eight corpora of the owner request route ran, alone or in a batch. */
const recordedTexts = new Set(
	[...recorded.values()].flatMap((cases) =>
		cases.flatMap((c) =>
			c.effects.flatMap((effect) => [
				...(effect.kind === "d1" && effect.sql !== undefined
					? [effect.sql]
					: []),
				...(effect.statements ?? []).map((statement) => statement.sql),
			]),
		),
	),
);

/** A regular expression literal's text (`/source/flags`) as a RegExp. */
function regExpOf(literal: string): RegExp {
	const end = literal.lastIndexOf("/");

	return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

/**
 * Every regular expression literal in the files whose hooks pick this route's statements: the eight corpora, their shared
 * area, and the route's outage tests. A superset of the hook patterns (a hook's `on` is often a helper's parameter here,
 * so the literals are collected wherever they are written).
 */
const HOOK_FILES = [
	...CORPORA.map(
		(corpus) => `tests/golden/owner-request-agreement-${corpus}.test.ts`,
	),
	"tests/golden/areas/signing.ts",
	"tests/api/signing-owner-outages.test.ts",
];

const patterns = HOOK_FILES.flatMap((file) => {
	const literals: string[] = [];

	const visit = (node: ts.Node) => {
		if (ts.isRegularExpressionLiteral(node)) literals.push(node.text);
		ts.forEachChild(node, visit);
	};

	visit(
		ts.createSourceFile(
			file,
			readFileSync(new URL(file, root), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		),
	);

	return literals;
});

/** The literals of the patterns that match a text. */
const matching = (text: string) =>
	[...new Set(patterns)].filter((literal) => regExpOf(literal).test(text));

// ---- the rules' writes, from the store's reads ----

/** The four columns of an agreement of the offer that countersign and abandon read. */
const hashesOf = ({
	id,
	kind,
	status,
	text_sha256,
}: {
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly text_sha256: string;
}) => ({ id, kind, status, text_sha256 });

const idsFrom = (first: number): CountersignIds => ({
	signatureId: uuidFor(first),
	eventId: uuidFor(first + 1),
	obsoleteEventId: uuidFor(first + 2),
});

/** Countersign as the flow will run it: the reads, the rule with the receipt id drawn first, the batch's ids after it. */
async function countersignOf(
	world: OwnerWorld,
	documents: readonly NamedDocument[] = BOTH,
) {
	const offer = await world.ok(readSentOffer("r1"));
	const setting = await world.ok(readSigningEnabled());
	const signingEnabled = setting?.software_signing_enabled ?? null;
	const agreements = await world.ok(readOfferAgreements("o1"));

	const write = Effect.runSync(
		countersign.decide(
			{
				documents,
				typedName: "Kazon Wilson",
				actor: OWNER,
				ip: null,
				userAgent: null,
				at: AT,
				receiptId: uuidFor(1),
			},
			{ offer, signingEnabled, agreements },
		),
	);

	return {
		write,
		ids: write.documents.map((_, index) => idsFrom(2 + index * 3)),
	};
}

const abandonIds = (count: number): AbandonIds[] =>
	Array.from({ length: count }, (_, index) => ({
		eventId: uuidFor(1 + index * 2),
		obsoleteEventId: uuidFor(2 + index * 2),
	}));

/** Abandon as the flow will run it: the reads, then the rule. */
async function abandonOf(
	world: OwnerWorld,
	documents: readonly NamedDocument[] = BOTH,
) {
	const offer = await world.ok(readSentOffer("r1"));
	const agreements = await world.ok(readOfferAgreements("o1"));
	const invoices = await world.ok(readOfferDeposits("o1"));

	return Effect.runSync(
		abandonSigning.decide(
			{
				requestId: "r1",
				documents,
				reason: "The client asked to change the scope",
				actor: OWNER,
				at: AT,
			},
			{ offer, agreements, invoices },
		),
	);
}

/** An end as the flow will run it: the agreement, the offers that reuse it when the front says so, then the rule. */
async function endOf(world: OwnerWorld, agreementId: string) {
	const request: EndRequest = { agreementId, endedOn: ENDED, today: ENDED };
	const agreement = await world.ok(readAgreement(agreementId, "r1"));

	const { readsMsaUse } = Effect.runSync(
		endFront.decide(request, { agreement }),
	);

	const reusingOffers = readsMsaUse
		? await world.ok(readMsaUse(agreementId))
		: [];

	return Effect.runSync(
		endAgreement.decide(request, { agreement, reusingOffers }),
	);
}

/** The offers reuse the MSA: set once the agreements are seeded, which the offers' foreign key needs (as the scene does). */
const reuse = (world: OwnerWorld, offers: readonly string[]) =>
	world.run(
		`UPDATE software_offers SET reused_msa_id='${MSA_ID}' WHERE id IN (${offers.map((offer) => `'${offer}'`).join(",")})`,
	);

const pendingWithLink = clientSigned({
	extra: { software_agreement_links: [openLink] },
});

describe("the batches, against the recorded corpora", () => {
	it("countersigns both documents with the old route's statements and values, ids drawn in its order", async () => {
		const world = await ownerWorld(clientSigned());
		const { write, ids } = await countersignOf(world);

		await world.ok(countersignBatch(write, ids));

		expect(asRecorded(world.batches[0])).toEqual(
			recordedBatch("countersign", "countersign both documents (no mail)"),
		);
		expect(
			world.all(
				"SELECT id,status,executed_at FROM software_agreements ORDER BY kind",
			),
		).toEqual([
			{ id: MSA_ID, status: "executed", executed_at: AT },
			{ id: SOW_ID, status: "executed", executed_at: AT },
		]);
		expect(
			world.all(
				"SELECT agreement_id,recipient_role,email,status FROM software_agreement_deliveries ORDER BY recipient_role",
			),
		).toEqual([
			{
				agreement_id: SOW_ID,
				recipient_role: "client",
				email: CLIENT_EMAIL,
				status: "pending",
			},
			{
				agreement_id: SOW_ID,
				recipient_role: "contractor",
				email: CONTRACTOR.notice_email,
				status: "pending",
			},
		]);
	});

	it("countersigns the SOW alone of an offer that reuses an MSA, A8 second, as recorded", async () => {
		const world = await ownerWorld(reusing);
		const { write, ids } = await countersignOf(world, SOW_ONLY);

		expect(write.reusedMsaId).toBe(OLD_MSA_ID);
		await world.ok(countersignBatch(write, ids));

		const statements = asRecorded(world.batches[0]);

		expect(statements[1]).toEqual({
			sql: "SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL) THEN 1 ELSE json_extract('Project changed. Reload and try again.','$') END",
			args: [OLD_MSA_ID],
		});
		expect(statements).toEqual(
			recordedBatch(
				"countersign",
				"a reused MSA: the SOW alone is countersigned",
			),
		);
	});

	it("abandons both documents with the old route's statements and values", async () => {
		const world = await ownerWorld(pendingWithLink);
		const write = await abandonOf(world);

		await world.ok(abandonBatch(write, abandonIds(2)));

		expect(asRecorded(world.batches[0])).toEqual(
			recordedBatch("abandon", "abandon both documents"),
		);
		expect(
			world.all(
				"SELECT status,abandoned_at,abandoned_reason FROM software_agreements ORDER BY kind",
			),
		).toEqual([
			{
				status: "abandoned",
				abandoned_at: AT,
				abandoned_reason: "The client asked to change the scope",
			},
			{
				status: "abandoned",
				abandoned_at: AT,
				abandoned_reason: "The client asked to change the scope",
			},
		]);
		expect(world.all("SELECT status FROM software_offers")).toEqual([
			{ status: "superseded" },
		]);
		expect(
			world.all("SELECT id,used_at FROM software_agreement_links ORDER BY id"),
		).toEqual([
			{ id: "link-1", used_at: "2026-11-13T10:00:00.000Z" },
			{ id: "link-2", used_at: AT },
		]);
	});

	it("ends the MSA (A13 first) and the SOW (no guard) with the old route's statements and values", async () => {
		const msa = await ownerWorld(executed());

		await msa.ok(endBatch(await endOf(msa, MSA_ID)));

		// The MSA's use is read as a batch of two statements, so the end's batch is the second.
		expect(asRecorded(msa.batches.at(-1))).toEqual(
			recordedBatch("end", "end the MSA today"),
		);

		const sow = await ownerWorld(executed());

		await sow.ok(endBatch(await endOf(sow, SOW_ID)));

		expect(asRecorded(sow.batches[0])).toEqual(
			recordedBatch("end", "end the SOW today"),
		);

		const ended = (world: OwnerWorld) =>
			world.all(
				"SELECT kind,ended_at,retain_until,terminated_at FROM software_agreements ORDER BY kind",
			);

		expect(ended(msa)).toEqual([
			{
				kind: "msa",
				ended_at: ENDED,
				retain_until: "2036-11-13T12:00:00.000Z",
				terminated_at: ENDED,
			},
			{ kind: "sow", ended_at: null, retain_until: null, terminated_at: null },
		]);
		expect(ended(sow)).toEqual([
			{ kind: "msa", ended_at: null, retain_until: null, terminated_at: null },
			{
				kind: "sow",
				ended_at: ENDED,
				retain_until: "2036-11-13T12:00:00.000Z",
				terminated_at: null,
			},
		]);
	});

	it("puts a hold and records a copy with the old route's statements and values", async () => {
		const hold = await ownerWorld(executed());
		const held = await hold.ok(readAgreement(SOW_ID, "r1"));

		const write = Effect.runSync(
			holdAgreement.decide(
				{ agreementId: SOW_ID, held: true, actor: OWNER, at: AT },
				{ agreement: held },
			),
		);

		await hold.ok(holdBatch(write, uuidFor(1)));

		expect(asRecorded(hold.batches[0])).toEqual(
			recordedBatch("hold", "place a hold"),
		);

		const copy = await ownerWorld(executed());
		const agreement = await copy.ok(readAgreement(SOW_ID, "r1"));

		const recordWrite = Effect.runSync(
			recordCopy.decide(
				{
					agreementId: SOW_ID,
					role: "client",
					method: "Courier, signed in person",
					actor: OWNER,
					at: AT,
				},
				{ agreement },
			),
		);

		await copy.ok(recordCopyBatch(recordWrite, uuidFor(1)));

		expect(asRecorded(copy.batches[0])).toEqual(
			recordedBatch("record-copy", "record the client's alternate copy"),
		);
	});

	it("dies when the ids do not match the documents, before any statement", async () => {
		const world = await ownerWorld(pendingWithLink);
		const { write, ids } = await countersignOf(world);
		const abandoned = await abandonOf(world);

		for (const exit of [
			await world.exit(countersignBatch(write, ids.slice(1))),
			await world.exit(abandonBatch(abandoned, abandonIds(3))),
		]) {
			expect(Exit.isFailure(exit)).toBe(true);
			expect(Exit.hasDies(exit)).toBe(true);
		}

		expect(world.batches).toEqual([]);
	});
});

describe("the reads", () => {
	it("reads the request's sent offer, its five columns only", async () => {
		const world = await ownerWorld(clientSigned());

		expect(await world.ok(readSentOffer("r1"))).toEqual({
			id: "o1",
			request_id: "r1",
			contractor_snapshot_json: JSON.stringify({
				...CONTRACTOR,
				config_version: 1,
			}),
			recipient_email_snapshot: CLIENT_EMAIL,
			reused_msa_id: null,
		});
		expect(await world.ok(readSentOffer("r9"))).toBeNull();

		const reused = await ownerWorld(reusing);

		expect(await reused.ok(readSentOffer("r1"))).toMatchObject({
			reused_msa_id: OLD_MSA_ID,
		});

		const superseded = await ownerWorld(
			clientSigned({ offer: { status: "superseded" } }),
		);

		expect(await superseded.ok(readSentOffer("r1"))).toBeNull();
	});

	it("reads the signing setting as stored, and null without its row", async () => {
		const on = await ownerWorld(clientSigned());

		expect(await on.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 1,
		});

		const off = await ownerWorld(clientSigned({ signing: false }));

		expect(await off.ok(readSigningEnabled())).toEqual({
			software_signing_enabled: 0,
		});
		off.run("DELETE FROM software_signing_settings");
		expect(await off.ok(readSigningEnabled())).toBeNull();
	});

	it("reads every agreement of the offer, the abandoned included, by kind", async () => {
		const world = await ownerWorld({
			...reusing,
			extra: {
				software_agreements: [
					rows.agreement(OTHER_SOW, "r1", "o1", {
						kind: "sow",
						status: "abandoned",
						text_sha256: "e".repeat(64),
					}),
				],
			},
		});

		const agreements = (await world.ok(readOfferAgreements("o1"))).map(
			hashesOf,
		);

		expect(agreements).toHaveLength(2);
		expect(agreements).toEqual(
			expect.arrayContaining([
				{
					id: SOW_ID,
					kind: "sow",
					status: "client_signed",
					text_sha256: SOW_HASH,
				},
				{
					id: OTHER_SOW,
					kind: "sow",
					status: "abandoned",
					text_sha256: "e".repeat(64),
				},
			]),
		);

		const both = await ownerWorld(clientSigned());

		expect((await both.ok(readOfferAgreements("o1"))).map(hashesOf)).toEqual([
			{
				id: MSA_ID,
				kind: "msa",
				status: "client_signed",
				text_sha256: MSA_HASH,
			},
			{
				id: SOW_ID,
				kind: "sow",
				status: "client_signed",
				text_sha256: SOW_HASH,
			},
		]);
	});

	it("reads every invoice of the offer, in id order, and none of another offer", async () => {
		const world = await ownerWorld({
			...reusing,
			extra: {
				software_invoices: [
					rows.softwareInvoice("si2", "r1", "o1", {
						milestone_index: 1,
						kind: "milestone",
						status: "paid",
						refunded_at: EARLIER,
					}),
					rows.softwareInvoice("si1", "r1", "o1", { status: "open" }),
					rows.softwareInvoice("si0", "r0", "o0", { status: "open" }),
				],
			},
		});

		expect(await world.ok(readOfferDeposits("o1"))).toEqual([
			{
				milestone_index: 0,
				kind: "deposit",
				status: "open",
				refunded_at: null,
			},
			{
				milestone_index: 1,
				kind: "milestone",
				status: "paid",
				refunded_at: EARLIER,
			},
		]);
		expect(await world.ok(readOfferDeposits("o9"))).toEqual([]);
	});

	it("reads the agreement of this request, with its closed archive, and null for another request's", async () => {
		const world = await ownerWorld(executed());

		expect(await world.ok(readAgreement(SOW_ID, "r1"))).toEqual({
			status: "executed",
			kind: "sow",
			effective_on: "2026-11-13",
			client_signed_at: EARLIER,
			executed_at: EARLIER,
			archive_closed_at: null,
		});

		world.run(
			`UPDATE software_agreements SET archive_closed_at='${AT}' WHERE id='${SOW_ID}'`,
		);
		expect(await world.ok(readAgreement(SOW_ID, "r1"))).toMatchObject({
			archive_closed_at: AT,
		});
		expect(await world.ok(readAgreement(SOW_ID, "r9"))).toBeNull();
		expect(await world.ok(readAgreement(OTHER_SOW, "r1"))).toBeNull();
	});

	it("reads every offer that reuses the agreement, with its request's status and its project", async () => {
		const world = await ownerWorld(
			executed({
				extra: {
					owner_requests: [
						rows.softwareRequest("r5", { status: "reviewed" }),
						rows.softwareRequest("r6", { status: "resolved" }),
						rows.softwareRequest("r7", { status: "reviewed" }),
					],
					software_offers: [
						rows.softwareOffer("o7", "r7"),
						rows.softwareOffer("o5", "r5", { status: "draft" }),
						rows.softwareOffer("o6", "r6"),
					],
					software_projects: [rows.softwareProject("r7", "o7")],
				},
			}),
		);

		reuse(world, ["o5", "o6", "o7"]);

		expect(await world.ok(readMsaUse(MSA_ID))).toEqual([
			{ status: "draft", request_status: "reviewed", project_offer_id: null },
			{ status: "sent", request_status: "resolved", project_offer_id: null },
			{ status: "sent", request_status: "reviewed", project_offer_id: "o7" },
		]);
		expect(await world.ok(readMsaUse(SOW_ID))).toEqual([]);
	});

	it("fails with the cause when a read fails", async () => {
		const reads: [
			RegExp,
			(world: OwnerWorld) => Promise<AgreementStoreFailed>,
		][] = [
			[
				/FROM software_offers WHERE request_id/,
				(w) => w.failed(readSentOffer("r1")),
			],
			[/FROM software_signing_settings/, (w) => w.failed(readSigningEnabled())],
			[
				/FROM software_agreements WHERE offer_id/,
				(w) => w.failed(readOfferAgreements("o1")),
			],
			[/^SELECT milestone_index/, (w) => w.failed(readOfferDeposits("o1"))],
			[
				/FROM software_agreements WHERE id=\? AND request_id/,
				(w) => w.failed(readAgreement(SOW_ID, "r1")),
			],
			[/^SELECT o\.status/, (w) => w.failed(readMsaUse(MSA_ID))],
		];

		for (const [on, read] of reads) {
			const world = await ownerWorld(executed(), {
				on,
				message: "d1 unavailable",
			});

			const failure = await read(world);

			expect(failure, String(on)).toBeInstanceOf(AgreementStoreFailed);
			expect(failure, String(on)).toHaveProperty(
				"failure.message",
				"d1 unavailable",
			);
		}
	});
});

describe("the guards the rules decide first, against their rules", () => {
	const KINDS = ["deposit", "balance", "milestone"] as const;

	const INVOICE_STATUSES = [
		"creating",
		"open",
		"paid",
		"payment_failed",
		"void",
		"uncollectible",
	] as const;

	it("A12 refuses the abandon exactly when abandonBlocked blocks on the invoices readOfferDeposits reads", async () => {
		let refused = 0;

		for (const milestone_index of [0, 1])
			for (const kind of KINDS)
				for (const status of INVOICE_STATUSES)
					for (const refunded_at of [null, EARLIER]) {
						const world = await ownerWorld(
							clientSigned({
								extra: {
									software_invoices: [
										rows.softwareInvoice("si1", "r1", "o1", {
											milestone_index,
											kind,
											status,
											refunded_at,
										}),
									],
								},
							}),
						);

						const invoices = await world.ok(readOfferDeposits("o1"));

						const blocked = abandonBlocked(
							invoices.map((invoice) => ({
								milestoneIndex: invoice.milestone_index,
								kind: invoice.kind,
								status: invoice.status,
								refunded: invoice.refunded_at !== null,
							})),
						);

						const write: AbandonWrite = {
							offerId: "o1",
							requestId: "r1",
							at: AT,
							actor: OWNER,
							reason: "x",
							documents: BOTH,
						};

						const label = `${milestone_index} ${kind} ${status} ${refunded_at}`;

						if (blocked) {
							refused += 1;
							expect(
								await world.failed(abandonBatch(write, abandonIds(2))),
								label,
							).toBeInstanceOf(GuardRefused);
						} else await world.ok(abandonBatch(write, abandonIds(2)));
					}

		// Milestone 0's deposit: four statuses that may still be charged, refunded or not, and paid without a refund.
		expect(refused).toBe(9);
	});

	it("A13 refuses an MSA's end exactly when the rule finds an open offer in what readMsaUse reads", async () => {
		let refused = 0;

		for (const offerStatus of ["draft", "sent", "superseded", "withdrawn"])
			for (const requestStatus of ["new", "reviewed", "resolved", "withdrawn"])
				for (const project of [false, true]) {
					const world = await ownerWorld(
						executed({
							extra: {
								owner_requests: [
									rows.softwareRequest("r5", { status: requestStatus }),
								],
								software_offers: [
									rows.softwareOffer("o5", "r5", { status: offerStatus }),
								],
								software_projects: project
									? [rows.softwareProject("r5", "o5")]
									: [],
							},
						}),
					);

					reuse(world, ["o5"]);

					const reusingOffers = await world.ok(readMsaUse(MSA_ID));
					const agreement = await world.ok(readAgreement(MSA_ID, "r1"));

					const decided = Effect.runSync(
						Effect.match(
							endAgreement.decide(
								{ agreementId: MSA_ID, endedOn: ENDED, today: ENDED },
								{ agreement, reusingOffers },
							),
							{
								onFailure: (refusal) => refusal._tag,
								onSuccess: () => "ends",
							},
						),
					);

					const write: EndWrite = {
						agreementId: MSA_ID,
						endedOn: ENDED,
						retainUntil: "2036-11-13T12:00:00.000Z",
						terminatedOn: ENDED,
						guardsMsaUse: true,
					};

					const label = `${offerStatus} ${requestStatus} ${project}`;

					if (decided === "MsaInUse") {
						refused += 1;
						expect(await world.failed(endBatch(write)), label).toBeInstanceOf(
							GuardRefused,
						);
					} else {
						expect(decided, label).toBe("ends");
						await world.ok(endBatch(write));
					}
				}

		// A draft or sent offer of a new or reviewed request, with no project.
		expect(refused).toBe(4);
	});
});

describe("countersign's refusals", () => {
	const refusedAfter = async (change: (world: OwnerWorld) => void) => {
		const world = await ownerWorld(clientSigned());
		const { write, ids } = await countersignOf(world);

		change(world);

		const failure = await world.failed(countersignBatch(write, ids));

		return { world, failure };
	};

	const running = (query: string) => (world: OwnerWorld) => world.run(query);

	it("refuses when A10, A11 or A8 no longer holds, and writes nothing", async () => {
		for (const change of [
			"UPDATE software_offers SET status='superseded'",
			"UPDATE software_signing_settings SET software_signing_enabled=0",
			"UPDATE owner_requests SET status='withdrawn'",
			"UPDATE owner_requests SET status='resolved'",
			`UPDATE software_agreements SET status='review' WHERE id='${SOW_ID}'`,
			`UPDATE software_agreements SET status='executed' WHERE id='${MSA_ID}'`,
		]) {
			const { world, failure } = await refusedAfter(running(change));

			expect(failure, change).toBeInstanceOf(GuardRefused);
			expect(
				world.all(
					"SELECT count(*) AS n FROM software_agreement_signatures WHERE party='contractor'",
				),
			).toEqual([{ n: 0 }]);
			expect(
				world.all("SELECT count(*) AS n FROM software_agreement_events"),
			).toEqual([{ n: 0 }]);
		}

		const world = await ownerWorld(reusing);
		const { write, ids } = await countersignOf(world, SOW_ONLY);

		world.run(
			`UPDATE software_agreements SET terminated_at='2026-11-13' WHERE id='${OLD_MSA_ID}'`,
		);
		expect(await world.failed(countersignBatch(write, ids))).toBeInstanceOf(
			GuardRefused,
		);
	});

	it("refuses a signature, packet or copy row another request wrote first", async () => {
		for (const [name, change] of [
			[
				"a contractor signature of the MSA",
				(world: OwnerWorld) =>
					world.insert({
						software_agreement_signatures: [
							contractorSignature(MSA_ID, MSA_HASH),
						],
					}),
			],
			[
				"the MSA's packet row",
				running(
					`INSERT INTO software_agreement_artifacts(agreement_id) VALUES('${MSA_ID}')`,
				),
			],
			[
				"the contractor's copy row",
				running(
					`INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email) VALUES('${SOW_ID}','contractor','x@example.test')`,
				),
			],
		] as const) {
			const { world, failure } = await refusedAfter(change);

			expect(failure, name).toBeInstanceOf(GuardRefused);
			expect(
				world.all("SELECT status FROM software_agreements ORDER BY kind"),
			).toEqual([{ status: "client_signed" }, { status: "client_signed" }]);
		}
	});

	it("fails with the cause on an outage, and on an event id another row holds", async () => {
		const world = await ownerWorld(clientSigned(), {
			on: /INSERT INTO software_agreement_signatures/,
			message: "d1 unavailable",
		});

		const { write, ids } = await countersignOf(world);
		const failure = await world.failed(countersignBatch(write, ids));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toHaveProperty("failure.message", "d1 unavailable");

		const taken = await ownerWorld(clientSigned());
		const drawn = await countersignOf(taken);

		taken.run(
			`INSERT INTO software_agreement_events(id,action,actor,occurred_at) VALUES('${uuidFor(3)}','verified','x','${AT}')`,
		);
		expect(
			await taken.failed(countersignBatch(drawn.write, drawn.ids)),
		).toBeInstanceOf(AgreementStoreFailed);
	});
});

describe("abandon's refusals", () => {
	it("refuses when a deposit counts now or a document moved, and writes nothing", async () => {
		for (const change of [
			"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'creating','o','t','t')",
			`UPDATE software_agreements SET status='executed' WHERE id='${SOW_ID}'`,
			`UPDATE software_agreements SET status='abandoned' WHERE id='${MSA_ID}'`,
		]) {
			const world = await ownerWorld(pendingWithLink);
			const write = await abandonOf(world);

			world.run(change);
			expect(
				await world.failed(abandonBatch(write, abandonIds(2))),
				change,
			).toBeInstanceOf(GuardRefused);
			expect(world.all("SELECT status FROM software_offers")).toEqual([
				{ status: "sent" },
			]);
		}
	});

	it("fails with the cause on an outage", async () => {
		const world = await ownerWorld(pendingWithLink, {
			on: /UPDATE software_agreements SET status='abandoned'/,
			message: "d1 unavailable",
		});

		const write = await abandonOf(world);
		const failure = await world.failed(abandonBatch(write, abandonIds(2)));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
	});
});

describe("the records' refusals", () => {
	const deleteSow = `DELETE FROM software_agreement_deliveries; DELETE FROM software_agreement_artifacts; DELETE FROM software_agreement_signatures WHERE agreement_id='${SOW_ID}'; DELETE FROM software_agreements WHERE id='${SOW_ID}'`;

	const closeSow = `UPDATE software_agreements SET archive_closed_at='${AT}' WHERE id='${SOW_ID}'`;

	const hold = () =>
		holdBatch(
			{
				agreementId: SOW_ID,
				legalHold: 1,
				actor: OWNER,
				at: AT,
				event: "hold-changed",
			},
			uuidFor(1),
		);

	const copy = () =>
		recordCopyBatch(
			{
				agreementId: SOW_ID,
				role: "client",
				method: "Courier",
				actor: OWNER,
				at: AT,
				event: "copy-delivered",
			},
			uuidFor(1),
		);

	it("refuses an end on a closed archive or an MSA an open offer now reuses; an end of a moved agreement changes nothing", async () => {
		const closed = await ownerWorld(executed());
		const write = await endOf(closed, SOW_ID);

		closed.run(closeSow);
		expect(await closed.failed(endBatch(write))).toBeInstanceOf(GuardRefused);

		const reused = await ownerWorld(executed());
		const msaWrite = await endOf(reused, MSA_ID);

		reused.run(`UPDATE software_offers SET reused_msa_id='${MSA_ID}'`);
		expect(await reused.failed(endBatch(msaWrite))).toBeInstanceOf(
			GuardRefused,
		);

		const moved = await ownerWorld(executed());
		const movedWrite = await endOf(moved, SOW_ID);

		moved.run(
			`UPDATE software_agreements SET status='client_signed' WHERE id='${SOW_ID}'`,
		);
		await moved.ok(endBatch(movedWrite));
		expect(
			moved.all(
				`SELECT ended_at FROM software_agreements WHERE id='${SOW_ID}'`,
			),
		).toEqual([{ ended_at: null }]);

		const down = await ownerWorld(executed(), {
			on: /UPDATE software_agreements SET ended_at/,
			message: "d1 unavailable",
		});

		expect(
			await down.failed(endBatch(await endOf(down, SOW_ID))),
		).toBeInstanceOf(AgreementStoreFailed);
	});

	it("refuses a hold on a closed archive or a deleted agreement", async () => {
		for (const change of [closeSow, deleteSow]) {
			const world = await ownerWorld(executed());

			world.run(change);
			expect(await world.failed(hold()), change).toBeInstanceOf(GuardRefused);
			expect(
				world.all("SELECT count(*) AS n FROM software_agreement_events"),
			).toEqual([{ n: 0 }]);
		}

		const down = await ownerWorld(executed(), {
			on: /UPDATE software_agreements SET legal_hold/,
			message: "d1 unavailable",
		});

		expect(await down.failed(hold())).toBeInstanceOf(AgreementStoreFailed);
	});

	it("refuses a copy record for a deleted agreement; records the event alone without a copy row", async () => {
		const gone = await ownerWorld(executed());

		gone.run(deleteSow);
		expect(await gone.failed(copy())).toBeInstanceOf(GuardRefused);

		const without = await ownerWorld(executed({ deliveries: false }));

		await without.ok(copy());
		expect(without.all("SELECT action FROM software_agreement_events")).toEqual(
			[{ action: "copy-delivered" }],
		);

		const down = await ownerWorld(executed(), {
			on: /UPDATE software_agreement_deliveries SET alternate/,
			message: "d1 unavailable",
		});

		expect(await down.failed(copy())).toBeInstanceOf(AgreementStoreFailed);
	});
});

describe("the SQL, against the golden corpora", () => {
	/**
	 * The texts that replace a recorded one: each picked by every hook pattern that picked the old text, less the ones
	 * PR 4 re-points, and by no other. The deposit and MSA-use reads are plain reads of the rows the rules decide on, so
	 * their texts no longer start as today's checks did; each re-pointed pattern, left as it is, would pick the guard
	 * that keeps the check in its batch instead (the unanchored one) or nothing at all (the anchored one).
	 */
	const CHANGED = [
		{
			text: "SELECT id,kind,status,client_id,canonical_text,text_sha256,values_json,review_session_hash FROM software_agreements WHERE offer_id=? ORDER BY kind",
			old: "SELECT * FROM software_agreements WHERE offer_id=? AND status<>'abandoned' ORDER BY kind",
			repoint: [],
		},
		{
			text: "SELECT status,kind,effective_on,client_signed_at,executed_at,archive_closed_at FROM software_agreements WHERE id=? AND request_id=?",
			old: "SELECT status,kind,effective_on,client_signed_at,executed_at FROM software_agreements WHERE id=? AND request_id=?",
			repoint: [],
		},
		{
			text: "SELECT milestone_index,kind,status,refunded_at FROM software_invoices WHERE offer_id=? ORDER BY id",
			old: "SELECT 1 FROM software_invoices WHERE offer_id=? AND milestone_index=0 AND kind='deposit' AND (status IN ('creating','open','payment_failed','uncollectible') OR (status='paid' AND refunded_at IS NULL))",
			// owner-request-agreement-abandon: "outage: the first deposit check", "... only", and "... and the recheck after
			// it" (with its second match and the optional trigger that names it).
			repoint: [
				String(/SELECT 1 FROM software_invoices WHERE offer_id=\?/),
				String(/^SELECT 1 FROM software_invoices WHERE offer_id=\?/),
			],
		},
		{
			text: "SELECT o.status,r.status AS request_status,(SELECT p.offer_id FROM software_projects p WHERE p.offer_id=o.id LIMIT 1) AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.reused_msa_id=? ORDER BY o.id",
			old: "SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.reused_msa_id=? AND o.status IN ('draft','sent') AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)",
			// owner-request-agreement-end: "outage: the open-offer check of an MSA", and "outage: the batch of an MSA, and
			// the recheck" (its second match and the optional trigger that names it).
			repoint: [
				String(/SELECT 1 FROM software_offers o JOIN owner_requests r/),
				String(/^SELECT 1 FROM software_offers o JOIN owner_requests r/),
			],
		},
	] as const;

	/** Every text the owner's actions run: each read, and each batch in each of its forms. */
	async function everyText() {
		const texts = new Set<string>();

		const countersigned = await ownerWorld(clientSigned());
		const signed = await countersignOf(countersigned);

		await countersigned.ok(countersignBatch(signed.write, signed.ids));

		const reused = await ownerWorld(reusing);
		const reusedSigned = await countersignOf(reused, SOW_ONLY);

		await reused.ok(countersignBatch(reusedSigned.write, reusedSigned.ids));

		const abandoned = await ownerWorld(pendingWithLink);

		await abandoned.ok(abandonBatch(await abandonOf(abandoned), abandonIds(2)));

		const ended = await ownerWorld(executed());

		await ended.ok(endBatch(await endOf(ended, MSA_ID)));
		await ended.ok(endBatch(await endOf(ended, SOW_ID)));

		const recordedWorld = await ownerWorld(executed());

		await recordedWorld.ok(
			holdBatch(
				{
					agreementId: SOW_ID,
					legalHold: 1,
					actor: OWNER,
					at: AT,
					event: "hold-changed",
				},
				uuidFor(1),
			),
		);
		await recordedWorld.ok(
			recordCopyBatch(
				{
					agreementId: SOW_ID,
					role: "client",
					method: "Courier",
					actor: OWNER,
					at: AT,
					event: "copy-delivered",
				},
				uuidFor(2),
			),
		);

		for (const world of [
			countersigned,
			reused,
			abandoned,
			ended,
			recordedWorld,
		])
			for (const text of world.executed) texts.add(text);

		return texts;
	}

	it("runs only texts the corpora recorded, or the changed ones", async () => {
		const texts = await everyText();
		const changed = new Set<string>(CHANGED.map((change) => change.text));

		expect(
			[...texts].filter(
				(text) => !recordedTexts.has(text) && !changed.has(text),
			),
		).toEqual([]);

		for (const text of changed) expect(texts.has(text), text).toBe(true);
	});

	it("replaces recorded texts with ones the same hook patterns pick, less the ones PR 4 re-points", () => {
		expect(patterns.length).toBeGreaterThan(30);

		for (const { text, old, repoint } of CHANGED) {
			const kept = matching(old).filter(
				(pattern) => !repoint.some((repointed) => repointed === pattern),
			);

			expect(recordedTexts.has(old), old).toBe(true);
			expect(recordedTexts.has(text), text).toBe(false);
			expect(matching(old), old).toEqual(expect.arrayContaining([...repoint]));
			expect(matching(text), text).toEqual(kept);
		}
	});
});
