import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { hashBytes } from "../../src/lib/agreement-artifacts";
import { agreementDownload } from "../../src/lib/agreement-download";
import {
	decideDownload,
	intactSignedCopy,
	ownerCopy,
	readySignedCopy,
	verifiedVisitor,
	type DownloadAgreement,
	type DownloadFacts,
	type OwnerCopyFacts,
	type StoredSignedCopy,
	type StudioProject,
} from "../../src/server/rules/agreement-download";
import { double, partial } from "../helpers/doubles";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The download rules as stories: who may download which signed copy, and which copy is intact.

const run = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (value) => ({ kept: value }),
		}),
	);

const agreement = (
	over: Partial<DownloadAgreement> = {},
): DownloadAgreement => ({
	id: "a1",
	offer_id: "o1",
	request_id: "r1",
	recipient_email: "grace@example.test",
	status: "executed",
	archive_closed_at: null,
	...over,
});

const project = (over: Partial<StudioProject> = {}): StudioProject => ({
	request_id: "r1",
	agreement_id: "a1",
	linked_msa_id: null,
	request_status: "open",
	request_email: "grace@example.test",
	revoked_at: null,
	content_deleted_at: null,
	...over,
});

const nobody: DownloadFacts = {
	agreement: agreement(),
	archive: null,
	signing: null,
	studio: null,
	signingReusedMsaId: null,
	studioProjects: [],
};

const decide = (over: Partial<DownloadFacts>, id = "a1") =>
	run(decideDownload.decide({ id }, { ...nobody, ...over }));

const allowed = { kept: { id: "a1" } };
const refused = { refused: "AgreementNotFound", say: "Not found" };

describe("a visitor with no session", () => {
	it("is asked to verify", () => {
		expect(
			run(
				verifiedVisitor.decide(null, {
					archive: null,
					signing: null,
					studio: null,
				}),
			),
		).toEqual({
			refused: "SignInFirst",
			say: "Verify your agreement email first.",
		});
	});

	it.each([
		[
			"an archive session",
			{ archive: { recipient_email: "" }, signing: null, studio: null },
		],
		[
			"a signing session",
			{
				archive: null,
				signing: { recipient_email: "", offer_id: null },
				studio: null,
			},
		],
		[
			"a studio session with an empty email",
			{ archive: null, signing: null, studio: { email: "" } },
		],
	])("is verified with %s", (_name, sessions) => {
		expect(run(verifiedVisitor.decide(null, sessions))).toEqual({
			kept: sessions,
		});
	});
});

describe("the archive session", () => {
	it("downloads an agreement of its own address", () => {
		expect(
			decide({ archive: { recipient_email: "grace@example.test" } }),
		).toEqual(allowed);
	});

	it("is refused another address, with the same answer as an unknown id", () => {
		expect(
			decide({ archive: { recipient_email: "other@example.test" } }),
		).toEqual(refused);
		expect(
			decide({
				agreement: null,
				archive: { recipient_email: "grace@example.test" },
			}),
		).toEqual(refused);
	});

	it("is refused when the agreement is not executed", () => {
		for (const status of ["review", "client_signed", "abandoned"])
			expect(
				decide({
					agreement: agreement({ status }),
					archive: { recipient_email: "grace@example.test" },
				}),
			).toEqual(refused);
	});

	it("is refused when the archive is closed", () => {
		expect(
			decide({
				agreement: agreement({ archive_closed_at: "2026-11-01T00:00:00.000Z" }),
				archive: { recipient_email: "grace@example.test" },
			}),
		).toEqual(refused);
	});
});

describe("the signing session", () => {
	const signing = { recipient_email: "grace@example.test", offer_id: "o1" };

	it("downloads the agreement of its own offer", () => {
		expect(decide({ signing })).toEqual(allowed);
	});

	it("downloads an agreement its offer reuses as the master agreement", () => {
		expect(
			decide({
				signing: { ...signing, offer_id: "o2" },
				signingReusedMsaId: "a1",
			}),
		).toEqual(allowed);
	});

	it("is refused another offer's agreement that its offer does not reuse", () => {
		expect(
			decide({
				signing: { ...signing, offer_id: "o2" },
				signingReusedMsaId: "a9",
			}),
		).toEqual(refused);
	});

	it("is refused another address even for the same offer", () => {
		expect(
			decide({ signing: { ...signing, recipient_email: "x@example.test" } }),
		).toEqual(refused);
	});

	it("matches a missing offer to a missing offer, as the comparison always did", () => {
		expect(
			decide({
				agreement: agreement({ offer_id: null }),
				signing: { ...signing, offer_id: null },
			}),
		).toEqual(allowed);
	});
});

describe("the studio session", () => {
	const studio = { email: "grace@example.test" };

	it("downloads the agreement its project names", () => {
		expect(decide({ studio, studioProjects: [project()] })).toEqual(allowed);
	});

	it("downloads the master agreement its project's agreement is linked to", () => {
		expect(
			decide({
				studio,
				studioProjects: [
					project({ agreement_id: "a-sow", linked_msa_id: "a1" }),
				],
			}),
		).toEqual(allowed);
	});

	it("is refused when the project names another agreement", () => {
		expect(
			decide({ studio, studioProjects: [project({ agreement_id: "a9" })] }),
		).toEqual(refused);
	});

	it("is refused when the project is for another request", () => {
		expect(
			decide({ studio, studioProjects: [project({ request_id: "r9" })] }),
		).toEqual(refused);
	});

	it("is refused when the project has no agreement", () => {
		expect(
			decide({ studio, studioProjects: [project({ agreement_id: null })] }),
		).toEqual(refused);
	});

	it.each([
		["the brief is withdrawn", { request_status: "withdrawn" }],
		["the brief has no email", { request_email: "" }],
		["the project was revoked", { revoked_at: "2026-11-01T00:00:00.000Z" }],
		[
			"the project's content was deleted",
			{ content_deleted_at: "2026-11-01T00:00:00.000Z" },
		],
	])("is refused when %s", (_name, over) => {
		expect(decide({ studio, studioProjects: [project(over)] })).toEqual(
			refused,
		);
	});

	it("is refused another address", () => {
		expect(
			decide({
				studio: { email: "x@example.test" },
				studioProjects: [project()],
			}),
		).toEqual(refused);
	});

	it("with an empty email matches nothing but an empty address, and never a project with no email", () => {
		expect(
			decide({
				studio: { email: "" },
				studioProjects: [project({ request_email: "" })],
			}),
		).toEqual(refused);
		expect(
			decide({ studio: { email: "" }, studioProjects: [project()] }),
		).toEqual(refused);
	});
});

describe("no session at all", () => {
	it("is refused with the same answer as everything else", () => {
		expect(decide({})).toEqual(refused);
	});
});

describe("the signed copy", () => {
	it("is read when it is ready and names an object", () => {
		expect(
			run(
				readySignedCopy.decide(null, {
					status: "ready",
					pdf_key: "k",
					pdf_sha256: "d",
				}),
			),
		).toEqual({ kept: { pdf_key: "k", pdf_sha256: "d" } });
	});

	it.each([
		["there is no row", null],
		["it is pending", { status: "pending", pdf_key: "k", pdf_sha256: "d" }],
		["it failed", { status: "failed", pdf_key: "k", pdf_sha256: "d" }],
		[
			"it is ready but names no object",
			{ status: "ready", pdf_key: null, pdf_sha256: "d" },
		],
		[
			"it is ready with an empty key",
			{ status: "ready", pdf_key: "", pdf_sha256: "d" },
		],
	])("is not ready when %s", (_name, stored) => {
		expect(run(readySignedCopy.decide(null, stored))).toEqual({
			refused: "CopyNotReady",
			say: "Signed by both parties. Copy preparation needs attention.",
		});
	});

	it("is intact only when the stored digest is there and the bytes have it", () => {
		expect(
			run(intactSignedCopy.decide({ bytesSha256: "d" }, { pdf_sha256: "d" })),
		).toEqual({ kept: {} });

		for (const stored of [null, "", "other"])
			expect(
				run(
					intactSignedCopy.decide({ bytesSha256: "d" }, { pdf_sha256: stored }),
				),
			).toEqual({
				refused: "CopyIntegrity",
				say: "Signed copy failed its integrity check. Contact Kazon.",
			});
	});
});

// ---- the owner's download ----

const owner = (facts: OwnerCopyFacts) => run(ownerCopy.decide(null, facts));

const executed = { status: "executed", archive_closed_at: null };

const readyCopy: StoredSignedCopy = {
	status: "ready",
	pdf_key: "agreements/a1/c.pdf",
	pdf_sha256: "d",
};

describe("the owner's download", () => {
	it("reads the copy row of an executed agreement whose archive is open", () => {
		expect(owner({ agreement: executed })).toEqual({
			kept: { next: "read-copy" },
		});
	});

	it("reads the bytes of a ready copy's object, then hands them over when they have its digest", () => {
		expect(owner({ agreement: executed, copy: readyCopy })).toEqual({
			kept: {
				next: "read-bytes",
				pdf_key: "agreements/a1/c.pdf",
				pdf_sha256: "d",
			},
		});
		expect(
			owner({ agreement: executed, copy: readyCopy, bytesSha256: "d" }),
		).toEqual({ kept: { next: "hand-over" } });
	});

	it("is not found for an agreement that is missing, not executed, or closed", () => {
		const notFound = { refused: "AgreementNotFound", say: "Not found" };

		expect(owner({ agreement: null })).toEqual(notFound);

		for (const status of ["review", "client_signed", "abandoned"])
			expect(owner({ agreement: { status, archive_closed_at: null } })).toEqual(
				notFound,
			);

		expect(
			owner({
				agreement: {
					status: "executed",
					archive_closed_at: "2026-11-01T00:00:00.000Z",
				},
			}),
		).toEqual(notFound);
	});

	it("is not ready for a copy that is missing, not ready, or names no object", () => {
		const notReady = {
			refused: "CopyNotReady",
			say: "Signed by both parties. Copy preparation needs attention.",
		};

		for (const copy of [
			null,
			{ ...readyCopy, status: "pending" },
			{ ...readyCopy, status: "rendering" },
			{ ...readyCopy, status: "failed" },
			{ ...readyCopy, pdf_key: null },
			{ ...readyCopy, pdf_key: "" },
		])
			expect(owner({ agreement: executed, copy })).toEqual(notReady);
	});

	it("fails its integrity check for bytes without the copy's digest, or a copy with none", () => {
		const integrity = {
			refused: "CopyIntegrity",
			say: "Signed copy failed its integrity check. Contact Kazon.",
		};

		expect(
			owner({ agreement: executed, copy: readyCopy, bytesSha256: "other" }),
		).toEqual(integrity);

		for (const pdf_sha256 of [null, ""])
			expect(
				owner({
					agreement: executed,
					copy: { ...readyCopy, pdf_sha256 },
					bytesSha256: "",
				}),
			).toEqual(integrity);
	});

	it("answers in today's order: not found, then not ready, then the integrity check", () => {
		expect(
			owner({
				agreement: null,
				copy: { ...readyCopy, status: "failed" },
				bytesSha256: "other",
			}),
		).toMatchObject({ refused: "AgreementNotFound" });
		expect(
			owner({
				agreement: executed,
				copy: { ...readyCopy, pdf_key: null },
				bytesSha256: "other",
			}),
		).toMatchObject({ refused: "CopyNotReady" });
	});
});

// Today's owner download (`agreementDownload`, src/lib/agreement-download.ts, run itself) on sqlite and a bucket, held
// to `ownerCopy` driven in the same order over the store's reads: the agreement with its client (the visitor's read,
// src/server/agreement-store.ts, whatever its status), then the copy row (whatever its status), then the object's bytes.

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

const artifactsTable = migration
	.split("\n")
	.find((line) =>
		line.startsWith("CREATE TABLE software_agreement_artifacts ("),
	);

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

database.exec(
	`CREATE TABLE software_agreement_clients (id TEXT PRIMARY KEY, recipient_email TEXT NOT NULL);
	CREATE TABLE software_agreements (id TEXT PRIMARY KEY, offer_id TEXT, request_id TEXT NOT NULL, client_id TEXT NOT NULL, status TEXT NOT NULL, archive_closed_at TEXT);
	${artifactsTable}`,
);

const ID = "a1";
const BYTES = new TextEncoder().encode("%PDF-1.7 signed").buffer;
const objects = new Map<string, ArrayBuffer>();

const bucket = double<R2Bucket>({
	get: async (key: string) => {
		const bytes = objects.get(key);

		return bytes
			? partial<R2ObjectBody>({ arrayBuffer: async () => bytes.slice(0) })
			: null;
	},
});

const AGREEMENT_READ =
	"SELECT a.id,a.offer_id,a.request_id,a.status,a.archive_closed_at,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=?";

const COPY_READ =
	"SELECT status,pdf_key,pdf_sha256 FROM software_agreement_artifacts WHERE agreement_id=?";

/** The facts the owner's download has read so far, filled in as the rule asks for them. */
type OwnerReads = {
	agreement: OwnerCopyFacts["agreement"];
	copy?: StoredSignedCopy | null;
	bytesSha256?: string;
};

/** The rule driven as the flow will drive it: each fact read only when the rule asks for it. */
async function ownerDecision(): Promise<string> {
	const facts: OwnerReads = {
		agreement: await db
			.prepare(AGREEMENT_READ)
			.bind(ID)
			.first<DownloadAgreement>(),
	};

	for (;;) {
		const step = run(ownerCopy.decide(null, facts));

		if ("refused" in step) return step.refused;

		if (step.kept.next === "hand-over") return "hand-over";

		if (step.kept.next === "read-copy") {
			facts.copy = await db
				.prepare(COPY_READ)
				.bind(ID)
				.first<StoredSignedCopy>();
			continue;
		}

		const object = await bucket.get(step.kept.pdf_key);

		if (!object) return "missing";

		facts.bytesSha256 = await hashBytes(await object.arrayBuffer());
	}
}

/** What today's response means, in the rule's words. */
async function todaysAnswer(response: Response) {
	const text = response.status === 200 ? "" : await response.text();

	if (response.status === 404 && text === "Not found")
		return "AgreementNotFound";

	if (
		response.status === 409 &&
		text === "Signed by both parties. Copy preparation needs attention."
	)
		return "CopyNotReady";

	if (
		response.status === 503 &&
		text === "Signed copy failed its integrity check. Contact Kazon."
	)
		return "CopyIntegrity";

	if (
		response.status === 500 &&
		text === "Signed copy unavailable. Contact Kazon."
	)
		return "missing";

	return response.status === 200 ? "hand-over" : `${response.status} ${text}`;
}

describe("today's owner download and ownerCopy", () => {
	it("agree on every agreement, copy row and object", async () => {
		const digest = await hashBytes(BYTES);
		const env = partial<Env>({ MUSIC_DB: db, AUDIO: bucket });
		const answers = new Map<string, number>();

		const agreements = [
			null,
			{ status: "executed", archive_closed_at: null, client: false },
			...["review", "client_signed", "executed", "abandoned"].flatMap(
				(status) =>
					[null, "2026-11-01T00:00:00.000Z"].map((archive_closed_at) => ({
						status,
						archive_closed_at,
						client: true,
					})),
			),
		];

		const copies: (StoredSignedCopy | null)[] = [
			null,
			...["pending", "rendering", "ready", "failed"].flatMap((status) =>
				[null, "", "agreements/a1/c.pdf"].flatMap((pdf_key) =>
					[null, "", digest, "f".repeat(64)].map((pdf_sha256) => ({
						status,
						pdf_key,
						pdf_sha256,
					})),
				),
			),
		];

		for (const agreement of agreements)
			for (const copy of copies)
				for (const stored of [true, false]) {
					database.exec(
						"DELETE FROM software_agreement_artifacts; DELETE FROM software_agreements; DELETE FROM software_agreement_clients",
					);
					objects.clear();

					if (agreement) {
						if (agreement.client)
							database
								.prepare("INSERT INTO software_agreement_clients VALUES (?,?)")
								.run("c1", "grace@example.test");
						database
							.prepare("INSERT INTO software_agreements VALUES (?,?,?,?,?,?)")
							.run(
								ID,
								"o1",
								"r1",
								"c1",
								agreement.status,
								agreement.archive_closed_at,
							);
					}

					if (agreement && copy)
						database
							.prepare(
								"INSERT INTO software_agreement_artifacts(agreement_id,status,pdf_key,pdf_sha256) VALUES (?,?,?,?)",
							)
							.run(ID, copy.status, copy.pdf_key, copy.pdf_sha256);

					if (stored && copy?.pdf_key) objects.set(copy.pdf_key, BYTES);

					const today = await todaysAnswer(
						await agreementDownload(env, ID, { unexpected: () => {} }),
					);

					const decided = await ownerDecision();

					expect(decided, JSON.stringify({ agreement, copy, stored })).toBe(
						today,
					);
					answers.set(today, (answers.get(today) ?? 0) + 1);
				}

		expect([...answers.keys()].sort()).toEqual([
			"AgreementNotFound",
			"CopyIntegrity",
			"CopyNotReady",
			"hand-over",
			"missing",
		]);
	});
});
