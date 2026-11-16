// The owner's pricing route (docs/plans/2026-11-offer-board.md, section 4). Every figure is made up for the test.
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "~/pages/api/owner/pricing";
import { readFileSync } from "node:fs";
import {
	DatabaseSync,
	type SqliteDatabase,
	sqliteD1,
} from "../helpers/sqlite-d1";
import { partial } from "../helpers/doubles";
import { readJson } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import type { JsonObject } from "../helpers/json";

let db: SqliteDatabase;
let failing: boolean;

function post(
	body: JsonObject,
	{ owner = true, bound = true }: { owner?: boolean; bound?: boolean } = {},
) {
	if (failing) db.exec("DROP TABLE IF EXISTS owner_pricing");

	return POST(
		partial<APIContext>({
			request: new Request("https://thesuperhuman.us/api/owner/pricing", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://thesuperhuman.us",
				},
				body: JSON.stringify(body),
			}),
			locals: {
				owner: owner ? { email: "owner@example.com" } : undefined,
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>(
						bound ? { MUSIC_DB: sqliteD1(db) } : {},
					),
				}),
			},
		}),
	);
}

const stored = () => {
	const row = db
		.prepare("SELECT reference_json FROM owner_pricing WHERE id=1")
		.get();

	return JSON.parse(String(row?.reference_json ?? "null"));
};

const research = {
	researchedOn: "2026-11-15",
	ranges: [
		{
			kind: "website",
			size: "small",
			definition: "A few pages",
			lowUsd: 1000,
			highUsd: 2000,
			sourceIds: [1],
		},
	],
	sources: [{ id: 1, title: "A source", url: "https://example.org/a" }],
};

beforeEach(() => {
	db = new DatabaseSync(":memory:");
	db.exec(readFileSync("migrations/music/0028_owner_pricing.sql", "utf8"));
	failing = false;
});

afterEach(() => db.close());

describe("the owner's pricing route", () => {
	it("refuses anyone but the owner", async () => {
		const response = await post(
			{
				action: "values",
				dayValue: 100,
				contingencyPercent: 10,
				expectedVersion: 0,
			},
			{ owner: false },
		);

		expect(response.status).toBe(403);
		expect(stored()).toBeNull();
	});

	it("saves the day value and contingency, then the research, each as the next version", async () => {
		const first = await post({
			action: "values",
			dayValue: 100,
			contingencyPercent: 10,
			expectedVersion: 0,
		});

		expect(first.status).toBe(200);
		expect(await readJson(first)).toEqual({ ok: true, version: 1 });
		expect(stored()).toMatchObject({
			version: 1,
			dayValueCents: 10000,
			contingencyPercent: 10,
			market: null,
		});

		const second = await post({
			action: "market",
			market: research,
			expectedVersion: 1,
		});

		expect(await readJson(second)).toEqual({ ok: true, version: 2 });
		expect(stored()).toMatchObject({
			version: 2,
			dayValueCents: 10000,
			market: { researchedOn: "2026-11-15" },
		});

		// Clearing keeps the values.
		await post({ action: "market", market: null, expectedVersion: 2 });
		expect(stored()).toMatchObject({
			version: 3,
			dayValueCents: 10000,
			market: null,
		});
	});

	it("refuses a save from a page that read an older version, and stores nothing", async () => {
		await post({
			action: "values",
			dayValue: 100,
			contingencyPercent: 10,
			expectedVersion: 0,
		});

		const response = await post({
			action: "values",
			dayValue: 200,
			contingencyPercent: 10,
			expectedVersion: 0,
		});

		expect(response.status).toBe(409);
		expect(await readJson(response)).toEqual({
			ok: false,
			error:
				"Your pricing was saved from another page since this one loaded. Reload to see it, then save again.",
		});
		expect(stored().dayValueCents).toBe(10000);
	});

	it.each([
		[
			"a day value with cents",
			{
				action: "values",
				dayValue: 99.5,
				contingencyPercent: 10,
				expectedVersion: 0,
			},
		],
		[
			"a contingency over 100%",
			{
				action: "values",
				dayValue: 100,
				contingencyPercent: 120,
				expectedVersion: 0,
			},
		],
		["an unknown action", { action: "rates", expectedVersion: 0 }],
		[
			"research that is not readable",
			{
				action: "market",
				market: { researchedOn: "soon" },
				expectedVersion: 0,
			},
		],
	])("answers 400 for %s, saying why", async (_, body) => {
		const response = await post(body);

		expect(response.status).toBe(400);
		expect(await readJson(response)).toEqual({
			ok: false,
			error: expect.any(String),
		});
		expect(stored()).toBeNull();
	});

	it("answers 503 without the store, and 500 with its fixed sentence when the store fails", async () => {
		const body = {
			action: "values",
			dayValue: 100,
			contingencyPercent: 10,
			expectedVersion: 0,
		};

		expect((await post(body, { bound: false })).status).toBe(503);
		failing = true;
		const response = await post(body);

		expect(response.status).toBe(500);
		expect(await readJson(response)).toEqual({
			ok: false,
			error: "Your pricing could not be saved. Try again.",
		});
	});
	it("allows only one of two simultaneous first saves", async () => {
		const results = await Promise.all(
			[100, 200].map((dayValue) =>
				post({
					action: "values",
					dayValue,
					contingencyPercent: 10,
					expectedVersion: 0,
				}),
			),
		);

		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		expect(stored().version).toBe(1);
		expect([10000, 20000]).toContain(stored().dayValueCents);
	});

	it("rejects a write that loses a race after reading the same existing version", async () => {
		await post({
			action: "values",
			dayValue: 100,
			contingencyPercent: 10,
			expectedVersion: 0,
		});

		const results = await Promise.all([
			post({
				action: "values",
				dayValue: 200,
				contingencyPercent: 20,
				expectedVersion: 1,
			}),
			post({ action: "market", market: research, expectedVersion: 1 }),
		]);

		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		const reference = stored();
		expect(reference.version).toBe(2);

		if (results[0].status === 200) {
			expect(reference.dayValueCents).toBe(20000);
			expect(reference.market).toBeNull();
		} else {
			expect(reference.dayValueCents).toBe(10000);
			expect(reference.market.researchedOn).toBe("2026-11-15");
		}
	});

	it("fails closed on corrupt stored pricing without overwriting it", async () => {
		db.prepare("INSERT INTO owner_pricing VALUES (1, 4, ?)").run("{}");

		const response = await post({
			action: "values",
			dayValue: 100,
			contingencyPercent: 10,
			expectedVersion: 0,
		});

		expect(response.status).toBe(500);
		expect(db.prepare("SELECT version FROM owner_pricing").get()?.version).toBe(
			4,
		);
	});
});
