// The offer board's route (docs/plans/2026-11-offer-board.md, section 5), against the real schema on node:sqlite with
// the model answered by a mock. Every figure is made up for the test.
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/offer-board";
import { pastOffers } from "~/server/offer-board-store";
import { PRICING_KEY } from "~/server/pricing-store";
import { fakeKv, partial } from "../helpers/doubles";
import { readJson, type JsonObject } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import {
	DatabaseSync,
	type SqliteDatabase,
	sqliteD1,
} from "../helpers/sqlite-d1";

const NOW = new Date("2026-11-15T15:00:00.000Z");

let db: SqliteDatabase;
let run: Mock;
let pricing: string | null;

const details = {
	path: "website",
	purpose:
		"A home for my pottery studio. People should see classes and sign up online.",
	currentUrl: "https://example.org/old",
	existing: "Photos are ready; page text is not.",
	updates: "self",
	company: "Clay Studio Co",
	timing: "soon",
	timingDate: "",
	budgetNote: "A few thousand dollars.",
};

function seed(id = "r1", status = "new", extra: JsonObject = {}) {
	db.prepare(
		`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
     VALUES (?, 'software', 'Sam Example', 'sam@example.com', 'A site', ?, ?, ?, ?)`,
	).run(
		id,
		JSON.stringify({ ...details, ...extra }),
		status,
		NOW.toISOString(),
		NOW.toISOString(),
	);
}

const body: JsonObject = {
	cards: [{ ref: "c1", lane: "outcome", text: "A studio site", state: "open" }],
	draft: {
		outcome: "",
		summary: "",
		milestones: [],
		clientInputs: "",
		exclusions: "",
		timing: "",
	},
};

const reply = {
	cards: [
		{
			ref: "c1",
			lane: "outcome",
			text: "A five-page site for the studio",
			reason: "Pages named",
		},
		{
			lane: "milestones",
			text: "Design direction",
			reason: "Start small",
			deliverables: ["Page list", "Homepage design"],
			acceptance: ["Approve the homepage"],
			daysLow: 2,
			daysHigh: 3.5,
		},
		{ lane: "milestones", text: "Build", reason: "No detail" },
		{ lane: "inputs", text: "Page text for each page" },
		{ lane: "exclusions", text: "Hosting at $20 a month" },
		{
			lane: "drivers",
			text: "Content is not ready",
			reason: "See example.com",
		},
		{ lane: "timing", text: "About 4 weeks from the start date" },
	],
	size: "small",
	sizeReason: "A few pages",
	figureUsd: 3000,
	figureReason: "Within the range",
};

function context(
	sent: JsonObject = body,
	{
		owner = true,
		id = "r1",
		env = {},
	}: { owner?: boolean; id?: string; env?: Partial<TestRuntime["env"]> } = {},
): APIContext {
	return partial<APIContext>({
		params: { id },
		request: new Request(
			`https://thesuperhuman.us/api/owner/requests/${id}/offer-board`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://thesuperhuman.us",
				},
				body: JSON.stringify(sent),
			},
		),
		locals: {
			owner: owner ? { email: "owner@example.com" } : undefined,
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					MUSIC_DB: sqliteD1(db),
					RESUME_STORE: fakeKv({
						get: async (key: string) => (key === PRICING_KEY ? pricing : null),
					}),
					AI: partial<Ai>({ run }),
					...env,
				}),
			}),
		},
	});
}

const count = () =>
	db
		.prepare(
			"SELECT count FROM brief_suggestion_budget WHERE scope = 'offer:owner'",
		)
		.all()[0]?.count ?? 0;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	db = new DatabaseSync(":memory:");
	db.exec(readFileSync("db/music.sql", "utf8"));
	run = vi.fn(async () => ({ response: reply }));
	pricing = JSON.stringify({
		version: 1,
		dayValueCents: 50000,
		contingencyPercent: 10,
		market: {
			researchedOn: "2026-11-15",
			ranges: [
				{
					kind: "website",
					size: "small",
					definition: "A few pages",
					lowUsd: 1000,
					highUsd: 4000,
					sourceIds: [],
				},
				{
					kind: "webapp",
					size: "small",
					definition: "A tool",
					lowUsd: 9000,
					highUsd: 9500,
					sourceIds: [],
				},
			],
			sources: [],
		},
		updatedAt: NOW.toISOString(),
	});
	seed();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("the offer board's route", () => {
	it("refuses anyone but the owner, and asks nothing", async () => {
		expect((await POST(context(body, { owner: false }))).status).toBe(403);
		expect(run).not.toHaveBeenCalled();
	});

	it("answers the cards read as untrusted data, with the size and figure, and counts the suggestion", async () => {
		const response = await POST(context());

		expect(response.status).toBe(200);
		expect(await readJson(response)).toEqual({
			ok: true,
			cards: [
				{
					ref: "c1",
					lane: "outcome",
					text: "A five-page site for the studio",
					reason: "Pages named",
					detail: null,
				},
				{
					ref: "",
					lane: "milestones",
					text: "Design direction",
					reason: "Start small",
					detail: {
						deliverables: ["Page list", "Homepage design"],
						acceptance: ["Approve the homepage"],
						daysLow: 2,
						daysHigh: 3.5,
					},
				},
				{
					ref: "",
					lane: "inputs",
					text: "Page text for each page",
					reason: "",
					detail: null,
				},
				{
					ref: "",
					lane: "timing",
					text: "About 4 weeks from the start date",
					reason: "",
					detail: null,
				},
			],
			refs: [],
			size: "small",
			sizeReason: "A few pages",
			figureUsd: 3000,
			figureReason: "Within the range",
		});
		expect(count()).toBe(1);
	});

	it("shows the model the brief and this kind's research, never the client's name, email, company or site, nor the owner's numbers", async () => {
		await POST(context());
		const [, inputs] = run.mock.calls[0];
		const sent = JSON.stringify(inputs.messages);

		expect(sent).toContain("A home for my pottery studio");
		expect(sent).toContain("A few thousand dollars.");
		expect(sent).toContain("A few pages");
		expect(sent).not.toMatch(
			/Sam Example|sam@example\.com|Clay Studio Co|example\.org\/old|50000|9500/,
		);
	});

	it.each([
		["a resolved request", "resolved"],
		["a withdrawn request", "withdrawn"],
	])("refuses %s with 409, and asks nothing", async (_, status) => {
		db.exec("DELETE FROM owner_requests");
		seed("r1", status);
		const response = await POST(context());

		expect(response.status).toBe(409);
		expect(run).not.toHaveBeenCalled();
		expect(count()).toBe(0);
	});

	it("refuses the retired idea path with 409, and an unknown request with 404", async () => {
		db.exec("DELETE FROM owner_requests");
		seed("r1", "new", { path: "idea" });
		expect((await POST(context())).status).toBe(409);
		expect((await POST(context(body, { id: "nope" }))).status).toBe(404);
		expect(run).not.toHaveBeenCalled();
	});

	it("stops at today's limit with 429", async () => {
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('2026-11-15', 'offer:owner', 40)",
		).run();
		const response = await POST(context());

		expect(response.status).toBe(429);
		expect(run).not.toHaveBeenCalled();
	});

	it("answers 503 with its sentence when the model fails or answers nothing readable", async () => {
		run.mockRejectedValueOnce(new Error("JSON Mode couldn't be met"));
		expect((await POST(context())).status).toBe(503);
		run.mockResolvedValueOnce({ response: "not json" });
		expect((await POST(context())).status).toBe(503);
	});

	it("still suggests without saved research", async () => {
		pricing = null;
		const response = await POST(context());

		expect(response.status).toBe(200);
		expect(
			JSON.parse(run.mock.calls[0][1].messages[1].content).marketRanges,
		).toEqual([]);
	});

	it("answers 400 for a request the page never sends", async () => {
		expect((await POST(context({ cards: "no", draft: {} }))).status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});
});

describe("the owner's past offers, for the pricing panel", () => {
	function offer(
		id: string,
		requestId: string,
		version: number,
		status: string,
		feeCents: number,
		sentAt: string,
	) {
		db.prepare(
			`INSERT INTO software_offers (id,request_id,version,status,terms_json,created_at,updated_at,sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			requestId,
			version,
			status,
			JSON.stringify({
				outcome: `Offer ${id}`,
				milestones: [{ feeCents }],
			}),
			sentAt,
			sentAt,
			sentAt,
		);
	}

	it("counts each client's offer once, as last sent, for briefs of the same kind only", async () => {
		seed("r2");
		seed("r3");
		seed("r4", "new", { path: "webapp" });
		offer("o1", "r2", 1, "superseded", 100000, "2026-11-01T00:00:00.000Z");
		offer("o2", "r2", 2, "sent", 200000, "2026-11-02T00:00:00.000Z");
		offer("o3", "r3", 1, "sent", 300000, "2026-11-03T00:00:00.000Z");
		offer("o4", "r4", 1, "sent", 900000, "2026-11-04T00:00:00.000Z");
		offer("o5", "r1", 1, "sent", 500000, "2026-11-05T00:00:00.000Z");

		const past = await pastOffers(sqliteD1(db), "website", "r1");

		expect(past.map((each) => [each.requestId, each.totalCents])).toEqual([
			["r3", 300000],
			["r2", 200000],
		]);
	});
});
