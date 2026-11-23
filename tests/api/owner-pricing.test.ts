// The owner's pricing route (docs/plans/2026-11-offer-board.md, section 4). Every figure is made up for the test.
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "~/pages/api/owner/pricing";
import { PRICING_KEY } from "~/server/pricing-store";
import { fakeKv, partial } from "../helpers/doubles";
import { readJson } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import type { JsonObject } from "../helpers/json";

let store: Map<string, string>;
let failing: boolean;

const kv = () =>
	fakeKv({
		get: async (key: string) => {
			if (failing) throw new Error("KV is down");

			return store.get(key) ?? null;
		},
		put: async (key: string, value: string) => {
			if (failing) throw new Error("KV is down");
			store.set(key, value);
		},
	});

function post(
	body: JsonObject,
	{ owner = true, bound = true }: { owner?: boolean; bound?: boolean } = {},
) {
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
					env: partial<TestRuntime["env"]>(bound ? { RESUME_STORE: kv() } : {}),
				}),
			},
		}),
	);
}

const stored = () => JSON.parse(store.get(PRICING_KEY) ?? "null");

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
	store = new Map();
	failing = false;
});

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
		expect(store.size).toBe(0);
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
		expect(store.size).toBe(0);
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
});
