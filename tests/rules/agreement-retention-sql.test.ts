import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupAgreementAccess } from "~/lib/agreement-access";
import { canonicalJson, hashBytes } from "~/lib/agreement-artifacts";
import { previewAgreementRetention } from "~/lib/agreement-retention";
import { softwareGuard } from "~/lib/software-guard";
import { hashOfferToken } from "~/lib/software-offers";
import {
	ATTACHMENT_PREFIX,
	type AgreementScan,
	type AttachmentEntry,
	accessCleanup,
	agreementPrefix,
	eligibleForRetention,
	listedObject,
	type MarkerRead,
	markerAfterPreview,
	namedByAgreement,
	ORPHAN_CURSOR_KEY,
	ORPHAN_LIMIT,
	type OrphanAttachment,
	objectFree,
	objectsToDelete,
	orphanCandidate,
	orphanFound,
	orphanFree,
	orphanUnreferenced,
	type ProjectEvidence,
	pinnedByOpenOffer,
	projectEvidenceUnchanged,
	type References,
	type RetentionFacts,
	type RetentionManifest,
	retentionEligible,
	retentionManifest,
	type StoredAccessLink,
	type StoredAccessSession,
	type StoredAttachment,
	type StoredObject,
	scanCursor,
	stillEligibleWithText,
	textOrder,
	type UnattachedAttachment,
	unattachedFree,
	unattachedRowKept,
	unattachedToDelete,
} from "~/server/rules/agreement-retention";
import {
	freshMusicDb,
	type Seed,
	type SeedRow,
	seed,
} from "../golden/harness/db";
import { fakeR2Bucket } from "../helpers/r2";
import { sqliteD1 } from "../helpers/sqlite-d1";

// The retention rules decide from plain rows what today's SQL decides (src/lib/agreement-retention.ts) and what the
// clean-up's DELETE statements choose (`cleanupAgreementAccess`, src/lib/agreement-access.ts). This holds them to that SQL
// on sqlite with the real schema (db/music.sql, foreign keys off so any shape can be stored): the preview's eligibility
// query, the shared-attachment and active-offer lookups, the unattached query and the orphan reference check; and A25,
// the guards the apply's batches keep (the project evidence, the agreement still eligible with the same text, each object,
// each unattached PDF and each orphan). Each runs over the golden corpora's shapes and over a few hundred seeded random
// worlds, and must answer exactly what the rule answers. Today's clean-up and today's preview are run as they are, and
// must delete, and answer and do in the bucket, exactly what the rules decide.
//
// Today's SQL is not exported, so it is copied below with the `today` tag, which records each literal piece; the first
// test requires every piece to appear verbatim in today's source. When the conversion deletes today's module, the copies
// are pointed at the store's guard SQL instead.

const database = freshMusicDb();

database.exec("PRAGMA foreign_keys=OFF");

const db = sqliteD1(database);

const pieces: string[] = [];

/** Today's SQL text, copied; its literal pieces are checked against today's source. */
const today = (strings: TemplateStringsArray, ...values: string[]) => {
	pieces.push(...strings);

	return String.raw({ raw: strings }, ...values);
};

const ELIGIBLE = today`a.status IN ('executed','abandoned') AND a.ended_at IS NOT NULL AND a.retain_until IS NOT NULL AND a.retain_until<=? AND a.legal_hold=0
 AND NOT EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=a.id AND f.status='rendering')
 AND NOT EXISTS(SELECT 1 FROM software_agreement_deliveries d WHERE d.agreement_id=a.id AND d.status='sending')
 AND NOT EXISTS(SELECT 1 FROM software_agreement_notifications n WHERE n.agreement_id=a.id AND n.status='sending')
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.agreement_id=a.id AND p.content_deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=a.offer_id AND p.content_deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM software_offers o WHERE o.reused_msa_id=a.id AND (EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id AND p.content_deleted_at IS NULL) OR EXISTS(SELECT 1 FROM software_agreements sow WHERE sow.offer_id=o.id) OR (o.status IN ('sent','draft') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id AND p.content_deleted_at IS NOT NULL))))
 AND NOT EXISTS(SELECT 1 FROM software_agreements s WHERE s.msa_id=a.id)
 AND (a.kind='sow' OR a.terminated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM software_agreement_signatures sig WHERE sig.agreement_id=a.id))`;

const offerPin = (keyExpression = "?") =>
	today`SELECT 1 FROM software_offers o,json_each(json_extract(o.agreement_details_json,'$.attachments')) attachment
 WHERE o.status IN ('draft','sent') AND CASE WHEN json_valid(attachment.value) THEN json_extract(attachment.value,'$.key') END=${keyExpression}
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)`;

const PREVIEW = today`SELECT a.* FROM software_agreements a WHERE ${ELIGIBLE} ORDER BY a.id LIMIT 20`;

const SHARED = today`SELECT 1 FROM software_agreements other,json_each(other.attachment_manifest_json) attachment WHERE other.id NOT IN (SELECT value FROM json_each(?)) AND json_extract(attachment.value,'$.key')=?`;

const EVIDENCE = today`SELECT request_id,external_signature_details_json FROM software_projects WHERE offer_id=? ORDER BY request_id`;

const UNATTACHED = today`SELECT attachment.id,attachment.object_key AS key,attachment.sha256,attachment.created_at
    FROM software_agreement_attachments attachment
    WHERE attachment.created_at<=?
      AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
        WHERE json_extract(item.value,'$.key')=attachment.object_key)
      AND NOT EXISTS(${offerPin("attachment.object_key")})
    ORDER BY attachment.id LIMIT 100`;

const ORPHAN_REFERENCED = today`SELECT 1 WHERE
        EXISTS(SELECT 1 FROM software_agreement_attachments WHERE object_key=?)
        OR EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
          WHERE json_extract(item.value,'$.key')=?)
        OR EXISTS(${offerPin()})`;

const EVIDENCE_COUNT_GUARD = today`SELECT 1 WHERE (SELECT count(*) FROM software_projects WHERE offer_id=(SELECT offer_id FROM software_agreements WHERE id=?))=?`;

const EVIDENCE_ROW_GUARD = today`SELECT 1 FROM software_projects WHERE request_id=? AND external_signature_details_json IS ?`;

const ELIGIBLE_GUARD = today`SELECT 1 FROM software_agreements a WHERE a.id=? AND a.text_sha256=? AND ${ELIGIBLE}`;

const OBJECT_GUARD = today`SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements other,json_each(other.attachment_manifest_json) attachment WHERE other.id<>? AND json_extract(attachment.value,'$.key')=?)
         AND NOT EXISTS(${offerPin()})`;

const METADATA = today`SELECT id,request_id,filename,version,document_date,object_key,sha256,bytes,created_at,created_by
      FROM software_agreement_attachments WHERE id=? AND object_key=? AND sha256=? AND created_at=?`;

const UNATTACHED_GUARD = today`SELECT 1 FROM software_agreement_attachments attachment
      WHERE attachment.id=? AND attachment.object_key=? AND attachment.sha256=? AND attachment.created_at=? AND attachment.created_at<=?
        AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
          WHERE json_extract(item.value,'$.key')=attachment.object_key)
        AND NOT EXISTS(${offerPin()})`;

const ORPHAN_GUARD = today`SELECT 1 WHERE
      NOT EXISTS(SELECT 1 FROM software_agreement_attachments WHERE object_key=?)
      AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
        WHERE json_extract(item.value,'$.key')=?)
      AND NOT EXISTS(${offerPin()})`;

const NOW = new Date("2026-11-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const DAY = 86_400_000;

const at = (offsetMs: number) =>
	new Date(NOW.getTime() + offsetMs).toISOString();

const CUTOFF = at(-30 * DAY);
const EARLIER = at(-3_600_000);
const SHA = "0".repeat(64);
const OTHER_SHA = "f".repeat(64);
const BINDING = "AUDIO:superhuman-audio";
const key = (name: string) => `agreements/attachments/${name}.pdf`;
const KEYS = ["k1", "k2", "k3", "k4"].map(key);

const TABLES = [
	"software_agreements",
	"software_agreement_artifacts",
	"software_agreement_deliveries",
	"software_agreement_notifications",
	"software_agreement_signatures",
	"software_projects",
	"software_offers",
	"software_agreement_attachments",
	"software_agreement_sessions",
	"software_agreement_links",
];

function store(world: Seed) {
	database.exec(TABLES.map((table) => `DELETE FROM ${table};`).join(""));
	seed(database, world);
}

/** The rows a statement reads, as node:sqlite gives them. */
function rows<T>(sql: string, ...values: SQLInputValue[]): T[] {
	// SAFETY: node:sqlite gives one object per row keyed by the statement's columns, which are the columns T names.
	return database.prepare(sql).all(...values) as T[];
}

const found = (sql: string, ...values: SQLInputValue[]) =>
	database.prepare(sql).get(...values) !== undefined;

/** Whether today's guard passes: `softwareGuard` raises "malformed JSON" in its batch when its condition does not hold. */
async function guardsHold(
	guards: readonly (readonly [string, readonly (string | number | null)[]])[],
) {
	try {
		await db.batch(
			guards.map(([query, values]) => softwareGuard(db, query, [...values])),
		);

		return true;
	} catch (error) {
		if (error instanceof Error && error.message.includes("malformed JSON"))
			return false;

		throw error;
	}
}

// The rows as the store will read them for the rules.

const readFacts = (): RetentionFacts => ({
	agreements: rows("SELECT * FROM software_agreements"),
	artifacts: rows(
		"SELECT agreement_id,status FROM software_agreement_artifacts",
	),
	deliveries: rows(
		"SELECT agreement_id,status FROM software_agreement_deliveries",
	),
	notifications: rows(
		"SELECT agreement_id,status FROM software_agreement_notifications",
	),
	projects: rows(
		"SELECT request_id,offer_id,agreement_id,content_deleted_at,external_signature_details_json FROM software_projects",
	),
	offers: rows("SELECT id,status,reused_msa_id FROM software_offers"),
	signatures: rows("SELECT agreement_id FROM software_agreement_signatures"),
});

const readReferences = (): References => ({
	agreements: rows(
		"SELECT a.id AS agreement_id,json_extract(item.value,'$.key') AS key FROM software_agreements a,json_each(a.attachment_manifest_json) item",
	),
	offers: rows(
		"SELECT o.id AS offer_id,o.status,CASE WHEN json_valid(item.value) THEN json_extract(item.value,'$.key') END AS key,(SELECT count(*) FROM software_projects p WHERE p.offer_id=o.id) AS projects FROM software_offers o,json_each(json_extract(o.agreement_details_json,'$.attachments')) item",
	),
});

const readAttachments = (): StoredAttachment[] =>
	rows(
		"SELECT id,request_id,filename,version,document_date,object_key,sha256,bytes,created_at,created_by FROM software_agreement_attachments",
	);

// Rows to store.

const agreementRow = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	kind: "sow",
	offer_id: `o-${id}`,
	request_id: `r-${id}`,
	client_id: `c-${id}`,
	template_id: "t1",
	status: "executed",
	canonical_text: `text of ${id}`,
	text_sha256: SHA,
	values_json: "{}",
	attachment_manifest_json: "[]",
	created_at: EARLIER,
	executed_at: EARLIER,
	effective_on: "2026-11-01",
	ended_at: EARLIER,
	retain_until: EARLIER,
	legal_hold: 0,
	review_session_hash: "h",
	...over,
});

const offerRow = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	request_id: `r-${id}`,
	version: 1,
	status: "superseded",
	terms_json: "{}",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

const projectRow = (
	requestId: string,
	offerId: string,
	over: SeedRow = {},
): SeedRow => ({
	request_id: requestId,
	offer_id: offerId,
	terms_json: "{}",
	payment_mode: "standard",
	signatures_recorded_at: EARLIER,
	first_payment_recorded_at: EARLIER,
	started_at: EARLIER,
	started_by: "owner",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

const signatureRow = (agreementId: string): SeedRow => ({
	id: `sig-${agreementId}`,
	agreement_id: agreementId,
	party: "client",
	typed_name: "Grace",
	title: "Owner",
	consent_text: "consent",
	consent_version: "1",
	consent_at: EARLIER,
	signed_at: EARLIER,
	document_sha256: SHA,
	verified_email: "grace@example.test",
	verified_at: EARLIER,
	verification_method: "email",
	intent_text: "intent",
	document_list_json: "[]",
	receipt_id: "receipt",
	ip_address: "192.0.2.1",
	user_agent: "test",
});

const attachmentRow = (objectKey: string, over: SeedRow = {}): SeedRow => ({
	id: `att-${objectKey.slice(ATTACHMENT_PREFIX.length)}`,
	request_id: "r1",
	filename: "file.pdf",
	version: "1",
	document_date: "2026-10-01",
	object_key: objectKey,
	sha256: SHA,
	bytes: 10,
	created_at: at(-31 * DAY),
	created_by: "owner@example.test",
	...over,
});

const manifestOf = (...keys: string[]) =>
	JSON.stringify(keys.map((name) => ({ key: name, sha256: SHA })));

const detailsOf = (...keys: string[]) =>
	JSON.stringify({
		attachments: keys.map((name) => ({ key: name, sha256: SHA })),
	});

function merge(...seeds: Seed[]): Seed {
	const merged: { [table: string]: SeedRow[] } = {};

	for (const part of seeds)
		for (const [table, list] of Object.entries(part))
			merged[table] = [...(merged[table] ?? []), ...list];

	return merged;
}

/** One retiring SOW, its offer, and anything else. */
const sow = (over: SeedRow = {}, ...extra: Seed[]): Seed =>
	merge(
		{
			software_offers: [offerRow("o-a1")],
			software_agreements: [agreementRow("a1", over)],
		},
		...extra,
	);

/** One retiring MSA with no offer, and anything else. */
const msa = (over: SeedRow = {}, ...extra: Seed[]): Seed =>
	merge(
		{
			software_agreements: [
				agreementRow("m1", { kind: "msa", offer_id: null, ...over }),
			],
		},
		...extra,
	);

const reusingOffer = (status: string, ...extra: Seed[]): Seed =>
	msa(
		{},
		{ software_offers: [offerRow("o2", { status, reused_msa_id: "m1" })] },
		...extra,
	);

const decide = <W>(answer: Effect.Effect<W, never>) => Effect.runSync(answer);

describe("the copies of today's SQL", () => {
	it("are today's text, piece for piece", () => {
		const source = readFileSync(
			new URL("../../src/lib/agreement-retention.ts", import.meta.url),
			"utf8",
		);

		for (const piece of pieces) expect(source).toContain(piece);
	});
});

/** What a world's SQL and rules say, compared; counts each answer so a run is seen to cover both. */
const tally = new Map<string, number>();

const count = (name: string, answer: boolean) =>
	tally.set(`${name}:${answer}`, (tally.get(`${name}:${answer}`) ?? 0) + 1);

async function holdEverything(world: Seed) {
	store(world);

	const facts = readFacts();
	const references = readReferences();
	const attachments = readAttachments();
	const chosen = decide(retentionEligible.decide({ now: NOW }, facts));
	const preview = rows<{ id: string }>(PREVIEW, NOW_ISO);

	expect(chosen.map((row) => row.id)).toEqual(preview.map((row) => row.id));
	expect(chosen).toEqual(preview);

	const eligible = rows<{ id: string }>(
		`SELECT a.id FROM software_agreements a WHERE ${ELIGIBLE} ORDER BY a.id`,
		NOW_ISO,
	).map((row) => row.id);

	for (const agreement of facts.agreements) {
		const answer = eligibleForRetention({ agreement, facts, now: NOW_ISO });

		count("eligible", answer);
		expect(answer, agreement.id).toBe(eligible.includes(agreement.id));
	}

	// A25: the agreement still eligible with the reviewed text.
	for (const id of [...facts.agreements.map((row) => row.id), "gone"])
		for (const sha of [SHA, OTHER_SHA]) {
			const answer = stillEligibleWithText({ id, sha256: sha }, facts, NOW_ISO);

			count("eligible with text", answer);
			expect(answer, `${id} ${sha}`).toBe(
				await guardsHold([[ELIGIBLE_GUARD, [id, sha, NOW_ISO]]]),
			);
		}

	// A25: the project evidence unchanged, for the evidence the preview reads and for evidence that differs from it.
	for (const agreement of [
		...facts.agreements,
		{ id: "gone", offer_id: "o1" },
	]) {
		const evidence = rows<ProjectEvidence>(EVIDENCE, agreement.offer_id);
		const someProject = facts.projects[0];

		const variants: ProjectEvidence[][] = [
			evidence,
			evidence.slice(1),
			[
				...evidence,
				{ request_id: "p9", external_signature_details_json: null },
			],
			evidence.map((project, index) =>
				index === 0
					? {
							...project,
							external_signature_details_json:
								project.external_signature_details_json === null ? "{}" : null,
						}
					: project,
			),
			someProject ? [someProject, ...evidence.slice(1)] : [],
		];

		for (const variant of variants) {
			const answer = projectEvidenceUnchanged(
				{ id: agreement.id, project_evidence: variant },
				facts.agreements,
				facts.projects,
			);

			count("evidence", answer);
			expect(answer, `${agreement.id} ${JSON.stringify(variant)}`).toBe(
				await guardsHold([
					[EVIDENCE_COUNT_GUARD, [agreement.id, variant.length]],
					...variant.map(
						(project) =>
							[
								EVIDENCE_ROW_GUARD,
								[project.request_id, project.external_signature_details_json],
							] as const,
					),
				]),
			);
		}
	}

	// The preview's lookups for a retiring agreement's attachments, and A25 for each object.
	const retiring = chosen.map((row) => row.id);

	for (const name of [...KEYS, "agreements/a1/signed.pdf"]) {
		const shared = namedByAgreement(name, references, (id) =>
			retiring.includes(id),
		);

		const pinned = pinnedByOpenOffer(name, references);

		count("shared", shared);
		count("pinned", pinned);
		expect(shared, name).toBe(found(SHARED, JSON.stringify(retiring), name));
		expect(pinned, name).toBe(found(offerPin(), name));

		for (const id of [...facts.agreements.map((row) => row.id), "gone"]) {
			const answer = objectFree(name, id, references);

			count("object", answer);
			expect(answer, `${name} ${id}`).toBe(
				await guardsHold([[OBJECT_GUARD, [id, name, name]]]),
			);
		}
	}

	// Unattached PDFs: the preview's list, the apply's metadata read, and A25.
	expect(
		decide(
			unattachedToDelete.decide({ now: NOW }, { attachments, references }),
		),
	).toEqual(rows<UnattachedAttachment>(UNATTACHED, CUTOFF));

	for (const row of attachments) {
		const entry: UnattachedAttachment = {
			id: row.id,
			key: row.object_key,
			sha256: row.sha256,
			created_at: row.created_at,
		};

		for (const variant of [
			entry,
			{ ...entry, sha256: OTHER_SHA },
			{ ...entry, created_at: at(-40 * DAY) },
			{ ...entry, key: key("elsewhere") },
		]) {
			const answer = unattachedFree(variant, CUTOFF, attachments, references);

			count("unattached", answer);
			expect(answer, JSON.stringify(variant)).toBe(
				await guardsHold([
					[
						UNATTACHED_GUARD,
						[
							variant.id,
							variant.key,
							variant.sha256,
							variant.created_at,
							CUTOFF,
							variant.key,
						],
					],
				]),
			);

			const kept = Effect.runSync(
				Effect.match(
					unattachedRowKept.decide(
						{ entry: variant },
						{
							row:
								attachments.find((stored) => stored.id === variant.id) ?? null,
						},
					),
					{ onFailure: () => false, onSuccess: () => true },
				),
			);

			expect(kept, JSON.stringify(variant)).toBe(
				found(
					METADATA,
					variant.id,
					variant.key,
					variant.sha256,
					variant.created_at,
				),
			);
		}
	}

	// Orphans: the preview's reference check and A25.
	for (const name of [...KEYS, key("nothing")]) {
		const answer = orphanFree(name, attachments, references);

		count("orphan", answer);
		expect(!answer, name).toBe(found(ORPHAN_REFERENCED, name, name, name));
		expect(answer, name).toBe(
			await guardsHold([[ORPHAN_GUARD, [name, name, name]]]),
		);
	}

	return chosen.map((row) => row.id);
}

describe("the eligibility query and A25, on the golden corpora's shapes", () => {
	const cases: [string, Seed, string[]][] = [
		["an eligible SOW", sow(), ["a1"]],
		["an abandoned SOW", sow({ status: "abandoned" }), ["a1"]],
		["a SOW in review", sow({ status: "review", ended_at: null }), []],
		["a client-signed SOW", sow({ status: "client_signed" }), []],
		["a SOW that has not ended", sow({ ended_at: null }), []],
		["a SOW with no retain_until", sow({ retain_until: null }), []],
		["retain_until in the future", sow({ retain_until: at(DAY) }), []],
		["retain_until at this instant", sow({ retain_until: NOW_ISO }), ["a1"]],
		["retain_until one millisecond later", sow({ retain_until: at(1) }), []],
		["a legal hold", sow({ legal_hold: 1 }), []],
		[
			"an artifact being rendered",
			sow(
				{},
				{
					software_agreement_artifacts: [
						{ agreement_id: "a1", status: "rendering" },
					],
				},
			),
			[],
		],
		[
			"a failed artifact",
			sow(
				{},
				{
					software_agreement_artifacts: [
						{ agreement_id: "a1", status: "failed", error_code: "render" },
					],
				},
			),
			["a1"],
		],
		[
			"a delivery being sent",
			sow(
				{},
				{
					software_agreement_deliveries: [
						{
							agreement_id: "a1",
							recipient_role: "client",
							email: "grace@example.test",
							status: "sending",
						},
					],
				},
			),
			[],
		],
		[
			"a notification being sent",
			sow(
				{},
				{
					software_agreement_notifications: [
						{
							agreement_id: "a1",
							kind: "signature-receipt",
							email: "grace@example.test",
							status: "sending",
						},
					],
				},
			),
			[],
		],
		[
			"a live project of the agreement",
			sow(
				{},
				{ software_projects: [projectRow("r9", "o9", { agreement_id: "a1" })] },
			),
			[],
		],
		[
			"a project of the agreement whose content was deleted",
			sow(
				{},
				{
					software_projects: [
						projectRow("r1", "o-a1", {
							agreement_id: "a1",
							content_deleted_at: EARLIER,
							external_signature_details_json: '{"who":"external"}',
						}),
					],
				},
			),
			["a1"],
		],
		[
			"a live project of the same offer",
			sow({}, { software_projects: [projectRow("r1", "o-a1")] }),
			[],
		],
		["an MSA without signatures", msa(), ["m1"]],
		[
			"a signed MSA that is not terminated",
			msa({}, { software_agreement_signatures: [signatureRow("m1")] }),
			[],
		],
		[
			"a signed MSA that was terminated",
			msa(
				{ terminated_at: EARLIER },
				{ software_agreement_signatures: [signatureRow("m1")] },
			),
			["m1"],
		],
		[
			"an MSA reused by an offer with a live project",
			reusingOffer("superseded", {
				software_projects: [projectRow("r2", "o2")],
			}),
			[],
		],
		[
			"an MSA reused by an offer that has an SOW",
			reusingOffer("superseded", {
				software_agreements: [
					agreementRow("a2", {
						offer_id: "o2",
						status: "review",
						ended_at: null,
						retain_until: null,
					}),
				],
			}),
			[],
		],
		["an MSA reused by a sent offer", reusingOffer("sent"), []],
		["an MSA reused by a draft offer", reusingOffer("draft"), []],
		[
			"an MSA reused only by a superseded offer",
			reusingOffer("superseded"),
			["m1"],
		],
		[
			"an MSA reused only by a withdrawn offer",
			reusingOffer("withdrawn"),
			["m1"],
		],
		[
			"an MSA reused by a sent offer whose project's content was deleted",
			reusingOffer("sent", {
				software_projects: [
					projectRow("r2", "o2", { content_deleted_at: EARLIER }),
				],
			}),
			["m1"],
		],
		[
			"an MSA linked by an SOW",
			msa(
				{},
				{
					software_agreements: [
						agreementRow("a2", { status: "review", msa_id: "m1" }),
					],
				},
			),
			[],
		],
		["an agreement that names itself as its MSA", sow({ msa_id: "a1" }), []],
		[
			"twenty-one eligible agreements",
			merge(
				...Array.from({ length: 21 }, (_, index) => ({
					software_agreements: [
						agreementRow(`a${String(20 - index).padStart(3, "0")}`),
					],
				})),
			),
			Array.from(
				{ length: 20 },
				(_, index) => `a${String(index).padStart(3, "0")}`,
			),
		],
		[
			"ids SQLite and JavaScript order differently",
			merge(
				{ software_agreements: [agreementRow("\u{1f600}")] },
				{ software_agreements: [agreementRow("～")] },
			),
			["～", "\u{1f600}"],
		],
	];

	for (const [name, world, expected] of cases)
		it(`${name}: the rule chooses ${JSON.stringify(expected)}, as the SQL does`, async () => {
			expect(await holdEverything(world)).toEqual(expected);
		});
});

// Seeded random worlds.

type Rand = () => number;

/** mulberry32: a small seeded generator, so every run builds the same worlds. */
function random(start: number): Rand {
	let state = start >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = <T>(rand: Rand, list: readonly T[]): T =>
	list[Math.floor(rand() * list.length)];

const UPLOADED = [at(-31 * DAY), at(-30 * DAY), at(-30 * DAY + 1), EARLIER];

type Stored = { readonly body: string; readonly uploaded: Date };

type World = {
	readonly seed: Seed;
	readonly objects: { readonly [name: string]: Stored };
};

/**
 * A world of up to five agreements, three offers, three projects, the rows that keep an agreement, attachment metadata
 * and stored objects. `odd` adds manifest items the site never writes (no key, a null or numeric key, a nested array),
 * which only the SQL comparisons read: today's preview parses manifests in JavaScript and binds their keys. `retiring`
 * makes agreements that may be retired, and the rows that keep them, likelier, so the preview's manifests list some.
 */
function randomWorld(rand: Rand, odd: boolean, retiring = false): World {
	const ids = ["a1", "a2", "a3", "m1", "m2"].filter(() => rand() < 0.8);

	const manifests = [
		"[]",
		manifestOf(KEYS[0]),
		manifestOf(KEYS[0], KEYS[1]),
		manifestOf(KEYS[1]),
		manifestOf(KEYS[2]),
		...(odd
			? [
					'[{"other":1}]',
					'[{"key":null}]',
					'[{"key":5}]',
					"[[1]]",
					`[{"key":"${KEYS[3]}","sha256":"${SHA}"},5]`,
				]
			: []),
	];

	const details = [
		null,
		"{}",
		'{"attachments":[]}',
		detailsOf(KEYS[0]),
		detailsOf(KEYS[1], KEYS[2]),
		'{"attachments":["text",{"key":null}]}',
		'{"attachments":[{"key":5}]}',
		JSON.stringify({ attachments: { x: { key: KEYS[0] } } }),
		JSON.stringify({ attachments: [JSON.stringify({ key: KEYS[3] })] }),
		'{"attachments":5}',
		'{"attachments":null}',
	];

	const offers = ["o1", "o2", "o3"].map((id) =>
		offerRow(id, {
			status: pick(rand, ["draft", "sent", "superseded", "withdrawn"]),
			reused_msa_id: pick(rand, [null, null, ...ids]),
			agreement_details_json: pick(rand, details),
		}),
	);

	const liveSows = new Set<string>();

	const agreements = ids.map((id) => {
		const kind = pick(rand, ["sow", "msa"]);

		const status = pick(rand, [
			"review",
			"client_signed",
			"executed",
			"executed",
			"abandoned",
			...(retiring ? ["executed", "abandoned", "executed"] : []),
		]);

		let offerId = pick(rand, [null, "o1", "o2", "o3"]);

		// One live SOW per offer (software_agreements_sow_offer).
		if (kind === "sow" && status !== "abandoned" && offerId !== null) {
			if (liveSows.has(offerId)) offerId = null;
			else liveSows.add(offerId);
		}

		return agreementRow(id, {
			kind,
			status,
			offer_id: offerId,
			msa_id: pick(rand, [null, null, null, ...ids]),
			ended_at: pick(rand, [
				null,
				EARLIER,
				EARLIER,
				...(retiring ? [EARLIER, EARLIER] : []),
			]),
			retain_until: pick(rand, [
				null,
				EARLIER,
				NOW_ISO,
				at(1),
				at(DAY),
				...(retiring ? [EARLIER, NOW_ISO, EARLIER] : []),
			]),
			legal_hold: pick(rand, [0, 0, 1, ...(retiring ? [0, 0, 0] : [])]),
			terminated_at: pick(rand, [null, null, EARLIER]),
			text_sha256: pick(rand, [SHA, SHA, OTHER_SHA]),
			attachment_manifest_json: pick(rand, manifests),
		});
	});

	const some = <T>(list: readonly T[], chance: number) =>
		list.filter(() => rand() < (retiring ? chance / 2 : chance));

	const statusOf = (statuses: readonly string[]) => pick(rand, statuses);
	const objects: { [name: string]: Stored } = {};

	for (const id of some(ids, 0.7)) {
		objects[`agreements/${id}/signed.pdf`] = {
			body: `signed copy of ${id}`,
			uploaded: NOW,
		};
		objects[`agreements/${id}/certificate.pdf`] = {
			body: `certificate of ${id}`,
			uploaded: NOW,
		};
	}

	for (const name of some(KEYS, 0.7))
		objects[name] = {
			body: `bytes of ${name}`,
			uploaded: new Date(pick(rand, UPLOADED)),
		};

	if (rand() < 0.3)
		objects["agreements/other/file.pdf"] = {
			body: "outside",
			uploaded: new Date(UPLOADED[0]),
		};

	if (rand() < 0.3)
		objects["agreements/a10/signed.pdf"] = { body: "longer id", uploaded: NOW };

	const marker = pick(rand, [
		null,
		JSON.stringify({ version: 1, cursor: KEYS[1] }),
		"{nope",
		JSON.stringify({ version: 2, cursor: KEYS[0] }),
		JSON.stringify({ version: 1, cursor: "" }),
		JSON.stringify({ version: 1, cursor: "z".repeat(4097) }),
		JSON.stringify({ version: 1, cursor: 7 }),
		"null",
		"[]",
	]);

	if (marker !== null)
		objects[ORPHAN_CURSOR_KEY] = { body: marker, uploaded: NOW };

	return {
		seed: {
			software_offers: offers,
			software_agreements: agreements,
			software_projects: some(["p1", "p2", "p3"], 0.5).map((id) =>
				projectRow(id, pick(rand, ["o1", "o2", "o3"]), {
					agreement_id: pick(rand, [null, ...ids]),
					content_deleted_at: pick(rand, [null, EARLIER]),
					external_signature_details_json: pick(rand, [
						null,
						'{"who":"external"}',
					]),
				}),
			),
			software_agreement_artifacts: some(ids, 0.5).map((id) => ({
				agreement_id: id,
				status: statusOf(["pending", "rendering", "ready", "failed"]),
			})),
			software_agreement_deliveries: some(ids, 0.5).map((id) => ({
				agreement_id: id,
				recipient_role: "client",
				email: "grace@example.test",
				status: statusOf(["pending", "sending", "sent", "failed"]),
			})),
			software_agreement_notifications: some(ids, 0.5).map((id) => ({
				agreement_id: id,
				kind: "signature-receipt",
				email: "grace@example.test",
				status: statusOf(["pending", "sending", "sent", "failed"]),
			})),
			software_agreement_signatures: some(ids, 0.5).map(signatureRow),
			software_agreement_attachments: some(KEYS, 0.6).map((name) =>
				attachmentRow(name, { created_at: pick(rand, UPLOADED) }),
			),
		},
		objects,
	};
}

describe("the eligibility query and A25, on random worlds", () => {
	it("answer as the rules do in every world, and the worlds reach both answers of each", async () => {
		tally.clear();

		for (let index = 0; index < 160; index += 1)
			await holdEverything(
				randomWorld(random(index + 1), index % 2 === 0, index % 3 !== 0).seed,
			);

		for (const name of [
			"eligible",
			"eligible with text",
			"evidence",
			"shared",
			"pinned",
			"object",
			"unattached",
			"orphan",
		]) {
			expect(tally.get(`${name}:true`), name).toBeGreaterThan(10);
			expect(tally.get(`${name}:false`), name).toBeGreaterThan(10);
		}
	}, 20_000);
});

// Today's preview against the rules, called as the flow will call them, in the same database and in two identical
// buckets: the same manifest (byte for byte), the same bucket calls in the same order, the same bucket afterwards.

type Bucket = {
	readonly binding: R2Bucket;
	readonly calls: string[];
	readonly contents: () => { [name: string]: string };
};

function bucketOf(
	objects: { readonly [name: string]: Stored },
	vanishing: readonly string[] = [],
): Bucket {
	const held = new Map(Object.entries(objects));
	const calls: string[] = [];

	const binding = fakeR2Bucket({
		list: async (options: R2ListOptions) => {
			calls.push(
				`list ${JSON.stringify([options.prefix, options.cursor ?? null, options.limit ?? null])}`,
			);

			const cursor = options.cursor;

			const names = [...held.keys()]
				.filter(
					(name) =>
						name.startsWith(options.prefix ?? "") &&
						(cursor === undefined || name > cursor),
				)
				.sort();

			const limit = options.limit ?? 1000;
			const page = names.slice(0, limit);

			const listed = page.map((name) => ({
				key: name,
				uploaded: held.get(name)?.uploaded,
			}));

			return names.length > limit
				? { objects: listed, truncated: true, cursor: page.at(-1) }
				: { objects: listed, truncated: false };
		},
		get: async (name: string) => {
			calls.push(`get ${name}`);
			const object = held.get(name);

			return object && !vanishing.includes(name)
				? {
						etag: `etag of ${name}`,
						arrayBuffer: async () =>
							new TextEncoder().encode(object.body).buffer,
					}
				: null;
		},
		put: async (name: string, body: string, options?: R2PutOptions) => {
			calls.push(`put ${JSON.stringify([name, body, options ?? null])}`);
			held.set(name, { body, uploaded: NOW });
		},
		delete: async (name: string) => {
			calls.push(`delete ${name}`);
			held.delete(name);
		},
	});

	return {
		binding,
		calls,
		contents: () =>
			Object.fromEntries(
				[...held].map(([name, object]) => [name, object.body]),
			),
	};
}

/** A rule's answer, or an error with its refusal's sentence, as today's code throws a `ReaderMessage`. */
function settle<W, E extends { readonly say: string }>(
	answer: Effect.Effect<W, E>,
): W {
	const settled = Effect.runSync(
		Effect.match(answer, {
			onFailure: (refusal) => ({ refused: refusal.say }),
			onSuccess: (value) => ({ value }),
		}),
	);

	if ("refused" in settled) throw new Error(settled.refused);

	return settled.value;
}

const digestOf = async (object: R2ObjectBody | null) =>
	object ? hashBytes(await object.arrayBuffer()) : null;

async function markerOf(object: R2ObjectBody | null): Promise<MarkerRead> {
	if (!object) return { kind: "absent" };

	try {
		return {
			kind: "read",
			etag: object.etag,
			saved: JSON.parse(new TextDecoder().decode(await object.arrayBuffer())),
		};
	} catch {
		return { kind: "unreadable", etag: object.etag };
	}
}

/** The items of a stored attachment manifest, parsed as today's preview parses them. */
const attachmentsOf = (text: string): AttachmentEntry[] => JSON.parse(text);

/** The preview, as the flow will run it: today's reads and bucket calls in today's order, each decision a rule's. */
async function previewByRules(
	bucket: R2Bucket,
	scan?: { readonly cursor: string | null },
) {
	const chosen = decide(retentionEligible.decide({ now: NOW }, readFacts()));

	const retiring = chosen.map((row) => ({
		id: row.id,
		attachments: attachmentsOf(row.attachment_manifest_json),
	}));

	const agreements: AgreementScan[] = [];

	for (const row of chosen) {
		const listed: StoredObject[] = [];
		let cursor: string | undefined;

		do {
			const page = await bucket.list({
				prefix: agreementPrefix(row.id),
				cursor,
			});

			for (const object of page.objects)
				listed.push(
					settle(
						listedObject.decide(
							{ key: object.key },
							{ digest: await digestOf(await bucket.get(object.key)) },
						),
					),
				);

			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);

		agreements.push({
			row,
			rowHash: await hashOfferToken(canonicalJson(row)),
			projectEvidence: rows<ProjectEvidence>(
				"SELECT request_id,external_signature_details_json FROM software_projects WHERE offer_id=?",
				row.offer_id,
			),
			objects: decide(
				objectsToDelete.decide(
					{ id: row.id },
					{ retiring, listed, references: readReferences() },
				),
			),
		});
	}

	const unattached = decide(
		unattachedToDelete.decide(
			{ now: NOW },
			{ attachments: readAttachments(), references: readReferences() },
		),
	);

	const from = scan
		? scan.cursor
		: decide(
				scanCursor.decide(null, {
					marker: await markerOf(await bucket.get(ORPHAN_CURSOR_KEY)),
				}),
			);

	const listing = await bucket.list({
		prefix: ATTACHMENT_PREFIX,
		limit: ORPHAN_LIMIT,
		cursor: from ?? undefined,
	});

	const orphans: OrphanAttachment[] = [];

	for (const object of listing.objects) {
		const step = decide(
			orphanCandidate.decide({ now: NOW }, { object, found: orphans.length }),
		);

		if (step === "stop") break;

		if (step === "skip") continue;

		const fetch = Effect.runSync(
			orphanUnreferenced.decide(
				{ key: object.key },
				{ rows: readAttachments(), references: readReferences() },
			),
		);

		if (Option.isNone(fetch)) continue;

		const orphan = Effect.runSync(
			orphanFound.decide(
				{ object },
				{ digest: await digestOf(await bucket.get(object.key)) },
			),
		);

		if (Option.isSome(orphan)) orphans.push(orphan.value);
	}

	const nextCursor = listing.truncated ? listing.cursor : null;

	const marker = Effect.runSync(
		markerAfterPreview.decide(
			{ reviewed: scan !== undefined, nextCursor },
			{ found: orphans.length },
		),
	);

	if (Option.isSome(marker))
		await bucket.put(marker.value.key, marker.value.body);

	return decide(
		retentionManifest.decide(
			{ now: NOW, binding: BINDING, scanCursor: from, nextCursor },
			{ agreements, unattached, orphans },
		),
	);
}

const answerOf = (run: Promise<unknown>) =>
	run.then(
		(manifest) => JSON.stringify(manifest),
		(error: Error) => `refused: ${error.message}`,
	);

async function samePreview(
	world: World,
	scan?: { readonly cursor: string | null },
	vanishing: readonly string[] = [],
) {
	store(world.seed);

	const old = bucketOf(world.objects, vanishing);
	const converted = bucketOf(world.objects, vanishing);

	const expected = await answerOf(
		previewAgreementRetention(db, old.binding, BINDING, NOW, scan),
	);

	expect(await answerOf(previewByRules(converted.binding, scan))).toBe(
		expected,
	);
	expect(converted.calls).toEqual(old.calls);
	expect(converted.contents()).toEqual(old.contents());

	return expected;
}

const objectsOf = (id: string) => ({
	[`agreements/${id}/signed.pdf`]: {
		body: `signed copy of ${id}`,
		uploaded: NOW,
	},
	[`agreements/${id}/certificate.pdf`]: {
		body: `certificate of ${id}`,
		uploaded: NOW,
	},
});

const old = (body: string): Stored => ({
	body,
	uploaded: new Date(at(-31 * DAY)),
});

describe("today's preview and the rules", () => {
	const scenes: [string, World][] = [
		["the empty archive", { seed: {}, objects: {} }],
		[
			"an eligible SOW with its objects",
			{ seed: sow(), objects: objectsOf("a1") },
		],
		[
			"an object of a longer id",
			{
				seed: sow(),
				objects: {
					...objectsOf("a1"),
					"agreements/a10/signed.pdf": { body: "other", uploaded: NOW },
				},
			},
		],
		[
			"an attachment of the agreement",
			{
				seed: sow(
					{ attachment_manifest_json: manifestOf(KEYS[0]) },
					{ software_agreement_attachments: [attachmentRow(KEYS[0])] },
				),
				objects: { ...objectsOf("a1"), [KEYS[0]]: old("pdf") },
			},
		],
		[
			"an attachment shared with a kept agreement, and one pinned by a sent offer",
			{
				seed: sow(
					{ attachment_manifest_json: manifestOf(KEYS[0], KEYS[1]) },
					{
						software_agreements: [
							agreementRow("a2", {
								retain_until: at(DAY),
								attachment_manifest_json: manifestOf(KEYS[0]),
							}),
						],
						software_offers: [
							offerRow("o2", {
								status: "sent",
								agreement_details_json: detailsOf(KEYS[1]),
							}),
						],
					},
				),
				objects: {
					...objectsOf("a1"),
					[KEYS[0]]: old("a"),
					[KEYS[1]]: old("b"),
				},
			},
		],
		[
			"two retiring agreements share an attachment",
			{
				seed: merge(sow({ attachment_manifest_json: manifestOf(KEYS[0]) }), {
					software_agreements: [
						agreementRow("a2", {
							attachment_manifest_json: manifestOf(KEYS[0]),
						}),
					],
				}),
				objects: {
					...objectsOf("a1"),
					...objectsOf("a2"),
					[KEYS[0]]: old("a"),
				},
			},
		],
		[
			"unattached PDFs old, at the line, young, named and pinned",
			{
				seed: merge(
					{
						software_agreement_attachments: [
							attachmentRow(KEYS[0]),
							attachmentRow(KEYS[1], { created_at: CUTOFF }),
							attachmentRow(KEYS[2], { created_at: at(-30 * DAY + 1) }),
							attachmentRow(KEYS[3]),
							attachmentRow(key("pinned")),
						],
						software_offers: [
							offerRow("o2", {
								status: "draft",
								agreement_details_json: detailsOf(key("pinned")),
							}),
						],
					},
					sow({
						retain_until: at(DAY),
						attachment_manifest_json: manifestOf(KEYS[3]),
					}),
				),
				objects: {},
			},
		],
		[
			"a hundred and one unattached PDFs",
			{
				seed: {
					software_agreement_attachments: Array.from(
						{ length: 101 },
						(_, index) =>
							attachmentRow(key(`u${String(index).padStart(3, "0")}`)),
					),
				},
				objects: {},
			},
		],
		[
			"orphans old, at the line, young, referenced three ways and outside the prefix",
			{
				seed: merge(
					{
						software_agreement_attachments: [attachmentRow(key("meta"))],
						software_offers: [
							offerRow("o2", {
								status: "sent",
								agreement_details_json: detailsOf(key("offered")),
							}),
						],
					},
					sow({
						retain_until: at(DAY),
						attachment_manifest_json: manifestOf(key("kept")),
					}),
				),
				objects: {
					[key("lost")]: old("lost"),
					[key("line")]: { body: "line", uploaded: new Date(CUTOFF) },
					[key("young")]: {
						body: "young",
						uploaded: new Date(at(-30 * DAY + 1)),
					},
					[key("meta")]: old("meta"),
					[key("kept")]: old("kept"),
					[key("offered")]: old("offered"),
					"agreements/other/file.pdf": old("outside"),
				},
			},
		],
		[
			"a hundred and one old objects",
			{
				seed: {},
				objects: Object.fromEntries(
					Array.from({ length: 101 }, (_, index) => [
						key(`o${String(index).padStart(3, "0")}`),
						old(`object ${index}`),
					]),
				),
			},
		],
		[
			"a hundred and one young objects",
			{
				seed: {},
				objects: Object.fromEntries(
					Array.from({ length: 101 }, (_, index) => [
						key(`o${String(index).padStart(3, "0")}`),
						{ body: `object ${index}`, uploaded: NOW },
					]),
				),
			},
		],
		...[
			JSON.stringify({ version: 1, cursor: key("a") }),
			"{nope",
			"null",
			JSON.stringify({ version: 2, cursor: key("a") }),
			JSON.stringify({ version: 1, cursor: "" }),
			JSON.stringify({ version: 1, cursor: "z".repeat(4097) }),
			JSON.stringify({ version: 1, cursor: 7 }),
		].map((marker): [string, World] => [
			`a marker ${marker.slice(0, 40)}`,
			{
				seed: {},
				objects: {
					[key("a")]: old("a"),
					[key("b")]: old("b"),
					[key("c")]: old("c"),
					[ORPHAN_CURSOR_KEY]: { body: marker, uploaded: NOW },
				},
			},
		]),
	];

	for (const [name, world] of scenes)
		it(`${name}: the same manifest and bucket calls, for the owner's preview and the apply's scans`, async () => {
			await samePreview(world);
			await samePreview(world, { cursor: null });
			await samePreview(world, { cursor: key("a") });
		});

	it("an object the listing named that is gone when read: the same refusal, after the same calls", async () => {
		expect(
			await samePreview({ seed: sow(), objects: objectsOf("a1") }, undefined, [
				"agreements/a1/certificate.pdf",
			]),
		).toBe("refused: Archive changed.");
	});

	it("random worlds: the same manifest and bucket calls", async () => {
		const reached = { agreements: 0, objects: 0, unattached: 0, orphans: 0 };

		for (let index = 0; index < 150; index += 1) {
			const world = randomWorld(random(1000 + index), false, true);
			const manifest: RetentionManifest = JSON.parse(await samePreview(world));

			reached.agreements += manifest.agreements.length ? 1 : 0;
			reached.objects += manifest.agreements.some(
				(entry) => entry.objects.length,
			)
				? 1
				: 0;
			reached.unattached += manifest.unattached_attachments.length ? 1 : 0;
			reached.orphans += manifest.orphan_attachments.length ? 1 : 0;
			await samePreview(world, { cursor: index % 3 ? null : KEYS[1] });
		}

		for (const [name, worlds] of Object.entries(reached))
			expect(worlds, name).toBeGreaterThan(15);
	}, 20_000);
});

describe("the access clean-up and today's DELETE statements", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const linkRow = (id: string, expiresAt: string): SeedRow => ({
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
		revokedAt: string | null,
	): SeedRow => ({
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

	async function sameCleanup(world: Seed) {
		store(world);

		const sessions = rows<StoredAccessSession>(
			"SELECT token_hash,link_id,expires_at,revoked_at FROM software_agreement_sessions",
		);

		const links = rows<StoredAccessLink>(
			"SELECT id,expires_at FROM software_agreement_links",
		);

		const chosen = decide(
			accessCleanup.decide({ now: NOW }, { sessions, links }),
		);

		await cleanupAgreementAccess(db);

		const left = {
			sessions: rows<{ token_hash: string }>(
				"SELECT token_hash FROM software_agreement_sessions",
			).map((row) => row.token_hash),
			links: rows<{ id: string }>(
				"SELECT id FROM software_agreement_links",
			).map((row) => row.id),
		};

		expect(chosen.before).toBe(CUTOFF);
		expect(chosen.sessions.toSorted()).toEqual(
			sessions
				.map((row) => row.token_hash)
				.filter((hash) => !left.sessions.includes(hash))
				.toSorted(),
		);
		expect(chosen.links.toSorted()).toEqual(
			links
				.map((row) => row.id)
				.filter((id) => !left.links.includes(id))
				.toSorted(),
		);

		return chosen.sessions.length + chosen.links.length;
	}

	const TIMES = [
		at(-31 * DAY),
		at(-30 * DAY - 1),
		at(-30 * DAY),
		at(-30 * DAY + 1),
		at(-29 * DAY),
		at(3_600_000),
		at(40 * DAY),
	];

	it("deletes what the rule chooses for every session age, revocation and link the golden corpus lists", async () => {
		const world: Seed = {
			software_agreement_links: [
				...TIMES.map((expires, index) => linkRow(`lone-${index}`, expires)),
				...TIMES.map((expires, index) => linkRow(`used-${index}`, expires)),
				linkRow("mixed", at(-31 * DAY)),
			],
			software_agreement_sessions: [
				...TIMES.map((expires, index) =>
					sessionRow(`expiring-${index}`, `used-${index}`, expires, null),
				),
				...TIMES.map((revoked, index) =>
					sessionRow(
						`revoked-${index}`,
						`used-${index}`,
						at(3_600_000),
						revoked,
					),
				),
				sessionRow("mixed-old", "mixed", at(-31 * DAY), null),
				sessionRow("mixed-live", "mixed", at(3_600_000), null),
			],
		};

		expect(await sameCleanup(world)).toBeGreaterThan(4);
	});

	it("deletes what the rule chooses in random worlds", async () => {
		let deleted = 0;

		for (let index = 0; index < 100; index += 1) {
			const rand = random(5000 + index);
			const ids = ["l1", "l2", "l3", "l4", "l5"];

			deleted += await sameCleanup({
				software_agreement_links: ids.map((id) =>
					linkRow(id, pick(rand, TIMES)),
				),
				software_agreement_sessions: Array.from(
					{ length: Math.floor(rand() * 8) },
					(_, index) =>
						sessionRow(
							`s${index}`,
							pick(rand, [...ids, "gone"]),
							pick(rand, TIMES),
							pick(rand, [null, null, ...TIMES]),
						),
				),
			});
		}

		expect(deleted).toBeGreaterThan(100);
	}, 20_000);

	it("orders text as SQLite does", () => {
		expect(
			rows<{ v: string }>(
				"SELECT v FROM (SELECT ? AS v UNION ALL SELECT ?) ORDER BY v",
				"\u{1f600}",
				"～",
			).map((row) => row.v),
		).toEqual(["～", "\u{1f600}"].toSorted(textOrder));
	});
});
