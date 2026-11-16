// The offer board's route (docs/plans/2026-11-offer-board.md, section 5), against the real schema on node:sqlite with
// the model answered by a mock. Every figure is made up for the test.
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import * as Predicate from "effect/Predicate";
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
import { withheldFrom } from "~/server/offer-board-model";
import { readPricingReference } from "~/lib/pricing-reference";
import { pastOffers } from "~/server/offer-board-store";
import { PRICING_KEY } from "~/server/pricing-store";
import { fakeKv, partial } from "../helpers/doubles";
import { readJson, type JsonObject } from "../helpers/json";
import type { JsonValue } from "~/lib/json-value";
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
		dayValueCents: 61300,
		contingencyPercent: 37,
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
					lowUsd: 91357,
					highUsd: 94211,
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
			/Sam Example|sam@example\.com|Clay Studio Co|example\.org\/old/,
		);

		// The owner's day value (in cents and dollars), contingency and another kind's research appear nowhere, in any
		// form, and the request holds only what the plan lists.
		const data: JsonValue = JSON.parse(inputs.messages[1].content);
		const numbers: number[] = [];
		const texts: string[] = [];

		const walk = (value: JsonValue) => {
			if (Predicate.isNumber(value)) numbers.push(value);
			else if (Predicate.isString(value)) texts.push(value);
			else if (Array.isArray(value)) value.forEach(walk);
			else if (value) Object.values(value).forEach(walk);
		};

		walk(data);
		expect(Object.keys(data ?? {}).sort()).toEqual([
			"brief",
			"cards",
			"draft",
			"lanes",
			"marketRanges",
			"ownersFitReview",
			"project",
		]);
		expect(
			numbers.filter((n) => [61300, 613, 37, 0.37, 91357, 94211].includes(n)),
		).toEqual([]);
		expect(texts.join(" ")).not.toMatch(
			/61300|\b613\b|91357|94211|91,357|94,211|\b37 ?%/,
		);
		// The record the route read holds this day value, so the checks above could fail.
		expect(
			readPricingReference(JSON.parse(pricing ?? "null")).dayValueCents,
		).toBe(61300);
	});

	it.each([
		[
			"an internationalised domain, as typed",
			"https://bücher.de/",
			"Our shop bücher.de sells books",
		],
		[
			"a page on a shared host, written without its scheme",
			"https://www.facebook.com/AcmeBakery",
			"We post at facebook.com/AcmeBakery daily",
		],
		[
			"the site with www and a trailing slash",
			"http://example.net/shop",
			"See www.example.net/shop/ for the shop",
		],
		[
			"the client's own email domain, with no site entered",
			"",
			"Rebuild example.com with class sign-ups",
		],
	])("hides %s from the model", async (_, currentUrl, purpose) => {
		db.exec("DELETE FROM owner_requests");
		seed("r1", "new", { currentUrl, purpose });
		await POST(context());
		const [, inputs] = run.mock.calls[0];
		const sent: string = inputs.messages[1].content;

		expect(sent).toContain("the client’s current site");
		expect(sent).not.toMatch(
			/bücher|xn--bcher|AcmeBakery|example\.net|example\.com/i,
		);
	});

	it("replaces the client's details wherever they appear in what the model reads, the owner's draft and cards included", async () => {
		await POST(
			context({
				...body,
				cards: [
					{
						ref: "c1",
						lane: "outcome",
						text: "A studio site for CLAY STUDIO CO",
						state: "open",
					},
				],
				draft: {
					outcome:
						"A five-page site for Clay Studio Co, replacing www.example.org",
					summary: "Sam Example asked by email (sam@example.com).",
					milestones: [],
					clientInputs: "Logins for https://example.org/old",
					exclusions: "",
					timing: "",
				},
			}),
		);
		const [, inputs] = run.mock.calls[0];
		const sent: string = inputs.messages[1].content;

		expect(sent).not.toMatch(
			/sam example|sam@example\.com|clay studio co|example\.org/i,
		);
		expect(sent).toContain(
			"A five-page site for the client, replacing the client’s current site",
		);
		expect(sent).toContain("the client asked by email (the client).");
		expect(sent).toContain("A studio site for the client");
		expect(sent).toContain("Logins for the client’s current site");
	});

	it("rewrites only free text: a client whose details read like fixed values leaves card states and range sizes alone", async () => {
		db.exec("DELETE FROM owner_requests");
		seed("r1", "new", { company: "Small", currentUrl: "open" });
		await POST(context());
		const [, inputs] = run.mock.calls[0];

		expect(JSON.parse(inputs.messages[1].content)).toMatchObject({
			cards: [{ ref: "c1", lane: "outcome", state: "open" }],
			marketRanges: [{ size: "small" }],
		});
	});

	it("keeps the first shown refs of a long keep list rather than none", async () => {
		const many = Array.from({ length: 45 }, (_, index) => ({
			ref: `c${index + 1}`,
			lane: "inputs",
			text: `Input ${index + 1}`,
			state: "open",
		}));

		run.mockResolvedValueOnce({
			response: { ...reply, cards: [], keep: many.map((card) => card.ref) },
		});

		const answer: JsonValue = await readJson(
			await POST(context({ ...body, cards: many })),
		);

		expect(answer).toMatchObject({
			ok: true,
			refs: many.map((card) => card.ref),
		});
	});

	it("keeps a milestone whose deliverables count things, and drops only a line that names money", async () => {
		run.mockResolvedValueOnce({
			response: {
				...reply,
				cards: [
					{
						lane: "milestones",
						text: "Catalog import",
						reason: "The shop's products",
						deliverables: [
							"Import up to 2,000 products",
							"A catalog of a few hundred items, sorted",
							"Hosting at $20 a month",
						],
						acceptance: ["Find any product by name"],
						daysLow: 3,
						daysHigh: 5,
					},
				],
			},
		});

		expect(await readJson(await POST(context()))).toMatchObject({
			cards: [
				{
					text: "Catalog import",
					detail: {
						deliverables: [
							"Import up to 2,000 products",
							"A catalog of a few hundred items, sorted",
						],
					},
				},
			],
		});
	});

	it("keeps the shown cards the reply lists in keep without repeating them, and no other ref", async () => {
		run.mockResolvedValueOnce({
			response: {
				...reply,
				cards: reply.cards.slice(1),
				keep: ["c1", "c9", "nope", 7],
			},
		});

		expect(await readJson(await POST(context()))).toMatchObject({
			ok: true,
			refs: ["c1"],
		});
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

	it("refuses a request that is not a software brief with 404, through the rule", async () => {
		db.prepare(
			"UPDATE owner_requests SET kind = 'service' WHERE id = 'r1'",
		).run();
		const response = await POST(context());

		expect(response.status).toBe(404);
		// The rule's own sentence, which the board shows as it does every other refusal.
		expect(await response.json()).toEqual({
			ok: false,
			error: "There is no software request with this id.",
		});
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

	it("reads again when another tab takes the day's last place between its read and its save, then refuses", async () => {
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('2026-11-15', 'offer:owner', 39)",
		).run();

		const d1 = sqliteD1(db);
		const batch = d1.batch.bind(d1);
		let raced = false;

		const racing = Object.assign(Object.create(d1), {
			prepare: d1.prepare.bind(d1),
			batch: async (statements: Parameters<D1Database["batch"]>[0]) => {
				if (!raced) {
					raced = true;
					db.prepare(
						"UPDATE brief_suggestion_budget SET count = count + 1 WHERE scope = 'offer:owner'",
					).run();
				}

				return batch(statements);
			},
		});

		const response = await POST(context(body, { env: { MUSIC_DB: racing } }));

		expect(response.status).toBe(429);
		expect(run).not.toHaveBeenCalled();
		expect(count()).toBe(40);
	});

	it("answers 409 when the day's last place is taken between read and save three times over", async () => {
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('2026-11-15', 'offer:owner', 39)",
		).run();

		const d1 = sqliteD1(db);
		const batch = d1.batch.bind(d1);

		// Each try reads 39; just before its save another tab takes place 40, then gives it back.
		const racing = Object.assign(Object.create(d1), {
			prepare: d1.prepare.bind(d1),
			batch: async (statements: Parameters<D1Database["batch"]>[0]) => {
				db.prepare(
					"UPDATE brief_suggestion_budget SET count = 40 WHERE scope = 'offer:owner'",
				).run();

				try {
					return await batch(statements);
				} finally {
					db.prepare(
						"UPDATE brief_suggestion_budget SET count = 39 WHERE scope = 'offer:owner'",
					).run();
				}
			},
		});

		const response = await POST(context(body, { env: { MUSIC_DB: racing } }));

		expect(response.status).toBe(409);
		expect(run).not.toHaveBeenCalled();
		expect(count()).toBe(39);
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

describe("withheldFrom", () => {
	const withheld = [
		{ text: "Sam Example", as: "the client" },
		{ text: "sam@example.com", as: "the client" },
		{ text: "A+B (Studio)", as: "the client" },
	];

	it("replaces whole words in any case, the longest first, in every string however deep", () => {
		expect(
			withheldFrom(
				{
					a: "Write to SAM@EXAMPLE.COM or Sam Example.",
					b: ["Hello sam example", { c: "From a+b (studio) today" }],
					n: 3,
				},
				withheld,
			),
		).toEqual({
			a: "Write to the client or the client.",
			b: ["Hello the client", { c: "From the client today" }],
			n: 3,
		});
	});

	it("leaves a word that only contains a detail", () => {
		expect(withheldFrom("Sam Examples and xsam@example.com", withheld)).toBe(
			"Sam Examples and xsam@example.com",
		);
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

	it("skips a request whose details are not readable, rather than failing for every page", async () => {
		seed("r2");
		offer("o1", "r2", 1, "sent", 123456, "2026-01-01T00:00:00.000Z");
		db.prepare(
			`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
       VALUES ('bad', 'software', 'X', 'x@example.com', 'X', 'not json', 'new', ?, ?)`,
		).run(NOW.toISOString(), NOW.toISOString());
		offer("o2", "bad", 1, "sent", 999900, "2026-11-10T00:00:00.000Z");

		const past = await pastOffers(sqliteD1(db), "website", "r1");

		expect(past.map((each) => each.requestId)).toEqual(["r2"]);
	});

	it("filters by kind before its limit, so many newer offers of another kind never hide this kind's", async () => {
		seed("r2");
		offer("o1", "r2", 1, "sent", 123456, "2026-01-01T00:00:00.000Z");

		for (let i = 0; i < 105; i++) {
			seed(`w${i}`, "new", { path: "webapp" });
			offer(
				`ow${i}`,
				`w${i}`,
				1,
				"sent",
				900000,
				`2026-11-${String((i % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
			);
		}

		const past = await pastOffers(sqliteD1(db), "website", "r1");

		expect(past.map((each) => [each.requestId, each.totalCents])).toEqual([
			["r2", 123456],
		]);
	});
});
