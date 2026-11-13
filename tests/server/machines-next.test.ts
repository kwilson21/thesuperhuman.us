import { setup } from "xstate";
import { describe, expect, it } from "vitest";
import { next, sourcesOf } from "../../src/server/machines/next";

const request = setup({}).createMachine({
	id: "request",
	initial: "new",
	context: { allowed: false },
	states: {
		new: {
			on: { REVIEW: { target: "reviewed" }, RESOLVE: { target: "resolved" } },
		},
		reviewed: {
			on: {
				RESOLVE: { target: "resolved" },
				REOPEN: { target: "new" },
				GATED: ({ context }) =>
					context.allowed ? { target: "resolved" } : undefined,
			},
		},
		resolved: { on: { REOPEN: { target: "new" } } },
		withdrawn: { type: "final" },
	},
});

describe("next", () => {
	it("gives the state an allowed event moves to", () => {
		expect(next(request, "new", "REVIEW")).toBe("reviewed");
		expect(next(request, "resolved", "REOPEN")).toBe("new");
	});

	it("gives null for an event the state does not handle, an unknown event and a final state", () => {
		expect(next(request, "new", "REOPEN")).toBeNull();
		expect(next(request, "new", "NOPE")).toBeNull();
		expect(next(request, "withdrawn", "REOPEN")).toBeNull();
	});

	it("reads a guard from the machine's default context, or from the row's own", () => {
		expect(next(request, "reviewed", "GATED")).toBeNull();
		expect(next(request, "reviewed", "GATED", { allowed: true })).toBe(
			"resolved",
		);
	});

	it("throws for a state the machine does not have", () => {
		expect(() => next(request, "lost", "REVIEW")).toThrow(
			'Unknown state "lost" for machine "request"',
		);
	});
});

describe("sourcesOf", () => {
	it("lists the states an event is allowed from, in the machine's order", () => {
		expect(sourcesOf(request, "RESOLVE")).toEqual(["new", "reviewed"]);
		expect(sourcesOf(request, "REOPEN")).toEqual(["reviewed", "resolved"]);
	});

	it("is empty for an event no state handles", () => {
		expect(sourcesOf(request, "NOPE")).toEqual([]);
	});

	it("leaves out a state whose guard says no, and takes the row's own context", () => {
		expect(sourcesOf(request, "GATED")).toEqual([]);
		expect(sourcesOf(request, "GATED", { allowed: true })).toEqual([
			"reviewed",
		]);
	});

	it("never lists a final state", () => {
		expect(sourcesOf(request, "REVIEW")).not.toContain("withdrawn");
	});
});

describe("next and compound states", () => {
	const nested = setup({}).createMachine({
		id: "nested",
		initial: "idle",
		states: {
			idle: { on: { START: { target: "running" } } },
			running: { initial: "warm", states: { warm: {}, hot: {} } },
		},
	});

	it("throws a clear error when the event lands on a compound state", () => {
		expect(() => next(nested, "idle", "START")).toThrow(
			/compound state.*"nested".*running/i,
		);
	});
});

describe("a row's own context", () => {
	const gated = setup({}).createMachine({
		id: "gated",
		initial: "a",
		context: { allowed: true, other: 1 },
		states: {
			a: {
				on: {
					GO: ({ context }) => (context.allowed ? { target: "b" } : undefined),
				},
			},
			b: {},
		},
	});

	it("replaces the default context entirely, it is not merged into it", () => {
		expect(next(gated, "a", "GO")).toBe("b");
		// The default says allowed; the row's own context has no `allowed`, so the guard reads undefined.
		expect(next(gated, "a", "GO", { other: 2 })).toBeNull();
	});
});

describe("sourcesOf and state names", () => {
	it("keeps the declared order when a state name looks like an integer, by refusing such names", () => {
		const numbered = setup({}).createMachine({
			id: "numbered",
			initial: "first",
			states: {
				first: { on: { GO: { target: "10" } } },
				"10": { on: { GO: { target: "first" } } },
			},
		});

		expect(() => sourcesOf(numbered, "GO")).toThrow(
			/state name "10".*integer.*"numbered"/i,
		);
	});

	it("never lists a wildcard state name as a source", () => {
		const wild = setup({}).createMachine({
			id: "wild",
			initial: "a",
			states: {
				a: { on: { GO: { target: "b" } } },
				b: { on: { GO: { target: "a" } } },
				"*": { on: { GO: { target: "a" } } },
			},
		});

		expect(sourcesOf(wild, "GO")).toEqual(["a", "b"]);
	});
});
