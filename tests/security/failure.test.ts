import Stripe from "stripe";
import * as Schema from "effect/Schema";
import { z } from "astro/zod";
import { afterEach, expect, it, vi } from "vitest";
import { FieldsRefused } from "~/lib/fields";
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

// The log never carries a message that can quote input, whatever the error calls itself.

function logged(error: Error) {
	const lines: unknown[][] = [];

	vi.spyOn(console, "error").mockImplementation((...args) => {
		lines.push(args);
	});
	logUnexpected("Software invoice", error);

	return lines[0];
}

/** The error a call throws, which a test needs as a real instance. */
function thrown(run: () => void): Error {
	try {
		run();
	} catch (error) {
		if (error instanceof Error) return error;
	}

	throw new Error("the call did not throw an error");
}

const quoting: [string, () => Error][] = [
	[
		"a Stripe invalid request error",
		() =>
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				message: "Invalid email address: grace@example.test",
				code: "email_invalid",
				statusCode: 400,
			}),
	],
	[
		"a Stripe error renamed by a wrapper",
		() => {
			const error = new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "No such customer: 'cus_grace@example.test'",
				statusCode: 500,
			});

			error.name = "Error";

			return error;
		},
	],
	[
		"a JSON parse error",
		() => thrown(() => JSON.parse('{"email":"grace@example.test",')),
	],
	[
		"a Zod error",
		() => thrown(() => z.enum(["a"]).parse("grace@example.test")),
	],
	[
		"an Effect schema error",
		() =>
			thrown(() =>
				Schema.decodeUnknownSync(Schema.Literal("a"))("grace@example.test"),
			),
	],
	["a refused form", () => new FieldsRefused({ email: "grace@example.test" })],
];

it.each(quoting)("never logs the message of %s", (_name, make) => {
	const line = logged(make());

	expect(JSON.stringify(line)).not.toMatch(/grace|example\.test|cus_/);
	expect(line?.[2] ?? "").not.toContain("@");
});

it("logs only the type, code and status of a Stripe error", () => {
	const line = logged(
		new Stripe.errors.StripeInvalidRequestError({
			type: "invalid_request_error",
			message: "Invalid email address: grace@example.test",
			code: "email_invalid",
			statusCode: 400,
		}),
	);

	expect(line).toEqual([
		"Software invoice failed unexpectedly:",
		"StripeInvalidRequestError",
		"code=email_invalid status=400",
	]);
});

it("cleans and cuts the logged name", () => {
	const error = new Error("x");

	error.name = `Bad\r\nName${"y".repeat(100)}`;
	const [, name] = logged(error) ?? [];

	expect(name).toBe(`Bad Name${"y".repeat(52)}`);
});
