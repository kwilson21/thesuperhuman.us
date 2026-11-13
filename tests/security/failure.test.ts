import { afterEach, expect, it, vi } from "vitest";
import { ReaderMessage } from "~/lib/reader-message";
import { classifyFailure, logUnexpected } from "~/server/failure";

// What a route does with what it caught: only a sentence the code wrote for the reader may be shown.

afterEach(() => {
	vi.restoreAllMocks();
});

it("shows a sentence the code wrote for the reader, word for word", () => {
	expect(
		classifyFailure(new ReaderMessage("This installment is already paid.")),
	).toEqual({ kind: "sentence", say: "This installment is already paid." });
});

it.each([
	["a failed guard", new Error("D1_ERROR: malformed JSON: SQLITE_ERROR")],
	[
		"a unique index",
		new Error("UNIQUE constraint failed: software_invoices.id"),
	],
	[
		"a failed guard under a wrapper",
		new Error("batch failed", { cause: new Error("malformed JSON") }),
	],
])("treats %s as a conflict with another request", (_name, error) => {
	expect(classifyFailure(error)).toEqual({ kind: "stale" });
});

it.each([
	["a database fault", new Error("FOREIGN KEY constraint failed")],
	["a JavaScript fault", new TypeError("Cannot read properties of undefined")],
	[
		"a parser fault",
		new SyntaxError("Unexpected token } in JSON at position 3"),
	],
	["a bare string", "malformed"],
	["nothing", undefined],
])("treats %s as a fault of the site", (_name, error) => {
	expect(classifyFailure(error)).toEqual({ kind: "unexpected" });
});

it("logs a fault by its name and never its message", () => {
	const logged: unknown[][] = [];

	vi.spyOn(console, "error").mockImplementation((...args) => {
		logged.push(args);
	});
	logUnexpected("Agreement review", new Error("FOREIGN KEY constraint failed"));
	logUnexpected("Agreement review", "not an error");

	expect(logged).toEqual([
		["Agreement review failed unexpectedly:", "Error"],
		["Agreement review failed unexpectedly:", "UnknownError"],
	]);
});
