import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it } from "vitest";
import { softwareGuard } from "../../src/lib/software-guard";
import { raisedByJsonGuard } from "../../src/server/guarded-save";
import {
	ATTACHMENT_LIMIT_BYTES,
	acceptAttachment,
	attachmentKey,
	refusedUpload,
	type StoredUploadRequest,
	UploadRefused,
	uploadBytes,
	uploadPages,
	uploadQuery,
} from "../../src/server/rules/agreement-upload";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The upload rules as stories, stage by stage in the order the route answers (the signing setting and the query, the
// body, what pdf-lib read, then the request after the object is put), and the batch guard that re-checks the request at
// write time (A24) held to `acceptAttachment` on sqlite. The guard is today's `softwareGuard` (src/lib/software-guard.ts,
// imported) over the condition and the insert copied from the PUT in
// src/pages/api/owner/requests/[id]/agreement-attachments.ts; the attachments table is the migration's own.

const run = <W, E extends { _tag: string; say: string }>(
	decided: Effect.Effect<W, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (value) => ({ kept: value }),
		}),
	);

const QUERY = { filename: "msa-draft.pdf", version: "2", date: "2026-10-01" };

const front = (
	over: {
		query?: Record<string, string>;
		contentType?: string | null;
		hasBody?: boolean;
	} = {},
	setting: { software_signing_enabled: number } | null = {
		software_signing_enabled: 1,
	},
) =>
	run(
		uploadQuery.decide(
			{
				query: over.query ?? QUERY,
				contentType:
					"contentType" in over
						? (over.contentType ?? null)
						: "application/pdf",
				hasBody: over.hasBody ?? true,
			},
			setting,
		),
	);

const queryRefused = {
	refused: "UploadRefused",
	say: "Choose a PDF, version and date.",
};

describe("stage 1: the signing setting, the query, the type and the body", () => {
	it("keeps the filename, version and date the query names", () => {
		expect(front()).toEqual({ kept: QUERY });
	});

	it("is refused while signing is off, or its setting is missing, before the query is looked at", () => {
		const off = { refused: "SigningOff", say: "Website signing is off." };

		expect(front({}, { software_signing_enabled: 0 })).toEqual(off);
		expect(front({}, null)).toEqual(off);
		expect(front({ query: {}, hasBody: false }, null)).toEqual(off);
	});

	it("is refused for a query that does not read", () => {
		expect(front({ query: {} })).toEqual(queryRefused);
		expect(front({ query: { ...QUERY, filename: "a/b.pdf" } })).toEqual(
			queryRefused,
		);
		expect(front({ query: { ...QUERY, filename: "a\\b.pdf" } })).toEqual(
			queryRefused,
		);
		expect(front({ query: { ...QUERY, version: "" } })).toEqual(queryRefused);
		expect(front({ query: { ...QUERY, date: "2026-02-30" } })).toEqual(
			queryRefused,
		);
		expect(front({ query: { ...QUERY, date: "1 October 2026" } })).toEqual(
			queryRefused,
		);
	});

	it("is refused for another content type, or no body, with the same sentence", () => {
		expect(front({ contentType: "application/octet-stream" })).toEqual(
			queryRefused,
		);
		expect(front({ contentType: "application/pdf; charset=binary" })).toEqual(
			queryRefused,
		);
		expect(front({ contentType: null })).toEqual(queryRefused);
		expect(front({ hasBody: false })).toEqual(queryRefused);
	});
});

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

const body = (bytes: ArrayBuffer | null) =>
	run(uploadBytes.decide({ bytes }, null));

describe("stage 2: the body", () => {
	it("keeps a body within 10 MiB that starts as a PDF does", () => {
		const pdf = bytesOf("%PDF-1.7\n...");

		expect(body(pdf)).toEqual({ kept: pdf });
		expect("kept" in body(bytesOf("%PDF-"))).toBe(true);
	});

	it("is refused with the 413's sentence for a body that ran past 10 MiB", () => {
		expect(body(null)).toEqual({
			refused: "UploadRefused",
			say: "Keep each PDF under 10 MiB.",
		});
		expect(ATTACHMENT_LIMIT_BYTES).toBe(10485760);
	});

	it("is refused for a body that does not start with %PDF-", () => {
		const notPdf = { refused: "UploadRefused", say: "The file must be a PDF." };

		expect(body(bytesOf("%PDF"))).toEqual(notPdf);
		expect(body(bytesOf("%pdf-1.7"))).toEqual(notPdf);
		expect(body(bytesOf("﻿%PDF-1.7"))).toEqual(notPdf);
		expect(body(bytesOf(" %PDF-1.7"))).toEqual(notPdf);
		expect(body(new ArrayBuffer(0))).toEqual(notPdf);
	});

	it("names the check that refused, so the route answers the size with 413 and the rest with 400", () => {
		expect(new UploadRefused({ problem: "size" }).problem).toBe("size");
		expect(new UploadRefused({ problem: "pages" }).say).toBe(
			"The PDF has no pages.",
		);
	});
});

const pages = (count: number | null) =>
	run(uploadPages.decide({ pages: count }, null));

describe("stage 3: what pdf-lib read", () => {
	it("goes on for a PDF with a page", () => {
		expect(pages(1)).toEqual({ kept: {} });
		expect(pages(40)).toEqual({ kept: {} });
	});

	it("is refused as unreadable when pdf-lib could not load the bytes (B4)", () => {
		expect(pages(null)).toEqual({
			refused: "PdfUnreadable",
			say: "The PDF could not be validated. Use a supported PDF or sign outside the website.",
		});
	});

	it("is refused for a PDF with no pages", () => {
		expect(pages(0)).toEqual({
			refused: "UploadRefused",
			say: "The PDF has no pages.",
		});
	});
});

const NOW = new Date("2026-11-23T15:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

const attachRequest = (requestId = "r1") => ({
	id: ID,
	requestId,
	query: QUERY,
	sha256: SHA,
	bytes: 2048,
	at: NOW,
	owner: "owner@example.test",
});

const attach = (facts: StoredUploadRequest | null, requestId = "r1") =>
	run(acceptAttachment.decide(attachRequest(requestId), facts));

const row = {
	id: ID,
	request_id: "r1",
	filename: "msa-draft.pdf",
	version: "2",
	document_date: "2026-10-01",
	object_key: `agreements/attachments/${ID}.pdf`,
	sha256: SHA,
	bytes: 2048,
	created_at: "2026-11-23T15:00:00.000Z",
	created_by: "owner@example.test",
};

const notFound = { refused: "RequestNotFound", say: "Not found" };

const closed = {
	refused: "RequestClosed",
	say: "The attachment could not be saved.",
};

describe("stage 4: the request", () => {
	it("writes the attachment's row for an open software request", () => {
		expect(attach({ kind: "software", status: "new" })).toEqual({ kept: row });
		expect(attach({ kind: "software", status: "reviewed" })).toEqual({
			kept: row,
		});
		expect(attachmentKey(ID)).toBe(row.object_key);
	});

	it("is not found for an unknown request, another kind of request, or no id (B3, B4)", () => {
		expect(attach(null)).toEqual(notFound);
		expect(attach(null, "")).toEqual(notFound);
		expect(attach({ kind: "service", status: "new" })).toEqual(notFound);
		expect(attach({ kind: "purchase", status: "reviewed" })).toEqual(notFound);
	});

	it("is closed for a withdrawn or resolved software request (B4)", () => {
		expect(attach({ kind: "software", status: "withdrawn" })).toEqual(closed);
		expect(attach({ kind: "software", status: "resolved" })).toEqual(closed);
	});

	it("answers not found before closed when both hold", () => {
		expect(attach({ kind: "service", status: "withdrawn" })).toEqual(notFound);
	});
});

describe("after a refused batch", () => {
	it("answers closed for a software request whatever its status reads now, and not found otherwise", () => {
		for (const status of ["new", "reviewed", "resolved", "withdrawn"]) {
			expect(
				run(refusedUpload.decide(null, { kind: "software", status })),
			).toEqual(closed);
			expect(
				run(refusedUpload.decide(null, { kind: "service", status })),
			).toEqual(notFound);
		}

		expect(run(refusedUpload.decide(null, null))).toEqual(notFound);
	});
});

// ---- the batch guard on sqlite ----

const migration = readFileSync(
	new URL("../../migrations/music/0023_software_signing.sql", import.meta.url),
	"utf8",
);

const attachmentsTable = migration
	.split("\n")
	.find((line) =>
		line.startsWith("CREATE TABLE software_agreement_attachments ("),
	);

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS software_agreement_attachments; DROP TABLE IF EXISTS owner_requests;
		CREATE TABLE owner_requests (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service','software')), status TEXT NOT NULL CHECK(status IN ('new','reviewed','resolved','withdrawn')));
		${attachmentsTable}`,
	);
});

// Copied from the PUT: the condition its batch guard re-checks (A24), and the insert it guards.
const UPLOAD_GUARD =
	"SELECT 1 FROM owner_requests WHERE id=? AND kind='software' AND status NOT IN ('withdrawn','resolved')";

const INSERT =
	"INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)";

/** Today's batch, bound as the PUT binds it; whether its guard raised. */
async function todaysBatch(requestId: string) {
	try {
		await db.batch([
			softwareGuard(db, UPLOAD_GUARD, [requestId]),
			db
				.prepare(INSERT)
				.bind(
					ID,
					requestId,
					QUERY.filename,
					QUERY.version,
					QUERY.date,
					`agreements/attachments/${ID}.pdf`,
					SHA,
					2048,
					NOW.toISOString(),
					"owner@example.test",
				),
		]);

		return false;
	} catch (error) {
		if (error instanceof Error && raisedByJsonGuard(error)) return true;

		throw error;
	}
}

/** Today's answer after the guard raised: the request's kind read again. */
async function todaysRefusal(requestId: string) {
	const owned = await db
		.prepare("SELECT kind FROM owner_requests WHERE id=?")
		.bind(requestId)
		.first<{ kind: string }>();

	return owned?.kind === "software" ? "RequestClosed" : "RequestNotFound";
}

const REQUESTS: (StoredUploadRequest | null)[] = [
	null,
	...["purchase", "merchandise", "service", "software"].flatMap((kind) =>
		["new", "reviewed", "resolved", "withdrawn"].map((status) => ({
			kind,
			status,
		})),
	),
];

describe("the upload's batch guard (A24) and its rule", () => {
	it("agree on every request: the guard raises exactly when the rule refuses, and the answers match", async () => {
		let accepted = 0;

		for (const request of REQUESTS) {
			database.exec(
				"DELETE FROM software_agreement_attachments; DELETE FROM owner_requests",
			);

			if (request)
				database
					.prepare("INSERT INTO owner_requests VALUES (?,?,?)")
					.run("r1", request.kind, request.status);

			const facts = await db
				.prepare("SELECT kind,status FROM owner_requests WHERE id=?")
				.bind("r1")
				.first<StoredUploadRequest>();

			const decided = attach(facts);
			const raised = await todaysBatch("r1");
			const label = JSON.stringify(request);

			expect(raised, label).toBe("refused" in decided);

			if ("refused" in decided) {
				const today = await todaysRefusal("r1");

				expect(decided.refused, label).toBe(today);
				expect(run(refusedUpload.decide(null, facts)), label).toMatchObject({
					refused: today,
				});
				expect(
					database
						.prepare("SELECT count(*) AS n FROM software_agreement_attachments")
						.get()?.n,
				).toBe(0);
			} else {
				accepted += 1;
				expect(
					database
						.prepare("SELECT * FROM software_agreement_attachments")
						.all(),
				).toEqual([decided.kept]);
			}
		}

		expect(accepted).toBe(2);
	});
});
