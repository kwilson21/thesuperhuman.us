import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A test replaces a collaborator through a seam (a parameter, or a service layer), never by mocking its module.
//
// REMAINING_MODULE_MOCKS is the remaining work of the area conversions. It is NOT an accepted exception: each entry is
// a test that still mocks a module inside a route area that has not been converted to Effect yet, and that area's
// conversion replaces the mock with a service layer and deletes the entry. Nothing is added to it. This test fails when
//
//   - a `vi.mock`, `vi.doMock` or `vi.unstable_mockModule` call appears in any file not listed here,
//   - a listed file has more such calls than listed, or
//   - a listed file has fewer (lower the number) or none (delete the entry),
//
// so the list can only shrink. The final layer of the overhaul deletes the list, leaving the scan to assert that no
// module mock exists anywhere. The Oxlint rule `anti-slop/no-module-mocking` reports the same calls.

/** The area whose conversion removes the mocks of a file. */
type Area =
	| "music and catalog"
	| "studio access"
	| "audio intake and invitation"
	| "owner audio tools"
	| "payments"
	| "Stripe webhook"
	| "publication API";

export const REMAINING_MODULE_MOCKS: readonly {
	file: string;
	/** The number of module-mock calls in the file today. */
	calls: number;
	area: Area;
}[] = [
	{ file: "tests/api/audio-file.test.ts", calls: 1, area: "music and catalog" },
	{
		file: "tests/api/music-demand.test.ts",
		calls: 2,
		area: "music and catalog",
	},
	{ file: "tests/api/studio-access.test.ts", calls: 2, area: "studio access" },
	{
		file: "tests/api/studio-review-response.test.ts",
		calls: 2,
		area: "studio access",
	},
	{
		file: "tests/api/audio-intake.test.ts",
		calls: 3,
		area: "audio intake and invitation",
	},
	{
		file: "tests/api/project-invitation.test.ts",
		calls: 1,
		area: "audio intake and invitation",
	},
	{
		file: "tests/lib/audio-project-invitations.test.ts",
		calls: 1,
		area: "audio intake and invitation",
	},
	{
		file: "tests/api/project-updates.test.ts",
		calls: 1,
		area: "owner audio tools",
	},
	{
		file: "tests/lib/audio-project-updates.test.ts",
		calls: 1,
		area: "owner audio tools",
	},
	{ file: "tests/api/owner-payment.test.ts", calls: 1, area: "payments" },
	{
		file: "tests/api/stripe-webhook.test.ts",
		calls: 1,
		area: "Stripe webhook",
	},
	{ file: "tests/api/publication.test.ts", calls: 2, area: "publication API" },
];

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Vendored third-party lint rules, kept byte for byte as upstream; they only name these methods in strings. */
const VENDORED = "tools/oxlint/anti-slop/";

const MOCK_METHODS = new Set(["mock", "doMock", "unstable_mockModule"]);

function isModuleMock(callee: ts.Expression): boolean {
	if (ts.isPropertyAccessExpression(callee))
		return (
			ts.isIdentifier(callee.expression) &&
			callee.expression.text === "vi" &&
			MOCK_METHODS.has(callee.name.text)
		);

	if (ts.isElementAccessExpression(callee))
		return (
			ts.isIdentifier(callee.expression) &&
			callee.expression.text === "vi" &&
			ts.isStringLiteralLike(callee.argumentExpression) &&
			MOCK_METHODS.has(callee.argumentExpression.text)
		);

	return false;
}

/** The number of module-mock calls in `text`: `vi.mock(...)`, `vi.doMock(...)`, `vi.unstable_mockModule(...)`, also as `vi["mock"](...)`. */
export function moduleMockCalls(file: string, text: string): number {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	let calls = 0;

	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && isModuleMock(node.expression)) calls++;
		ts.forEachChild(node, visit);
	}

	visit(source);

	return calls;
}

/** Every source file Git tracks or has not been told to ignore, that still exists. */
function sourceFiles(): string[] {
	const listing = execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);

	const files = listing.split("\0").filter(Boolean);

	if (files.length === 0)
		throw new Error("git ls-files listed no file; is this a Git checkout?");

	return files.filter(
		(file) =>
			SOURCE.test(file) &&
			!file.startsWith(VENDORED) &&
			existsSync(join(repository, file)),
	);
}

describe("module mocks", () => {
	it("finds each form of module mock and nothing else", () => {
		expect(moduleMockCalls("a.ts", 'vi.mock("~/a", () => ({}));')).toBe(1);
		expect(moduleMockCalls("a.ts", 'vi.doMock("~/a", () => ({}));')).toBe(1);

		expect(
			moduleMockCalls("a.ts", 'vi.unstable_mockModule("~/a", () => ({}));'),
		).toBe(1);

		expect(moduleMockCalls("a.ts", 'vi["mock"]("~/a");')).toBe(1);
		expect(moduleMockCalls("a.ts", 'vi.mock("a"); vi.mock("b");')).toBe(2);
		expect(moduleMockCalls("a.ts", "vi.fn(); vi.spyOn(o, 'm');")).toBe(0);
		expect(moduleMockCalls("a.ts", 'const text = "vi.mock(x)";')).toBe(0);
		expect(moduleMockCalls("a.ts", "// vi.mock(x)")).toBe(0);
		expect(moduleMockCalls("a.ts", "f.mock(x); mocks.mock(y);")).toBe(0);
	});

	it("lists each file once, in tests, with a count above zero", () => {
		const files = REMAINING_MODULE_MOCKS.map(({ file }) => file);

		expect(new Set(files).size).toBe(files.length);

		for (const { file, calls } of REMAINING_MODULE_MOCKS) {
			expect(file.startsWith("tests/")).toBe(true);
			expect(calls).toBeGreaterThan(0);
		}
	});

	it("allows module mocks only in the files of the area conversions still to come", () => {
		const found = new Map<string, number>();

		for (const file of sourceFiles()) {
			const calls = moduleMockCalls(
				file,
				readFileSync(join(repository, file), "utf8"),
			);

			if (calls > 0) found.set(file, calls);
		}

		const listed = new Set(REMAINING_MODULE_MOCKS.map(({ file }) => file));

		expect(
			[...found.keys()].filter((file) => !listed.has(file)),
			"A module mock is not allowed here: pass the collaborator in (a parameter, or a service layer) and use a double.",
		).toEqual([]);

		expect(
			REMAINING_MODULE_MOCKS.flatMap(({ file, calls }) =>
				found.get(file) === calls
					? []
					: [{ file, listed: calls, found: found.get(file) ?? 0 }],
			),
			"The list can only shrink: lower the count of a file with fewer module mocks, delete the entry of a file with none.",
		).toEqual([]);
	});
});
