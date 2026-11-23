import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	prepareAgreementArtifact,
	type SigningCertificate,
} from "../../src/lib/agreement-artifacts";
import { sendAudioMessage } from "../../src/lib/audio-resend";
import { keyedHash } from "../../src/lib/client-portal";
import type { Agreement } from "../../src/lib/software-agreements";
import {
	AgreementAllowance,
	AgreementAllowanceFailed,
	AgreementMail,
	type AgreementMailMessage,
	AgreementPacket,
	liveAgreementAllowance,
	liveAgreementMail,
	liveAgreementPacket,
	livePdfCheck,
	mailAttachment,
	type PacketModule,
	PacketNotRendered,
	PdfCheck,
	type PdfLib,
	PdfLibUnavailable,
	RendererNotLoaded,
	type StoredPacketBytes,
} from "../../src/server/agreement-services";
import {
	readDocumentSignatures,
	readTemplateLabel,
	readTemplateSourceRevision,
} from "../../src/server/agreement-store";
import { MusicDb } from "../../src/server/services";
import { CodeKeyUnusable } from "../../src/server/signin-services";
import { freshMusicDb, seed } from "../golden/harness/db";
import * as rows from "../golden/harness/rows";
import { double, partial } from "../helpers/doubles";
import { sqliteD1 } from "../helpers/sqlite-d1";

// The agreement area's services (src/server/agreement-services.ts) with fake bindings: the mail as Resend is asked
// (each request body byte for byte what the old code sent, its idempotency key, each outcome), the allowance on the real
// schema (the use it counted, a code key under 32 characters), the packet against today's prepareAgreementArtifact on
// twin databases (built from the store's certificate reads: the same certificates, keys and bytes, and the same error
// for what it throws, so the same log line), and the PDF check with pdf-lib.

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const run = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.match(effect, {
			onFailure: (failure) => ({ failed: failure }),
			onSuccess: (value) => ({ value }),
		}),
	);

/** What an effect failed with; an effect that succeeds fails the test. */
async function failureOf<A, E>(effect: Effect.Effect<A, E>) {
	const ran = await run(effect);

	if (!("failed" in ran)) throw new Error("The effect succeeded.");

	return ran.failed;
}

/** What a failure that carries one says caused it. */
const causeOf = (failure: { readonly failure: unknown }) => failure.failure;

// ---- the mail ----

/** One request the stubbed fetch received. */
type Sent = { url: string; headers: Headers; body: string };

/** Stubs fetch with Resend answering `answer` (a status, or a network failure), and records each request. */
function stubFetch(answer: number | "network-down" = 200) {
	const sent: Sent[] = [];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			sent.push({
				url: String(input),
				headers: new Headers(init?.headers),
				body: String(init?.body),
			});

			if (answer === "network-down") throw new TypeError("fetch failed");

			return Response.json({ id: "email-1" }, { status: answer });
		}),
	);

	return sent;
}

const mail = () => Context.get(liveAgreementMail("re_key"), AgreementMail);

/** A recorded golden case's Resend requests: each one's body and idempotency key. */
function recordedResend(corpus: string, name: string) {
	// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases with their effects.
	const cases = JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(`../golden/fixtures/${corpus}.json.gz`, import.meta.url),
			),
		).toString("utf8"),
	) as {
		name: string;
		effects: {
			kind: string;
			host?: string;
			body?: string;
			headers?: Record<string, string>;
		}[];
	}[];

	const found = cases.find((recorded) => recorded.name === name);

	if (!found) throw new Error(`No ${corpus} case named "${name}".`);

	return found.effects.flatMap((effect) =>
		effect.kind === "fetch" && effect.host === "resend" && effect.body
			? [{ body: effect.body, key: effect.headers?.["idempotency-key"] }]
			: [],
	);
}

/** The base64 text's bytes. */
const bytesOf = (base64: string) =>
	Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

describe("AgreementMail", () => {
	it("sends a signed copy as the old code did: its body, attachment included, byte for byte, with its idempotency key", async () => {
		const recorded = recordedResend(
			"owner-request-agreement-retry-artifact",
			"the packet is prepared and both copies are sent",
		);

		expect(recorded).toHaveLength(2);

		for (const { body, key } of recorded) {
			// SAFETY: the recorded body is the JSON of a signed copy's payload (from, to, subject, text, attachments).
			const old = JSON.parse(body) as {
				from: string;
				to: string[];
				subject: string;
				text: string;
				attachments: { filename: string; content: string }[];
			};

			// The payload as the copies flow builds it, the PDF attached from its bytes.
			const payload: AgreementMailMessage = {
				from: old.from,
				to: old.to,
				subject: old.subject,
				text: old.text,
				attachments: [
					mailAttachment(
						"signed-agreement.pdf",
						bytesOf(old.attachments[0].content),
					),
				],
			};

			const sent = stubFetch();

			expect(await run(mail().send(payload, key))).toEqual({ value: "sent" });
			expect(sent).toHaveLength(1);
			expect(sent[0].url).toBe("https://api.resend.com/emails");
			expect(sent[0].body).toBe(body);
			expect(sent[0].headers.get("idempotency-key")).toBe(key);
			expect(sent[0].headers.get("authorization")).toBe("Bearer re_key");
		}
	});

	it("sends a signing notice as the old code did, with its idempotency key", async () => {
		const recorded = recordedResend(
			"owner-request-agreement-retry-copy",
			"the notices of a waiting agreement are sent",
		);

		expect(recorded.length).toBeGreaterThan(0);

		for (const { body, key } of recorded) {
			// SAFETY: the recorded body is the JSON of a notice's payload (from, to, subject, text).
			const old = JSON.parse(body) as {
				from: string;
				to: string[];
				subject: string;
				text: string;
			};

			const sent = stubFetch();

			await run(
				mail().send(
					{
						from: old.from,
						to: old.to,
						subject: old.subject,
						text: old.text,
					},
					key,
				),
			);

			expect(sent[0].body).toBe(body);
			expect(key).toMatch(
				/^agreement-.+-(signature-receipt|countersign-notice)$/,
			);
			expect(sent[0].headers.get("idempotency-key")).toBe(key);
		}
	});

	it("sends no idempotency key when none is given, and asks Resend exactly as sendAudioMessage does", async () => {
		const payload: AgreementMailMessage = {
			from: "site@example.test",
			to: ["grace@example.test"],
			subject: "Open your agreement",
			text: "Hi Grace,",
			html: "<p>Hi Grace,</p>",
		};

		const viaService = stubFetch();
		await run(mail().send(payload));

		const direct = stubFetch();
		await sendAudioMessage({ apiKey: "re_key", payload });

		expect(viaService[0].headers.has("idempotency-key")).toBe(false);
		expect(viaService[0].body).toBe(direct[0].body);
		expect([...viaService[0].headers]).toEqual([...direct[0].headers]);
	});

	it.each([
		[200, "sent"],
		[422, "refused"],
		[500, "uncertain"],
		["network-down", "uncertain"],
	] as const)("answers %s as %s", async (answer, outcome) => {
		stubFetch(answer);

		expect(
			await run(
				mail().send({
					from: "site@example.test",
					to: ["grace@example.test"],
					subject: "Your signature is saved",
					text: "Saved.",
				}),
			),
		).toEqual({ value: outcome });
	});
});

describe("mailAttachment", () => {
	it.each([0, 1, 8191, 8192, 8193, 20_000])(
		"encodes %i bytes as base64, across the 8,192-byte chunks",
		(length) => {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 7) % 256);

			expect(mailAttachment("signed-agreement.pdf", bytes)).toEqual({
				filename: "signed-agreement.pdf",
				content: Buffer.from(bytes).toString("base64"),
			});
		},
	);
});

// ---- the allowance ----

const SECRET = "k".repeat(32);

/** A database on the real schema whose statements are logged by their SQL. */
function loggedDb() {
	const sql = freshMusicDb();
	const real = sqliteD1(sql);
	const log: string[] = [];

	const db = double<D1Database>({
		prepare: (query: string) => {
			log.push(query);

			return real.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			log.push("batch");

			return real.batch<T>(items);
		},
	});

	return { sql, db, log };
}

describe("AgreementAllowance", () => {
	it("answers each use with whether it is allowed, its keyed hash and the start of the window it counted in", async () => {
		const { db } = loggedDb();

		const allowance = Context.get(
			liveAgreementAllowance(db, SECRET),
			AgreementAllowance,
		);

		const key = await keyedHash(SECRET, "agreement-link-ip:203.0.113.7");

		vi.useFakeTimers({ now: new Date("2026-11-23T12:00:00.000Z") });

		const first = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		vi.setSystemTime(new Date("2026-11-23T12:01:00.000Z"));

		const second = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		const third = await run(
			allowance.reserve("agreement-link-ip", "203.0.113.7", 2),
		);

		vi.useRealTimers();

		// Every use of the window answers the window's start, so a refund finds its row.
		const window_start = "2026-11-23T12:00:00.000Z";

		expect([first, second, third]).toEqual([
			{ value: { key, window_start, allowed: true } },
			{ value: { key, window_start, allowed: true } },
			{ value: { key, window_start, allowed: false } },
		]);
	});

	it("refuses a code key under 32 characters before anything is counted or hashed", async () => {
		const { db, log } = loggedDb();

		const allowance = Context.get(
			liveAgreementAllowance(db, "k".repeat(31)),
			AgreementAllowance,
		);

		expect(
			await failureOf(allowance.reserve("agreement-link-ip", "x", 20)),
		).toBeInstanceOf(CodeKeyUnusable);
		expect(
			await failureOf(allowance.keyed("archive-link-cooldown:x")),
		).toBeInstanceOf(CodeKeyUnusable);
		expect(log).toEqual([]);
	});

	it("is AgreementAllowanceFailed with the cause when the count fails", async () => {
		const failure = new Error("D1_ERROR: unavailable");

		const statement = double<D1PreparedStatement>({});
		statement.bind = () => statement;

		const allowance = Context.get(
			liveAgreementAllowance(
				double<D1Database>({
					prepare: () => statement,
					batch: async () => {
						throw failure;
					},
				}),
				SECRET,
			),
			AgreementAllowance,
		);

		const failed = await failureOf(
			allowance.reserve("agreement-link-ip", "x", 20),
		);

		expect(failed).toBeInstanceOf(AgreementAllowanceFailed);
		expect(failed instanceof AgreementAllowanceFailed && causeOf(failed)).toBe(
			failure,
		);
	});
});

// ---- the packet ----

const EXECUTED = "2026-11-13T12:00:00.000Z";

/** A signature row of `agreement` by `party`. */
const signature = (agreement: string, party: "client" | "contractor") => ({
	id: `${agreement}-${party}`,
	agreement_id: agreement,
	party,
	typed_name: party === "client" ? "Grace Hopper" : "Kazon Wilson",
	title: party === "client" ? "Owner" : "Member",
	consent_text: "I agree to sign electronically.",
	consent_version: "v1",
	consent_at: EXECUTED,
	signed_at: EXECUTED,
	document_sha256: "0".repeat(64),
	verified_email: "grace@example.test",
	verified_at: EXECUTED,
	verification_method: "email-link",
	intent_text: "Sign",
	document_list_json: "[]",
	receipt_id: `receipt-${party}`,
	ip_address: "192.0.2.1",
	user_agent: "Synthetic browser",
});

type PacketWorld = {
	/** The SOW's values; the MSA's always carry their label and revision. */
	readonly sowValues?: object;
	/** Signatures to leave out, as `<agreement>-<party>`. */
	readonly unsigned?: readonly string[];
	/** The SOW's stored attachment manifest, as text. */
	readonly sowManifest?: string;
};

/**
 * An executed MSA (`a1`) and its SOW (`a2`), each with both signatures and a pending packet row. The SOW's values lack
 * the label and the revision, so its certificate reads them from its template row, as an older SOW's does.
 */
function packetWorld(world: PacketWorld = {}) {
	const { sql, db, log } = loggedDb();

	seed(sql, {
		owner_requests: [rows.softwareRequest("r1")],
		software_offers: [rows.softwareOffer("o1", "r1")],
		...rows.agreementBase(),
	});
	seed(sql, {
		software_agreement_templates: [
			{
				id: "template-sow",
				kind: "sow",
				version: 2,
				text: "SOW",
				sha256: "1".repeat(64),
				published_at: "2026-10-01T10:00:00.000Z",
				published_by: "owner@example.test",
				version_label: "sow-2.0",
				source_revision: "rev-sow",
			},
		],
		software_agreements: [
			rows.agreement("a1", "r1", "o1", {
				status: "executed",
				executed_at: EXECUTED,
				canonical_text: "The MSA.",
				text_sha256: "a".repeat(64),
				values_json: JSON.stringify({
					msa: {
						template_version: 1,
						version_label: "msa-1.0",
						source_revision: "rev-msa",
					},
					contractor: { config_version: 3 },
				}),
			}),
			rows.agreement("a2", "r1", "o1", {
				kind: "sow",
				template_id: "template-sow",
				msa_id: "a1",
				status: "executed",
				executed_at: EXECUTED,
				canonical_text: "The SOW.",
				text_sha256: "b".repeat(64),
				values_json: JSON.stringify(
					world.sowValues ?? {
						system: { template_version: 2 },
						sow: { version: 1 },
						contractor: { config_version: 3 },
					},
				),
				attachment_manifest_json:
					world.sowManifest ??
					JSON.stringify([
						{ filename: "Plan.pdf", version: "1", sha256: "c".repeat(64) },
					]),
			}),
		],
		software_agreement_signatures: ["a1", "a2"]
			.flatMap((id) => [signature(id, "client"), signature(id, "contractor")])
			.filter(
				(row) =>
					!(world.unsigned ?? []).includes(`${row.agreement_id}-${row.party}`),
			),
		software_agreement_artifacts: [
			{ agreement_id: "a1" },
			{ agreement_id: "a2" },
		],
	});

	/** R2, kept in a map with each object's bytes; each call is logged after the database's statements. */
	const objects = new Map<
		string,
		{ body: string | Uint8Array; sha256?: string }
	>();

	const bytesIn = (body: string | Uint8Array) =>
		body instanceof Uint8Array ? body.slice() : new TextEncoder().encode(body);

	const bucket = double<R2Bucket>({
		get: async (key: string) => {
			log.push(`r2 get ${key}`);
			const object = objects.get(key);

			return object
				? double<R2ObjectBody>({
						customMetadata: object.sha256 ? { sha256: object.sha256 } : {},
						arrayBuffer: async () => bytesIn(object.body).buffer,
					})
				: null;
		},
		put: async (
			key: string,
			body: string | Uint8Array,
			options?: R2PutOptions,
		) => {
			log.push(`r2 put ${key}`);
			objects.set(key, { body, sha256: options?.customMetadata?.sha256 });

			return double<R2Object>({ key });
		},
	});

	const env = partial<Env>({ MUSIC_DB: db, AUDIO: bucket });

	/** The documents the packet flow reads: the SOW's MSA, then the SOW. */
	const documents = () =>
		["a1", "a2"].map(
			// SAFETY: SELECT * of software_agreements gives every column of the Agreement row.
			(id) =>
				sql
					.prepare("SELECT * FROM software_agreements WHERE id=?")
					.get(id) as Agreement,
		);

	return { sql, db, log, bucket, env, objects, documents };
}

/** A renderer that records what it was handed and answers fixed bytes. */
function recordingRenderer(bytes = new TextEncoder().encode("%PDF-packet")) {
	const calls: {
		documents: Agreement[];
		certificates: SigningCertificate[];
	}[] = [];

	const renderer: PacketModule = {
		renderAgreementPacket: async (_env, documents, certificates) => {
			calls.push({ documents, certificates });

			return bytes;
		},
	};

	return { calls, renderer };
}

const packetService = (
	world: ReturnType<typeof packetWorld>,
	renderer: PacketModule,
) =>
	Context.get(
		liveAgreementPacket(world.env, async () => renderer),
		AgreementPacket,
	);

/** What the packet flow reads through the store for each document, in order: its template's revision and label, its signatures. */
const certificateReads = (documents: readonly Agreement[]) =>
	Effect.forEach(documents, (d) =>
		Effect.all({
			sourceRevision: readTemplateSourceRevision(d.template_id),
			label: readTemplateLabel(d.template_id),
			signatures: readDocumentSignatures(d.id),
		}),
	);

/** The packet stored under `key`, as the flow reads it from the bucket. */
async function storedUnder(
	bucket: R2Bucket,
	key: string,
): Promise<StoredPacketBytes | null> {
	const object = await bucket.get(key);

	return object
		? {
				bytes: new Uint8Array(await object.arrayBuffer()),
				sha256: object.customMetadata?.sha256,
			}
		: null;
}

/**
 * The packet as the flow will make it after its claim (the SOW `a2` and its MSA): the certificate reads through the
 * store, the certificates, the stored packet's read from the bucket, then the packet.
 */
const preparedPacket = (
	world: ReturnType<typeof packetWorld>,
	renderer: PacketModule,
) =>
	Effect.gen(function* () {
		const packet = packetService(world, renderer);
		const documents = world.documents();
		const reads = yield* certificateReads(documents);
		const certified = yield* packet.certify("a2", documents, reads);

		const stored = yield* Effect.promise(() =>
			storedUnder(world.bucket, certified.key),
		);

		const rendered = yield* packet.render(documents, certified, stored);

		return { certified, rendered };
	}).pipe(Effect.provideService(MusicDb, world.db));

/** The line today's packet preparation logs for an error it caught (artifacts.ts:327-336). */
const loggedLine = (error: Error) => [
	"Agreement artifact preparation failed:",
	error.name,
	error instanceof SyntaxError ? "Invalid JSON." : error.message,
];

describe("AgreementPacket", () => {
	it("builds today's certificates from the store's reads, hands the renderer what today's code did and answers today's keys, bytes and manifest", async () => {
		// Today: prepareAgreementArtifact claims, reads the SOW and its MSA, then makes the certificate reads and renders.
		const today = packetWorld();
		const old = recordingRenderer();

		await prepareAgreementArtifact(
			today.env,
			"a2",
			old.renderer.renderAgreementPacket,
		);

		const converted = packetWorld();
		const now = recordingRenderer();

		const prepared = await run(preparedPacket(converted, now.renderer));

		if (!("value" in prepared)) throw new Error("The packet did not render.");
		const { certified, rendered } = prepared.value;

		expect(now.calls).toHaveLength(1);
		expect(now.calls[0]).toEqual(old.calls[0]);
		expect(now.calls[0].certificates[1].versions?.version_label).toBe(
			"sow-2.0",
		);

		// The services read nothing: every statement is the store's certificate reads, each document's in turn, and
		// today's reads (made only where a document's values lack the revision or the label) are among them.
		const SIGNATURES = expect.stringMatching(
			/^SELECT party,typed_name,.* WHERE agreement_id=\? ORDER BY party$/,
		);

		const certificateReadsOfOne = [
			"SELECT source_revision FROM software_agreement_templates WHERE id=?",
			"SELECT version_label,published_at FROM software_agreement_templates WHERE id=?",
			SIGNATURES,
		];

		expect(converted.log).toEqual([
			...certificateReadsOfOne,
			...certificateReadsOfOne,
			expect.stringMatching(/^r2 get agreements\/a2\/[0-9a-f]{64}\.pdf$/),
		]);

		const firstPut = today.log.findIndex((entry) => entry.startsWith("r2 put"));

		for (const entry of today.log.slice(3, firstPut))
			expect(converted.log).toContain(entry);

		// What today put in R2 is what the services answer for the flow to put.
		const put = (key: string) => today.objects.get(key);

		expect(put(certified.key)).toEqual({
			body: rendered.bytes,
			sha256: rendered.pdfHash,
		});
		expect(put(certified.certificateKey)).toEqual({
			body: certified.certificate,
			sha256: certified.certificateHash,
		});
		expect(put(certified.manifestKey)).toEqual({
			body: rendered.manifest,
			sha256: undefined,
		});
		expect(rendered.alreadyStored).toBe(false);
		expect(certified.key).toBe(
			`agreements/a2/${certified.certificateHash}.pdf`,
		);
		expect(
			today.sql
				.prepare(
					"SELECT pdf_key,pdf_sha256,certificate_key,certificate_sha256,manifest_json,bytes FROM software_agreement_artifacts WHERE agreement_id='a2'",
				)
				.get(),
		).toEqual({
			pdf_key: certified.key,
			pdf_sha256: rendered.pdfHash,
			certificate_key: certified.certificateKey,
			certificate_sha256: certified.certificateHash,
			manifest_json: rendered.manifest,
			bytes: rendered.bytes.length,
		});
	});

	it("uses a stored packet instead of rendering it, and refuses one whose recorded hash differs", async () => {
		const world = packetWorld();
		const first = recordingRenderer();

		const prepared = await run(preparedPacket(world, first.renderer));

		if (!("value" in prepared)) throw new Error("The packet did not render.");
		const { certified, rendered } = prepared.value;

		world.objects.set(certified.key, {
			body: rendered.bytes,
			sha256: rendered.pdfHash,
		});

		const again = recordingRenderer();

		expect(await run(preparedPacket(world, again.renderer))).toEqual({
			value: { certified, rendered: { ...rendered, alreadyStored: true } },
		});
		expect(again.calls).toEqual([]);

		world.objects.set(certified.key, {
			body: rendered.bytes,
			sha256: "f".repeat(64),
		});

		const mismatch = await failureOf(preparedPacket(world, again.renderer));

		expect(mismatch).toBeInstanceOf(PacketNotRendered);
		expect(mismatch instanceof PacketNotRendered && causeOf(mismatch)).toEqual(
			new Error("Stored packet hash mismatch."),
		);
	});

	it.each([
		[
			"a values record that lacks the contractor",
			{ sowValues: { system: { template_version: 2 }, sow: { version: 1 } } },
			TypeError,
		],
		["a manifest that is not JSON", { sowManifest: "{bad" }, SyntaxError],
	] as const)(
		"fails on %s with what today's code throws, so the log line is today's",
		async (_case, world, kind) => {
			const today = packetWorld(world);

			const logged = vi.spyOn(console, "error").mockImplementation(() => {});

			await prepareAgreementArtifact(
				today.env,
				"a2",
				recordingRenderer().renderer.renderAgreementPacket,
			);

			expect(logged).toHaveBeenCalledTimes(1);

			const failed = await failureOf(
				preparedPacket(packetWorld(world), recordingRenderer().renderer),
			);

			expect(failed).toBeInstanceOf(PacketNotRendered);

			const thrown = failed instanceof PacketNotRendered && causeOf(failed);

			if (!(thrown instanceof kind)) throw new Error("Not today's error.");
			expect(loggedLine(thrown)).toEqual(logged.mock.calls[0]);
		},
	);

	it.each([
		[
			"a missing signature",
			{ unsigned: ["a1-contractor"] },
			undefined,
			new Error("Missing signature."),
		],
		[
			"a packet over 25 MiB",
			{},
			new Uint8Array(25 * 1024 * 1024 + 1),
			new Error("Packet exceeds 25 MiB."),
		],
	] as const)(
		"fails on %s with today's error",
		async (_case, world, bytes, error) => {
			const failed = await failureOf(
				preparedPacket(packetWorld(world), recordingRenderer(bytes).renderer),
			);

			expect(failed).toBeInstanceOf(PacketNotRendered);
			expect(failed instanceof PacketNotRendered && causeOf(failed)).toEqual(
				error,
			);
		},
	);

	it("fails with the renderer's own error, as it was", async () => {
		const refusal = new Error("The packet font cannot print 漢.");

		const renderer: PacketModule = {
			renderAgreementPacket: async () => {
				throw refusal;
			},
		};

		const failed = await failureOf(preparedPacket(packetWorld(), renderer));

		expect(failed instanceof PacketNotRendered && causeOf(failed)).toBe(
			refusal,
		);
	});

	it("dies when the reads are not one per document", async () => {
		const world = packetWorld();
		const packet = packetService(world, recordingRenderer().renderer);

		const exit = await Effect.runPromiseExit(
			packet.certify("a2", world.documents(), []),
		);

		expect(Exit.hasDies(exit)).toBe(true);
	});

	it("imports the renderer once, where `load` is asked, and names an import that fails", async () => {
		const world = packetWorld();
		const { renderer } = recordingRenderer();
		const load = vi.fn(async () => renderer);

		const packet = Context.get(
			liveAgreementPacket(world.env, load),
			AgreementPacket,
		);

		expect(await run(packet.load)).toEqual({ value: undefined });

		const documents = world.documents();

		const certified = await Effect.runPromise(
			certificateReads(documents).pipe(
				Effect.flatMap((reads) => packet.certify("a2", documents, reads)),
				Effect.provideService(MusicDb, world.db),
			),
		);

		await run(packet.render(documents, certified, null));
		expect(load).toHaveBeenCalledTimes(1);

		const missing = new Error("Cannot find module");

		const broken = Context.get(
			liveAgreementPacket(world.env, async () => {
				throw missing;
			}),
			AgreementPacket,
		);

		const failed = await failureOf(broken.load);

		expect(failed).toBeInstanceOf(RendererNotLoaded);
		expect(failed instanceof RendererNotLoaded && causeOf(failed)).toBe(
			missing,
		);
	});

	it("imports the real renderer by default", async () => {
		const world = packetWorld();

		const packet = Context.get(liveAgreementPacket(world.env), AgreementPacket);

		expect(await run(packet.load)).toEqual({ value: undefined });
	});
});

// ---- the PDF check ----

describe("PdfCheck", () => {
	const pages = (bytes: Uint8Array, load?: () => Promise<PdfLib>) =>
		run(Context.get(livePdfCheck(load), PdfCheck).pages(bytes));

	it("counts the pages pdf-lib reads", async () => {
		const one = await PDFDocument.create();
		one.addPage();

		const none = await PDFDocument.create();

		expect(await pages(await one.save())).toEqual({ value: 1 });
		expect(await pages(await none.save({ addDefaultPage: false }))).toEqual({
			value: 0,
		});
	});

	it("answers no count for bytes pdf-lib cannot load", async () => {
		const text = (value: string) => new TextEncoder().encode(value);

		expect(await pages(text("%PDF-"))).toEqual({ value: null });
		expect(await pages(text("%PDF-1.7\nnot a document"))).toEqual({
			value: null,
		});
	});

	it("answers no count when counting the pages throws", async () => {
		const throwing: PdfLib = {
			PDFDocument: double<typeof PDFDocument>({
				load: async () =>
					double<PDFDocument>({
						getPageCount: () => {
							throw new Error("Bad page tree.");
						},
					}),
			}),
		};

		expect(await pages(new Uint8Array(), async () => throwing)).toEqual({
			value: null,
		});
	});

	it("is PdfLibUnavailable when pdf-lib cannot be loaded", async () => {
		expect(
			await failureOf(
				Context.get(
					livePdfCheck(async () => {
						throw new Error("Cannot find module 'pdf-lib'");
					}),
					PdfCheck,
				).pages(new Uint8Array()),
			),
		).toBeInstanceOf(PdfLibUnavailable);
	});
});
