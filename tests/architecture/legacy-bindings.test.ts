import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// `legacyBindingsOrDefect` reproduces one answer: a missing binding is a 500 at the first read. Only the three routes
// whose current answer that is may use it. Every later route uses `bindingsOrUnavailable`, which answers a missing
// binding before anything runs.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const NAME = "legacyBindingsOrDefect";

export const ALLOWED = [
	"src/pages/api/contact.ts",
	"src/pages/api/resume-request.ts",
	"src/pages/api/resume-approve.ts",
];

/** The file that defines it. */
const DEFINITION = "src/server/services.ts";

/** True when the source text names the function as an identifier (not in a comment or a string). */
export function namesLegacyBindings(file: string, text: string): boolean {
	if (file.endsWith(".astro")) return text.includes(NAME);

	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

	let found = false;

	const visit = (node: ts.Node) => {
		if (ts.isIdentifier(node) && node.text === NAME) found = true;

		if (!found) ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
}

const filesNaming = (files: Record<string, string>) =>
	Object.entries(files)
		.filter(([file, text]) => namesLegacyBindings(file, text))
		.map(([file]) => file)
		.sort();

describe("legacyBindingsOrDefect is for the three contact and resume routes only", () => {
	it("recognizes a use and not a comment or a string", () => {
		expect(
			filesNaming({
				"a.ts": `import { ${NAME} } from "~/server/services";`,
				"b.ts": `import * as S from "~/server/services"; S.${NAME}(env);`,
				"c.ts": `// ${NAME}\nconst s = "${NAME}";`,
				"d.astro": `---\nimport { ${NAME} } from "~/server/services";\n---\n`,
				"e.ts": "export const x = bindingsOrUnavailable;",
			}),
		).toEqual(["a.ts", "b.ts", "d.astro"]);
	});

	it("is imported by the three routes and nothing else under src", () => {
		const files = Object.fromEntries(
			globSync("src/**/*.{ts,tsx,astro}", { cwd: repository })
				.filter((file) => file !== DEFINITION)
				.map((file) => [file, readFileSync(join(repository, file), "utf8")]),
		);

		expect(filesNaming(files)).toEqual([...ALLOWED].sort());
	});
});
