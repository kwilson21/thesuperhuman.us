import { describe, expect, it } from "vitest";
import {
	boundQuery,
	boundStatement,
	fakeBatch,
	fakeD1First,
	fakeFirst,
	preparedStatement,
} from "./d1";
import { double } from "./doubles";

describe("preparedStatement", () => {
	it("records its SQL and bound arguments, and bind() records new ones", () => {
		const statement = preparedStatement("SELECT ?");

		expect(boundStatement(statement)).toEqual({ query: "SELECT ?", args: [] });
		expect(boundStatement(statement.bind(7))).toEqual({
			query: "SELECT ?",
			args: [7],
		});
		expect(boundQuery(statement)).toBe("SELECT ?");
	});

	it("builds every bound statement from the same members", async () => {
		const statement = preparedStatement("SELECT ?", [], (query, args) => ({
			first: fakeFirst(() => ({ query, args })),
		}));

		expect(await statement.bind(1).first()).toEqual({
			query: "SELECT ?",
			args: [1],
		});
	});

	it("rejects a statement it did not prepare with boundStatement and answers undefined to boundQuery", () => {
		const other = double<D1PreparedStatement>({});

		expect(() => boundStatement(other)).toThrow(
			"Expected a statement prepared by this fake.",
		);
		expect(boundQuery(other)).toBeUndefined();
	});
});

describe("fakeFirst, fakeBatch and fakeD1First", () => {
	it("fakeFirst resolves to what read returns, including a promise", async () => {
		expect(await fakeFirst(() => ({ a: 1 }))()).toEqual({ a: 1 });
		expect(await fakeFirst(async () => null)()).toBeNull();
	});

	it("fakeBatch runs its function over the statements and resolves to its results", async () => {
		const statements = [preparedStatement("A"), preparedStatement("B")];

		const batch = fakeBatch((items) =>
			items.map((item) => double<D1Result>({ results: [boundQuery(item)] })),
		);

		expect((await batch(statements)).map((result) => result.results)).toEqual([
			["A"],
			["B"],
		]);
	});

	it("fakeD1First answers every prepare().bind().first() with the row", async () => {
		expect(await fakeD1First({ id: 1 }).prepare("x").bind(1).first()).toEqual({
			id: 1,
		});
		expect(await fakeD1First(null).prepare("x").bind().first()).toBeNull();
	});
});
