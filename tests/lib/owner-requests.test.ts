import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { double } from "../helpers/doubles";
import { createRequest } from "../helpers/owner-request-store";
import { BriefTooLarge } from "~/server/intake-store";
import { sqliteD1 } from "../helpers/sqlite-d1";
import {
	changeOwnerRequest,
	getOwnerRequest,
	listOwnerRequests,
} from "~/lib/owner-requests";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function fixture(beforeSoftware = false) {
	const sql = new DatabaseSync(":memory:");

	if (beforeSoftware) {
		for (const name of readdirSync(
			new URL("../../migrations/music/", import.meta.url),
		)
			.filter((name) => name.endsWith(".sql") && name < "0019")
			.sort())
			sql.exec(
				readFileSync(
					new URL(`../../migrations/music/${name}`, import.meta.url),
					"utf8",
				),
			);
	} else
		sql.exec(
			readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
		);

	const db = sqliteD1(sql);

	return { db, sql };
}

const purchase = {
	kind: "purchase" as const,
	releaseId: "old-news-single",
	email: "fan@example.com",
	cityRegion: "Nashville, Tennessee",
	summary: "Interested in buying Old News",
	details: { format: "digital" },
};

describe("owner requests", () => {
	it("returns the stored request without reading it back", async () => {
		const { db } = fixture();
		const reads: string[] = [];

		const watched = double<D1Database>({
			prepare: (query: string) => {
				if (query.trimStart().toUpperCase().startsWith("SELECT")) {
					reads.push(query);
				}

				return db.prepare(query);
			},
			batch: (statements) => db.batch(statements),
		});

		const request = await createRequest(watched, {
			...purchase,
			details: { format: "digital", nested: { keep: [1, "two"] } },
			name: "  Fan  ",
			releaseId: undefined,
		});

		expect(reads).toEqual([]);
		expect(request).toEqual(await getOwnerRequest(db, request.id));
	});

	it("stores a request and its creation audit atomically", async () => {
		const { db, sql } = fixture();
		const request = await createRequest(db, purchase);
		expect(request).toMatchObject({
			kind: "purchase",
			status: "new",
			email: "fan@example.com",
		});
		expect(await getOwnerRequest(db, request.id)).toEqual(request);
		expect(
			sql
				.prepare(
					"SELECT action,actor FROM owner_request_audit WHERE request_id=?",
				)
				.get(request.id),
		).toEqual({ action: "created", actor: "system" });
	});

	it.each(["software", "service"] as const)(
		"stores a %s request email lowercased, matching the studio sign-in and access revocation",
		async (kind) => {
			const { db, sql } = fixture();

			const request = await createRequest(db, {
				...purchase,
				kind,
				email: "  Grace@Example.COM ",
			});

			expect(request.email).toBe("grace@example.com");
			expect(
				sql
					.prepare("SELECT email FROM owner_requests WHERE id=?")
					.get(request.id),
			).toEqual({ email: "grace@example.com" });
		},
	);

	it("rejects oversized request details with the typed error", async () => {
		const { db } = fixture();
		await expect(
			createRequest(db, {
				...purchase,
				details: { note: "x".repeat(32_000) },
			}),
		).rejects.toBeInstanceOf(BriefTooLarge);
	});

	it("applies only defined status transitions and records the owner actor", async () => {
		const { db, sql } = fixture();
		const request = await createRequest(db, purchase);
		expect(
			(
				await changeOwnerRequest(db, {
					id: request.id,
					action: "review",
					actor: "owner@example.com",
				})
			).status,
		).toBe("reviewed");
		expect(
			(
				await changeOwnerRequest(db, {
					id: request.id,
					action: "resolve",
					actor: "owner@example.com",
				})
			).status,
		).toBe("resolved");
		await expect(
			changeOwnerRequest(db, {
				id: request.id,
				action: "review",
				actor: "owner@example.com",
			}),
		).rejects.toThrow("Invalid request transition");
		expect(
			(
				await changeOwnerRequest(db, {
					id: request.id,
					action: "reopen",
					actor: "owner@example.com",
				})
			).status,
		).toBe("new");
		expect(
			sql
				.prepare(
					"SELECT action FROM owner_request_audit WHERE request_id=? ORDER BY id",
				)
				.all(request.id),
		).toEqual([
			{ action: "created" },
			{ action: "reviewed" },
			{ action: "resolved" },
			{ action: "reopened" },
		]);
	});

	it("updates bounded private notes without changing status and filters the inbox", async () => {
		const { db } = fixture();
		const purchaseRequest = await createRequest(db, purchase);
		await createRequest(db, {
			...purchase,
			kind: "service",
			serviceId: "mastering",
			email: "artist@example.com",
			summary: "Mastering review",
		});

		const updated = await changeOwnerRequest(db, {
			id: purchaseRequest.id,
			action: "note",
			actor: "owner@example.com",
			note: "Reply after listening.",
		});

		expect(updated).toMatchObject({
			status: "new",
			privateNote: "Reply after listening.",
		});
		expect(
			await listOwnerRequests(db, { kind: "purchase", status: "new" }),
		).toHaveLength(1);
		await expect(
			changeOwnerRequest(db, {
				id: purchaseRequest.id,
				action: "note",
				actor: "owner@example.com",
				note: "x".repeat(1001),
			}),
		).rejects.toThrow("Private note");
	});
});

it("saves a service request before software migration 0019", async () => {
	const { db, sql } = fixture(true);

	const request = await createRequest(db, {
		kind: "service",
		serviceId: "mixing",
		email: "CLIENT@EXAMPLE.COM",
		summary: "Audio inquiry",
	});

	expect(request.email).toBe("client@example.com");
	expect(sql.prepare("SELECT COUNT(*) AS n FROM owner_requests").get()).toEqual(
		{ n: 1 },
	);
});
