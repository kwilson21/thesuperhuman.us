import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A `Data.TaggedError` is an Error. Its own `name`, `message`, `stack` and `cause` belong to Error: a field with one of
// those names replaces it, so `String(error)` and any log would print the field (visitor text, for one) as the error's
// type or message. A refusal names its facts some other way (`requesterName`), and carries no HTML.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RESERVED = ["name", "message", "stack", "cause"];

/** The names a type declares as members: a type literal's properties, an interface's, and what an intersection joins. */
function memberNames(
	type: ts.TypeNode,
	declared: ReadonlyMap<string, readonly ts.TypeElement[]>,
): string[] {
	if (ts.isTypeLiteralNode(type)) return namesOf(type.members);

	if (ts.isIntersectionTypeNode(type))
		return type.types.flatMap((part) => memberNames(part, declared));

	if (ts.isParenthesizedTypeNode(type)) return memberNames(type.type, declared);

	if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName))
		return namesOf(declared.get(type.typeName.text) ?? []);

	return [];
}

function namesOf(members: readonly ts.TypeElement[]): string[] {
	return members.flatMap((member) =>
		member.name &&
		(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
			? [member.name.text]
			: [],
	);
}

/** True when `expression` is `Data.TaggedError("X")` or `TaggedError("X")`. */
function isTaggedErrorCall(expression: ts.Expression): boolean {
	if (!ts.isCallExpression(expression)) return false;

	const callee = expression.expression;

	return (
		(ts.isIdentifier(callee) && callee.text === "TaggedError") ||
		(ts.isPropertyAccessExpression(callee) &&
			callee.name.text === "TaggedError")
	);
}

/**
 * The reserved names that a class extending `Data.TaggedError(...)` declares, in its type argument (a type literal, or
 * an interface or type alias declared in the same file) or as a member of the class, as "Class.field".
 */
export function taggedErrorViolations(file: string, text: string): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

	const declared = new Map<string, readonly ts.TypeElement[]>();

	for (const statement of source.statements) {
		if (ts.isInterfaceDeclaration(statement))
			declared.set(statement.name.text, statement.members);

		if (
			ts.isTypeAliasDeclaration(statement) &&
			ts.isTypeLiteralNode(statement.type)
		)
			declared.set(statement.name.text, statement.type.members);
	}

	const found: string[] = [];

	const visit = (node: ts.Node) => {
		if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
			for (const clause of node.heritageClauses ?? []) {
				if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;

				for (const base of clause.types) {
					if (!isTaggedErrorCall(base.expression)) continue;

					const label = node.name?.text ?? "(anonymous)";

					const fields = (base.typeArguments ?? []).flatMap((argument) =>
						memberNames(argument, declared),
					);

					const members = node.members.flatMap((member) =>
						member.name && ts.isIdentifier(member.name)
							? [member.name.text]
							: [],
					);

					for (const name of [...fields, ...members])
						if (RESERVED.includes(name)) found.push(`${label}.${name}`);
				}
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
}

describe("tagged errors keep Error's own fields", () => {
	it("finds a reserved field in a type argument, an alias, an interface or a class member", () => {
		for (const text of [
			'class A extends Data.TaggedError("A")<{ readonly name: string }> {}',
			'class A extends Data.TaggedError("A")<{ readonly message: string }> {}',
			'class A extends Data.TaggedError("A")<{ stack: string; ok: string }> {}',
			'class A extends Data.TaggedError("A")<{ readonly cause: unknown }> {}',
			'class A extends TaggedError("A")<{ readonly name: string }> {}',
			'class A extends Data.TaggedError("A")<{ readonly ok: string } & { readonly name: string }> {}',
			'type F = { readonly name: string };\nclass A extends Data.TaggedError("A")<F> {}',
			'interface F { readonly name: string }\nclass A extends Data.TaggedError("A")<F> {}',
			'class A extends Data.TaggedError("A") { readonly message = "x"; }',
			'class A extends Data.TaggedError("A") { get message() { return "x"; } }',
			'const A = class extends Data.TaggedError("A")<{ readonly name: string }> {};',
		])
			expect(taggedErrorViolations("a.ts", text), text).not.toEqual([]);
	});

	it("names the class and the field", () => {
		expect(
			taggedErrorViolations(
				"a.ts",
				'class ResumeNotSent extends Data.TaggedError("ResumeNotSent")<{ readonly name: string; readonly email: string }> {}',
			),
		).toEqual(["ResumeNotSent.name"]);
	});

	it("accepts other field names, other classes and other base classes", () => {
		for (const text of [
			'class A extends Data.TaggedError("A")<{ readonly requesterName: string }> {}',
			'class A extends Data.TaggedError("A") { readonly say = "x"; }',
			'class A extends Data.TaggedError("A") {}',
			"class A extends Error { readonly name = 'A'; }",
			"class A { readonly name = 'A'; }",
			'class A extends Context.Service<A, { readonly name: string }>()("A") {}',
			'// class A extends Data.TaggedError("A")<{ name: string }> {}',
			"const s = 'class A extends Data.TaggedError(\"A\")<{ name: string }> {}';",
		])
			expect(taggedErrorViolations("a.ts", text), text).toEqual([]);
	});

	it("holds for every file under src", () => {
		const offenders = globSync("src/**/*.{ts,tsx}", {
			cwd: repository,
		}).flatMap((file) =>
			taggedErrorViolations(
				file,
				readFileSync(join(repository, file), "utf8"),
			).map((violation) => `${file}: ${violation}`),
		);

		expect(offenders).toEqual([]);
	});
});
