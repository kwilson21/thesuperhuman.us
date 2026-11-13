import { afterEach, expect, it, vi } from "vitest";
import { LostRace, ReaderMessage } from "~/lib/reader-message";
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
	["a race a batch recognised itself", new LostRace("client row")],
	[
		"a failed guard under a wrapper",
		new Error("batch failed", { cause: new Error("malformed JSON") }),
	],
])("treats %s as a conflict with another request", (_name, error) => {
	expect(classifyFailure(error)).toEqual({ kind: "stale" });
});

it.each([
	[
		"a foreign key failure no batch recognised",
		new Error("FOREIGN KEY constraint failed"),
	],
	["a database fault", new Error("D1_ERROR: no such table: x")],
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

it("logs the route, the name and a clean, cut message, and leaves out a message that quotes input", () => {
	const logged: unknown[][] = [];

	vi.spyOn(console, "error").mockImplementation((...args) => {
		logged.push(args);
	});
	logUnexpected(
		"Agreement review",
		new Error("D1_ERROR: no such table: x\r\nBcc: a@b.c"),
	);
	logUnexpected("Agreement review", new Error("x".repeat(500)));
	logUnexpected(
		"Agreement review",
		new SyntaxError(
			"Unexpected token 'o', \"ada@example.com\" is not valid JSON",
		),
	);
	logUnexpected(
		"Software invoice",
		new Error("Invalid API Key provided: sk_live_****abcd"),
	);
	logUnexpected("Agreement review", "not an error");

	expect(logged).toEqual([
		[
			"Agreement review failed unexpectedly:",
			"Error",
			"D1_ERROR: no such table: x Bcc: a@b.c",
		],
		["Agreement review failed unexpectedly:", "Error", "x".repeat(300)],
		["Agreement review failed unexpectedly:", "SyntaxError", ""],
		["Software invoice failed unexpectedly:", "Error", ""],
		["Agreement review failed unexpectedly:", "UnknownError", ""],
	]);
});
