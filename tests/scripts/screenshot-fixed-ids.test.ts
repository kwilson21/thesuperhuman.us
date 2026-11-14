import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	FIXED_SOW_NUMBER,
	fixDisplayedAgreementIds,
} from "../../scripts/screenshots/agreed-terms.mjs";

// A fake element with the text it holds, as the reader's markup would expose it.
type FakeText = { textContent: string };

// One document block of the reader: its hash line and its legal text.
type FakeBlock = {
	hash: FakeText;
	legal: FakeText;
	querySelector: (selector: string) => FakeText | null;
};

function block(hash: string, legal: string): FakeBlock {
	const hashText = { textContent: `SHA-256 ${hash}` };
	const legalText = { textContent: legal };

	return {
		hash: hashText,
		legal: legalText,
		querySelector: (selector: string) =>
			selector === ".terms-hash"
				? hashText
				: selector === "pre.terms-legal"
					? legalText
					: null,
	};
}

// Runs the page-side function in a fresh context, with the reader as its root.
function run(blocks: FakeBlock[]): void {
	const sandbox: Context = createContext({
		root: {
			querySelectorAll: (selector: string) =>
				selector === ".terms-document" ? blocks : [],
		},
	});

	runInContext(`(${fixDisplayedAgreementIds.toString()})(root)`, sandbox);
}

const sow = "SOW-7f3c2a10-5b1e-4c8d-9a0f-1234567890ab";

describe("fixDisplayedAgreementIds", () => {
	it("shows a fixed fictional hash in place of the generated one, for each document", () => {
		const msa = block("a".repeat(64), "MSA text");
		const statement = block("b".repeat(64), `Number ${sow}`);

		run([msa, statement]);

		expect(msa.hash.textContent).toMatch(/^SHA-256 [0-9a-f]{64}$/);
		expect(msa.hash.textContent).not.toContain("a".repeat(8));
		expect(statement.hash.textContent).not.toContain("b".repeat(8));
	});

	it("replaces the generated SOW number in the legal text with the fixed one", () => {
		const statement = block("c".repeat(64), `Statement ${sow} for the client`);

		run([statement]);

		expect(statement.legal.textContent).toBe(
			`Statement ${FIXED_SOW_NUMBER} for the client`,
		);
	});

	it("leaves text without a generated SOW number unchanged", () => {
		const legal = "No identifiers here, only SOW text.";
		const plain = block("d".repeat(64), legal);

		run([plain]);

		expect(plain.legal.textContent).toBe(legal);
	});

	it("does nothing when the reader has no documents", () => {
		expect(() => run([])).not.toThrow();
	});

	it("uses a fixed SOW number that is clearly fictional", () => {
		expect(FIXED_SOW_NUMBER).toBe("SOW-00000000-0000-4000-8000-000000000009");
	});
});
