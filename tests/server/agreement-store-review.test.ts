import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statementOf } from "../../scripts/sql-effects.mjs";
import { resolveClientDetails } from "../../src/lib/agreement-draft-fields";
import { templateFields } from "../../src/lib/agreement-templates";
import type { RawValue } from "../../src/lib/fields";
import { projectToday } from "../../src/lib/project-dates";
import {
	reviewAgreements,
	signAgreements,
} from "../../src/lib/software-agreements";
import {
	hashOfferToken,
	type SoftwareOffer,
} from "../../src/lib/software-offers";
import {
	AgreementStoreFailed,
	REVIEWED,
	readClientByKey,
	readClientEvidence,
	readOfferAgreements,
	readPendingMsa,
	readReusedMsa,
	readSavedDraft,
	readSavedReceipt,
	readStillSignable,
	readTemplate,
	reviewBatch,
	signBatch,
	signingStatusIs,
} from "../../src/server/agreement-store";
import {
	alwaysDecideAndSave,
	ChangedSinceRead,
	GuardRefused,
} from "../../src/server/guarded-save";
import {
	AGREEMENT_MOVES,
	AGREEMENT_SIGNED,
	agreementDocument,
} from "../../src/server/machines/agreement-document";
import { next } from "../../src/server/machines/next";
import type { StoredAgreementSession } from "../../src/server/rules/agreement-session";
import {
	PendingMsaElsewhere,
	type ReviewWrite,
	reviewDocuments,
	reviewExisting,
	reviewParty,
	reviewPendingMsa,
	reviewStored,
	reviewTemplates,
	reviewTexts,
} from "../../src/server/rules/signing-review";
import {
	documentsToSign,
	type NamedDocument,
	type SignIds,
	type SignWrite,
	signDocuments,
	stillSignable,
} from "../../src/server/rules/signing-sign";
import { MusicDb } from "../../src/server/services";
import { type BoundStatement, boundStatement } from "../helpers/d1";
import { double } from "../helpers/doubles";
import {
	agreementDetails,
	contractorValues,
	offerTerms,
} from "../helpers/offer-rules";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";

// The review and signature group of the signing store (src/server/agreement-store.ts, "the review and the signature";
// docs/plans/2026-11-signing-conversion.md, section 4) on node:sqlite with the real schema: what each read finds, what
// each batch writes, and what each failure is (`AgreementStoreFailed`, `GuardRefused`, or `ChangedSinceRead` for the
// review's two re-decided failures, B7), with a real second tab's client row and a real pending MSA written between the
// read and the batch. Then today's `reviewAgreements` and `signAgreements` (src/lib/software-agreements.ts) beside the
// store's reads, the rules and the batches, on twin databases with the same clock and ids: the batches must be today's,
// statement for statement and value for value. Last, the SQL against the golden corpora that run it (offer-review and
// offer-sign): every text is one they recorded or one listed below with its reason, each batch is in an order they
// recorded, and the hooks' counts stay as they were except where a listed change names the hook PR 4 re-points.

const EARLIER = "2026-11-13T11:00:00.000Z";
const AT = "2026-11-13T12:00:00.000Z";
const EMAIL = "grace@example.test";
const TOKEN_HASH = "a".repeat(64);
const LINK_HASH = "b".repeat(64);
const ADDRESS = "203.0.113.9";
const AGENT = "Test browser";

/** The n-th id, a UUID version 4 shape with a hex counter (as the golden harness draws them). */
const uuid = (n: number): `${string}-${string}-${string}-${string}-${string}` =>
	`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A template that names every field it must, one per line, as the template code's own tests build one. */
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

/** The client's saved draft, as the golden sign corpus seeds it (tests/golden/areas/signing.ts). */
const DRAFT = {
	legal_name: "Grace Hopper LLC",
	entity_type: "LLC",
	state: "Virginia",
	business_address: "1 Main St",
	signer_name: "Grace Hopper",
	signer_title: "Founder",
	portfolio_choice: "private",
	notice_email: "notices@example.test",
};

const resolved = resolveClientDetails(DRAFT, EMAIL);

if (!resolved.ok) throw new Error("The draft must resolve to a client.");

/** The client's details as the review route resolves them from the draft, so that a saved draft matches at signing. */
const CLIENT = resolved.client;

/** The client row a review writes for CLIENT, with the natural key the store reads by. */
const CLIENT_KEY = {
	recipient_email: EMAIL,
	legal_name_key: "grace hopper llc",
	entity_type: "LLC",
	jurisdiction: "Virginia",
};

const OFFER: SoftwareOffer = {
	id: "o1",
	request_id: "r1",
	version: 2,
	status: "sent",
	terms_json: JSON.stringify(offerTerms),
	created_at: EARLIER,
	updated_at: EARLIER,
	sent_at: EARLIER,
	sent_by: "owner@example.test",
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

const SESSION: StoredAgreementSession = {
	token_hash: TOKEN_HASH,
	purpose: "agreement",
	offer_id: "o1",
	link_hash: LINK_HASH,
	recipient_email: EMAIL,
	verified_at: "2026-11-13T11:30:00.000Z",
	expires_at: "2026-11-13T13:30:00.000Z",
	revoked_at: null,
	csrf_nonce: "csrf",
};

const request = (id: string, over: Seed[string][number] = {}) => ({
	id,
	kind: "software",
	name: "Grace Hopper",
	email: EMAIL,
	summary: "Build a tool",
	status: "reviewed",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

const offerRow = (offer: SoftwareOffer) => ({
	id: offer.id,
	request_id: offer.request_id,
	version: offer.version,
	status: offer.status,
	terms_json: offer.terms_json,
	created_at: offer.created_at,
	updated_at: offer.updated_at,
	sent_at: offer.sent_at,
	sent_by: offer.sent_by,
	agreement_details_json: offer.agreement_details_json ?? null,
	msa_template_id: offer.msa_template_id ?? null,
	sow_template_id: offer.sow_template_id ?? null,
	contractor_snapshot_json: offer.contractor_snapshot_json ?? null,
	recipient_email_snapshot: offer.recipient_email_snapshot ?? null,
	reused_msa_id: offer.reused_msa_id ?? null,
});

/** Signing on; the client's request with its sent offer and link, another request's sent offer; the templates; a session. */
const BASE: Seed = {
	owner_requests: [request("r1"), request("r0"), request("r2")],
	software_agreement_templates: [
		{
			id: "t-msa",
			kind: "msa",
			version: 1,
			text: fieldsOf("msa"),
			sha256: "c".repeat(64),
			published_at: EARLIER,
			published_by: "owner",
			version_label: "msa-v1",
			source_revision: "msa-rev",
		},
		{
			id: "t-sow",
			kind: "sow",
			version: 1,
			text: fieldsOf("sow"),
			sha256: "e".repeat(64),
			published_at: EARLIER,
			published_by: "owner",
			version_label: "sow-v1",
			source_revision: null,
		},
	],
	software_offers: [
		offerRow(OFFER),
		offerRow({ ...OFFER, id: "o0", request_id: "r0", status: "superseded" }),
		offerRow({ ...OFFER, id: "o2", request_id: "r2" }),
	],
	software_offer_links: [
		{ request_id: "r1", token_hash: LINK_HASH, created_at: EARLIER },
	],
	software_agreement_links: [
		{
			id: "link",
			purpose: "agreement",
			offer_id: "o1",
			link_hash: LINK_HASH,
			recipient_email: EMAIL,
			token_hash: "f".repeat(64),
			issued_at: EARLIER,
			expires_at: AT,
		},
	],
	software_agreement_sessions: [
		{
			token_hash: TOKEN_HASH,
			purpose: "agreement",
			offer_id: "o1",
			link_hash: LINK_HASH,
			recipient_email: EMAIL,
			link_id: "link",
			verified_at: SESSION.verified_at,
			expires_at: SESSION.expires_at,
			revoked_at: null,
			csrf_nonce: "csrf",
		},
	],
};

/** A client row with the review's natural key (or another legal name), as another request may have left it. */
const clientRow = (id: string, over: Seed[string][number] = {}) => ({
	id,
	...CLIENT_KEY,
	legal_name: "Grace Hopper LLC",
	business_address: "1 Main St",
	notice_email: "notices@example.test",
	created_at: EARLIER,
	...over,
});

/** An agreement row; every other column takes a value the schema accepts. */
const agreementRow = (id: string, over: Seed[string][number] = {}) => ({
	id,
	kind: "msa",
	offer_id: "o1",
	request_id: "r1",
	client_id: "c1",
	template_id: "t-msa",
	status: "review",
	canonical_text: `Text of ${id}`,
	text_sha256: "9".repeat(64),
	values_json: "{}",
	created_at: EARLIER,
	effective_on: "2026-10-02",
	review_session_hash: TOKEN_HASH,
	...over,
});

type Hook = { readonly on: RegExp; readonly nth?: number };

type WorldHooks = {
	/** A statement that fails as D1 does when it is unavailable, on its `nth` match (the first by default). */
	readonly fail?: Hook;
	/** Another request's change, run once just before the first batch with a statement the pattern matches. */
	readonly before?: Hook & { readonly run: (sql: SqliteDatabase) => void };
};

const OUTAGE = "D1_ERROR: Network connection lost.";

/** A world: the real schema seeded with BASE, every statement run and every batch recorded, and the hooks above. */
function signingWorld(hooks: WorldHooks = {}) {
	const sql = freshMusicDb();
	const executed: string[] = [];
	const batches: BoundStatement[][] = [];
	let failMatches = 0;
	let beforeRan = false;
	let drawn = 0;

	const watched = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (hooks.fail?.on.test(query) && ++failMatches === (hooks.fail.nth ?? 1))
				throw new Error(OUTAGE);

			return sql.prepare(query);
		},
		exec: (query: string) => sql.exec(query),
	});

	const inner = sqliteD1(watched);

	const db = double<D1Database>({
		prepare: (query: string) => inner.prepare(query),
		batch: <T>(items: D1PreparedStatement[]) => {
			const statements = items.map(boundStatement);

			batches.push(statements);

			if (
				hooks.before &&
				!beforeRan &&
				statements.some((statement) => hooks.before?.on.test(statement.query))
			) {
				beforeRan = true;
				hooks.before.run(sql);
			}

			return inner.batch<T>(items);
		},
	});

	seed(sql, BASE);
	sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1");

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		db,
		executed,
		batches,
		/** The next id, in the order this world draws them. */
		draw: () => uuid(++drawn),
		seed: (tables: Seed) => seed(sql, tables),
		/** What the effect answers; a failure fails the test. */
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		/** What the effect fails with; a success fails the test. */
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		rows: (query: string, ...args: SQLInputValue[]) =>
			sql.prepare(query).all(...args),
		count: (table: string) =>
			Number(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n),
	};
}

type World = ReturnType<typeof signingWorld>;

/**
 * The review as the flow will run it (plan, section 3): the store's reads in today's order, each rule stage in turn, and
 * the ids drawn and the clock read where today's `reviewOnce` draws and reads them (the client's id only when no client
 * has the key, the MSA's only when none is reused, the SOW's, then the event's as the batch is built).
 */
const reviewPipeline = (
	world: World,
	offer: SoftwareOffer = OFFER,
	client: RawValue = CLIENT,
) =>
	Effect.gen(function* () {
		const stored = yield* reviewStored.decide(
			{ client, session: SESSION },
			offer,
		);

		const agreements = yield* readOfferAgreements(offer.id);
		const existing = yield* reviewExisting.decide(null, agreements);
		const at = new Date(AT).toISOString();
		const found = yield* readClientByKey(stored.key);
		const newClientId = found ? null : world.draw();
		const reusedMsa = yield* readReusedMsa(offer.reused_msa_id);

		const party = yield* reviewParty.decide(
			{ offer, newClientId },
			{ client: found, reusedMsa },
		);

		const msa = yield* readTemplate(party.msaTemplateId);
		const sow = yield* readTemplate(offer.sow_template_id);
		const templates = yield* reviewTemplates.decide(null, { msa, sow });
		const msaId = party.reused ? null : world.draw();
		const sowId = world.draw();

		const texts = yield* reviewTexts.decide(
			{
				offer,
				stored,
				party,
				templates,
				msaId,
				sowId,
				effectiveOn: projectToday(new Date(at)),
			},
			null,
		);

		const hashes = yield* Effect.promise(() =>
			Promise.all(
				texts.documents.map((document) => hashOfferToken(document.text)),
			),
		);

		const pending = yield* readPendingMsa(party.clientId, templates.msa.id);

		yield* reviewPendingMsa.decide({ offer, party, templates }, pending);

		return yield* reviewDocuments.decide(
			{
				offer,
				session: SESSION,
				stored,
				existing,
				party,
				templates,
				texts,
				hashes,
				at,
				sessionNow: AT,
				eventId: world.draw(),
			},
			null,
		);
	});

/** A review made and stored in this world, as the flow will: the write the rule made. */
async function reviewed(
	world: World,
	offer: SoftwareOffer = OFFER,
	client: RawValue = CLIENT,
) {
	const write = await world.ok(reviewPipeline(world, offer, client));

	await world.ok(reviewBatch(write));

	return write;
}

/** The documents a review answered, as the client names them to sign. */
const namedOf = (write: ReviewWrite): NamedDocument[] =>
	write.answer.documents.map((document) => ({
		id: document.id,
		hash: document.hash,
	}));

/**
 * The signature as the flow will run it: the offer's agreements, the documents to sign, the ids drawn in today's order
 * (the receipt, the notice, then each document's signature and event), the draft, the statements, and just before the
 * batch the offer's signing state and the reused MSA.
 */
const signPipeline = (
	world: World,
	named: readonly NamedDocument[],
	offer: SoftwareOffer = OFFER,
) =>
	Effect.gen(function* () {
		const chosen = yield* documentsToSign.decide(
			{ named },
			yield* readOfferAgreements(offer.id),
		);

		if (chosen.kind === "repeat") throw new Error("Not a first signature.");
		const receipt = world.draw();
		const notice = world.draw();

		const ids: SignIds = {
			receipt,
			notice,
			documents: chosen.documents.map(() => ({
				signature: world.draw(),
				event: world.draw(),
			})),
		};

		const draft = yield* readSavedDraft(offer.id, SESSION.recipient_email);

		const write = yield* signDocuments.decide(
			{
				at: AT,
				ids,
				session: SESSION,
				offer,
				named,
				address: ADDRESS,
				userAgent: AGENT,
			},
			{ chosen, draft },
		);

		yield* stillSignable.decide(
			{ at: AT, session: SESSION, offer, documents: chosen.documents },
			yield* readStillSignable(offer, SESSION),
		);

		return write;
	});

/** An offer that reuses an executed MSA of the client (the row given), whose signed copy is ready. */
function reusing(
	world: World,
	artifact: string | null = "ready",
	client: Seed[string][number] = clientRow("c1"),
) {
	world.seed({
		software_agreement_clients: [client],
		software_agreements: [
			agreementRow("m1", {
				offer_id: "o0",
				request_id: "r0",
				status: "executed",
				canonical_text: "The executed MSA",
				text_sha256: "8".repeat(64),
			}),
		],
		software_agreement_artifacts:
			artifact === null ? [] : [{ agreement_id: "m1", status: artifact }],
	});
	world.sql.exec("UPDATE software_offers SET reused_msa_id='m1' WHERE id='o1'");

	return { ...OFFER, reused_msa_id: "m1" };
}

const CLIENTS_INSERT = /INSERT OR IGNORE INTO software_agreement_clients/;
const SIGNATURES_INSERT = /INSERT INTO software_agreement_signatures/;

/** The SQL of the world's last batch. */
const lastBatch = (world: World) =>
	(world.batches.at(-1) ?? []).map((statement) => statement.query);

// ---- the golden corpora that run these statements ----

const CORPORA = ["offer-review", "offer-sign"] as const;

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly { readonly sql: string }[];
};

type RecordedCase = { readonly effects: readonly RecordedEffect[] };

const recordedCases = CORPORA.flatMap((corpus): RecordedCase[] =>
	// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases with these fields.
	JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(`../golden/fixtures/${corpus}.json.gz`, import.meta.url),
			),
		).toString("utf8"),
	),
);

/** Every SQL text the two corpora ran, alone or in a batch. */
const RECORDED_SQL = new Set(
	recordedCases.flatMap((recorded) =>
		recorded.effects.flatMap((effect) => [
			...(effect.kind === "d1" && effect.sql !== undefined ? [effect.sql] : []),
			...(effect.statements ?? []).map((statement) => statement.sql),
		]),
	),
);

/** The SQL texts of every batch the two corpora ran, each in its order, as JSON. */
const RECORDED_BATCHES = new Set(
	recordedCases.flatMap((recorded) =>
		recorded.effects.flatMap((effect) =>
			effect.kind === "d1-batch" && effect.statements
				? [JSON.stringify(effect.statements.map((statement) => statement.sql))]
				: [],
		),
	),
);

/** A regular expression literal's text (`/source/flags`) as a RegExp. */
function regExpOf(literal: string) {
	const end = literal.lastIndexOf("/");

	return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

/**
 * Every regular expression literal of the two corpora's test files. Each is a hook pattern (an `interleave` or a
 * `failures` entry, several passed through a helper's parameter), so all of them are the safe set to hold the store to.
 */
const HOOK_PATTERNS = CORPORA.flatMap((corpus) => {
	const file = `tests/golden/${corpus}.test.ts`;

	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);

	const found: RegExp[] = [];

	const visit = (node: ts.Node) => {
		if (ts.isRegularExpressionLiteral(node)) found.push(regExpOf(node.text));

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
});

const TODAY_SOURCE = readFileSync("src/lib/software-agreements.ts", "utf8");

/**
 * Every SQL text the signing link's corpus recorded, alone or in a batch: the offer's signing state the signature reads
 * is the read the link made after its batch's guard raised before its conversion (`signingRefusal`, deleted with
 * `issueAgreementLink`), and the read the converted link makes before each try.
 */
const LINK_RECORDED_SQL = new Set(
	// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases with these fields.
	(
		JSON.parse(
			gunzipSync(
				readFileSync(
					new URL("../golden/fixtures/offer-link.json.gz", import.meta.url),
				),
			).toString("utf8"),
		) as RecordedCase[]
	).flatMap((recorded) =>
		recorded.effects.flatMap((effect) =>
			effect.kind === "d1" && effect.sql !== undefined ? [effect.sql] : [],
		),
	),
);

describe("the status lists", () => {
	it("come from the agreement document machine and give today's texts", () => {
		expect(signingStatusIs(AGREEMENT_MOVES.REVIEW)).toBe("status='review'");
		expect(signingStatusIs(AGREEMENT_MOVES.SIGN)).toBe("status='review'");
		expect(signingStatusIs(AGREEMENT_SIGNED)).toBe(
			"status IN ('client_signed','executed')",
		);
		expect(next(agreementDocument, "review", "REVIEW")).toBe(REVIEWED);
		expect(() => signingStatusIs([])).toThrow();
		// SAFETY: the cast puts a status the machine does not name through, which is the bug the check stops.
		expect(() => signingStatusIs(["review'--" as "review"])).toThrow();
	});
});

describe("the review's reads", () => {
	it("reads every agreement of the offer, abandoned ones included, in kind order, with the columns both rules read", async () => {
		const world = signingWorld();

		world.seed({
			software_agreement_clients: [
				clientRow("c1"),
				clientRow("c2", { legal_name_key: "other" }),
			],
			software_agreements: [
				agreementRow("a-sow", { kind: "sow", template_id: "t-sow" }),
				agreementRow("a-old", { status: "abandoned" }),
				agreementRow("a-msa"),
				agreementRow("b-msa", { offer_id: "o2", client_id: "c2" }),
			],
		});

		const rows = await world.ok(readOfferAgreements("o1"));

		expect(rows.map((row) => [row.id, row.kind, row.status])).toEqual([
			["a-old", "msa", "abandoned"],
			["a-msa", "msa", "review"],
			["a-sow", "sow", "review"],
		]);
		expect(rows[2]).toEqual({
			id: "a-sow",
			kind: "sow",
			status: "review",
			client_id: "c1",
			canonical_text: "Text of a-sow",
			text_sha256: "9".repeat(64),
			values_json: "{}",
			review_session_hash: TOKEN_HASH,
		});
		expect(await world.ok(readOfferAgreements("o-none"))).toEqual([]);
	});

	it("reads the client the natural key names, or none", async () => {
		const world = signingWorld();

		world.seed({ software_agreement_clients: [clientRow("c1")] });

		expect(await world.ok(readClientByKey(CLIENT_KEY))).toEqual({ id: "c1" });
		expect(
			await world.ok(
				readClientByKey({ ...CLIENT_KEY, jurisdiction: "Wyoming" }),
			),
		).toBeNull();
	});

	it("reads the reused MSA by its id with its signed copy's status, and nothing when the offer reuses none", async () => {
		const ready = signingWorld();

		reusing(ready);

		expect(await ready.ok(readReusedMsa("m1"))).toEqual({
			id: "m1",
			kind: "msa",
			status: "executed",
			client_id: "c1",
			template_id: "t-msa",
			terminated_at: null,
			archive_closed_at: null,
			effective_on: "2026-10-02",
			canonical_text: "The executed MSA",
			text_sha256: "8".repeat(64),
			artifact_status: "ready",
		});
		expect(await ready.ok(readReusedMsa("m-gone"))).toBeNull();

		const uncopied = signingWorld();

		reusing(uncopied, null);
		expect(await uncopied.ok(readReusedMsa("m1"))).toMatchObject({
			id: "m1",
			artifact_status: null,
		});

		const none = signingWorld();

		for (const id of [null, undefined, ""])
			expect(await none.ok(readReusedMsa(id))).toBeNull();

		expect(none.executed).toEqual([]);
	});

	it("reads a template by its id, and none for a null or unknown id (the statement runs, as today)", async () => {
		const world = signingWorld();

		expect(await world.ok(readTemplate("t-sow"))).toEqual({
			id: "t-sow",
			kind: "sow",
			version: 1,
			text: fieldsOf("sow"),
			sha256: "e".repeat(64),
			version_label: "sow-v1",
			source_revision: null,
			published_at: EARLIER,
		});
		expect(await world.ok(readTemplate(null))).toBeNull();
		expect(await world.ok(readTemplate("t-gone"))).toBeNull();
		expect(world.executed).toHaveLength(3);
	});

	it("reads every agreement of the client for the template, whatever its kind, status and offer", async () => {
		const world = signingWorld();

		world.seed({
			software_agreement_clients: [
				clientRow("c1"),
				clientRow("c2", { legal_name_key: "other" }),
			],
			software_agreements: [
				agreementRow("own"),
				agreementRow("other-offer", {
					offer_id: "o2",
					status: "client_signed",
					template_id: "t-sow",
					kind: "sow",
				}),
				agreementRow("elsewhere", { offer_id: "o2", status: "abandoned" }),
				agreementRow("no-offer", { offer_id: null, status: "executed" }),
				agreementRow("other-client", { offer_id: "o2", client_id: "c2" }),
			],
		});

		const rows = await world.ok(readPendingMsa("c1", "t-msa"));

		expect(rows.map((row) => row.id).sort()).toEqual([
			"elsewhere",
			"no-offer",
			"own",
		]);
		expect(rows.find((row) => row.id === "no-offer")).toEqual({
			id: "no-offer",
			kind: "msa",
			status: "executed",
			offer_id: null,
			client_id: "c1",
			template_id: "t-msa",
		});
	});

	it("reads the evidence after a FOREIGN KEY failure: the earlier client by its id, or the clients with a new one's key", async () => {
		const world = signingWorld();

		world.seed({ software_agreement_clients: [clientRow("c1")] });

		const client = { ...clientRow("new-id"), created_at: AT };

		expect(
			await world.ok(readClientEvidence({ client, earlierClientId: "c1" })),
		).toEqual([{ id: "c1" }]);
		expect(
			await world.ok(readClientEvidence({ client, earlierClientId: "c-gone" })),
		).toEqual([]);
		expect(
			await world.ok(readClientEvidence({ client, earlierClientId: null })),
		).toEqual([{ id: "c1" }]);
	});

	it("fails with AgreementStoreFailed carrying what the database raised", async () => {
		const world = signingWorld({ fail: { on: /FROM software_agreements/ } });

		const failure = await world.failed(readOfferAgreements("o1"));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({ failure: new Error(OUTAGE) });
	});
});

describe("the review batch", () => {
	it("writes a first review as the rule wrote it: the client, the MSA and the SOW in review, and the event", async () => {
		const world = signingWorld();
		const write = await reviewed(world);

		expect(write.client.id).toBe(uuid(1));
		expect(write.documents.map((document) => document.id)).toEqual([
			uuid(2),
			uuid(3),
		]);
		expect(write.event.id).toBe(uuid(4));
		expect(
			world.rows(
				"SELECT id,kind,offer_id,request_id,client_id,template_id,msa_id,sow_number,canonical_text,text_sha256,values_json,attachment_manifest_json,created_at,effective_on,review_session_hash FROM software_agreements WHERE status='review' ORDER BY kind",
			),
		).toEqual(write.documents);
		expect(
			world.rows(
				"SELECT * FROM software_agreement_clients WHERE id=?",
				uuid(1),
			),
		).toEqual([write.client]);
		expect(world.rows("SELECT * FROM software_agreement_events")).toEqual([
			write.event,
		]);
		expect(RECORDED_BATCHES.has(JSON.stringify(lastBatch(world)))).toBe(true);
	});

	it("replaces an earlier review, and removes its client unless an agreement or a notice still names it", async () => {
		const world = signingWorld();

		await reviewed(world, OFFER, {
			...CLIENT,
			legal_name: "Hopper Industries",
		});

		const write = await reviewed(world);

		expect(write.staleClientIds).toEqual([uuid(1)]);
		expect(world.rows("SELECT id FROM software_agreement_clients")).toEqual([
			{ id: uuid(5) },
		]);
		expect(
			world.rows("SELECT id FROM software_agreements ORDER BY kind"),
		).toEqual([{ id: uuid(6) }, { id: uuid(7) }]);
		expect(RECORDED_BATCHES.has(JSON.stringify(lastBatch(world)))).toBe(true);

		// The replaced client stays while another agreement names it: the delete's filter refuses nothing.
		const kept = signingWorld();

		await reviewed(kept, OFFER, { ...CLIENT, legal_name: "Hopper Industries" });
		kept.seed({
			software_agreements: [
				agreementRow("elsewhere", {
					offer_id: "o2",
					request_id: "r2",
					client_id: uuid(1),
					status: "executed",
				}),
			],
		});
		await reviewed(kept);

		expect(
			kept.rows("SELECT id FROM software_agreement_clients ORDER BY id"),
		).toEqual([{ id: uuid(1) }, { id: uuid(5) }]);
	});

	it("writes a review that reuses the MSA: the SOW alone, against that MSA", async () => {
		const world = signingWorld();
		const offer = reusing(world);
		const write = await reviewed(world, offer);

		expect(write.documents).toHaveLength(1);
		expect(write.documents[0]).toMatchObject({
			kind: "sow",
			client_id: "c1",
			msa_id: "m1",
		});
		expect(write.answer.reused_msa).toEqual({
			id: "m1",
			text: "The executed MSA",
			hash: "8".repeat(64),
		});
		expect(RECORDED_BATCHES.has(JSON.stringify(lastBatch(world)))).toBe(true);
	});

	const refusedBy = [
		{
			name: "A1: the offer is superseded",
			sql: "UPDATE software_offers SET status='superseded' WHERE id='o1'",
		},
		{
			name: "A1: signing is switched off",
			sql: "UPDATE software_signing_settings SET software_signing_enabled=0",
		},
		{
			name: "A1: the owner starts the project",
			sql: "INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','t','t','t','o','t','t')",
		},
		{
			name: "A2: the session is revoked",
			sql: `UPDATE software_agreement_sessions SET revoked_at='${EARLIER}'`,
		},
		{
			name: "A2: the session expires by the batch's time",
			sql: `UPDATE software_agreement_sessions SET expires_at='${AT}'`,
		},
		{
			name: "A3: another tab signs the agreement",
			sql: "UPDATE software_agreements SET status='client_signed' WHERE id='a-msa'",
		},
	];

	for (const refused of refusedBy)
		it(`is GuardRefused, writing nothing, when ${refused.name} before the batch`, async () => {
			const world = signingWorld({
				before: {
					on: CLIENTS_INSERT,
					run: (sql) => sql.exec(refused.sql),
				},
			});

			world.seed({
				software_agreement_clients: [clientRow("c1")],
				software_agreements: [agreementRow("a-msa")],
			});

			const write = await world.ok(reviewPipeline(world));
			const failure = await world.failed(reviewBatch(write));

			expect(failure).toBeInstanceOf(GuardRefused);
			expect(world.count("software_agreement_events")).toBe(0);
			expect(world.rows("SELECT id FROM software_agreements")).toEqual([
				{ id: "a-msa" },
			]);
		});

	it("is ChangedSinceRead when another offer's pending MSA for the client and template is written after the read, and the retry refuses it", async () => {
		const pendingElsewhere = (sql: SqliteDatabase) =>
			sql.exec(
				`INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o2','r2','c1','t-msa','review','x','${"3".repeat(64)}','{}','t','2026-11-13','h')`,
			);

		const world = signingWorld({
			before: { on: CLIENTS_INSERT, run: pendingElsewhere },
		});

		world.seed({ software_agreement_clients: [clientRow("c1")] });

		const write = await world.ok(reviewPipeline(world));

		expect(write.client.id).toBe("c1");
		expect(await world.failed(reviewBatch(write))).toBeInstanceOf(
			ChangedSinceRead,
		);

		const again = signingWorld({
			before: { on: CLIENTS_INSERT, run: pendingElsewhere },
		});

		again.seed({ software_agreement_clients: [clientRow("c1")] });

		const answer = await again.failed(
			alwaysDecideAndSave({
				facts: reviewPipeline(again),
				decide: (decided: ReviewWrite) => Effect.succeed(decided),
				save: reviewBatch,
			}),
		);

		expect(answer).toBeInstanceOf(PendingMsaElsewhere);
		expect(again.batches).toHaveLength(1);
	});

	it("is ChangedSinceRead when another tab creates the same legal party under its own id, and the retry writes for that client", async () => {
		const otherTab = (sql: SqliteDatabase) =>
			sql.exec(
				`INSERT INTO software_agreement_clients VALUES('client-race','${EMAIL}','Grace Hopper LLC','grace hopper llc','LLC','Virginia','1 Main St','notices@example.test','${EARLIER}')`,
			);

		const world = signingWorld({
			before: { on: CLIENTS_INSERT, run: otherTab },
		});

		const write = await world.ok(reviewPipeline(world));

		expect(write.earlierClientId).toBeNull();
		expect(await world.failed(reviewBatch(write))).toBeInstanceOf(
			ChangedSinceRead,
		);
		expect(world.executed.at(-1)).toBe(
			"SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=?",
		);

		const again = signingWorld({
			before: { on: CLIENTS_INSERT, run: otherTab },
		});

		const saved = await again.ok(
			alwaysDecideAndSave({
				facts: reviewPipeline(again),
				decide: (decided: ReviewWrite) => Effect.succeed(decided),
				save: reviewBatch,
			}),
		);

		expect(saved.decided.client.id).toBe("client-race");
		expect(
			again.rows("SELECT DISTINCT client_id FROM software_agreements"),
		).toEqual([{ client_id: "client-race" }]);
		expect(again.rows("SELECT id FROM software_agreement_clients")).toEqual([
			{ id: "client-race" },
		]);
	});

	it("is ChangedSinceRead when the client found before the batch is replaced by another tab under another id", async () => {
		const world = signingWorld({
			before: {
				on: CLIENTS_INSERT,
				run: (sql) =>
					sql.exec(
						`DELETE FROM software_agreement_clients WHERE id='c1'; INSERT INTO software_agreement_clients VALUES('c-other','${EMAIL}','Grace Hopper LLC','grace hopper llc','LLC','Virginia','1 Main St','notices@example.test','${EARLIER}')`,
					),
			},
		});

		world.seed({ software_agreement_clients: [clientRow("c1")] });

		const write = await world.ok(reviewPipeline(world));

		expect(write.earlierClientId).toBe("c1");
		expect(await world.failed(reviewBatch(write))).toBeInstanceOf(
			ChangedSinceRead,
		);
		expect(world.executed.at(-1)).toBe(
			"SELECT id FROM software_agreement_clients WHERE id=?",
		);
	});

	it("is AgreementStoreFailed with the batch's own failure for a FOREIGN KEY failure with no evidence of another request", async () => {
		const world = signingWorld();
		const write = await world.ok(reviewPipeline(world));

		const failure = await world.failed(
			reviewBatch({
				...write,
				documents: write.documents.map((document) => ({
					...document,
					template_id: "t-gone",
				})),
			}),
		);

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({
			failure: expect.objectContaining({
				message: expect.stringMatching(/FOREIGN KEY constraint failed/),
			}),
		});
		expect(world.count("software_agreement_clients")).toBe(0);
	});

	it("keeps the batch's own failure when the evidence cannot be read", async () => {
		const builder = signingWorld();
		const write = await builder.ok(reviewPipeline(builder));

		// The evidence read is the only statement by the natural key in this world.
		const world = signingWorld({
			fail: {
				on: /SELECT id FROM software_agreement_clients WHERE recipient_email/,
			},
		});

		const failure = await world.failed(
			reviewBatch({
				...write,
				documents: write.documents.map((document) => ({
					...document,
					template_id: "t-gone",
				})),
			}),
		);

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({
			failure: expect.objectContaining({
				message: expect.stringMatching(/FOREIGN KEY constraint failed/),
			}),
		});
		expect(world.executed.at(-1)).toMatch(/WHERE recipient_email=/);
	});

	it("is GuardRefused for any other UNIQUE failure (a document id another agreement has)", async () => {
		const world = signingWorld();

		world.seed({
			software_agreement_clients: [clientRow("c1")],
			software_agreements: [
				agreementRow("taken", {
					kind: "sow",
					template_id: "t-sow",
					offer_id: "o2",
					request_id: "r2",
				}),
			],
		});

		const write = await world.ok(reviewPipeline(world));

		const failure = await world.failed(
			reviewBatch({
				...write,
				documents: write.documents.map((document, index) =>
					index === 0 ? { ...document, id: "taken" } : document,
				),
			}),
		);

		expect(failure).toBeInstanceOf(GuardRefused);
	});

	it("is AgreementStoreFailed with the cause for an outage", async () => {
		const world = signingWorld({ fail: { on: CLIENTS_INSERT } });
		const write = await world.ok(reviewPipeline(world));
		const failure = await world.failed(reviewBatch(write));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({ failure: new Error(OUTAGE) });
	});

	it("recognises D1's wording down the cause chain", async () => {
		const builder = signingWorld();
		const write = await builder.ok(reviewPipeline(builder));

		const rejecting = (cause: Error) => {
			const world = signingWorld();

			world.seed({
				software_agreement_clients: [clientRow("client-race")],
			});

			const db = double<D1Database>({
				prepare: (query: string) => world.db.prepare(query),
				batch: () => Promise.reject(new Error("D1_ERROR", { cause })),
			});

			return Effect.runPromise(
				Effect.flip(
					reviewBatch(write).pipe(Effect.provideService(MusicDb, db)),
				),
			);
		};

		expect(
			await rejecting(
				new Error(
					"UNIQUE constraint failed: software_agreements.client_id, software_agreements.template_id: SQLITE_CONSTRAINT",
				),
			),
		).toBeInstanceOf(ChangedSinceRead);
		expect(
			await rejecting(
				new Error("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"),
			),
		).toBeInstanceOf(ChangedSinceRead);
		expect(
			await rejecting(
				new Error(
					"UNIQUE constraint failed: software_agreements.offer_id: SQLITE_CONSTRAINT",
				),
			),
		).toBeInstanceOf(GuardRefused);
		expect(
			await rejecting(new Error("malformed JSON: SQLITE_ERROR")),
		).toBeInstanceOf(GuardRefused);
		expect(await rejecting(new Error(OUTAGE))).toBeInstanceOf(
			AgreementStoreFailed,
		);
	});
});

describe("the signature's reads", () => {
	it("reads the client signature's receipt and session, and none without one", async () => {
		const world = signingWorld();

		world.seed({
			software_agreement_clients: [clientRow("c1")],
			software_agreements: [agreementRow("a1", { status: "client_signed" })],
		});

		expect(await world.ok(readSavedReceipt("a1"))).toBeNull();

		world.seed({
			software_agreement_signatures: [
				{
					id: "s-owner",
					agreement_id: "a1",
					party: "contractor",
					typed_name: "x",
					title: "x",
					consent_text: "x",
					consent_version: "v",
					consent_at: AT,
					signed_at: AT,
					document_sha256: "h",
					owner_subject: "owner",
					verified_email: EMAIL,
					verified_at: AT,
					verification_method: "m",
					intent_text: "i",
					document_list_json: "[]",
					receipt_id: "owner-receipt",
					ip_address: "",
					user_agent: "",
				},
			],
		});

		expect(await world.ok(readSavedReceipt("a1"))).toBeNull();

		world.sql.exec(
			`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,session_token_hash,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES('s-client','a1','client','x','x','x','v','t','t','h','${TOKEN_HASH}','e','t','m','i','[]','receipt-1','','')`,
		);

		expect(await world.ok(readSavedReceipt("a1"))).toEqual({
			receipt_id: "receipt-1",
			session_token_hash: TOKEN_HASH,
		});
	});

	it("reads the client's saved draft for the offer and address, or none", async () => {
		const world = signingWorld();

		expect(await world.ok(readSavedDraft("o1", EMAIL))).toBeNull();

		world.seed({
			software_agreement_drafts: [
				{
					offer_id: "o1",
					recipient_email: EMAIL,
					values_json: JSON.stringify(DRAFT),
					updated_at: EARLIER,
				},
			],
		});

		expect(await world.ok(readSavedDraft("o1", EMAIL))).toEqual({
			values_json: JSON.stringify(DRAFT),
		});
		expect(
			await world.ok(readSavedDraft("o1", "other@example.test")),
		).toBeNull();
	});

	it("reads the offer's signing state with the signing link's SQL, and the reused MSA only when the offer names one", async () => {
		const world = signingWorld();

		expect(await world.ok(readStillSignable(OFFER, SESSION))).toEqual({
			signing: {
				status: "sent",
				recipient_email_snapshot: EMAIL,
				request_status: "reviewed",
				link_hash: LINK_HASH,
				link_revoked_at: null,
				software_signing_enabled: 1,
				project_offer_id: null,
			},
			reusedMsa: null,
		});
		expect(world.executed).toHaveLength(1);
		expect(LINK_RECORDED_SQL.has(world.executed[0] ?? "")).toBe(true);

		world.sql.exec(
			"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','t','t','t','o','t','t')",
		);

		expect(
			await world.ok(
				readStillSignable(OFFER, { link_hash: "another-link-hash" }),
			),
		).toMatchObject({
			signing: { link_hash: null, project_offer_id: "o1" },
		});
		expect(
			await world.ok(readStillSignable({ ...OFFER, id: "o-gone" }, SESSION)),
		).toEqual({ signing: null, reusedMsa: null });

		const reuse = signingWorld();
		const offer = reusing(reuse);

		reuse.sql.exec("UPDATE software_agreements SET terminated_at='2026-11-13'");

		expect(await reuse.ok(readStillSignable(offer, SESSION))).toMatchObject({
			reusedMsa: {
				id: "m1",
				kind: "msa",
				status: "executed",
				terminated_at: "2026-11-13",
			},
		});
		expect(reuse.executed.at(-1)).toBe(
			"SELECT id,kind,status,terminated_at FROM software_agreements WHERE id=?",
		);
	});
});

describe("the signing batch", () => {
	it("signs the MSA and the SOW as the rule wrote it: signatures, events, statuses, the draft removed, two notifications", async () => {
		const world = signingWorld();
		const review = await reviewed(world);
		const write = await world.ok(signPipeline(world, namedOf(review)));

		await world.ok(signBatch(write, AT));

		expect(
			world.rows(
				"SELECT id,status,client_signed_at FROM software_agreements ORDER BY kind",
			),
		).toEqual(
			write.documents.map((document) => ({
				id: document.id,
				status: "client_signed",
				client_signed_at: AT,
			})),
		);
		expect(
			world.rows(
				"SELECT id,agreement_id,party,typed_name,title,consent_text,consent_at,signed_at,document_sha256,session_token_hash,owner_subject,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent FROM software_agreement_signatures ORDER BY id",
			),
		).toEqual(write.documents.map((document) => document.signature));
		expect(
			world.rows(
				"SELECT DISTINCT consent_version FROM software_agreement_signatures",
			),
		).toEqual([{ consent_version: "website-signing-v3" }]);
		expect(
			world.rows(
				"SELECT * FROM software_agreement_events WHERE action='client-signed' ORDER BY id",
			),
		).toEqual(write.documents.map((document) => document.event));
		expect(
			world.rows(
				"SELECT agreement_id,kind,email,status FROM software_agreement_notifications ORDER BY kind",
			),
		).toEqual(
			[...write.notifications]
				.reverse()
				.map((notification) => ({ ...notification, status: "pending" })),
		);
		// The client row is the one the review wrote, so the notice's filter inserts nothing.
		expect(world.count("software_agreement_notices")).toBe(0);
		expect(RECORDED_BATCHES.has(JSON.stringify(lastBatch(world)))).toBe(true);
	});

	it("records the notice when the client row has another address, and checks a saved draft and a reused MSA", async () => {
		const world = signingWorld();

		const offer = reusing(
			world,
			"ready",
			clientRow("c1", { business_address: "9 Old Road" }),
		);

		const review = await reviewed(world, offer);

		world.seed({
			software_agreement_drafts: [
				{
					offer_id: "o1",
					recipient_email: EMAIL,
					values_json: JSON.stringify(DRAFT),
					updated_at: EARLIER,
				},
			],
		});

		const write = await world.ok(signPipeline(world, namedOf(review), offer));

		expect(write.guards.draftValues).toBe(JSON.stringify(DRAFT));
		expect(write.guards.reusedMsaId).toBe("m1");

		await world.ok(signBatch(write, AT));

		expect(world.rows("SELECT * FROM software_agreement_notices")).toEqual([
			write.notice,
		]);
		expect(world.count("software_agreement_drafts")).toBe(0);
		expect(lastBatch(world).slice(0, 5)).toEqual([
			expect.stringMatching(
				/^SELECT CASE WHEN EXISTS\(SELECT 1 FROM software_offers o/,
			),
			expect.stringMatching(/software_agreement_sessions/),
			expect.stringMatching(
				/software_agreement_drafts WHERE offer_id=\? AND recipient_email=\? AND values_json=\?/,
			),
			expect.stringMatching(
				/kind='msa' AND status='executed' AND terminated_at IS NULL/,
			),
			expect.stringMatching(/^INSERT INTO software_agreement_notices/),
		]);
		// No golden case signs a reused MSA's SOW with a saved draft; today's order for it is held below, beside
		// signAgreements ("the SOW of a reused MSA").
		expect(lastBatch(world)).toHaveLength(12);
	});

	const refusedBy = [
		{
			name: "A1: the offer is superseded",
			sql: "UPDATE software_offers SET status='superseded' WHERE id='o1'",
		},
		{
			name: "A1: the request is withdrawn",
			sql: "UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
		},
		{
			name: "A1: the offer link is revoked",
			sql: `UPDATE software_offer_links SET revoked_at='${EARLIER}'`,
		},
		{
			name: "A2: the session is revoked",
			sql: `UPDATE software_agreement_sessions SET revoked_at='${EARLIER}'`,
		},
		{
			name: "A7: the client edits the draft",
			sql: `UPDATE software_agreement_drafts SET values_json='{"legal_name":"Edited"}'`,
		},
		{
			name: "A8: the reused MSA is terminated",
			sql: "UPDATE software_agreements SET terminated_at='2026-11-13' WHERE id='m1'",
		},
		{
			name: "A9: the SOW is client_signed first",
			sql: "UPDATE software_agreements SET status='client_signed' WHERE kind='sow'",
		},
		{
			name: "A9: the SOW's text hash changes",
			sql: `UPDATE software_agreements SET text_sha256='${"e".repeat(64)}' WHERE kind='sow'`,
		},
		{
			name: "A9: the SOW's review session changes",
			sql: "UPDATE software_agreements SET review_session_hash='other' WHERE kind='sow'",
		},
	];

	for (const refused of refusedBy)
		it(`is GuardRefused, writing nothing, when ${refused.name} before the batch`, async () => {
			const world = signingWorld({
				before: {
					on: SIGNATURES_INSERT,
					run: (sql) => sql.exec(refused.sql),
				},
			});

			const offer = reusing(world);
			const review = await reviewed(world, offer);

			world.seed({
				software_agreement_drafts: [
					{
						offer_id: "o1",
						recipient_email: EMAIL,
						values_json: JSON.stringify(DRAFT),
						updated_at: EARLIER,
					},
				],
			});

			const write = await world.ok(signPipeline(world, namedOf(review), offer));
			const failure = await world.failed(signBatch(write, AT));

			expect(failure).toBeInstanceOf(GuardRefused);
			expect(world.count("software_agreement_signatures")).toBe(0);
			expect(world.count("software_agreement_notifications")).toBe(0);
			expect(world.count("software_agreement_drafts")).toBe(1);
		});

	it("is GuardRefused when the session expires by the batch's own time", async () => {
		const world = signingWorld();
		const review = await reviewed(world);
		const write = await world.ok(signPipeline(world, namedOf(review)));

		expect(
			await world.failed(signBatch(write, SESSION.expires_at)),
		).toBeInstanceOf(GuardRefused);
		expect(world.count("software_agreement_signatures")).toBe(0);
	});

	/** A review whose client row has another address, so the signing batch inserts a notice. */
	async function noticeWorld(hooks: WorldHooks) {
		const world = signingWorld(hooks);

		world.seed({
			software_agreement_clients: [
				clientRow("c1", { business_address: "9 Old Road" }),
			],
		});

		const review = await reviewed(world);

		return {
			world,
			write: await world.ok(signPipeline(world, namedOf(review))),
		};
	}

	const conflicts = [
		{
			name: "a signature row for the MSA appears first (UNIQUE)",
			sql: (write: SignWrite) =>
				`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES('s-x','${write.documents[0]?.id}','client','x','x','x','v','t','t','h','e','t','m','i','[]','r','','')`,
		},
		{
			name: "the SOW has a notice already (UNIQUE)",
			sql: (write: SignWrite) =>
				`INSERT INTO software_agreement_notices VALUES('n-x','${write.notice.agreement_id}','c1','x','x','t')`,
		},
		{
			name: "another tab's review deletes the documents (FOREIGN KEY)",
			sql: () => "DELETE FROM software_agreements",
		},
	];

	for (const conflict of conflicts)
		it(`is GuardRefused when ${conflict.name} before the batch`, async () => {
			let race = "";

			const { world, write } = await noticeWorld({
				before: { on: SIGNATURES_INSERT, run: (sql) => sql.exec(race) },
			});

			race = conflict.sql(write);

			expect(await world.failed(signBatch(write, AT))).toBeInstanceOf(
				GuardRefused,
			);
			expect(world.count("software_agreement_notifications")).toBe(0);
		});

	it("is AgreementStoreFailed with the cause for an outage, and recognises D1's wording down the cause chain", async () => {
		const world = signingWorld({ fail: { on: SIGNATURES_INSERT } });
		const review = await reviewed(world);
		const write = await world.ok(signPipeline(world, namedOf(review)));
		const failure = await world.failed(signBatch(write, AT));

		expect(failure).toBeInstanceOf(AgreementStoreFailed);
		expect(failure).toMatchObject({ failure: new Error(OUTAGE) });

		const rejecting = (cause: Error) =>
			Effect.runPromise(
				Effect.flip(
					signBatch(write, AT).pipe(
						Effect.provideService(
							MusicDb,
							double<D1Database>({
								prepare: (query: string) => world.db.prepare(query),
								batch: () => Promise.reject(new Error("D1_ERROR", { cause })),
							}),
						),
					),
				),
			);

		for (const message of [
			"UNIQUE constraint failed: software_agreement_signatures.agreement_id, software_agreement_signatures.party: SQLITE_CONSTRAINT",
			"UNIQUE constraint failed: software_agreement_notices.agreement_id: SQLITE_CONSTRAINT",
			"FOREIGN KEY constraint failed: SQLITE_CONSTRAINT",
			"malformed JSON: SQLITE_ERROR",
		])
			expect(await rejecting(new Error(message))).toBeInstanceOf(GuardRefused);

		expect(await rejecting(new Error(OUTAGE))).toBeInstanceOf(
			AgreementStoreFailed,
		);
	});
});

describe("today's batches beside the store's, on twin databases with the same clock and ids", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(AT));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	/** Runs today's code in `today`, drawing its ids from that world's counter. */
	async function asToday<A>(today: World, work: () => Promise<A>) {
		const draws = vi
			.spyOn(crypto, "randomUUID")
			.mockImplementation(() => today.draw());

		try {
			return await work();
		} finally {
			draws.mockRestore();
		}
	}

	const reviewCases = [
		{
			name: "a first review, for a new client, then again for another legal name",
			setup: () => OFFER,
			again: { ...CLIENT, legal_name: "Hopper Industries" },
		},
		{
			name: "a review for a client found by its key, then again for another legal name",
			setup: (world: World) => {
				world.seed({
					software_agreement_clients: [
						clientRow("c1", { business_address: "9 Old Road" }),
					],
				});

				return OFFER;
			},
			again: { ...CLIENT, legal_name: "Hopper Industries" },
		},
		{
			name: "a review that reuses the MSA, then again with another address (its client is kept)",
			setup: (world: World) => reusing(world),
			again: { ...CLIENT, business_address: "2 Main St" },
		},
	];

	for (const testCase of reviewCases)
		it(`reviews as today's reviewAgreements: ${testCase.name}`, async () => {
			const today = signingWorld();
			const store = signingWorld();
			const offer = testCase.setup(today);

			testCase.setup(store);

			for (const client of [CLIENT, testCase.again]) {
				await asToday(today, () =>
					reviewAgreements(today.db, offer, SESSION, client),
				);
				await reviewed(store, offer, client);

				expect(store.batches.at(-1)).toEqual(today.batches.at(-1));
			}

			expect(store.batches.at(-1)?.length).toBeGreaterThan(4);
		});

	const signCases = [
		{ name: "the MSA and the SOW", setup: () => OFFER, draft: false },
		{ name: "with a saved draft", setup: () => OFFER, draft: true },
		{
			name: "the SOW of a reused MSA",
			setup: (world: World) => reusing(world),
			draft: true,
		},
		{
			name: "with a notice, for a client row with another address",
			setup: (world: World) => {
				world.seed({
					software_agreement_clients: [
						clientRow("c1", { notice_email: "old@example.test" }),
					],
				});

				return OFFER;
			},
			draft: false,
		},
	];

	for (const testCase of signCases)
		it(`signs as today's signAgreements: ${testCase.name}`, async () => {
			const today = signingWorld();
			const store = signingWorld();
			const offer = testCase.setup(today);

			testCase.setup(store);

			const review = await reviewed(today, offer);

			await reviewed(store, offer);

			for (const world of [today, store])
				if (testCase.draft)
					world.seed({
						software_agreement_drafts: [
							{
								offer_id: "o1",
								recipient_email: EMAIL,
								values_json: JSON.stringify(DRAFT),
								updated_at: EARLIER,
							},
						],
					});

			const receipt = await asToday(today, () =>
				signAgreements(
					today.db,
					offer,
					SESSION,
					namedOf(review),
					new Request("https://thesuperhuman.us/api/offer/token/sign", {
						method: "POST",
						headers: { "cf-connecting-ip": ADDRESS, "user-agent": AGENT },
					}),
				),
			);

			const write = await store.ok(signPipeline(store, namedOf(review), offer));

			await store.ok(signBatch(write, AT));

			expect(write.receiptId).toBe(receipt);
			expect(store.batches.at(-1)).toEqual(today.batches.at(-1));
		});
});

// ---- the SQL against the golden corpora ----

const CLIENT_BY_KEY =
	"SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=?";

/** Today's texts the store changes, each with the new text, why, and the hooks PR 4 re-points (none: the hooks pick it as before). */
const CHANGED = [
	{
		old: "SELECT * FROM software_agreements WHERE offer_id=? AND status<>'abandoned' ORDER BY kind",
		new: "SELECT id,kind,status,client_id,canonical_text,text_sha256,values_json,review_session_hash FROM software_agreements WHERE offer_id=? ORDER BY kind",
		why: "every agreement of the offer, abandoned ones included: the rules leave those out (plan, section 4)",
		repoint: [
			String(
				/SELECT \* FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
			),
			String(
				/FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
			),
		],
	},
	{
		old: "SELECT * FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL AND archive_closed_at IS NULL AND EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=software_agreements.id AND f.status='ready') AND client_id=?",
		new: "SELECT a.id,a.kind,a.status,a.client_id,a.template_id,a.terminated_at,a.archive_closed_at,a.effective_on,a.canonical_text,a.text_sha256,f.status AS artifact_status FROM software_agreements a LEFT JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.id=?",
		why: "the reused MSA as a plain row with its signed copy's status: `reviewParty` decides the six conditions",
		repoint: [
			String(/SELECT \* FROM software_agreements WHERE id=\? AND kind='msa'/),
		],
	},
	{
		old: "SELECT * FROM software_agreements WHERE client_id=? AND template_id=? AND kind='msa' AND status IN ('review','client_signed') AND offer_id<>?",
		new: "SELECT * FROM software_agreements WHERE client_id=? AND template_id=?",
		why: "every agreement of the client and template: `reviewPendingMsa` decides kind, status and offer; the start the hook picks is kept",
		repoint: [],
	},
	{
		old: "SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=? AND id<>?",
		new: CLIENT_BY_KEY,
		why: "the evidence for a new client is the clients with its key: `clientChangedElsewhere` decides `id<>?`",
		repoint: [],
	},
	{
		old: "SELECT 1 FROM software_agreement_clients WHERE id=?",
		new: "SELECT id FROM software_agreement_clients WHERE id=?",
		why: "the evidence for a client found before reads its id, which `clientChangedElsewhere` compares",
		repoint: [],
	},
] as const;

/** The reads the store adds, each with why; no hook of the corpora may pick one, since hooks count their matches. */
const ADDED = [
	{
		sql: "SELECT o.status,o.recipient_email_snapshot,r.status AS request_status,l.token_hash AS link_hash,l.revoked_at AS link_revoked_at,s.software_signing_enabled,p.offer_id AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id LEFT JOIN software_offer_links l ON l.request_id=o.request_id AND l.token_hash=? LEFT JOIN software_signing_settings s ON s.id=1 LEFT JOIN software_projects p ON p.offer_id=o.id WHERE o.id=?",
		why: "the offer's signing state just before the signing batch (`stillSignable`, A1 read first); today's signingRefusal text",
	},
	{
		sql: "SELECT id,kind,status,terminated_at FROM software_agreements WHERE id=?",
		why: "the reused MSA just before the signing batch (`stillSignable`, A8 read first)",
	},
] as const;

/** Every text the group runs and every batch it writes, from worlds that reach each statement. */
async function tour() {
	const texts = new Set<string>();
	const batches: string[][] = [];

	const visit = (world: World, from: number) => {
		for (const text of world.executed) texts.add(text);

		for (const batch of world.batches.slice(from))
			if (batch.some((statement) => statementOf(statement.query).write))
				batches.push(batch.map((statement) => statement.query));
	};

	const plain = signingWorld();
	const review = await reviewed(plain);

	await reviewed(plain, OFFER, { ...CLIENT, legal_name: "Hopper Industries" });
	await plain.ok(
		readClientEvidence({ client: review.client, earlierClientId: null }),
	);
	await plain.ok(
		readClientEvidence({ client: review.client, earlierClientId: "c1" }),
	);
	visit(plain, 0);

	// The SOW of a reused MSA, as the corpus's "a reused MSA: the SOW alone is signed".
	const signing = signingWorld();
	const offer = reusing(signing);
	const reuse = await reviewed(signing, offer);

	await signing.ok(
		signBatch(
			await signing.ok(signPipeline(signing, namedOf(reuse), offer)),
			AT,
		),
	);
	await signing.ok(readSavedReceipt(reuse.documents[0]?.id ?? ""));
	visit(signing, 0);

	// Both documents with a saved draft, as the corpus's "a saved draft that matches the reviewed details".
	const both = signingWorld();
	const first = await reviewed(both);

	both.seed({
		software_agreement_drafts: [
			{
				offer_id: "o1",
				recipient_email: EMAIL,
				values_json: JSON.stringify(DRAFT),
				updated_at: EARLIER,
			},
		],
	});
	await both.ok(
		signBatch(await both.ok(signPipeline(both, namedOf(first))), AT),
	);
	visit(both, 0);

	return { texts, batches };
}

const matching = (sql: string) =>
	HOOK_PATTERNS.flatMap((pattern) =>
		pattern.test(sql) ? [String(pattern)] : [],
	);

describe("the store's SQL against the golden corpora (offer-review, offer-sign)", () => {
	it("runs only texts the corpora recorded, or a changed or added text listed here", async () => {
		const { texts } = await tour();

		const listed = new Set<string>([
			...CHANGED.map((change) => change.new),
			...ADDED.map((added) => added.sql),
		]);

		expect(
			[...texts].filter((text) => !RECORDED_SQL.has(text) && !listed.has(text)),
		).toEqual([]);

		for (const change of CHANGED) {
			expect(texts.has(change.new), change.why).toBe(true);
			expect(texts.has(change.old), change.why).toBe(false);
			expect(TODAY_SOURCE, change.why).toContain(`"${change.old}"`);
		}

		for (const added of ADDED) {
			expect(texts.has(added.sql), added.why).toBe(true);
			expect(RECORDED_SQL.has(added.sql), added.why).toBe(false);
		}

		expect(LINK_RECORDED_SQL.has(ADDED[0].sql)).toBe(true);
	});

	it("writes each batch's statements in an order the corpora recorded", async () => {
		const { batches } = await tour();

		expect(batches).toHaveLength(6);
		expect(
			batches.filter((batch) => !RECORDED_BATCHES.has(JSON.stringify(batch))),
		).toEqual([]);
	});

	it("leaves every hook's count as it was, except the listed re-points; an added read matches no hook", () => {
		expect(HOOK_PATTERNS.length).toBeGreaterThan(15);

		for (const change of CHANGED) {
			expect(matching(change.old), change.why).toEqual(
				expect.arrayContaining([...change.repoint]),
			);
			expect(matching(change.new), change.why).toEqual(
				matching(change.old).filter(
					(pattern) =>
						!change.repoint.some((repointed) => repointed === pattern),
				),
			);
			// The trigger-hit marker a hook writes names the statement's operation, table and access.
			expect(statementOf(change.new), change.why).toEqual(
				statementOf(change.old),
			);
		}

		for (const added of ADDED)
			expect(matching(added.sql), added.why).toEqual([]);
	});
});
