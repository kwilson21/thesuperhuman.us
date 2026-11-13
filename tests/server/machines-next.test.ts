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
