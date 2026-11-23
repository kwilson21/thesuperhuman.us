import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { currentSigningNotification } from "../../src/lib/agreement-artifacts";
import {
	AgreementStoreFailed,
	claimCopy,
	claimNotice,
	claimPacket,
	MESSAGE_SQL,
	markPacketFailed,
	markPacketReady,
	PACKET_SQL,
	type PacketReady,
	readCopyArtifact,
	readCopyClaim,
	readDocumentSignatures,
	readMessages,
	readNoticeAgreement,
	readNoticeClaim,
	readPacketClaim,
	readPacketDocuments,
	readPacketMsaId,
	readReceiptId,
	readTemplateLabel,
	readTemplateSourceRevision,
	recordCopyOutcome,
	recordNoticeOutcome,
	recoverPacket,
	resetCopies,
	resetNotices,
} from "../../src/server/agreement-store";
import { AGREEMENT_STATUSES } from "../../src/server/machines/agreement-document";
import { MESSAGE_STATUSES } from "../../src/server/machines/agreement-message";
import { PACKET_STATUSES } from "../../src/server/machines/agreement-packet";
import {
	copyClaimable,
	MESSAGE_STALE_MS,
	type MessageClaim,
	type MessageSettled,
	messageOutcome,
	messagesToReset,
	noticeClaimable,
} from "../../src/server/rules/agreement-messages";
import {
	PACKET_STALE_MS,
	type PacketClaim,
	packetClaimable,
	packetRecoverable,
} from "../../src/server/rules/agreement-packet";
import { MusicDb } from "../../src/server/services";
import { freshMusicDb, type Seed, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";
import { boundStatement } from "../helpers/d1";
import { double } from "../helpers/doubles";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";

// The store's statements for the signed copy (the packet) and the emails (docs/plans/2026-11-signing-conversion.md,
// section 4), on node:sqlite with the real schema: what each read finds, what each write changes and under which
// condition, the claims and the resets held to their rules (src/server/rules/agreement-packet.ts and
// agreement-messages.ts), and a rejection as an AgreementStoreFailed with its cause. Then the SQL against today's code and
// the golden corpora: every statement that replaces one of today's has today's text (the corpora recorded it, so each
// golden hook keeps its count), each batch keeps today's order, and the reads the claims and the reset add are ones no
// corpus recorded and no golden hook pattern matches.

const EARLIER = "2026-11-13T11:00:00.000Z";
const AT = "2026-11-13T12:00:00.000Z";
const NOW = new Date(AT);
const SHA = "a".repeat(64);
const MSA = "msa-1";
const SOW = "sow-1";

/** A time this many milliseconds before NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** A world: the real schema, every SQL text prepared and every batch recorded, and one statement failing when asked to. */
function packetWorld(fail?: { readonly on: RegExp; readonly message: string }) {
	const sql = freshMusicDb();
	const executed: string[] = [];
	const batches: string[][] = [];

	const recording = double<SqliteDatabase>({
		prepare: (query: string) => {
			executed.push(query);

			if (fail?.on.test(query)) throw new Error(fail.message);

			return sql.prepare(query);
		},
		exec: (query: string) => sql.exec(query),
	});

	const inner = sqliteD1(recording);

	const db = double<D1Database>({
		prepare: (query: string) => inner.prepare(query),
		batch: <T>(statements: D1PreparedStatement[]) => {
			batches.push(
				statements.map((statement) => boundStatement(statement).query),
			);

			return inner.batch<T>(statements);
		},
	});

	const provided = <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
		effect.pipe(Effect.provideService(MusicDb, db));

	return {
		sql,
		executed,
		batches,
		ok: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(provided(effect)),
		failed: <A, E>(effect: Effect.Effect<A, E, MusicDb>) =>
			Effect.runPromise(Effect.flip(provided(effect))),
		seed: (tables: Seed) => seed(sql, tables),
		one: (query: string, ...args: string[]) => sql.prepare(query).get(...args),
		all: (query: string, ...args: string[]) => sql.prepare(query).all(...args),
		run: (query: string, ...args: (string | null)[]) =>
			sql.prepare(query).run(...args),
	};
}

type World = ReturnType<typeof packetWorld>;

const signature = (agreementId: string, party: string) => ({
	id: `sig-${agreementId}-${party}`,
	agreement_id: agreementId,
	party,
	typed_name: party === "client" ? "Grace Hopper" : "Kazon Wilson",
	title: party === "client" ? "Owner" : "Member",
	consent_text: "I agree to sign electronically.",
	consent_version: "website-signing-v3",
	consent_at: EARLIER,
	signed_at: EARLIER,
	document_sha256: SHA,
	session_token_hash: null,
	owner_subject: party === "contractor" ? "owner@example.test" : null,
	verified_email:
		party === "client" ? "grace@example.test" : "owner@example.test",
	verified_at: EARLIER,
	verification_method: party === "client" ? "email-link" : "owner-session",
	intent_text: "I sign the documents listed.",
	document_list_json: "[]",
	receipt_id: `receipt-${party}`,
	ip_address: "203.0.113.1",
	user_agent: "Test",
});

/** The request, its sent offer, the template and the client, then an executed MSA and the SOW that names it. */
function signed(world: World, sow: Record<string, string | null> = {}) {
	world.seed({
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
		software_offers: [rows.softwareOffer("o1", "r1")],
		...rows.agreementBase(),
	});

	world.seed({
		software_agreements: [
			rows.agreement(MSA, "r1", "o1", {
				status: "executed",
				executed_at: EARLIER,
			}),
			rows.agreement(SOW, "r1", "o1", {
				kind: "sow",
				msa_id: MSA,
				status: "executed",
				executed_at: EARLIER,
				...sow,
			}),
		],
	});
}

const packetRow = (
	status: string,
	over: Record<string, string | null> = {},
) => ({
	agreement_id: SOW,
	status,
	attempt_id: status === "pending" ? null : "theirs",
	attempted_at: status === "pending" ? null : EARLIER,
	...over,
});

const claim: PacketClaim = {
	status: "rendering",
	attempt_id: "mine",
	attempted_at: AT,
	error_code: null,
};

const ready: PacketReady = {
	attempt: "mine",
	pdfKey: `agreements/${SOW}/c.pdf`,
	pdfSha256: SHA,
	certificateKey: `agreements/${SOW}/c.certificate.json`,
	certificateSha256: SHA,
	manifest: "{}",
	bytes: 1234,
	readyAt: AT,
	eventId: "event-1",
	eventAt: "2026-11-13T12:00:00.001Z",
};

const messageClaim: MessageClaim = {
	status: "sending",
	attempt_id: "mine",
	attempted_at: AT,
};

const settledAs = (mail: "sent" | "refused"): MessageSettled =>
	Effect.runSync(
		Effect.map(messageOutcome.decide({ mail, at: NOW }, null), (decided) =>
			Option.getOrThrow(decided),
		),
	);

/** What a rule decided: its write, `null` for nothing to do, or `"refused"`. */
const decision = <W, E>(decided: Effect.Effect<Option.Option<W>, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: () => "refused",
			onSuccess: (write) => Option.getOrNull(write),
		}),
	);

describe("the packet", () => {
	it("reads the packet row with its agreement's closed archive, or null when there is no row", async () => {
		const world = packetWorld();
		signed(world, { archive_closed_at: AT });

		expect(await world.ok(readPacketClaim(SOW))).toBeNull();

		world.seed({ software_agreement_artifacts: [packetRow("failed")] });

		expect(await world.ok(readPacketClaim(SOW))).toEqual({
			status: "failed",
			attempt_id: "theirs",
			attempted_at: EARLIER,
			archive_closed_at: AT,
		});
		expect(await world.ok(readPacketClaim("unknown"))).toBeNull();
	});

	it("claims exactly the packets packetClaimable claims: pending or failed, with the archive open", async () => {
		const world = packetWorld();
		signed(world);
		let claims = 0;

		for (const status of PACKET_STATUSES)
			for (const archive of [null, AT]) {
				world.run("DELETE FROM software_agreement_artifacts");
				world.run(
					"UPDATE software_agreements SET archive_closed_at=? WHERE id=?",
					archive,
					SOW,
				);
				world.seed({ software_agreement_artifacts: [packetRow(status)] });

				const decided = decision(
					packetClaimable.decide(
						{ attempt: "mine", at: NOW },
						await world.ok(readPacketClaim(SOW)),
					),
				);

				const claimed = await world.ok(claimPacket(SOW, claim));
				const case_ = JSON.stringify({ status, archive });

				expect(claimed, case_).toBe(decided !== null);

				if (decided !== null) {
					claims += 1;
					expect(decided).toEqual(claim);
					expect(
						world.one(
							"SELECT status,attempt_id,attempted_at,error_code FROM software_agreement_artifacts",
						),
					).toEqual(claim);
				}
			}

		expect(claims).toBe(2);
	});

	it("clears the error of a failed packet it claims, and claims nothing for an agreement without a packet row", async () => {
		const world = packetWorld();
		signed(world);

		expect(await world.ok(claimPacket(SOW, claim))).toBe(false);

		world.seed({
			software_agreement_artifacts: [
				packetRow("failed", { error_code: "storage" }),
			],
		});

		expect(await world.ok(claimPacket(SOW, claim))).toBe(true);
		expect(
			world.one("SELECT error_code FROM software_agreement_artifacts"),
		).toEqual({ error_code: null });
	});

	it("reads the MSA an agreement names, or null", async () => {
		const world = packetWorld();
		signed(world);

		expect(await world.ok(readPacketMsaId(SOW))).toBe(MSA);
		expect(await world.ok(readPacketMsaId(MSA))).toBeNull();
		expect(await world.ok(readPacketMsaId("unknown"))).toBeNull();
	});

	it("reads the documents in today's order, the MSA first, and stops at the first one missing", async () => {
		const world = packetWorld();
		signed(world);

		const read = await world.ok(readPacketDocuments(SOW));

		expect("documents" in read && read.documents.map((d) => d.id)).toEqual([
			MSA,
			SOW,
		]);
		expect(world.executed).toEqual([PACKET_SQL.document, PACKET_SQL.document]);

		// Every column of the row, as today's `SELECT *` gave the certificate and the renderer.
		expect("documents" in read && read.documents[1]).toEqual(
			world.one("SELECT * FROM software_agreements WHERE id=?", SOW),
		);

		expect(await world.ok(readPacketDocuments(MSA))).toEqual({
			documents: [
				world.one("SELECT * FROM software_agreements WHERE id=?", MSA),
			],
		});

		world.executed.length = 0;
		world.run(
			"UPDATE software_agreements SET status='abandoned' WHERE id=?",
			MSA,
		);

		expect(await world.ok(readPacketDocuments(SOW))).toEqual({
			missing: "Missing MSA.",
		});

		world.executed.length = 0;
		world.run(
			"UPDATE software_agreements SET status='client_signed' WHERE id=?",
			SOW,
		);

		expect(await world.ok(readPacketDocuments(SOW))).toEqual({
			missing: "Not executed.",
		});
		expect(world.executed).toEqual([PACKET_SQL.document]);
	});

	it("reads a document's signatures by party, every column the certificate records, and the templates' revision and label", async () => {
		const world = packetWorld();
		signed(world);
		world.seed({
			software_agreement_signatures: [
				signature(SOW, "contractor"),
				signature(SOW, "client"),
			],
		});

		const signatures = await world.ok(readDocumentSignatures(SOW));

		expect(signatures.map((s) => s.party)).toEqual(["client", "contractor"]);
		expect(Object.keys(signatures[0] ?? {})).toEqual([
			"party",
			"typed_name",
			"title",
			"consent_text",
			"consent_version",
			"consent_at",
			"signed_at",
			"document_sha256",
			"owner_subject",
			"verified_email",
			"verified_at",
			"verification_method",
			"intent_text",
			"document_list_json",
			"receipt_id",
			"ip_address",
			"user_agent",
		]);
		expect(signatures[1]?.owner_subject).toBe("owner@example.test");
		expect(await world.ok(readDocumentSignatures(MSA))).toEqual([]);

		expect(await world.ok(readTemplateSourceRevision("template-msa"))).toEqual({
			source_revision: null,
		});
		expect(await world.ok(readTemplateLabel("template-msa"))).toEqual({
			version_label: null,
			published_at: EARLIER,
		});

		world.seed({
			software_agreement_templates: [
				{
					id: "template-sow",
					kind: "sow",
					version: 1,
					text: "SOW",
					sha256: SHA,
					published_at: EARLIER,
					published_by: "owner@example.test",
					version_label: "v1",
					source_revision: "rev",
				},
			],
		});

		expect(await world.ok(readTemplateSourceRevision("template-sow"))).toEqual({
			source_revision: "rev",
		});
		expect(await world.ok(readTemplateLabel("template-sow"))).toEqual({
			version_label: "v1",
			published_at: EARLIER,
		});
		expect(await world.ok(readTemplateSourceRevision("unknown"))).toBeNull();
		expect(await world.ok(readTemplateLabel("unknown"))).toBeNull();
	});

	it("marks the packet ready, with its event, only for the attempt that claimed it while rendering", async () => {
		const world = packetWorld();
		signed(world);
		world.seed({
			software_agreement_artifacts: [
				packetRow("rendering", { attempt_id: "mine" }),
			],
		});

		await world.ok(markPacketReady(SOW, { ...ready, attempt: "theirs" }));

		expect(
			world.one("SELECT status FROM software_agreement_artifacts"),
		).toEqual({ status: "rendering" });
		expect(world.all("SELECT * FROM software_agreement_events")).toEqual([]);

		await world.ok(markPacketReady(SOW, ready));

		expect(
			world.one(
				"SELECT status,pdf_key,pdf_sha256,certificate_key,certificate_sha256,manifest_json,bytes,renderer_version,ready_at FROM software_agreement_artifacts",
			),
		).toEqual({
			status: "ready",
			pdf_key: ready.pdfKey,
			pdf_sha256: ready.pdfSha256,
			certificate_key: ready.certificateKey,
			certificate_sha256: ready.certificateSha256,
			manifest_json: ready.manifest,
			bytes: ready.bytes,
			renderer_version: "website-pdf-v2",
			ready_at: ready.readyAt,
		});
		expect(world.all("SELECT * FROM software_agreement_events")).toEqual([
			{
				id: ready.eventId,
				agreement_id: SOW,
				offer_id: null,
				action: "artifact-ready",
				actor: "system",
				occurred_at: ready.eventAt,
				reason: null,
			},
		]);
		expect(world.batches).toEqual([
			[PACKET_SQL.ready, PACKET_SQL.readyEvent],
			[PACKET_SQL.ready, PACKET_SQL.readyEvent],
		]);
	});

	it("marks the packet failed at the step reached only for the attempt that claimed it while rendering", async () => {
		const world = packetWorld();
		signed(world);
		world.seed({
			software_agreement_artifacts: [
				packetRow("rendering", { attempt_id: "mine" }),
			],
		});

		await world.ok(markPacketFailed(SOW, "theirs", "storage"));

		expect(
			world.one("SELECT status,error_code FROM software_agreement_artifacts"),
		).toEqual({ status: "rendering", error_code: null });

		await world.ok(markPacketFailed(SOW, "mine", "readback"));

		expect(
			world.one("SELECT status,error_code FROM software_agreement_artifacts"),
		).toEqual({ status: "failed", error_code: "readback" });

		world.run(
			"UPDATE software_agreement_artifacts SET status='ready',error_code=NULL",
		);
		await world.ok(markPacketFailed(SOW, "mine", "render"));

		expect(
			world.one("SELECT status,error_code FROM software_agreement_artifacts"),
		).toEqual({ status: "ready", error_code: null });
	});

	it("recovers exactly the attempts packetRecoverable recovers, once the owner confirmed", async () => {
		const world = packetWorld();
		signed(world);
		let recovered = 0;

		for (const status of PACKET_STATUSES)
			for (const attempt of ["seen", "other"])
				for (const attempted of [
					ago(PACKET_STALE_MS + 1),
					ago(PACKET_STALE_MS),
					ago(PACKET_STALE_MS - 1),
				]) {
					world.run("DELETE FROM software_agreement_artifacts");
					world.seed({
						software_agreement_artifacts: [
							packetRow(status, {
								attempt_id: attempt,
								attempted_at: attempted,
							}),
						],
					});

					const decided = decision(
						packetRecoverable.decide(
							{ expectedAttempt: "seen", confirmedStale: true, now: NOW },
							await world.ok(readPacketClaim(SOW)),
						),
					);

					const done = await world.ok(
						recoverPacket(SOW, {
							status: "failed",
							error_code: "render",
							attempt_id: "seen",
							staleBefore: ago(PACKET_STALE_MS),
						}),
					);

					expect(done, JSON.stringify({ status, attempt, attempted })).toBe(
						decided !== null && decided !== "refused",
					);

					if (done) {
						recovered += 1;
						expect(
							world.one(
								"SELECT status,attempt_id,error_code FROM software_agreement_artifacts",
							),
						).toEqual({
							status: "failed",
							attempt_id: "seen",
							error_code: "render",
						});
					}
				}

		// The attempt the owner saw, rendering, a minute old or older.
		expect(recovered).toBe(2);
	});
});

/** The copies of an executed SOW, signed by both parties, its ready packet stored. */
function delivered(world: World) {
	signed(world);
	world.seed({
		software_agreement_signatures: [
			signature(SOW, "client"),
			signature(SOW, "contractor"),
		],
		software_agreement_artifacts: [
			packetRow("ready", { pdf_key: "k.pdf", pdf_sha256: SHA }),
		],
		software_agreement_deliveries: [
			{
				agreement_id: SOW,
				recipient_role: "client",
				email: "grace@example.test",
			},
			{
				agreement_id: SOW,
				recipient_role: "contractor",
				email: "owner@example.test",
			},
		],
	});
}

describe("the copies", () => {
	it("reads the ready packet only, and a party's receipt id only once that party signed", async () => {
		const world = packetWorld();
		delivered(world);

		expect(await world.ok(readCopyArtifact(SOW))).toEqual({
			status: "ready",
			pdf_key: "k.pdf",
			pdf_sha256: SHA,
		});

		world.run("UPDATE software_agreement_artifacts SET status='failed'");

		expect(await world.ok(readCopyArtifact(SOW))).toBeNull();
		expect(await world.ok(readReceiptId(SOW, "client"))).toEqual({
			receipt_id: "receipt-client",
		});
		expect(await world.ok(readReceiptId(MSA, "client"))).toBeNull();
	});

	it("reads a party's copy with the agreement and its request's project", async () => {
		const world = packetWorld();
		delivered(world);

		expect(await world.ok(readCopyClaim(SOW, "contractor"))).toEqual({
			copy: {
				recipient_role: "contractor",
				status: "pending",
				attempted_at: null,
			},
			agreement: {
				status: "executed",
				archive_closed_at: null,
				project_request_id: null,
			},
		});

		world.seed({ software_projects: [rows.softwareProject("r1", "o1")] });

		expect(await world.ok(readCopyClaim(MSA, "client"))).toEqual({
			copy: null,
			agreement: {
				status: "executed",
				archive_closed_at: null,
				project_request_id: "r1",
			},
		});
		expect(await world.ok(readCopyClaim("unknown", "client"))).toEqual({
			copy: null,
			agreement: null,
		});
	});

	it("claims exactly the copies copyClaimable claims, once the party signed", async () => {
		const world = packetWorld();
		delivered(world);
		let claims = 0;

		for (const status of AGREEMENT_STATUSES)
			for (const archive of [null, AT])
				for (const copy of MESSAGE_STATUSES) {
					world.run(
						"UPDATE software_agreements SET status=?,archive_closed_at=? WHERE id=?",
						status,
						archive,
						SOW,
					);
					world.run(
						"UPDATE software_agreement_deliveries SET status=?,attempt_id=NULL,attempted_at=NULL",
						copy,
					);

					const decided = decision(
						copyClaimable.decide(
							{ attempt: "mine", at: NOW },
							{
								signature: await world.ok(readReceiptId(SOW, "client")),
								...(await world.ok(readCopyClaim(SOW, "client"))),
							},
						),
					);

					const email = await world.ok(claimCopy(SOW, "client", messageClaim));

					expect(
						email !== null,
						JSON.stringify({ status, archive, copy }),
					).toBe(decided !== null);

					if (email !== null) {
						claims += 1;
						expect(email).toBe("grace@example.test");
						expect(decided).toEqual(messageClaim);
						expect(
							world.one(
								"SELECT status,attempt_id,attempted_at FROM software_agreement_deliveries WHERE recipient_role='client'",
							),
						).toEqual(messageClaim);
					}
				}

		expect(claims).toBe(1);
	});

	it("records a sent or refused copy and its event, only by the attempt that claimed it while sending", async () => {
		const world = packetWorld();
		delivered(world);
		await world.ok(claimCopy(SOW, "client", messageClaim));
		await world.ok(claimCopy(SOW, "contractor", messageClaim));

		const sent = settledAs("sent");

		await world.ok(
			recordCopyOutcome(SOW, "client", {
				attempt: "theirs",
				settled: sent,
				eventId: "event-0",
				occurredAt: AT,
			}),
		);

		expect(world.all("SELECT * FROM software_agreement_events")).toEqual([]);

		await world.ok(
			recordCopyOutcome(SOW, "client", {
				attempt: "mine",
				settled: { ...sent, sent_at: EARLIER },
				eventId: "event-1",
				occurredAt: AT,
			}),
		);
		await world.ok(
			recordCopyOutcome(SOW, "contractor", {
				attempt: "mine",
				settled: settledAs("refused"),
				eventId: "event-2",
				occurredAt: AT,
			}),
		);

		expect(
			world.all(
				"SELECT recipient_role,status,sent_at FROM software_agreement_deliveries ORDER BY recipient_role",
			),
		).toEqual([
			{ recipient_role: "client", status: "sent", sent_at: EARLIER },
			{ recipient_role: "contractor", status: "failed", sent_at: null },
		]);
		expect(
			world.all(
				"SELECT id,agreement_id,action,actor,occurred_at FROM software_agreement_events ORDER BY id",
			),
		).toEqual([
			{
				id: "event-1",
				agreement_id: SOW,
				action: "copy-delivered",
				actor: "client",
				occurred_at: AT,
			},
			{
				id: "event-2",
				agreement_id: SOW,
				action: "delivery-failed",
				actor: "contractor",
				occurred_at: AT,
			},
		]);
		expect(world.batches.slice(-2)).toEqual([
			[MESSAGE_SQL.copyOutcome("SEND"), MESSAGE_SQL.copyEvent],
			[MESSAGE_SQL.copyOutcome("FAIL"), MESSAGE_SQL.copyEvent],
		]);
	});
});

/** The two notices of a client-signed SOW, the client's signature saved. */
function noticed(world: World) {
	signed(world, { status: "client_signed", executed_at: null });
	world.seed({
		software_agreement_signatures: [signature(SOW, "client")],
		software_agreement_notifications: [
			{
				agreement_id: SOW,
				kind: "signature-receipt",
				email: "grace@example.test",
			},
			{
				agreement_id: SOW,
				kind: "countersign-notice",
				email: "owner@example.test",
			},
		],
	});
}

describe("the notices", () => {
	it("reads the agreement's request and its client's receipt id, which is null before the client signed", async () => {
		const world = packetWorld();
		noticed(world);

		expect(await world.ok(readNoticeAgreement(SOW))).toEqual({
			request_id: "r1",
			receipt_id: "receipt-client",
		});
		expect(await world.ok(readNoticeAgreement(MSA))).toEqual({
			request_id: "r1",
			receipt_id: null,
		});
		expect(await world.ok(readNoticeAgreement("unknown"))).toBeNull();
	});

	it("claims exactly the notices noticeClaimable claims: pending and current", async () => {
		const world = packetWorld();
		noticed(world);
		let claims = 0;

		for (const status of AGREEMENT_STATUSES)
			for (const archive of [null, AT])
				for (const project of [false, true])
					for (const notice of MESSAGE_STATUSES) {
						world.run(
							"UPDATE software_agreements SET status=?,archive_closed_at=? WHERE id=?",
							status,
							archive,
							SOW,
						);
						world.run("DELETE FROM software_projects");

						if (project)
							world.seed({
								software_projects: [rows.softwareProject("r1", "o1")],
							});

						world.run(
							"UPDATE software_agreement_notifications SET status=?,attempt_id=NULL,attempted_at=NULL",
							notice,
						);

						const read = await world.ok(
							readNoticeClaim(SOW, "signature-receipt"),
						);

						expect(read.agreement).toEqual({
							status,
							archive_closed_at: archive,
							project_request_id: project ? "r1" : null,
						});

						const decided = decision(
							noticeClaimable.decide({ attempt: "mine", at: NOW }, read),
						);

						const email = await world.ok(
							claimNotice(SOW, "signature-receipt", messageClaim),
						);

						expect(
							email !== null,
							JSON.stringify({ status, archive, project, notice }),
						).toBe(decided !== null);

						if (email !== null) {
							claims += 1;
							expect(email).toBe("grace@example.test");
						}
					}

		expect(claims).toBe(1);
	});

	it("records a sent or refused notice only by the attempt that claimed it while sending, with no event", async () => {
		const world = packetWorld();
		noticed(world);
		await world.ok(claimNotice(SOW, "signature-receipt", messageClaim));
		await world.ok(claimNotice(SOW, "countersign-notice", messageClaim));

		await world.ok(
			recordNoticeOutcome(
				SOW,
				"signature-receipt",
				"theirs",
				settledAs("sent"),
			),
		);
		await world.ok(
			recordNoticeOutcome(
				SOW,
				"countersign-notice",
				"mine",
				settledAs("refused"),
			),
		);

		expect(
			world.all(
				"SELECT kind,status,sent_at FROM software_agreement_notifications ORDER BY kind DESC",
			),
		).toEqual([
			{ kind: "signature-receipt", status: "sending", sent_at: null },
			{ kind: "countersign-notice", status: "failed", sent_at: null },
		]);

		await world.ok(
			recordNoticeOutcome(SOW, "signature-receipt", "mine", settledAs("sent")),
		);

		expect(
			world.one(
				"SELECT status,sent_at FROM software_agreement_notifications WHERE kind='signature-receipt'",
			),
		).toEqual({ status: "sent", sent_at: AT });
		expect(world.all("SELECT * FROM software_agreement_events")).toEqual([]);
	});
});

describe("the owner's reset", () => {
	it("reads every copy and notice of the agreement, in today's delivery order, with the agreement", async () => {
		const world = packetWorld();
		noticed(world);
		world.seed({
			software_agreement_deliveries: [
				{ agreement_id: SOW, recipient_role: "contractor", email: "o@x.test" },
				{ agreement_id: SOW, recipient_role: "client", email: "c@x.test" },
			],
		});

		expect(await world.ok(readMessages(SOW))).toEqual({
			copies: [
				{ recipient_role: "client", status: "pending", attempted_at: null },
				{ recipient_role: "contractor", status: "pending", attempted_at: null },
			],
			notices: [
				{ kind: "signature-receipt", status: "pending", attempted_at: null },
				{ kind: "countersign-notice", status: "pending", attempted_at: null },
			],
			agreement: {
				status: "client_signed",
				archive_closed_at: null,
				project_request_id: null,
			},
		});
		expect(world.batches).toEqual([
			[MESSAGE_SQL.copies, MESSAGE_SQL.notices, MESSAGE_SQL.messageAgreement],
		]);
	});

	it("moves exactly the copies messagesToReset names, and runs its statement even when it names none", async () => {
		const world = packetWorld();
		delivered(world);
		let moved = 0;

		for (const status of MESSAGE_STATUSES)
			for (const attempted of [
				null,
				ago(MESSAGE_STALE_MS + 1),
				ago(MESSAGE_STALE_MS),
				ago(MESSAGE_STALE_MS - 1),
			])
				for (const confirmedNotSent of [false, true]) {
					world.run(
						"UPDATE software_agreement_deliveries SET status=?,attempted_at=? WHERE recipient_role='client'",
						status,
						attempted,
					);
					world.run(
						"UPDATE software_agreement_deliveries SET status='sent' WHERE recipient_role='contractor'",
					);

					const decided = Effect.runSync(
						messagesToReset.decide(
							{ confirmedNotSent, now: NOW },
							{ copies: (await world.ok(readMessages(SOW))).copies },
						),
					);

					world.executed.length = 0;
					await world.ok(resetCopies(SOW, decided));

					expect(world.executed).toEqual([MESSAGE_SQL.resetCopies]);

					const after = world.one(
						"SELECT status FROM software_agreement_deliveries WHERE recipient_role='client'",
					);

					const changed = status !== "pending" && after?.status === "pending";

					expect(
						changed,
						JSON.stringify({ status, attempted, confirmedNotSent }),
					).toBe(decided.keys.includes("client"));
					expect(decided.keys).not.toContain("contractor");

					if (changed) moved += 1;
				}

		// Failed (four attempt times, either way), and sending a minute old or older once confirmed.
		expect(moved).toBe(10);
	});

	it("moves exactly the current notices messagesToReset names", async () => {
		const world = packetWorld();
		noticed(world);
		let moved = 0;

		for (const status of AGREEMENT_STATUSES)
			for (const archive of [null, AT])
				for (const project of [false, true])
					for (const notice of MESSAGE_STATUSES)
						for (const attempted of [
							ago(MESSAGE_STALE_MS),
							ago(MESSAGE_STALE_MS - 1),
						]) {
							world.run(
								"UPDATE software_agreements SET status=?,archive_closed_at=? WHERE id=?",
								status,
								archive,
								SOW,
							);
							world.run("DELETE FROM software_projects");

							if (project)
								world.seed({
									software_projects: [rows.softwareProject("r1", "o1")],
								});

							world.run(
								"UPDATE software_agreement_notifications SET status=?,attempted_at=?",
								notice,
								attempted,
							);

							const read = await world.ok(readMessages(SOW));

							const decided = Effect.runSync(
								messagesToReset.decide(
									{ confirmedNotSent: true, now: NOW },
									{ notices: read.notices, agreement: read.agreement },
								),
							);

							await world.ok(resetNotices(SOW, decided));

							const changed = world
								.all(
									"SELECT kind,status FROM software_agreement_notifications ORDER BY kind DESC",
								)
								.flatMap((row) =>
									notice !== "pending" && row.status === "pending"
										? [String(row.kind)]
										: [],
								);

							expect(
								changed,
								JSON.stringify({ status, archive, project, notice, attempted }),
							).toEqual(decided.keys);

							moved += changed.length;
						}

		// A current notice (client_signed, archive open, no project): both kinds, failed at either time, sending at a minute.
		expect(moved).toBe(6);
	});
});

/** What `run` fails with on a world of delivered copies where every statement `on` matches is rejected. */
async function failureOf<A, E>(on: RegExp, run: Effect.Effect<A, E, MusicDb>) {
	const world = packetWorld({ on, message: "d1 unavailable" });
	delivered(world);

	return world.failed(run);
}

describe("a rejected statement", () => {
	it("is an AgreementStoreFailed carrying what the database raised, for a read, a write and a batch", async () => {
		const failures = [
			await failureOf(
				/software_agreement_artifacts p ON/,
				readPacketClaim(SOW),
			),
			await failureOf(/SET status='rendering'/, claimPacket(SOW, claim)),
			await failureOf(/artifact-ready/, markPacketReady(SOW, ready)),
			await failureOf(
				/FROM software_agreement_deliveries WHERE agreement_id=\? AND recipient_role=\?/,
				readCopyClaim(SOW, "client"),
			),
			await failureOf(
				/SET status='pending'/,
				resetCopies(SOW, {
					status: "pending",
					keys: [],
					confirmed: false,
					staleBefore: AT,
				}),
			),
		];

		for (const failure of failures) {
			expect(failure).toBeInstanceOf(AgreementStoreFailed);
			expect(failure).toMatchObject({
				failure: expect.objectContaining({ message: "d1 unavailable" }),
			});
		}
	});

	it("leaves a failed batch's earlier statement unwritten", async () => {
		const world = packetWorld({
			on: /artifact-ready/,
			message: "d1 unavailable",
		});

		signed(world);
		world.seed({
			software_agreement_artifacts: [
				packetRow("rendering", { attempt_id: "mine" }),
			],
		});

		await world.failed(markPacketReady(SOW, ready));

		expect(
			world.one("SELECT status FROM software_agreement_artifacts"),
		).toEqual({ status: "rendering" });
	});
});

// ---- today's code and the golden corpora ----

const root = new URL("../../", import.meta.url);

/** The corpora whose cases run the packet, the copies, the notices or the owner's reset (their recorded SQL shows it). */
const CORPORA = [
	"owner-request-agreement-countersign",
	"owner-request-agreement-retry-artifact",
	"owner-request-agreement-retry-copy",
	"owner-request-agreement-wire",
	"owner-request-agreement-end",
	"owner-request-agreement-record-copy",
	"offer-sign",
];

type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly { readonly sql: string }[];
};

/** Every SQL text the corpora recorded, and every batch's texts in order (as JSON). */
function recorded() {
	const texts = new Set<string>();
	const batches = new Set<string>();

	for (const corpus of CORPORA) {
		// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases, each with its effects.
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
					batches.add(JSON.stringify(effect.statements.map((s) => s.sql)));
			}
	}

	return { texts, batches };
}

/**
 * Every regular expression literal in every golden test file and area file. Hooks pick statements with such literals,
 * many passed through helpers (`fail(name, /.../)`), so all of them are read: a superset of the hook patterns.
 */
function goldenPatterns(): RegExp[] {
	const folders = ["tests/golden/", "tests/golden/areas/"];
	const patterns: RegExp[] = [];

	for (const folder of folders)
		for (const name of readdirSync(new URL(folder, root)).filter((file) =>
			file.endsWith(".ts"),
		)) {
			const file = `${folder}${name}`;

			const source = ts.createSourceFile(
				file,
				readFileSync(new URL(file, root), "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);

			const visit = (node: ts.Node) => {
				if (ts.isRegularExpressionLiteral(node)) {
					const end = node.text.lastIndexOf("/");

					patterns.push(
						new RegExp(
							node.text.slice(1, end),
							node.text.slice(end + 1).replace("g", ""),
						),
					);
				}

				ts.forEachChild(node, visit);
			};

			visit(source);
		}

	return patterns;
}

/** Today's statements, as src/lib/agreement-artifacts.ts and the retry-copy action write them. */
const TODAY = {
	msaId: "SELECT msa_id FROM software_agreements WHERE id=?",
	claim:
		"UPDATE software_agreement_artifacts SET status='rendering',attempt_id=?,attempted_at=?,error_code=NULL WHERE agreement_id=? AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_artifacts.agreement_id AND a.archive_closed_at IS NULL) RETURNING agreement_id",
	document:
		"SELECT * FROM software_agreements WHERE id=? AND status='executed'",
	sourceRevision:
		"SELECT source_revision FROM software_agreement_templates WHERE id=?",
	label:
		"SELECT version_label,published_at FROM software_agreement_templates WHERE id=?",
	signatures:
		"SELECT party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,owner_subject,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent FROM software_agreement_signatures WHERE agreement_id=? ORDER BY party",
	ready:
		"UPDATE software_agreement_artifacts SET status='ready',pdf_key=?,pdf_sha256=?,certificate_key=?,certificate_sha256=?,manifest_json=?,bytes=?,renderer_version='website-pdf-v2',ready_at=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'",
	readyEvent:
		"INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,'artifact-ready','system',? WHERE EXISTS(SELECT 1 FROM software_agreement_artifacts WHERE agreement_id=? AND attempt_id=? AND status='ready')",
	failed:
		"UPDATE software_agreement_artifacts SET status='failed',error_code=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'",
	recover:
		"UPDATE software_agreement_artifacts SET status='failed',error_code='render' WHERE agreement_id=? AND status='rendering' AND attempt_id=? AND attempted_at<=? RETURNING agreement_id",
	copyArtifact:
		"SELECT * FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'",
	receiptId:
		"SELECT receipt_id FROM software_agreement_signatures WHERE agreement_id=? AND party=?",
	claimCopy:
		"UPDATE software_agreement_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND recipient_role=? AND status='pending' AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_deliveries.agreement_id AND a.archive_closed_at IS NULL AND a.status='executed') RETURNING email",
	copyOutcome:
		"UPDATE software_agreement_deliveries SET status=?,sent_at=? WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status='sending'",
	copyEvent:
		"INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_deliveries WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status=?)",
	noticeAgreement:
		"SELECT request_id,(SELECT receipt_id FROM software_agreement_signatures WHERE agreement_id=software_agreements.id AND party='client') AS receipt_id FROM software_agreements WHERE id=?",
	claimNotice: `UPDATE software_agreement_notifications SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND kind=? AND status='pending' AND ${currentSigningNotification} RETURNING email`,
	noticeOutcome:
		"UPDATE software_agreement_notifications SET status=?,sent_at=? WHERE agreement_id=? AND kind=? AND attempt_id=? AND status='sending'",
	resetCopies:
		"UPDATE software_agreement_deliveries SET status='pending' WHERE agreement_id=? AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))",
	resetNotices: `UPDATE software_agreement_notifications SET status='pending' WHERE agreement_id=? AND ${currentSigningNotification} AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))`,
};

/** The reads the claims and the owner's reset add. */
const ADDED: readonly string[] = [
	PACKET_SQL.claimFacts,
	MESSAGE_SQL.copy,
	MESSAGE_SQL.notice,
	MESSAGE_SQL.messageAgreement,
	MESSAGE_SQL.copies,
	MESSAGE_SQL.notices,
];

/** Runs every function once on a world where each statement finds rows; answers the texts and batches it ran. */
async function tour() {
	const world = packetWorld();
	delivered(world);
	world.seed({
		software_agreement_signatures: [
			signature(MSA, "client"),
			signature(MSA, "contractor"),
		],
	});
	world.run("UPDATE software_agreement_artifacts SET status='failed'");

	const reset = {
		status: "pending",
		keys: [],
		confirmed: true,
		staleBefore: AT,
	} as const;

	await world.ok(readPacketMsaId(SOW));
	await world.ok(readPacketClaim(SOW));
	await world.ok(claimPacket(SOW, claim));
	await world.ok(readPacketDocuments(SOW));
	await world.ok(readDocumentSignatures(SOW));
	await world.ok(readTemplateSourceRevision("template-msa"));
	await world.ok(readTemplateLabel("template-msa"));
	await world.ok(markPacketFailed(SOW, "mine", "render"));
	await world.ok(claimPacket(SOW, claim));
	await world.ok(markPacketReady(SOW, ready));
	await world.ok(
		recoverPacket(SOW, {
			status: "failed",
			error_code: "render",
			attempt_id: "mine",
			staleBefore: AT,
		}),
	);
	await world.ok(readCopyArtifact(SOW));
	await world.ok(readReceiptId(SOW, "client"));
	await world.ok(readCopyClaim(SOW, "client"));
	await world.ok(claimCopy(SOW, "client", messageClaim));

	for (const mail of ["sent", "refused"] as const)
		await world.ok(
			recordCopyOutcome(SOW, "client", {
				attempt: "mine",
				settled: settledAs(mail),
				eventId: `event-${mail}`,
				occurredAt: AT,
			}),
		);

	await world.ok(readNoticeAgreement(SOW));
	await world.ok(readNoticeClaim(SOW, "signature-receipt"));
	await world.ok(claimNotice(SOW, "signature-receipt", messageClaim));

	for (const mail of ["sent", "refused"] as const)
		await world.ok(
			recordNoticeOutcome(SOW, "signature-receipt", "mine", settledAs(mail)),
		);

	await world.ok(readMessages(SOW));
	await world.ok(resetCopies(SOW, reset));
	await world.ok(resetNotices(SOW, reset));

	return { texts: new Set(world.executed), batches: world.batches };
}

describe("the statements, against today's code and the golden corpora", () => {
	it("keeps today's text for every statement it replaces, its status lists and moves read from the machines", () => {
		expect({
			msaId: PACKET_SQL.msaId,
			claim: PACKET_SQL.claim,
			document: PACKET_SQL.document,
			sourceRevision: PACKET_SQL.sourceRevision,
			label: PACKET_SQL.label,
			signatures: PACKET_SQL.signatures,
			ready: PACKET_SQL.ready,
			readyEvent: PACKET_SQL.readyEvent,
			failed: PACKET_SQL.failed,
			recover: PACKET_SQL.recover,
			copyArtifact: MESSAGE_SQL.copyArtifact,
			receiptId: MESSAGE_SQL.receiptId,
			claimCopy: MESSAGE_SQL.claimCopy,
			copyOutcome: MESSAGE_SQL.copyOutcome("SEND"),
			copyEvent: MESSAGE_SQL.copyEvent,
			noticeAgreement: MESSAGE_SQL.noticeAgreement,
			claimNotice: MESSAGE_SQL.claimNotice,
			noticeOutcome: MESSAGE_SQL.noticeOutcome("SEND"),
			resetCopies: MESSAGE_SQL.resetCopies,
			resetNotices: MESSAGE_SQL.resetNotices,
		}).toEqual(TODAY);
		expect(MESSAGE_SQL.copyOutcome("FAIL")).toBe(TODAY.copyOutcome);
		expect(MESSAGE_SQL.noticeOutcome("FAIL")).toBe(TODAY.noticeOutcome);

		// The texts the corpora do not run (no case has a document whose values lack a label or a source revision) are
		// today's source text as written.
		const artifacts = readFileSync(
			new URL("src/lib/agreement-artifacts.ts", root),
			"utf8",
		);

		expect(artifacts).toContain(`"${TODAY.sourceRevision}"`);
		expect(artifacts).toContain(`"${TODAY.label}"`);
	});

	it("runs only today's texts, each recorded by the corpora (but the two template reads no case reaches), and the added reads", async () => {
		const { texts } = recorded();
		const { texts: ran } = await tour();
		const unrecorded = [TODAY.sourceRevision, TODAY.label];

		expect([...ran].filter((text) => !texts.has(text)).sort()).toEqual(
			[...ADDED, ...unrecorded].sort(),
		);

		for (const today of Object.values(TODAY))
			if (!unrecorded.includes(today))
				expect(texts.has(today), today).toBe(true);

		for (const added of ADDED) expect(texts.has(added), added).toBe(false);
	});

	it("runs each of today's batches in the order the corpora recorded it", async () => {
		const { batches } = recorded();
		const { batches: ran } = await tour();

		const todays = ran.filter((batch) =>
			batch.every((text) => !ADDED.includes(text)),
		);

		expect(todays.length).toBe(3);

		for (const batch of todays)
			expect(batches.has(JSON.stringify(batch)), batch.join("\n")).toBe(true);
	});

	it("adds reads that no golden hook pattern matches, so every hook keeps its count", () => {
		const patterns = goldenPatterns();

		// The hooks the packet and copy corpora pick their statements by are among the literals read.
		expect(patterns.map(String)).toEqual(
			expect.arrayContaining([
				String(/UPDATE software_agreement_artifacts SET status='rendering'/),
				String(/SELECT receipt_id FROM software_agreement_signatures/),
				String(/SELECT request_id,\(SELECT receipt_id/),
				String(/FROM software_agreement_artifacts/),
			]),
		);

		for (const added of ADDED)
			expect(
				patterns.filter((pattern) => pattern.test(added)).map(String),
				added,
			).toEqual([]);
	});
});
