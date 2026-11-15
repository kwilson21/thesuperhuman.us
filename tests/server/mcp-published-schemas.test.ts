import * as Predicate from "effect/Predicate";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../src/lib/json-value";
import { publicationMcp } from "../../src/lib/publication/mcp";
import { ALL as probeRoute } from "../../src/pages/api/mcp-probe";

// The JSON Schema a tool publishes and the reader that checks its arguments are written apart, so this walks each
// published schema and holds the reader to it, through the real servers: every required key, `additionalProperties`, the
// type of each value, length limits, enums, constants, patterns and number limits. A value on each limit is accepted and
// a value one past it is refused, so the reader enforces each published constraint and nothing stricter. It uses no Zod
// and no frozen copy, so it stays when those are deleted.

type Schema = { readonly [key: string]: JsonValue };

type Path = readonly string[];

const isMembers = (value: JsonValue | undefined) =>
	Predicate.isObject(value) && !Array.isArray(value);

const HEADERS = {
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
};

const asSchema = (value: JsonValue | undefined): Schema => {
	if (!isMembers(value)) throw new Error("expected a schema object");

	return value;
};

const post = (message: JsonValue) =>
	new Request("https://example.test/mcp", {
		method: "POST",
		headers: HEADERS,
		body: JSON.stringify(message),
	});

const tools = {
	progress: async () => ({ value: { status: "ok" }, isError: false }),
	publish: async () => ({ value: { status: "ok" }, isError: false }),
};

const identity = { ownerId: "owner", scopes: ["publication:alpha"] };

type Server = {
	readonly name: string;
	readonly send: (message: JsonValue) => Promise<Response>;
};

const servers: Server[] = [
	{
		name: "publication",
		send: (message) => publicationMcp(post(message), identity, tools),
	},
	{
		name: "probe",
		// SAFETY: the probe route reads nothing of its context but the request.
		send: async (message) =>
			probeRoute({ request: post(message) } as Parameters<
				typeof probeRoute
			>[0]),
	},
];

async function published(server: Server) {
	const response = await server.send({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/list",
	});

	const body: { result: { tools: { name: string; inputSchema: Schema }[] } } =
		JSON.parse(await response.text());

	return body.result.tools;
}

/** A value that satisfies a published schema, with the smallest text the limits allow. */
function valid(schema: Schema): JsonValue {
	const branches = schema.anyOf;

	if (Array.isArray(branches)) return valid(asSchema(branches[0]));

	if ("const" in schema) return schema.const;

	if (schema.type === "object") {
		const properties = asSchema(schema.properties);

		return Object.fromEntries(
			Object.entries(properties).map(([key, property]) => [
				key,
				valid(asSchema(property)),
			]),
		);
	}

	if (schema.type === "integer") return Number(schema.minimum ?? 0);

	if (Array.isArray(schema.enum)) return schema.enum[0];

	if (Predicate.isString(schema.pattern)) {
		const examples = new Map([
			["^[a-z0-9][a-z0-9_-]{0,79}$", "a"],
			["^\\d{4}-\\d{2}-\\d{2}$", "2026-11-15"],
		]);

		const example = examples.get(schema.pattern);

		if (example === undefined)
			throw new Error(`no example for the pattern ${schema.pattern}`);

		return example;
	}

	return "x".repeat(Math.max(1, Number(schema.minLength ?? 1)));
}

/** The arguments with the value at `path` replaced (or taken away, with `undefined`). */
function put(
	root: JsonValue,
	path: Path,
	value: JsonValue | undefined,
): JsonValue {
	if (path.length === 0) {
		if (value === undefined) throw new Error("the root cannot be removed");

		return value;
	}

	if (!isMembers(root)) throw new Error("the path leaves the arguments");

	const [key, ...below] = path;

	const entries = Object.entries(root).filter(
		([name]) => name !== key || below.length > 0 || value !== undefined,
	);

	return Object.fromEntries(
		entries.map(([name, member]) => [
			name,
			name === key ? put(member, below, value) : member,
		]),
	);
}

const adding = (root: JsonValue, path: Path, name: string): JsonValue => {
	const here = path.reduce<JsonValue>((value, key) => {
		if (!isMembers(value)) throw new Error("the path leaves the arguments");

		return value[key];
	}, root);

	if (!isMembers(here)) throw new Error("not an object");

	return put(root, path, { ...here, [name]: true });
};

describe("what each tool publishes is what its reader enforces", () => {
	for (const server of servers)
		it(`${server.name}: every constraint in the published schema, and no other`, async () => {
			const listed = await published(server);

			expect(listed.length).toBeGreaterThan(0);

			for (const tool of listed) {
				const accepts = async (args: JsonValue) => {
					const response = await server.send({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: { name: tool.name, arguments: args },
					});

					const body: { result: { isError?: boolean } } = JSON.parse(
						await response.text(),
					);

					return body.result.isError !== true;
				};

				const base = valid(tool.inputSchema);
				let checked = 0;

				const expectAccepted = async (
					path: Path,
					value: JsonValue,
					why: string,
				) => {
					checked++;
					expect(
						await accepts(put(base, path, value)),
						`${tool.name} ${path.join(".")}: ${why}`,
					).toBe(true);
				};

				const expectRefused = async (args: JsonValue, why: string) => {
					checked++;
					expect(await accepts(args), `${tool.name}: ${why}`).toBe(false);
				};

				const walk = async (
					schema: Schema,
					path: Path,
					nullable = false,
				): Promise<void> => {
					const branches = schema.anyOf;

					if (Array.isArray(branches)) {
						// A schema that may also be null: null is accepted, and the other branch is walked.
						expect(branches.map((branch) => asSchema(branch).type)).toContain(
							"null",
						);
						await expectAccepted(path, null, "null is allowed");
						await walk(asSchema(branches[0]), path, true);

						return;
					}

					if (!nullable && path.length > 0)
						await expectRefused(
							put(base, path, null),
							`null at ${path.join(".")} is refused`,
						);

					if (schema.type === "object") {
						const properties = asSchema(schema.properties);

						const required = Array.isArray(schema.required)
							? schema.required
							: [];

						expect(required.slice().sort()).toEqual(
							Object.keys(properties).sort(),
						);
						expect(schema.additionalProperties).toBe(false);

						await expectRefused(
							adding(base, path, "unpublished"),
							`an unpublished key at ${path.join(".")}`,
						);

						for (const key of required)
							await expectRefused(
								put(base, [...path, String(key)], undefined),
								`${key} missing at ${path.join(".")}`,
							);

						if (path.length > 0)
							await expectRefused(put(base, path, 5), "an object is needed");

						for (const [key, property] of Object.entries(properties))
							await walk(asSchema(property), [...path, key]);

						return;
					}

					if (schema.type === "string") {
						await expectRefused(
							put(base, path, 5),
							`a number at ${path.join(".")}`,
						);

						if (Array.isArray(schema.enum)) {
							for (const value of schema.enum)
								await expectAccepted(path, value, `${value} is published`);

							await expectRefused(
								put(base, path, "not-published"),
								`a text that is not published at ${path.join(".")}`,
							);

							return;
						}

						if (Predicate.isString(schema.pattern)) {
							await expectAccepted(
								path,
								valid(schema),
								"an example of the pattern",
							);
							await expectRefused(
								put(base, path, "!"),
								"a text outside the pattern",
							);
							await expectRefused(
								put(base, path, ""),
								"an empty text outside the pattern",
							);

							return;
						}

						const least = Number(schema.minLength ?? 0);
						const most = Number(schema.maxLength);

						await expectAccepted(path, "x".repeat(least), "the shortest text");
						await expectAccepted(path, "x".repeat(most), "the longest text");
						await expectAccepted(
							path,
							"🚀".repeat(most),
							"the longest text of emoji",
						);
						await expectRefused(
							put(base, path, "x".repeat(most + 1)),
							`${most + 1} characters at ${path.join(".")}`,
						);
						await expectRefused(
							put(base, path, "🚀".repeat(most + 1)),
							`${most + 1} emoji at ${path.join(".")}`,
						);

						if (least > 0)
							await expectRefused(
								put(base, path, "x".repeat(least - 1)),
								`${least - 1} characters at ${path.join(".")}`,
							);

						return;
					}

					if (schema.type === "integer") {
						const least = Number(schema.minimum);
						const most = Number(schema.maximum);

						await expectRefused(put(base, path, "1"), "a text for a number");
						await expectAccepted(path, least, "the least number");
						await expectAccepted(path, most, "the most number");
						await expectRefused(put(base, path, least - 1), "below the least");
						await expectRefused(put(base, path, most + 1), "above the most");
						await expectRefused(
							put(base, path, 0.5),
							"a number that is not whole",
						);

						return;
					}

					if ("const" in schema) {
						await expectAccepted(path, schema.const, "the constant");
						await expectRefused(
							put(base, path, Number(schema.const) + 1),
							"another number",
						);
						await expectRefused(put(base, path, "1"), "a text for a number");

						return;
					}

					throw new Error(`the walk does not know ${JSON.stringify(schema)}`);
				};

				await expectAccepted([], base, "the smallest valid arguments");
				await walk(tool.inputSchema, []);

				expect(checked).toBeGreaterThan(5);
			}
		});
});
