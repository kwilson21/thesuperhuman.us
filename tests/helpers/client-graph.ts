import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

// The static import graph of what runs in the browser: every file under src/scripts and the <script> blocks of every
// .astro file under src. Used by tests/architecture/client-graph.test.ts to keep Effect and src/server out of it.

/** One forbidden import and the files that lead to it, from a client entry to the file that imports it. */
export type ClientGraphViolation = {
	/** The forbidden module as written in the import. */
	import: string;
	/** Paths relative to the root: the client entry first, the importing file last. */
	chain: string[];
};

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const FRONTMATTER = /^\s*---[\s\S]*?\n---/;
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".mts"];

/** Every file under `directory` whose name ends with one of `suffixes`, in a stable order. */
function filesUnder(directory: string, suffixes: string[]): string[] {
	if (!existsSync(directory)) return [];

	return readdirSync(directory)
		.sort()
		.flatMap((name) => {
			const path = join(directory, name);

			if (statSync(path).isDirectory()) return filesUnder(path, suffixes);

			return suffixes.some((suffix) => name.endsWith(suffix)) ? [path] : [];
		});
}

/** The `~/` style aliases of the root's tsconfig.json: prefix (with its slash) to the directory it stands for. */
function aliasesOf(root: string): Map<string, string> {
	const parsed = ts.parseConfigFileTextToJson(
		"tsconfig.json",
		readFileSync(join(root, "tsconfig.json"), "utf8"),
	);

	const options: { baseUrl?: string; paths?: Record<string, string[]> } =
		parsed.config?.compilerOptions ?? {};

	const base = resolve(root, options.baseUrl ?? ".");
	const aliases = new Map<string, string>();

	for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
		const [target] = targets;

		if (pattern.endsWith("/*") && target?.endsWith("/*"))
			aliases.set(pattern.slice(0, -1), join(base, target.slice(0, -1)));
	}

	return aliases;
}

/** True when an import brings code into the module: not `import type`, and not every specifier marked `type`. */
function bringsCode(node: ts.ImportDeclaration | ts.ExportDeclaration) {
	if (ts.isExportDeclaration(node)) return !node.isTypeOnly;
	const clause = node.importClause;

	if (!clause) return true;

	if (clause.isTypeOnly) return false;
	const named = clause.namedBindings;

	if (clause.name || !named || ts.isNamespaceImport(named)) return true;

	return (
		named.elements.length === 0 ||
		named.elements.some((element) => !element.isTypeOnly)
	);
}

/** The module specifiers a source text loads: static imports, re-exports and `import("...")` with a literal. */
function specifiersOf(file: string, text: string): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const found: string[] = [];

	const visit = (node: ts.Node) => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			bringsCode(node)
		)
			found.push(node.moduleSpecifier.text);

		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			const [argument] = node.arguments;

			if (argument && ts.isStringLiteral(argument)) found.push(argument.text);
		}

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
}

/** The script text of a file: a .ts file whole, an .astro file's <script> blocks (never its frontmatter). */
function clientText(file: string): string {
	const text = readFileSync(file, "utf8");

	if (!file.endsWith(".astro")) return text;
	const markup = text.replace(FRONTMATTER, "");

	return [...markup.matchAll(SCRIPT_BLOCK)].map((block) => block[1]).join("\n");
}

function isForbidden(specifier: string, root: string, path?: string): boolean {
	if (
		specifier === "effect" ||
		specifier.startsWith("effect/") ||
		specifier === "@xstate/effect" ||
		specifier.startsWith("@xstate/effect/")
	)
		return true;

	return (
		path !== undefined &&
		(path + sep).startsWith(join(root, "src", "server") + sep)
	);
}

/** The file a relative or aliased specifier names, or undefined for a package or a file that is not code. */
function resolveSpecifier(
	specifier: string,
	from: string,
	aliases: Map<string, string>,
): string | undefined {
	const bare = specifier.split("?")[0];
	let base: string | undefined;

	if (bare.startsWith(".")) base = resolve(dirname(from), bare);

	for (const [prefix, directory] of aliases)
		if (bare.startsWith(prefix))
			base = join(directory, bare.slice(prefix.length));

	if (!base) return undefined;

	const candidates = [
		base,
		...EXTENSIONS.map((extension) => base + extension),
		...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
	];

	return candidates.find(
		(candidate) =>
			existsSync(candidate) &&
			statSync(candidate).isFile() &&
			[...EXTENSIONS, ".astro"].some((extension) =>
				candidate.endsWith(extension),
			),
	);
}

/** The client entry files under `root`: src/scripts/** and every .astro file under src that has a <script> block. */
export function clientEntries(root: string): string[] {
	const scripts = filesUnder(join(root, "src", "scripts"), [
		".ts",
		".tsx",
		".js",
		".mjs",
	]);

	const pages = filesUnder(join(root, "src"), [".astro"]).filter(
		(file) => clientText(file).trim() !== "",
	);

	return [...scripts, ...pages];
}

/**
 * Walks the static import graph from every client entry under `root` and lists each import of `effect`, `effect/*`,
 * `@xstate/effect` or anything under src/server that a reachable module makes. Type-only imports do not count.
 */
export function clientGraphViolations(root: string): ClientGraphViolation[] {
	const aliases = aliasesOf(root);
	const violations: ClientGraphViolation[] = [];
	const seen = new Set<string>();
	const shown = (file: string) => relative(root, file).split(sep).join("/");

	for (const entry of clientEntries(root)) {
		const queue: { file: string; chain: string[] }[] = [
			{ file: entry, chain: [shown(entry)] },
		];

		while (queue.length > 0) {
			const current = queue.shift();

			if (!current || seen.has(`${entry}|${current.file}`)) continue;
			seen.add(`${entry}|${current.file}`);

			for (const specifier of specifiersOf(
				current.file,
				clientText(current.file),
			)) {
				const target = resolveSpecifier(specifier, current.file, aliases);

				if (isForbidden(specifier, root, target))
					violations.push({ import: specifier, chain: current.chain });
				else if (target && !target.endsWith(".astro"))
					queue.push({
						file: target,
						chain: [...current.chain, shown(target)],
					});
			}
		}
	}

	return violations;
}
