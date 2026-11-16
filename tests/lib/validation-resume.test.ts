import { describe, it, expect } from "vitest";
import { readResumeRequestInput } from "~/server/contact-input";

describe("readResumeRequestInput", () => {
	const valid = {
		name: "Jane",
		email: "jane@example.com",
		company: "Acme",
		audience: "general",
		note: "",
		turnstileToken: "tok",
	};

	it("accepts valid input", () => {
		const result = readResumeRequestInput(valid);
		expect(result.ok).toBe(true);
	});

	it("rejects missing name", () => {
		const result = readResumeRequestInput({ ...valid, name: "" });
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.name).toBeDefined();
	});

	it("rejects invalid email", () => {
		const result = readResumeRequestInput({
			...valid,
			email: "not-an-email",
		});

		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.email).toBeDefined();
	});

	it("rejects unknown audience", () => {
		const result = readResumeRequestInput({ ...valid, audience: "sales" });
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.audience).toBeDefined();
	});

	it("rejects the retired DoD variant for new requests", () => {
		const result = readResumeRequestInput({ ...valid, audience: "dod" });
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.errors.audience).toBeDefined();
	});

	it("rejects missing audience", () => {
		const { audience: _drop, ...withoutAudience } = valid;
		const result = readResumeRequestInput(withoutAudience);
		expect(result.ok).toBe(false);
	});

	it("rejects note longer than 1000 chars", () => {
		const result = readResumeRequestInput({
			...valid,
			note: "x".repeat(1001),
		});

		expect(result.ok).toBe(false);
	});

	it("accepts empty company and note", () => {
		const result = readResumeRequestInput({
			...valid,
			company: "",
			note: "",
		});

		expect(result.ok).toBe(true);
	});

	it("rejects missing turnstile token", () => {
		const result = readResumeRequestInput({ ...valid, turnstileToken: "" });
		expect(result.ok).toBe(false);
	});

	it("trims string fields", () => {
		const result = readResumeRequestInput({
			...valid,
			name: "  Jane  ",
			company: "  Acme  ",
		});

		if (!result.ok) throw new Error("expected ok");
		expect(result.value.name).toBe("Jane");
		expect(result.value.company).toBe("Acme");
	});
});
