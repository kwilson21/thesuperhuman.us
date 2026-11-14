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
			"D1_ERROR: no such table: x Bcc: [email]",
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

// logUnexpected runs inside a route's catch block, so it must never throw itself.

const PREFIX = "Software invoice failed unexpectedly:";
const FIXED = [PREFIX, "(details unavailable)"];

function logLine<T>(error: T) {
	const lines: unknown[][] = [];

	vi.spyOn(console, "error").mockImplementation((...args) => {
		lines.push(args);
	});
	expect(() => logUnexpected("Software invoice", error)).not.toThrow();

	return lines[0];
}

function withProperty(property: string, value: PropertyDescriptor) {
	const error = new Error("plain");

	Object.defineProperty(error, property, value);

	return error;
}

it("logs a fixed line when the error's own fields cannot be read or are not text", () => {
	const throwing = {
		get() {
			throw new Error("getter");
		},
	};

	expect(logLine(withProperty("name", { value: 42 }))?.[1]).toBe("Error");
	expect(logLine(withProperty("name", { value: { a: 1 } }))?.[1]).toBe("Error");
	expect(logLine(withProperty("name", throwing))).toEqual(FIXED);
	expect(logLine(withProperty("message", { value: 42 }))?.[2]).toBe("");
	expect(logLine(withProperty("message", throwing))).toEqual(FIXED);
	expect(logLine(Object.freeze(new Error("frozen")))).toEqual([
		PREFIX,
		"Error",
		"frozen",
	]);
	expect(logLine(null)).toEqual([PREFIX, "UnknownError", ""]);
	expect(logLine(undefined)).toEqual([PREFIX, "UnknownError", ""]);
});

it("redacts the userinfo and query of a URL, and any email address, from the logged message", () => {
	expect(
		logLine(
			new Error(
				"Failed to parse URL from http://grace@example.test:99999/?k=v",
			),
		)?.[2],
	).toBe(
		"Failed to parse URL from http://[redacted]@example.test:99999/?[redacted]",
	);
	expect(
		logLine(
			new Error("bad link /verify?t=abc123&email=grace%40example.test failed"),
		)?.[2],
	).toBe("bad link /verify?[redacted] failed");
	expect(logLine(new Error("Cannot send to grace@example.test now"))?.[2]).toBe(
		"Cannot send to [email] now",
	);
	expect(
		logLine(
			new Error(
				"D1_ERROR: UNIQUE constraint failed: software_invoices.request_id: SQLITE_CONSTRAINT",
			),
		)?.[2],
	).toBe(
		"D1_ERROR: UNIQUE constraint failed: software_invoices.request_id: SQLITE_CONSTRAINT",
	);
});

it("logs the class of a cause and never its message, and drops a message that wraps a quoting cause", () => {
	const inner = new Stripe.errors.StripeInvalidRequestError({
		type: "invalid_request_error",
		message: "Invalid email address: grace@example.test",
		statusCode: 400,
	});

	const wrapped = new Error(`Invoice failed: ${inner.message}`, {
		cause: inner,
	});

	expect(logLine(wrapped)).toEqual([
		PREFIX,
		"Error",
		"",
		"cause=StripeInvalidRequestError",
	]);

	const plain = new Error("Invoice failed: no such table", {
		cause: new TypeError("secret detail"),
	});

	expect(logLine(plain)).toEqual([
		PREFIX,
		"Error",
		"Invoice failed: no such table",
		"cause=TypeError",
	]);

	const parser = new Error("Could not read: x", {
		cause: thrown(() => JSON.parse("{")),
	});

	expect(logLine(parser)).toEqual([PREFIX, "Error", "", "cause=SyntaxError"]);
});

it("redacts an IPv4 or IPv6 address from the logged message, wherever it sits, and leaves version numbers and C++ style names alone", () => {
	const said = (message: string) => logLine(new Error(message))?.[2];

	expect(said("rate limit for 203.0.113.7 failed")).toBe(
		"rate limit for [ip] failed",
	);
	expect(said("peer 203.0.113.7:8443 reset, then 198.51.100.4.")).toBe(
		"peer [ip]:8443 reset, then [ip].",
	);
	expect(said("no route to 2001:db8::1")).toBe("no route to [ip]");
	expect(said("no route to 2001:0db8:85a3:0000:0000:8a2e:0370:7334 now")).toBe(
		"no route to [ip] now",
	);
	expect(said("no route to ::1 or fe80::1ff:fe23:4567:890a")).toBe(
		"no route to [ip] or [ip]",
	);
	// Ordinary text with dots and colons is not an address.
	expect(said("effect 4.1.4 and xstate 6.0.0-beta.1 failed")).toBe(
		"effect 4.1.4 and xstate 6.0.0-beta.1 failed",
	);
	expect(said("std::vector at 12:30:45 failed")).toBe(
		"std::vector at 12:30:45 failed",
	);
});
