import { describe, it, expect } from "vitest";
import { readContactInput } from "~/server/contact-input";

describe("readContactInput", () => {
	const validInput = {
		name: "Jane",
		email: "jane@example.com",
		company: "",
		description: "Hello!",
		turnstileToken: "tok",
	};

	it("accepts valid input", () => {
		const result = readContactInput(validInput);
		expect(result.ok).toBe(true);
	});

	it("rejects missing name", () => {
		const result = readContactInput({ ...validInput, name: "" });
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.name).toBeDefined();
	});

	it("rejects invalid email", () => {
		const result = readContactInput({
			...validInput,
			email: "not-an-email",
		});

		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.email).toBeDefined();
	});

	it("rejects a whitespace-only message", () => {
		const result = readContactInput({ ...validInput, description: "   " });
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.description).toBeDefined();
	});

	it("rejects description longer than 4000 chars", () => {
		const result = readContactInput({
			...validInput,
			description: "a".repeat(4001),
		});

		expect(result.ok).toBe(false);
	});

	it("accepts a short introduction without business qualifiers", () => {
		expect(
			readContactInput({
				name: " Jane ",
				email: " jane@example.com ",
				description: " Hi ",
				turnstileToken: "tok",
			}),
		).toEqual({
			ok: true,
			value: {
				name: "Jane",
				email: "jane@example.com",
				company: "",
				description: "Hi",
				turnstileToken: "tok",
			},
		});
	});

	it("rejects missing turnstile token", () => {
		const result = readContactInput({ ...validInput, turnstileToken: "" });
		expect(result.ok).toBe(false);
	});

	it("accepts optional fields when empty", () => {
		const result = readContactInput({ ...validInput, company: "" });
		expect(result.ok).toBe(true);
	});
});
