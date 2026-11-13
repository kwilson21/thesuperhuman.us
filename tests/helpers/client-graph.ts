import {
	existsSync,
	globSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

// The static import graph of what runs in the browser: every file under src/scripts and the <script> blocks of every
// .astro file under src. Used by tests/architecture/client-graph.test.ts to keep Effect and src/server out of it.

/** One forbidden import and the files that lead to it, from a client entry to the file that imports it. */
export type ClientGraphViolation = {
	/** The forbidden module as written in the import (or, for a glob, the pattern). */
	import: string;
	/** Paths relative to the root: the client entry first, the importing file last. */
	chain: string[];
};

/** A load the walker cannot follow statically (a dynamic import with a real expression): a failure, never a pass. */
export type UnresolvedLoad = ClientGraphViolation & {
	/** The 1-based line in the last file of the chain. */
	line: number;
	/** What could not be resolved. */
	reason: string;
};

/**
 * The modules that must never ship to the browser: a package name stands for itself and everything under it. One list,
 * so a later decision to allow a named module is one line in `allow`. Code under src/server is forbidden by path.
 */
export const FORBIDDEN_MODULES: readonly string[] = [
	"effect",
	"@effect",
	"@xstate/effect",
];

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const FRONTMATTER = /^\s*---[\s\S]*?\n---/;

const EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
	".js",
	".jsx",
];

// A specifier written with a JavaScript suffix may name the TypeScript file beside it.
const TYPESCRIPT_OF = [
	[".js", [".ts", ".tsx"]],
	[".jsx", [".tsx"]],
	[".mjs", [".mts"]],
	[".cjs", [".cts"]],
] as const;

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

	if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
	const named = clause.namedBindings;

	if (clause.name || !named || ts.isNamespaceImport(named)) return true;

	return (
		named.elements.length === 0 ||
		named.elements.some((element) => !element.isTypeOnly)
	);
}

/** One load a source text makes: a module specifier, a glob, or a load the walker cannot resolve. */
type Load =
	| { kind: "module"; specifier: string; line: number }
	| { kind: "glob"; pattern: string; line: number }
	| { kind: "unresolved"; reason: string; line: number };

/** The expression without the parentheses, `as` and `satisfies` around it. */
function unwrap(node: ts.Expression): ts.Expression {
	let current = node;

	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current)
	)
		current = current.expression;

	return current;
}

/** The text of a string literal or a template literal with no substitution, or undefined for anything else. */
function literalText(node: ts.Expression): string | undefined {
	const inner = unwrap(node);

	return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)
		? inner.text
		: undefined;
}

/** True for `import.meta.glob` and `import.meta.globEager`, the call's callee. */
function isImportMetaGlob(node: ts.Expression): boolean {
	return (
		ts.isPropertyAccessExpression(node) &&
		ts.isMetaProperty(node.expression) &&
		node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
		(node.name.text === "glob" || node.name.text === "globEager")
	);
}

/** True for `import.meta.url`. */
function isImportMetaUrl(node: ts.Expression): boolean {
	const inner = unwrap(node);

	return (
		ts.isPropertyAccessExpression(inner) &&
		ts.isMetaProperty(inner.expression) &&
		inner.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
		inner.name.text === "url"
	);
}

/**
 * Every load a source text makes: static imports and re-exports, `import x = require()`, `require()`, `import()`,
 * `import.meta.glob()` and `new URL("...", import.meta.url)` (how a worker is named). A load whose argument is a real
 * expression comes back as unresolved.
 */
function loadsOf(file: string, text: string): Load[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const found: Load[] = [];

	const lineOf = (node: ts.Node) =>
		source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

	const add = (
		node: ts.Node,
		argument: ts.Expression | undefined,
		what: string,
	) => {
		const literal = argument && literalText(argument);

		if (literal !== undefined)
			found.push({ kind: "module", specifier: literal, line: lineOf(node) });
		else
			found.push({
				kind: "unresolved",
				reason: `${what} with an argument that is not a literal`,
				line: lineOf(node),
			});
	};

	const visit = (node: ts.Node) => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			bringsCode(node)
		)
			found.push({
				kind: "module",
				specifier: node.moduleSpecifier.text,
				line: lineOf(node),
			});

		if (
			ts.isImportEqualsDeclaration(node) &&
			!node.isTypeOnly &&
			ts.isExternalModuleReference(node.moduleReference)
		)
			add(node, node.moduleReference.expression, "import = require()");

		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const [argument] = node.arguments;

			if (callee.kind === ts.SyntaxKind.ImportKeyword)
				add(node, argument, "import()");
			else if (ts.isIdentifier(callee) && callee.text === "require")
				add(node, argument, "require()");
			else if (isImportMetaGlob(callee)) {
				const patterns = argument && globPatternsOf(argument);

				if (patterns)
					for (const pattern of patterns)
						found.push({ kind: "glob", pattern, line: lineOf(node) });
				else
					found.push({
						kind: "unresolved",
						reason: "import.meta.glob() with a pattern that is not a literal",
						line: lineOf(node),
					});
			}
		}

		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "URL" &&
			node.arguments?.length === 2 &&
			isImportMetaUrl(node.arguments[1])
		)
			add(node, node.arguments[0], "new URL(..., import.meta.url)");

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
}

/** The literal patterns of an `import.meta.glob` first argument (a string, or an array of strings), or undefined. */
function globPatternsOf(argument: ts.Expression): string[] | undefined {
	const single = literalText(argument);

	if (single !== undefined) return [single];
	const inner = unwrap(argument);

	if (!ts.isArrayLiteralExpression(inner)) return undefined;
	const texts = inner.elements.map((element) => literalText(element));

	return texts.every((text) => text !== undefined) ? texts : undefined;
}

/** The script text of a file: a .ts file whole, an .astro file's <script> blocks (never its frontmatter). */
function clientText(file: string): string {
	const text = readFileSync(file, "utf8");

	if (!file.endsWith(".astro")) return text;
	const markup = text.replace(FRONTMATTER, "");

	return [...markup.matchAll(SCRIPT_BLOCK)].map((block) => block[1]).join("\n");
}

/** True when `specifier` is a forbidden package (or something under it) that `allow` does not name exactly. */
function isForbiddenPackage(specifier: string, allow: readonly string[]) {
	if (allow.includes(specifier)) return false;

	return FORBIDDEN_MODULES.some(
		(name) => specifier === name || specifier.startsWith(`${name}/`),
	);
}

/** True when `path` is a file under src/server. */
function isServerFile(path: string, root: string) {
	return (path + sep).startsWith(join(root, "src", "server") + sep);
}

/** The path a relative, root-absolute (`/src/...`) or aliased specifier names, without looking at the file system. */
function basePath(
	specifier: string,
	from: string,
	root: string,
	aliases: Map<string, string>,
): string | undefined {
	const bare = specifier.split("?")[0];

	for (const [prefix, directory] of aliases)
		if (bare.startsWith(prefix))
			return join(directory, bare.slice(prefix.length));

	if (bare.startsWith(".")) return resolve(dirname(from), bare);

	if (bare.startsWith("/")) return join(root, bare);

	return undefined;
}

/** The file a relative, root-absolute or aliased specifier names, or undefined for a package or a file that is not code. */
function resolveSpecifier(
	specifier: string,
	from: string,
	root: string,
	aliases: Map<string, string>,
): string | undefined {
	const base = basePath(specifier, from, root, aliases);

	if (!base) return undefined;
	const swap = TYPESCRIPT_OF.find(([js]) => base.endsWith(js));

	const candidates = [
		base,
		...(swap
			? swap[1].map((extension) => base.slice(0, -swap[0].length) + extension)
			: []),
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

/** The files an `import.meta.glob` pattern matches: relative to the file, from the root (`/`), or through an alias. */
function expandGlob(
	pattern: string,
	from: string,
	root: string,
	aliases: Map<string, string>,
): string[] {
	if (pattern.startsWith("!")) return [];
	const [bare] = pattern.split("?");
	const aliased = [...aliases].find(([prefix]) => bare.startsWith(prefix));

	const [cwd, relativePattern] = aliased
		? [aliased[1], bare.slice(aliased[0].length)]
		: bare.startsWith("/")
			? [root, bare.slice(1)]
			: [dirname(from), bare];

	return globSync(relativePattern, { cwd })
		.map((match) => resolve(cwd, match))
		.filter(
			(match) =>
				statSync(match).isFile() &&
				[...EXTENSIONS, ".astro"].some((extension) =>
					match.endsWith(extension),
				),
		);
}

/** The client entry files under `root`: src/scripts/** and every .astro file under src that has a <script> block. */
export function clientEntries(root: string): string[] {
	const scripts = filesUnder(join(root, "src", "scripts"), EXTENSIONS);

	const pages = filesUnder(join(root, "src"), [".astro"]).filter(
		(file) => clientText(file).trim() !== "",
	);

	return [...scripts, ...pages];
}

/**
 * Walks the import graph from every client entry under `root` and lists each load of a forbidden module
 * (FORBIDDEN_MODULES, except those named in `allow`) or of anything under src/server that a reachable module makes: by
 * import, re-export, `import = require`, `require`, `import()` (a string or template literal), `import.meta.glob` (its
 * pattern expanded against the file system) or `new URL(..., import.meta.url)`. Type-only imports do not count. A load
 * the walker cannot resolve statically comes back as an UnresolvedLoad naming the file and line, and counts as a failure.
 */
export function clientGraphViolations(
	root: string,
	allow: readonly string[] = [],
): (ClientGraphViolation | UnresolvedLoad)[] {
	const aliases = aliasesOf(root);
	const violations: (ClientGraphViolation | UnresolvedLoad)[] = [];
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

			for (const load of loadsOf(current.file, clientText(current.file))) {
				const targets: { text: string; file?: string }[] =
					load.kind === "module"
						? [
								{
									text: load.specifier,
									file: resolveSpecifier(
										load.specifier,
										current.file,
										root,
										aliases,
									),
								},
							]
						: load.kind === "glob"
							? expandGlob(load.pattern, current.file, root, aliases).map(
									(file) => ({ text: load.pattern, file }),
								)
							: [];

				if (load.kind === "unresolved")
					violations.push({
						import: "<unresolved>",
						chain: current.chain,
						line: load.line,
						reason: load.reason,
					});

				for (const { text, file } of targets) {
					if (
						isForbiddenPackage(text, allow) ||
						(file !== undefined && isServerFile(file, root))
					)
						violations.push({ import: text, chain: current.chain });
					else if (file && !file.endsWith(".astro"))
						queue.push({ file, chain: [...current.chain, shown(file)] });
				}
			}
		}
	}

	return violations;
}
