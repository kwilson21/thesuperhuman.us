import { globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// src/lib is shared with the browser, so it does not import values from src/server. One exception stands until the
// owner agreement area converts to Effect Schema: src/lib/agreement-fields.ts (server-only) imports the Zod copies of
// `cleanText`, `required` and `email` from src/server/agreement-zod-fields.ts. This test keeps the exception from
// spreading: that file may import that module and nothing else of src/server, and no other src/lib file may import a
// value (or load, or re-export) anything under src/server. A type-only import is erased and does not count.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every load of something under src/server that `file` (under src/lib) makes, as written, type-only imports left out. */
function serverLoadsIn(file: string, text: string): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const found: string[] = [];

	const fromServer = (specifier: string) => {
		if (specifier.startsWith("~/"))
			return specifier.startsWith("~/server/") || specifier === "~/server";

		if (!specifier.startsWith(".")) return false;

		const target = resolve(dirname(join(repository, file)), specifier);

		return (
			relative(join(repository, "src", "server"), target).startsWith("..") ===
			false
		);
	};

	const visit = (node: ts.Node) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteralLike(node.moduleSpecifier) &&
			node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
		) {
			const bindings = node.importClause?.namedBindings;

			const onlyTypes =
				bindings !== undefined &&
				ts.isNamedImports(bindings) &&
				!node.importClause?.name &&
				bindings.elements.length > 0 &&
				bindings.elements.every((element) => element.isTypeOnly);

			if (!onlyTypes && fromServer(node.moduleSpecifier.text))
				found.push(node.moduleSpecifier.text);
		}

		if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier) &&
			!node.isTypeOnly &&
			fromServer(node.moduleSpecifier.text)
		)
			found.push(node.moduleSpecifier.text);

		if (
			ts.isCallExpression(node) &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0]) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === "require")) &&
			fromServer(node.arguments[0].text)
		)
			found.push(node.arguments[0].text);

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
}

describe("src/lib and src/server", () => {
	const files = globSync("src/lib/**/*.{ts,mjs,js}", { cwd: repository });

	it("has files to read", () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it("lets only agreement-fields.ts load src/server, and only the Zod helpers module", () => {
		const loads = Object.fromEntries(
			files
				.map((file) => [
					file,
					serverLoadsIn(file, readFileSync(join(repository, file), "utf8")),
				])
				.filter(([, found]) => found.length > 0),
		);

		expect(loads).toEqual({
			"src/lib/agreement-fields.ts": ["../server/agreement-zod-fields"],
		});
	});

	describe("the reader", () => {
		const loads = (text: string) => serverLoadsIn("src/lib/a.ts", text);

		it("finds a value import, a re-export, a dynamic import and a require, by relative path or alias", () => {
			expect(loads('import { a } from "../server/edge";')).toEqual([
				"../server/edge",
			]);
			expect(loads('import a from "~/server/edge";')).toEqual([
				"~/server/edge",
			]);
			expect(loads('import "../server/x";')).toEqual(["../server/x"]);
			expect(loads('export { a } from "../server/edge";')).toEqual([
				"../server/edge",
			]);
			expect(loads('export * from "~/server/edge";')).toEqual([
				"~/server/edge",
			]);
			expect(loads('export const l = () => import("../server/edge");')).toEqual(
				["../server/edge"],
			);
			expect(loads('const a = require("../server/edge");')).toEqual([
				"../server/edge",
			]);
		});

		it("does not count a type-only import, another module or a comment", () => {
			expect(loads('import type { A } from "../server/edge";')).toEqual([]);
			expect(loads('import { type A, type B } from "../server/edge";')).toEqual(
				[],
			);
			expect(loads('export type { A } from "../server/edge";')).toEqual([]);
			expect(loads('import { a } from "./serverless";')).toEqual([]);
			expect(loads('// import { a } from "../server/edge";')).toEqual([]);
			expect(loads('export const s = "../server/edge";')).toEqual([]);
		});
	});
});
