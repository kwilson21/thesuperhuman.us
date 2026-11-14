import { readFileSync } from "node:fs";
import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	FIXED_AGREEMENT_HASH,
	FIXED_SOW_NUMBER,
	fixDisplayedAgreementIds,
	SOW_NUMBER_PATTERN,
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

// Runs the page-side function in a fresh context, with the reader as its root and the constants as its argument,
// the way the capture passes them through Playwright's evaluate.
function run(
	blocks: FakeBlock[],
	args: { sowNumber?: string; sowHash?: string } = {},
): void {
	const sandbox: Context = createContext({
		root: {
			querySelectorAll: (selector: string) =>
				selector === ".terms-document" ? blocks : [],
		},
	});

	const argument = JSON.stringify({
		sowNumber: FIXED_SOW_NUMBER,
		sowHash: FIXED_AGREEMENT_HASH,
		sowPattern: SOW_NUMBER_PATTERN,
		...args,
	});

	runInContext(
		`(${fixDisplayedAgreementIds.toString()})({ root, ...${argument} })`,
		sandbox,
	);
}

const sow = "SOW-7f3c2a10-5b1e-4c8d-9a0f-1234567890ab";
const msaHash = "a".repeat(64);

describe("fixDisplayedAgreementIds", () => {
	it("shows the fixed SOW hash only in the document whose legal text holds the generated SOW number", () => {
		const msa = block(msaHash, "MSA text without a SOW number");
		const statement = block("b".repeat(64), `Number ${sow}`);

		run([msa, statement]);

		expect(statement.hash.textContent).toBe(`SHA-256 ${FIXED_AGREEMENT_HASH}`);
		// The MSA's real hash is stable across runs, so it is left as it was: it must not share the SOW's hash.
		expect(msa.hash.textContent).toBe(`SHA-256 ${msaHash}`);
	});

	it("writes the exported hash constant in the displayed format", () => {
		const statement = block("c".repeat(64), `Statement ${sow}`);

		run([statement]);

		expect(FIXED_AGREEMENT_HASH).toMatch(/^[0-9a-f]{64}$/);
		expect(statement.hash.textContent).toBe(`SHA-256 ${FIXED_AGREEMENT_HASH}`);
	});

	it("replaces the generated SOW number in the legal text with the fixed one", () => {
		const statement = block("c".repeat(64), `Statement ${sow} for the client`);

		run([statement]);

		expect(statement.legal.textContent).toBe(
			`Statement ${FIXED_SOW_NUMBER} for the client`,
		);
	});

	it("leaves a document's hash alone when its legal text has no generated SOW number", () => {
		const legal = "No identifiers here, only SOW text.";
		const plain = block("d".repeat(64), legal);

		run([plain]);

		expect(plain.legal.textContent).toBe(legal);
		expect(plain.hash.textContent).toBe(`SHA-256 ${"d".repeat(64)}`);
	});

	it("uses the constants it is given rather than copies of its own", () => {
		const statement = block("e".repeat(64), `Statement ${sow}`);

		run([statement], { sowNumber: "SOW-x", sowHash: "f".repeat(64) });

		expect(statement.legal.textContent).toBe("Statement SOW-x");
		expect(statement.hash.textContent).toBe(`SHA-256 ${"f".repeat(64)}`);
	});

	it("does nothing when the reader has no documents", () => {
		expect(() => run([])).not.toThrow();
	});

	it("uses a fixed SOW number that is clearly fictional", () => {
		expect(FIXED_SOW_NUMBER).toBe("SOW-00000000-0000-4000-8000-000000000009");
	});
});

// The source of a scenario file, read as text: the captions are set in its shot calls.
const scenario = (name: string) =>
	readFileSync(
		new URL(`../../scripts/screenshots/scenarios/${name}`, import.meta.url),
		"utf8",
	);

describe("the fixed-values caption note", () => {
	it("is on no capture of the project whose agreement is signed outside the website", () => {
		// The external signature shows no SOW number or hash, so the note would be false there.
		expect(scenario("software-project.mjs")).not.toContain("FIXED_IDS_NOTE");
	});

	it("is on the guided-full capture of the signing scenario and on no other", () => {
		const source = scenario("software-signing.mjs");
		const note = source.indexOf("note: FIXED_IDS_NOTE");

		expect(source.split("note: FIXED_IDS_NOTE")).toHaveLength(2);

		const shot = source.lastIndexOf("await shot(", note);

		expect(source.slice(shot, note)).toContain('"guided-full"');
	});
});
