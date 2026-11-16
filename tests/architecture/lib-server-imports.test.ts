import { globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// src/lib is shared with the browser, so no file under it imports a value from src/server (the helpers the browser
// and the server share live in src/lib/fields.ts for that reason). There is no exception: a type-only import is erased
// and does not count, and a load, a re-export or a `require` does. The one exception there was (server-only Zod copies of
// three agreement text helpers) was removed when the owner agreement schemas moved to Effect Schema; this test keeps it
// from coming back unnoticed.

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

	it("lets no file under src/lib load a value from src/server", () => {
		const loads = Object.fromEntries(
			files
				.map((file) => [
					file,
					serverLoadsIn(file, readFileSync(join(repository, file), "utf8")),
				])
				.filter(([, found]) => found.length > 0),
		);

		expect(loads).toEqual({});
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
