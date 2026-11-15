import { describe, expect, it } from "vitest";
import { publicationMcp } from "../../src/lib/publication/mcp";
import type {
	PublicationTools,
	ToolAnswer,
} from "../../src/lib/publication/mcp";
import { ALL as probeRoute } from "../../src/pages/api/mcp-probe";
import {
	legacyProbe,
	legacyPublicationMcp,
} from "../fixtures/legacy-validators/mcp-tool-inputs";
import { seeded, texts } from "../helpers/differential";
import type { JsonValue } from "../helpers/json";

// The MCP tools stopped giving the SDK's high-level server Zod schemas. This holds the new servers (the lower-level
// server, JSON Schema written as data, Effect Schema readers) to the old ones, frozen in
// tests/fixtures/legacy-validators/mcp-tool-inputs.ts: the same request goes to both, and the whole answer must be the
// same, byte for byte (status, headers, body), whatever the arguments are. The arguments are seeded random mutations of
// a valid call: a field of every wrong type, missing, out of range, too long (in characters, not UTF-16 units), unicode,
// extra keys, and numbers that are not whole, beyond the safe range or not finite.

const HEADERS = {
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
};

const identity = { ownerId: "owner", scopes: ["publication:alpha", "other"] };

/** The tools both servers get: they record what they were called with and answer the same. */
function fakeTools() {
	const calls: string[] = [];
	const answer: ToolAnswer = { value: { status: "delivered" }, isError: false };

	const tools: PublicationTools = {
		progress: async (projectId) => {
			calls.push(`progress ${projectId}`);

			return answer;
		},
		publish: async (projectId, publication) => {
			calls.push(`publish ${projectId} ${JSON.stringify(publication)}`);

			return answer;
		},
	};

	return { tools, calls };
}

// A number JSON can hold but JavaScript prints as null once parsed, written into the body after it is stringified.
const INFINITY = "__INFINITY__";
const NEGATIVE_INFINITY = "__NEGATIVE_INFINITY__";

const bodyOf = (message: JsonValue) =>
	JSON.stringify(message)
		.replaceAll(`"${INFINITY}"`, "1e999")
		.replaceAll(`"${NEGATIVE_INFINITY}"`, "-1e999");

const post = (body: string) =>
	new Request("https://example.test/mcp", {
		method: "POST",
		headers: HEADERS,
		body,
	});

const call = (name: string, args?: JsonValue): JsonValue => ({
	jsonrpc: "2.0",
	id: 1,
	method: "tools/call",
	params: args === undefined ? { name } : { name, arguments: args },
});

async function heard(response: Response) {
	return {
		status: response.status,
		type: response.headers.get("content-type"),
		cache: response.headers.get("cache-control"),
		body: await response.text(),
	};
}

/** Sends one body to the old and the new publication server; both answers, and what each tool was called with. */
async function publicationBoth(body: string) {
	const before = fakeTools();
	const after = fakeTools();

	const old = await heard(
		await legacyPublicationMcp(post(body), identity, before.tools),
	);

	const now = await heard(
		await publicationMcp(post(body), identity, after.tools),
	);

	return { old, now, oldCalls: before.calls, nowCalls: after.calls };
}

async function probeBoth(body: string) {
	const old = await heard(await legacyProbe(post(body)));

	// SAFETY: the probe route reads nothing of its context but the request.
	const now = await heard(
		await probeRoute({ request: post(body) } as Parameters<
			typeof probeRoute
		>[0]),
	);

	return { old, now };
}

const validStory = {
	headline: "A headline",
	summary: "A summary",
	technicalDetail: "Detail",
	delivery: "tested",
	basis: "human-confirmed",
};

const validEnvelope = {
	version: 1,
	projectId: "threadline",
	eventId: "event-1",
	entryId: "entry-1",
	expectedRevision: 0,
	operation: "publish",
	origin: "work",
	occurredOn: "2026-11-15",
	threadId: null,
	milestoneId: "m-1",
	story: validStory,
};

const rest = (random: ReturnType<typeof seeded>): JsonValue[] => [
	null,
	0,
	1,
	-1,
	1.5,
	-0.5,
	2 ** 53,
	-(2 ** 53),
	2 ** 53 - 1,
	1e21,
	-1e300,
	INFINITY,
	NEGATIVE_INFINITY,
	true,
	false,
	[],
	["a"],
	[[]],
	{},
	{ a: 1 },
	{ length: 3 },
	{ length: 0 },
	{ length: 100 },
	{ length: 5000 },
	{ length: "abc" },
	{ length: "5" },
	{ length: null },
	{ length: true },
	{ length: [] },
	{ length: {} },
	Array.from({ length: 81 }, () => 0),
	Array.from({ length: 141 }, () => "a"),
	Array.from({ length: 4001 }, () => 1),
	{ ...validStory },
	"1",
	"publish",
	"Publish",
	"withdraw",
	random.pick(["work", "shutdown", "backfill", "nope"]),
	"2026-11-15",
	"2026-13-45",
	"2026-11-15\n",
	"x".repeat(80),
	"x".repeat(81),
	"a-b_c",
	"-a",
	"A",
];

/** A text for a field: the pool the other differential tests use, plus lengths around each limit, in characters. */
const textsFor = (random: ReturnType<typeof seeded>, limit: number) =>
	random.pick([
		...texts(limit),
		"🚀".repeat(limit),
		"🚀".repeat(limit + 1),
		`${"a".repeat(limit - 1)}🚀`,
		`${"a".repeat(limit)}🚀`,
		"\ud83d".repeat(limit),
		"\ud83d🚀".repeat(limit),
		"café 中文 🚀",
	]);

/** A value for one field of the envelope or the story: right, a text of any length, or anything else. */
function mutated(random: ReturnType<typeof seeded>, limit: number): JsonValue {
	return random.chance(0.45)
		? textsFor(random, limit)
		: random.pick(rest(random));
}

function mutateStory(random: ReturnType<typeof seeded>): JsonValue {
	const story = new Map<string, JsonValue>(Object.entries(validStory));

	const limits = new Map([
		["headline", 140],
		["summary", 1000],
		["technicalDetail", 4000],
		["delivery", 10],
		["basis", 10],
	]);

	for (let n = random.below(4); n > 0; n--) {
		const [key, limit] = random.pick([...limits]);
		const how = random.below(8);

		if (how === 0) story.delete(key);
		else if (how === 1)
			story.set(`extra${random.below(3)}`, random.pick(rest(random)));
		else story.set(key, mutated(random, limit));
	}

	return Object.fromEntries(story);
}

function mutateEnvelope(random: ReturnType<typeof seeded>): JsonValue {
	const envelope = new Map<string, JsonValue>(Object.entries(validEnvelope));

	const limits = new Map([
		["version", 1],
		["projectId", 80],
		["eventId", 80],
		["entryId", 80],
		["expectedRevision", 1],
		["operation", 10],
		["origin", 10],
		["occurredOn", 12],
		["threadId", 80],
		["milestoneId", 80],
		["story", 1],
	]);

	for (let n = random.below(5); n > 0; n--) {
		const [key, limit] = random.pick([...limits]);
		const how = random.below(10);

		if (how === 0) envelope.delete(key);
		else if (how === 1)
			envelope.set(`extra${random.below(3)}`, random.pick(rest(random)));
		else if (key === "story" && how < 6)
			envelope.set("story", mutateStory(random));
		else envelope.set(key, mutated(random, limit));
	}

	return Object.fromEntries(envelope);
}

describe("the publication tools against the server they replaced", {
	timeout: 60000,
}, () => {
	it("answer initialize, ping, the tool list and an unknown method alike", async () => {
		for (const message of [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-03-26",
					capabilities: {},
					clientInfo: { name: "chat", version: "1" },
				},
			},
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			{ jsonrpc: "2.0", id: 3, method: "ping" },
			{ jsonrpc: "2.0", id: 4, method: "resources/list", params: {} },
		]) {
			const { old, now } = await publicationBoth(bodyOf(message));

			expect(now).toEqual(old);
		}
	});

	it("answer every call to a tool that is not there, including names an object has of its own", async () => {
		for (const name of [
			"nope",
			"",
			"constructor",
			"toString",
			"__proto__",
			"hasOwnProperty",
			"valueOf",
			"publication_connection_probe",
		]) {
			const { old, now } = await publicationBoth(bodyOf(call(name, {})));

			expect(now).toEqual(old);
		}
	});

	it("answer a call with no arguments, null arguments and arguments that are not an object", async () => {
		for (const args of [undefined, null, [], "x", 5, {}, { projectId: "a" }]) {
			for (const name of ["get_project_progress", "publish_project_update"]) {
				const { old, now, oldCalls, nowCalls } = await publicationBoth(
					bodyOf(call(name, args)),
				);

				expect(now).toEqual(old);
				expect(nowCalls).toEqual(oldCalls);
			}
		}
	});

	it("answer a tool that rejects with the text of its failure, whatever it rejected with", async () => {
		for (const failure of [
			new Error("it broke"),
			new TypeError("wrong"),
			"just text",
			42,
			null,
			undefined,
			{ message: "not an error" },
			["a", "b"],
		]) {
			const failing: PublicationTools = {
				progress: () => Promise.reject(failure),
				publish: () => Promise.reject(failure),
			};

			const progress = bodyOf(
				call("get_project_progress", { projectId: "threadline" }),
			);

			const publish = bodyOf(
				call("publish_project_update", { publication: validEnvelope }),
			);

			for (const body of [progress, publish])
				expect(
					await heard(await publicationMcp(post(body), identity, failing)),
					String(failure),
				).toEqual(
					await heard(
						await legacyPublicationMcp(post(body), identity, failing),
					),
				);
		}
	});

	it("read the progress tool's arguments as the old tool did, and call the tool with the same project", async () => {
		const random = seeded(20261115);

		for (let round = 0; round < 600; round++) {
			const args = new Map<string, JsonValue>([["projectId", "threadline"]]);
			const how = random.below(6);

			if (how === 0) args.delete("projectId");
			else if (how === 1) args.set("extra", random.pick(rest(random)));
			else if (how === 2)
				args.set(`x${random.below(3)}`, random.pick(rest(random)));
			else args.set("projectId", mutated(random, 80));

			const body = bodyOf(
				call("get_project_progress", Object.fromEntries(args)),
			);

			const { old, now, oldCalls, nowCalls } = await publicationBoth(body);

			expect(now, body).toEqual(old);
			expect(nowCalls, body).toEqual(oldCalls);
		}
	});

	it("read the publish tool's arguments as the old tool did, and call the tool with the same publication", async () => {
		const random = seeded(20261116);
		let delivered = 0;
		let refused = 0;

		for (let round = 0; round < 4000; round++) {
			const args = new Map<string, JsonValue>([
				[
					"publication",
					random.chance(0.97)
						? mutateEnvelope(random)
						: random.pick(rest(random)),
				],
			]);

			if (random.chance(0.05)) args.set(`extra${random.below(2)}`, true);

			if (random.chance(0.02)) args.delete("publication");

			const body = bodyOf(
				call("publish_project_update", Object.fromEntries(args)),
			);

			const { old, now, oldCalls, nowCalls } = await publicationBoth(body);

			expect(now, body).toEqual(old);
			expect(nowCalls, body).toEqual(oldCalls);

			if (oldCalls.length > 0) delivered++;
			else refused++;
		}

		// The mutations must reach both outcomes, or the comparison proves little.
		expect(delivered).toBeGreaterThan(100);
		expect(refused).toBeGreaterThan(1000);
	});

	it("publish every valid envelope, with each limit exactly", async () => {
		for (const publication of [
			validEnvelope,
			{ ...validEnvelope, story: null, operation: "withdraw" },
			{ ...validEnvelope, expectedRevision: Number.MAX_SAFE_INTEGER },
			{ ...validEnvelope, expectedRevision: 2 ** 53 },
			{ ...validEnvelope, expectedRevision: -1 },
			{ ...validEnvelope, expectedRevision: 0.5 },
			{ ...validEnvelope, expectedRevision: INFINITY },
			{ ...validEnvelope, expectedRevision: NEGATIVE_INFINITY },
			{ ...validEnvelope, expectedRevision: -1e300 },
			{ ...validEnvelope, projectId: "a".repeat(80) },
			{ ...validEnvelope, projectId: "a".repeat(81) },
			{
				...validEnvelope,
				story: { ...validStory, headline: "🚀".repeat(140) },
			},
			{
				...validEnvelope,
				story: { ...validStory, headline: "🚀".repeat(141) },
			},
			{ ...validEnvelope, story: { ...validStory, technicalDetail: null } },
		]) {
			const body = bodyOf(call("publish_project_update", { publication }));
			const { old, now, oldCalls, nowCalls } = await publicationBoth(body);

			expect(now, body).toEqual(old);
			expect(nowCalls, body).toEqual(oldCalls);
		}
	});
});

describe("the connectivity probe against the server it replaced", {
	timeout: 60000,
}, () => {
	it("answers initialize, ping, the tool list and an unknown method alike", async () => {
		for (const message of [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-03-26",
					capabilities: {},
					clientInfo: { name: "chat", version: "1" },
				},
			},
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			{ jsonrpc: "2.0", id: 3, method: "ping" },
			{ jsonrpc: "2.0", id: 4, method: "prompts/list", params: {} },
		]) {
			const { old, now } = await probeBoth(bodyOf(message));

			expect(now).toEqual(old);
		}
	});

	it("reads the challenge as the old tool did", async () => {
		const random = seeded(20261117);

		for (let round = 0; round < 800; round++) {
			const args = new Map<string, JsonValue>([
				["challenge", mutated(random, 80)],
			]);

			const how = random.below(8);

			if (how === 0) args.delete("challenge");
			else if (how === 1) args.set("extra", random.pick(rest(random)));
			else if (how === 2) {
				args.set("extra", true);
				args.set("other", null);
			}

			const body = bodyOf(
				call("publication_connection_probe", Object.fromEntries(args)),
			);

			const { old, now } = await probeBoth(body);

			expect(now, body).toEqual(old);
		}
	});

	it("answers a call with odd arguments or an odd tool name as the old tool did", async () => {
		for (const name of [
			"publication_connection_probe",
			"nope",
			"constructor",
			"__proto__",
		])
			for (const args of [
				undefined,
				null,
				[],
				"x",
				5,
				{},
				{ challenge: "a" },
			]) {
				const { old, now } = await probeBoth(bodyOf(call(name, args)));

				expect(now).toEqual(old);
			}
	});
});
