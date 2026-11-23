// The market refresh's owner actions (src/pages/api/owner/pricing-refresh.ts, docs/plans/2026-11-market-refresh.md):
// asking for a search, using a proposal through the versioned save, and discarding one, over a memory KV. Every figure
// is made up.
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it } from "vitest";
import type { MarketReference } from "~/lib/pricing-reference";
import { POST } from "~/pages/api/owner/pricing-refresh";
import { ASK_KEY, PROPOSAL_PREFIX } from "~/server/market-refresh-store";
import { PRICING_KEY } from "~/server/pricing-store";
import { proposeMarket } from "~/server/rules/market-refresh";
import { fakeKv, partial } from "../helpers/doubles";
import { type JsonObject, readJson } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";

const ID = "001763882580000";
const NEWER = "001763882590000";

const research: MarketReference = {
	researchedOn: "2026-08-01",
	ranges: [
		{
			kind: "website",
			size: "small",
			definition: "A made-up small site.",
			lowUsd: 1_000,
			highUsd: 2_000,
			sourceIds: [],
		},
	],
	dayRate: null,
	caveats: [],
	sources: [],
};

const proposal = proposeMarket(
	ID,
	"2026-11-23T07:23:00.000Z",
	research,
	new Map([
		[
			"website small",
			{
				lowUsd: 1_200,
				highUsd: 2_400,
				cited: [
					{
						title: "A made-up page",
						url: "https://example.com/a",
						content: "$1,200 to $2,400",
						published: "",
					},
				],
			},
		],
	]),
);

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
		delete: async (key: string) => {
			if (failing) throw new Error("KV is down");
			store.delete(key);
		},
	});

function post(
	body: JsonObject,
	{ owner = true, bound = true }: { owner?: boolean; bound?: boolean } = {},
) {
	return POST(
		partial<APIContext>({
			request: new Request(
				"https://thesuperhuman.us/api/owner/pricing-refresh",
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "https://thesuperhuman.us",
					},
					body: JSON.stringify(body),
				},
			),
			locals: {
				owner: owner ? { email: "owner@example.com" } : undefined,
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>(bound ? { RESUME_STORE: kv() } : {}),
				}),
			},
		}),
	);
}

beforeEach(() => {
	failing = false;
	store = new Map([
		[
			PRICING_KEY,
			JSON.stringify({
				version: 4,
				dayValueCents: 90_000,
				contingencyPercent: 20,
				market: research,
				updatedAt: "2026-08-01T00:00:00.000Z",
			}),
		],
		[`${PROPOSAL_PREFIX}${ID}`, JSON.stringify(proposal)],
	]);
});

describe("the market refresh's owner actions", () => {
	it("refuses anyone but the owner, and a request the page never sends", async () => {
		expect((await post({ action: "ask" }, { owner: false })).status).toBe(403);
		expect((await post({ action: "nothing" })).status).toBe(400);
		expect((await post({ action: "discard", proposalId: "../x" })).status).toBe(
			400,
		);
	});

	it("stores the time of an ask", async () => {
		const response = await post({ action: "ask" });

		expect(response.status).toBe(200);
		expect(Number.isNaN(Date.parse(store.get(ASK_KEY) ?? ""))).toBe(false);
	});

	it("discards only the proposal the page showed (newerKept)", async () => {
		store.set(`${PROPOSAL_PREFIX}${NEWER}`, "{}");

		expect((await post({ action: "discard", proposalId: ID })).status).toBe(
			200,
		);
		expect(store.has(`${PROPOSAL_PREFIX}${ID}`)).toBe(false);
		expect(store.has(`${PROPOSAL_PREFIX}${NEWER}`)).toBe(true);
	});

	it("uses the proposal as the research through the versioned save, keeps the day value, and removes the proposal", async () => {
		const response = await post({
			action: "use",
			proposalId: ID,
			expectedVersion: 4,
		});

		expect(response.status).toBe(200);
		expect(await readJson(response)).toEqual({ ok: true, version: 5 });

		const saved = JSON.parse(store.get(PRICING_KEY) ?? "{}");

		expect(saved).toMatchObject({
			version: 5,
			dayValueCents: 90_000,
			contingencyPercent: 20,
		});
		expect(saved.market.ranges[0]).toMatchObject({
			lowUsd: 1_200,
			highUsd: 2_400,
		});
		expect(store.has(`${PROPOSAL_PREFIX}${ID}`)).toBe(false);
	});

	it("keeps research the owner saved after the search, and changes only the figures the search found (the review of PR #378)", async () => {
		store.set(
			PRICING_KEY,
			JSON.stringify({
				version: 5,
				dayValueCents: 90_000,
				contingencyPercent: 20,
				market: {
					...research,
					researchedOn: "2026-11-20",
					ranges: [
						research.ranges[0],
						{
							kind: "workflow",
							size: "small",
							definition: "A made-up automation.",
							lowUsd: 700,
							highUsd: 1_100,
							sourceIds: [],
						},
					],
					dayRate: { lowUsd: 700, highUsd: 1_100 },
				},
				updatedAt: "2026-11-20T00:00:00.000Z",
			}),
		);

		const response = await post({
			action: "use",
			proposalId: ID,
			expectedVersion: 5,
		});

		expect(response.status).toBe(200);

		const saved = JSON.parse(store.get(PRICING_KEY) ?? "{}");

		expect(saved.market.ranges).toEqual([
			expect.objectContaining({
				kind: "website",
				size: "small",
				lowUsd: 1_200,
				highUsd: 2_400,
			}),
			expect.objectContaining({
				kind: "workflow",
				size: "small",
				lowUsd: 700,
				highUsd: 1_100,
			}),
		]);
		expect(saved.market.dayRate).toEqual({ lowUsd: 700, highUsd: 1_100 });
	});

	it("refuses a use from a page whose version is old, and changes nothing", async () => {
		const response = await post({
			action: "use",
			proposalId: ID,
			expectedVersion: 3,
		});

		expect(response.status).toBe(409);
		expect(JSON.parse(store.get(PRICING_KEY) ?? "{}").version).toBe(4);
		expect(store.has(`${PROPOSAL_PREFIX}${ID}`)).toBe(true);
	});

	it("refuses to use a proposal a newer search replaced (acceptedWasShown)", async () => {
		store.delete(`${PROPOSAL_PREFIX}${ID}`);
		store.set(
			`${PROPOSAL_PREFIX}${NEWER}`,
			JSON.stringify({ ...proposal, id: NEWER }),
		);

		const response = await post({
			action: "use",
			proposalId: ID,
			expectedVersion: 4,
		});

		expect(response.status).toBe(409);
		expect(JSON.parse(store.get(PRICING_KEY) ?? "{}").version).toBe(4);
	});

	it("answers 500 with its fixed sentence when the store fails, and 503 when it is not bound", async () => {
		failing = true;

		const failed = await post({ action: "ask" });

		expect(failed.status).toBe(500);
		expect(await readJson(failed)).toEqual({
			ok: false,
			error: "That did not go through. Try again.",
		});
		expect((await post({ action: "ask" }, { bound: false })).status).toBe(503);
	});
});
