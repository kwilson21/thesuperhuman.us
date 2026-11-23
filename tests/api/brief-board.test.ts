// POST /api/software/brief/board over real SQL (node:sqlite through the D1 helper, batches in one transaction), with the
// Workers AI binding and the two Cloudflare rate limits replaced by doubles.
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from "vitest";
import {
	createSuggestionPass,
	suggestionVisitorHash,
} from "~/lib/brief-suggestion-pass";
import { POST } from "~/pages/api/software/brief/board";
import {
	BOARD_INSTRUCTIONS,
	BOARD_MODEL,
	BOARD_REPLY_SCHEMA,
	askWorkersAi,
} from "~/server/brief-board-model";
import {
	BOARD_SITE_LIMIT,
	BOARD_VISITOR_LIMIT,
} from "~/server/rules/brief-board";
import { double, partial } from "../helpers/doubles";
import { readJson, type JsonObject } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import {
	DatabaseSync,
	type SqliteDatabase,
	sqliteD1,
} from "../helpers/sqlite-d1";

const SECRET = "board-test-secret";
const IP = "203.0.113.9";
const NOW = new Date("2026-11-15T15:00:00.000Z");
const DAY = "2026-11-15";

const ANSWERS =
	"A home for my band. Fans should hear new music, see upcoming shows near them and join the mailing list.";

const cards = [
	{ ref: "c1", lane: "parts", text: "Shows", state: "open" },
	{ ref: "c2", lane: "parts", text: "Contact", state: "avoid" },
];

const body: JsonObject = {
	path: "website",
	answers: { purpose: ANSWERS },
	cards,
};

let db: SqliteDatabase;
let d1: D1Database;
let run: Mock;

/** A Cloudflare rate limit binding: its limit() is a mock the tests inspect and replace. */
type Limiter = { limit: Mock };

let visitorLimit: Limiter;
let siteLimit: Limiter;
let cookie: string;
let hash: string;

const reply = {
	cards: [
		{
			ref: "c1",
			lane: "parts",
			text: "Shows",
			basis: "said",
			quote: "upcoming shows near them",
		},
		{ lane: "parts", text: "Music", basis: "said", quote: "hear new music" },
		{
			lane: "questions",
			text: "Who adds new show dates?",
			basis: "suggested",
			reason: "Dates change",
		},
	],
};

function context(
	sent: JsonObject = body,
	env: Partial<TestRuntime["env"]> = {},
	headers: Record<string, string> = {},
	url = "https://thesuperhuman.us/api/software/brief/board",
	/** Text sent as the body in place of `sent`, for a body that is not JSON. */
	text?: string,
): APIContext {
	return partial<APIContext>({
		request: new Request(url, {
			method: "POST",
			headers: {
				origin: new URL(url).origin,
				"content-type": "application/json",
				"cf-connecting-ip": IP,
				cookie,
				...headers,
			},
			body: text ?? JSON.stringify(sent),
		}),
		locals: partial<APIContext["locals"]>({
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					// SAFETY: run is the vi.fn standing in for Workers AI; Ai["run"] is overloaded and generic, so a Mock cannot be typed as it, and the route calls it with a model and inputs and reads only `response`.
					AI: double<Ai>({ run: run as Ai["run"] }),
					MUSIC_DB: d1,
					BRIEF_SUGGEST_RATE_LIMIT: double<RateLimit>(visitorLimit),
					BRIEF_SUGGEST_SITE_LIMIT: double<RateLimit>(siteLimit),
					TURNSTILE_SECRET_KEY: SECRET,
					SOFTWARE_BOARD_ENABLED: "true",
					...env,
				}),
			}),
		}),
	});
}

const counts = () =>
	Object.fromEntries(
		db
			.prepare(
				"SELECT day, scope, count FROM brief_suggestion_budget ORDER BY day, scope",
			)
			.all()
			.map((row) => [
				`${row.day} ${String(row.scope).replace(hash, "<visitor>")}`,
				row.count,
			]),
	);

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	db = new DatabaseSync(":memory:");
	db.exec(
		readFileSync("migrations/music/0025_brief_suggestion_budget.sql", "utf8"),
	);
	d1 = sqliteD1(db);
	run = vi.fn(async () => ({ response: reply }));
	visitorLimit = { limit: vi.fn(async () => ({ success: true })) };
	siteLimit = { limit: vi.fn(async () => ({ success: true })) };
	cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(SECRET, IP, NOW.getTime())}`;
	hash = await suggestionVisitorHash(SECRET, IP, NOW.getTime());
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("when interpretation is off", () => {
	it.each([
		["the switch is absent", { SOFTWARE_BOARD_ENABLED: undefined }],
		["the switch is false", { SOFTWARE_BOARD_ENABLED: "false" }],
		["there is no AI binding", { AI: undefined }],
		["there is no per-visitor limit", { BRIEF_SUGGEST_RATE_LIMIT: undefined }],
		["there is no site limit", { BRIEF_SUGGEST_SITE_LIMIT: undefined }],
		["there is no Turnstile secret", { TURNSTILE_SECRET_KEY: undefined }],
		["there is no database", { MUSIC_DB: undefined }],
	])("answers 503 off when %s, and asks nothing", async (_, env) => {
		const response = await POST(context(body, env));

		expect(response.status).toBe(503);
		expect(await readJson(response)).toEqual({ ok: false, reason: "off" });
		expect(run).not.toHaveBeenCalled();
		expect(visitorLimit.limit).not.toHaveBeenCalled();
		expect(counts()).toEqual({});
	});

	it("answers off with no address, and on a local preview", async () => {
		expect(
			(await POST(context(body, {}, { "cf-connecting-ip": "" }))).status,
		).toBe(503);

		for (const host of ["localhost:4321", "127.0.0.1:4321", "[::1]:4321"])
			expect(
				await readJson(
					await POST(
						context(body, {}, {}, `http://${host}/api/software/brief/board`),
					),
				),
			).toEqual({
				ok: false,
				reason: "off",
			});

		expect(run).not.toHaveBeenCalled();
	});
});

describe("a request the page never sends", () => {
	it.each([
		["no path", { ...body, path: undefined }],
		["an unknown path", { ...body, path: "idea" }],
		[
			"an answer over 2,000 characters",
			{ ...body, answers: { purpose: "word ".repeat(401) } },
		],
		["fewer than six words", { ...body, answers: { purpose: "A band site" } }],
		["only another path's answer", { ...body, answers: { today: ANSWERS } }],
		["a repeated ref", { ...body, cards: [cards[0], cards[0]] }],
		["a ref of another form", { ...body, cards: [{ ...cards[0], ref: "x1" }] }],
		["an unknown state", { ...body, cards: [{ ...cards[0], state: "maybe" }] }],
		[
			"a purpose card, which the outline no longer has",
			{ ...body, cards: [{ ...cards[0], lane: "purpose" }] },
		],
		[
			"31 cards",
			{
				...body,
				cards: Array.from({ length: 31 }, (_, i) => ({
					ref: `c${i}`,
					lane: "parts",
					text: "P",
					state: "open",
				})),
			},
		],
		[
			"over 7,000 characters in all",
			{
				...body,
				cards: Array.from({ length: 30 }, (_, i) => ({
					ref: `c${i}`,
					lane: "questions",
					text: "Q".repeat(240),
					state: "open",
				})),
			},
		],
	])("answers 400 for %s", async (_, sent) => {
		const response = await POST(context(sent));

		expect(response.status).toBe(400);
		expect(run).not.toHaveBeenCalled();
		expect(counts()).toEqual({});
	});

	it("reads 7,000 characters in a script of three bytes a character, over 16 KB as JSON", async () => {
		run.mockResolvedValueOnce({ response: { cards: [] } });
		const hindi = (length: number) => "किताबें बेचने ".repeat(300).slice(0, length);

		const long: JsonObject = {
			path: "webapp",
			answers: { appGoal: hindi(1990), firstVersion: hindi(1990) },
			cards: Array.from({ length: 10 }, (_, i) => ({
				ref: `c${i + 1}`,
				lane: "questions",
				text: hindi(250),
				state: "yours",
			})),
		};

		expect(
			new TextEncoder().encode(JSON.stringify(long)).length,
		).toBeGreaterThan(16384);
		expect((await POST(context(long))).status).toBe(200);
	});

	it("refuses another origin and text that is not JSON as the other public routes do", async () => {
		expect(
			(await POST(context(body, {}, { origin: "https://elsewhere.example" })))
				.status,
		).toBe(403);
		expect((await POST(context(body, {}, {}, undefined, "{"))).status).toBe(
			400,
		);
	});
});

describe("the pass", () => {
	it("answers 403 pass without a valid pass, before any limit, count or model", async () => {
		for (const value of [
			"",
			"__Secure-brief-suggestion-pass=forged",
			`__Secure-brief-suggestion-pass=${await createSuggestionPass("other", IP, NOW.getTime())}`,
		]) {
			cookie = value;
			const response = await POST(context());

			expect(response.status).toBe(403);
			expect(await readJson(response)).toEqual({ ok: false, reason: "pass" });
		}

		expect(visitorLimit.limit).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(counts()).toEqual({});
	});
});

describe("the limits", () => {
	it("counts under the board's own keys, apart from the autocomplete's", async () => {
		await POST(context());

		expect(visitorLimit.limit).toHaveBeenCalledWith({ key: `board:${hash}` });
		expect(siteLimit.limit).toHaveBeenCalledWith({ key: "board:site" });
		expect(counts()).toEqual({
			[`${DAY} board:<visitor>`]: 1,
			[`${DAY} board:site`]: 1,
		});
	});

	it("answers 429 busy when a rate limit refuses, 503 busy when it fails, with nothing reserved", async () => {
		visitorLimit.limit.mockResolvedValueOnce({ success: false });
		let response = await POST(context());

		expect(response.status).toBe(429);
		expect(await readJson(response)).toEqual({ ok: false, reason: "busy" });
		siteLimit.limit.mockResolvedValueOnce({ success: false });
		expect((await POST(context())).status).toBe(429);
		siteLimit.limit.mockRejectedValueOnce(new Error("limiter down"));
		response = await POST(context());
		expect(response.status).toBe(503);
		expect(await readJson(response)).toEqual({ ok: false, reason: "busy" });
		expect(run).not.toHaveBeenCalled();
		expect(counts()).toEqual({});
	});

	it("answers 429 limit at the visitor's or the site's daily limit, without asking the model", async () => {
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
		).run(DAY, `board:${hash}`, BOARD_VISITOR_LIMIT);
		let response = await POST(context());

		expect(response.status).toBe(429);
		expect(await readJson(response)).toEqual({
			ok: false,
			reason: "limit",
			error:
				"The outline reached today’s limit. You can still add your own notes.",
		});

		db.exec("DELETE FROM brief_suggestion_budget");
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
		).run(DAY, "board:site", BOARD_SITE_LIMIT);
		response = await POST(context());

		expect(response.status).toBe(429);
		expect(run).not.toHaveBeenCalled();
	});

	it("reads again when another request takes the last place between its read and its save, then refuses", async () => {
		db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
		).run(DAY, `board:${hash}`, BOARD_VISITOR_LIMIT - 1);
		const batch = d1.batch.bind(d1);
		let raced = false;

		d1 = Object.assign(Object.create(d1), {
			prepare: d1.prepare.bind(d1),
			batch: async (statements: D1PreparedStatement[]) => {
				if (!raced) {
					raced = true;
					db.prepare(
						"UPDATE brief_suggestion_budget SET count = count + 1 WHERE scope = ?",
					).run(`board:${hash}`);
				}

				return batch(statements);
			},
		});

		const response = await POST(context());

		expect(response.status).toBe(429);
		expect(counts()).toEqual({
			[`${DAY} board:<visitor>`]: BOARD_VISITOR_LIMIT,
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("clears days before yesterday on the day's first reservation only", async () => {
		const insert = db.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
		);

		insert.run("2026-11-13", "board:site", 9);
		insert.run("2026-11-13", "site", 9);
		insert.run("2026-11-14", "board:site", 9);
		await POST(context());

		expect(counts()).toEqual({
			"2026-11-14 board:site": 9,
			[`${DAY} board:<visitor>`]: 1,
			[`${DAY} board:site`]: 1,
		});

		insert.run("2026-11-12", "site", 1);
		await POST(context());
		expect(counts()["2026-11-12 site"]).toBe(1);
	});

	it("answers 500 with its fixed sentence when the store fails, and never asks the model", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		d1 = double<D1Database>({
			prepare: () => {
				throw new Error("D1_ERROR: no such table: brief_suggestion_budget");
			},
		});

		const response = await POST(context());

		expect(response.status).toBe(500);
		expect(await readJson(response)).toEqual({
			ok: false,
			error: "Suggestions could not be made just now.",
		});
		expect(run).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});
});

describe("the model", () => {
	it("is asked once, with JSON Mode, the instructions and only the path's answers and the board", async () => {
		await POST(
			context({
				...body,
				answers: { purpose: ANSWERS, existing: "Secret notes", name: "Alex" },
			}),
		);

		expect(run).toHaveBeenCalledTimes(1);
		const [model, inputs] = run.mock.calls[0];

		expect(model).toBe(BOARD_MODEL);
		expect(inputs).toMatchObject({
			response_format: {
				type: "json_schema",
				json_schema: { name: "board_reply", schema: BOARD_REPLY_SCHEMA },
			},
			temperature: 0.2,
			max_tokens: 700,
			// Thinking would spend the 700 tokens and no JSON would come back.
			chat_template_kwargs: { enable_thinking: false },
		});
		expect(inputs.messages[0]).toEqual({
			role: "system",
			content: BOARD_INSTRUCTIONS,
		});
		expect(JSON.parse(inputs.messages[1].content)).toEqual({
			project: "a website",
			lanes: {
				audience: "Who it’s for",
				parts: "Pages",
				questions: "Open questions",
			},
			answers: ANSWERS,
			cards,
		});
		expect(inputs.messages[1].content).not.toMatch(/Secret notes|Alex/);
	});

	it("never asks for a purpose card: the visitor's written answer is the statement of purpose", () => {
		expect(BOARD_INSTRUCTIONS).not.toMatch(/purpose/i);
		expect(
			BOARD_REPLY_SCHEMA.properties.cards.items.properties.lane.enum,
		).toEqual(["audience", "parts", "questions"]);
	});

	it("answers the cards, read as untrusted data", async () => {
		run.mockResolvedValueOnce({
			response: {
				cards: [
					...reply.cards,
					{
						ref: "c9",
						lane: "parts",
						text: "Shop",
						basis: "suggested",
						reason: "Bands sell merch",
					},
					{
						lane: "parts",
						text: "Tickets",
						basis: "said",
						quote: "buy tickets from us",
					},
					{
						lane: "parts",
						text: "Launch in 2 weeks",
						basis: "suggested",
						reason: "x",
					},
					{
						lane: "parts",
						text: "<img src=x onerror=alert(1)>",
						basis: "suggested",
						reason: "x",
					},
				],
			},
		});

		const response = await POST(context());

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await readJson(response)).toEqual({
			ok: true,
			cards: [
				{
					ref: "c1",
					lane: "parts",
					text: "Shows",
					basis: "said",
					quote: "upcoming shows near them",
					reason: "",
				},
				{
					ref: "",
					lane: "parts",
					text: "Music",
					basis: "said",
					quote: "hear new music",
					reason: "",
				},
				{
					ref: "",
					lane: "questions",
					text: "Who adds new show dates?",
					basis: "suggested",
					quote: "",
					reason: "Dates change",
				},
				{
					ref: "",
					lane: "parts",
					text: "Shop",
					basis: "suggested",
					quote: "",
					reason: "Bands sell merch",
				},
				// Text is only ever text: the page sets it with textContent.
				{
					ref: "",
					lane: "parts",
					text: "<img src=x onerror=alert(1)>",
					basis: "suggested",
					quote: "",
					reason: "x",
				},
			],
			// c1's own card was kept, so it names itself; c9 was never shown, so it names nothing.
			refs: [],
		});
	});

	it("reads a chat-completion reply, the form the current model answers in, the same as a response", async () => {
		run.mockResolvedValueOnce({ response: JSON.stringify(reply) });
		const fromResponse = await readJson(await POST(context()));

		run.mockResolvedValueOnce({
			object: "chat.completion",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: JSON.stringify(reply) },
					finish_reason: "stop",
				},
			],
		});

		expect(await readJson(await POST(context()))).toEqual(fromResponse);
	});

	it("reads a chat-completion reply without text as an unreadable reply", async () => {
		run.mockResolvedValueOnce({ object: "chat.completion", choices: [] });
		const noChoices = await POST(context());

		run.mockResolvedValueOnce({ response: "Sure! Here are some ideas" });
		const unreadable = await POST(context());

		expect(noChoices.status).toBe(unreadable.status);
		expect(await readJson(noChoices)).toEqual(await readJson(unreadable));
	});

	it("reads a reply sent as JSON text", async () => {
		run.mockResolvedValueOnce({ response: JSON.stringify(reply) });

		expect(await readJson(await POST(context()))).toEqual({
			ok: true,
			cards: [
				{
					ref: "c1",
					lane: "parts",
					text: "Shows",
					basis: "said",
					quote: "upcoming shows near them",
					reason: "",
				},
				{
					ref: "",
					lane: "parts",
					text: "Music",
					basis: "said",
					quote: "hear new music",
					reason: "",
				},
				{
					ref: "",
					lane: "questions",
					text: "Who adds new show dates?",
					basis: "suggested",
					quote: "",
					reason: "Dates change",
				},
			],
			refs: [],
		});
	});

	it("passes on a shown card the reply named in a card it left out, so the page does not withdraw it", async () => {
		run.mockResolvedValueOnce({
			response: {
				cards: [
					{
						ref: "c1",
						lane: "parts",
						text: "Shows in 2 weeks",
						basis: "suggested",
						reason: "x",
					},
				],
			},
		});

		expect(await readJson(await POST(context()))).toEqual({
			ok: true,
			cards: [],
			refs: ["c1"],
		});
	});

	it.each([
		[
			"throws (JSON Mode couldn't be met)",
			() => run.mockRejectedValueOnce(new Error("JSON Mode couldn't be met")),
		],
		[
			"answers text that is not JSON",
			() =>
				run.mockResolvedValueOnce({ response: "Sure! Here are some ideas" }),
		],
		[
			"answers no cards list",
			() => run.mockResolvedValueOnce({ response: { ideas: [] } }),
		],
		["answers nothing", () => run.mockResolvedValueOnce(null)],
	])(
		"answers 503 busy when the model %s, with the reservation kept",
		async (_, arrange) => {
			arrange();
			const response = await POST(context());

			expect(await readJson(response)).toEqual({ ok: false, reason: "busy" });
			expect(response.status).toBe(503);
			expect(counts()[`${DAY} board:site`]).toBe(1);
		},
	);

	it("answers 503 busy when the model has not answered after thirty seconds, with the reservation kept", async () => {
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		vi.setSystemTime(NOW);
		run.mockReturnValueOnce(new Promise(() => {}));

		const pending = POST(context());

		// The pass and the reservation are checked first; the thirty seconds start when the model is asked.
		await vi.waitFor(() => expect(run).toHaveBeenCalled());
		await vi.advanceTimersByTimeAsync(30_001);
		const response = await pending;

		expect(await readJson(response)).toEqual({ ok: false, reason: "busy" });
		expect(response.status).toBe(503);
		expect(counts()[`${DAY} board:site`]).toBe(1);
	});

	it("waits thirty seconds for the model, then gives up", async () => {
		vi.useRealTimers();
		vi.useFakeTimers();

		// SAFETY: a run that never settles stands in for Workers AI; Ai["run"] is overloaded and generic, and askWorkersAi only awaits it.
		const never = double<Ai>({
			run: (() => new Promise(() => {})) as Ai["run"],
		});

		const exit = Effect.runPromiseExit(
			askWorkersAi(never, {
				path: "website",
				answers: { purpose: ANSWERS },
				cards: [],
			}),
		);

		let settled = false;

		void exit.then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(29_999);

		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(2);
		const result = await exit;

		expect(Exit.isFailure(result) && JSON.stringify(result.cause)).toContain(
			"BoardModelTimedOut",
		);
	});
});
