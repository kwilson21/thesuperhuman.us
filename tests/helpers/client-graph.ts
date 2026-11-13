import {
	existsSync,
	globSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
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
	"xstate",
	"zod",
	"stripe",
	"resend",
	"pdf-lib",
];

/**
 * Zod v3 through `astro/zod` still validates in the browser in three modules (audio intake, software inquiry, agreement
 * client details). It is the one named exception, until the Zod to Effect Schema PR removes it and this entry with it.
 * `astro` depends on `zod`, so the exception also covers the dependency walk for this specifier only.
 */
export const ALLOWED_BROWSER_MODULES: readonly string[] = ["astro/zod"];

/** What a walk reached: every file (paths relative to the root) and every package (by name) any client entry loads. */
export type Reached = { files: Set<string>; packages: Set<string> };

// An opening tag may hold a ">" inside a quoted attribute value.
const SCRIPT_BLOCK =
	/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/script>/g;

// One attribute of an opening tag: a name, and a double-quoted, single-quoted or unquoted value when it has one.
const ATTRIBUTE =
	/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

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

/**
 * What a module specifier may stand for besides itself: a tsconfig.json `paths` entry or a package.json `imports` entry.
 * `pattern` may hold one `*`; every target (all of them, not only the first) replaces its `*` with what the pattern's
 * `*` matched. A target is an absolute path, or a bare specifier (only an `imports` entry may name a package).
 */
type Alias = { pattern: string; targets: string[] };

/** Every string in a package.json `imports` value: a target, or the targets of a condition object or an array. */
function importTargets(value: Schema.Json): string[] {
	if (Predicate.isString(value)) return [value];

	if (Array.isArray(value)) return value.flatMap(importTargets);

	return isJsonObject(value) ? Object.values(value).flatMap(importTargets) : [];
}

const isJsonObject = Schema.is(Schema.JsonObject);

/** What of a package.json the walker reads: its `imports`. */
const Manifest = Schema.Struct({
	imports: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});

/** The tsconfig.json `paths` and the package.json `imports` of the root, as aliases. */
function aliasesOf(root: string): Alias[] {
	const parsed = ts.parseConfigFileTextToJson(
		"tsconfig.json",
		readFileSync(join(root, "tsconfig.json"), "utf8"),
	);

	const options: { baseUrl?: string; paths?: Record<string, string[]> } =
		parsed.config?.compilerOptions ?? {};

	const base = resolve(root, options.baseUrl ?? ".");

	const aliases: Alias[] = Object.entries(options.paths ?? {}).map(
		([pattern, targets]) => ({
			pattern,
			targets: targets.map((target) => resolve(base, target)),
		}),
	);

	const manifest = join(root, "package.json");

	if (existsSync(manifest)) {
		const read = Schema.decodeUnknownResult(Manifest)(
			JSON.parse(readFileSync(manifest, "utf8")),
		);

		if (Result.isFailure(read))
			throw new Error(
				`Cannot read the imports of ${manifest}: ${read.failure.message}`,
			);

		for (const [pattern, value] of Object.entries(read.success.imports ?? {}))
			aliases.push({
				pattern,
				targets: importTargets(value).map((target) =>
					target.startsWith(".") ? resolve(root, target) : target,
				),
			});
	}

	return aliases;
}

/** What `specifier` matches in `alias`: the text its `*` stood for ("" with no `*`), or undefined when it does not match. */
function matchAlias(alias: Alias, specifier: string): string | undefined {
	const star = alias.pattern.indexOf("*");

	if (star === -1) return alias.pattern === specifier ? "" : undefined;
	const prefix = alias.pattern.slice(0, star);
	const suffix = alias.pattern.slice(star + 1);

	return specifier.length >= prefix.length + suffix.length &&
		specifier.startsWith(prefix) &&
		specifier.endsWith(suffix)
		? specifier.slice(prefix.length, specifier.length - suffix.length)
		: undefined;
}

/** Every target of every alias that matches `specifier`, with the matched text put in. */
function aliasTargets(aliases: Alias[], specifier: string): string[] {
	return aliases.flatMap((alias) => {
		const matched = matchAlias(alias, specifier);

		return matched === undefined
			? []
			: alias.targets.map((target) => target.replace("*", matched));
	});
}

/** True when an import brings code into the module: not `import type`, and not every specifier marked `type`. */
function bringsCode(node: ts.ImportDeclaration | ts.ExportDeclaration) {
	if (ts.isExportDeclaration(node)) {
		const exported = node.exportClause;

		// `export type { A }` and `export { type A }` are erased; `export *` and `export * as N` are not.
		if (node.isTypeOnly) return false;

		return !(
			exported &&
			ts.isNamedExports(exported) &&
			exported.elements.length > 0 &&
			exported.elements.every((element) => element.isTypeOnly)
		);
	}

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
function loadsOf(file: string, text: string, includeTypes = false): Load[] {
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
			(includeTypes || bringsCode(node))
		)
			found.push({
				kind: "module",
				specifier: node.moduleSpecifier.text,
				line: lineOf(node),
			});

		if (
			ts.isImportEqualsDeclaration(node) &&
			(includeTypes || !node.isTypeOnly) &&
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

/**
 * The value of the `src` attribute of an opening `<script ...>` tag, or undefined when it has none. Attribute names are
 * read whole and compared without regard to case, so `data-src` and `ng-src` are not `src`; a quoted value that holds
 * text like ` src=` is one value, never another attribute.
 */
function scriptSrc(open: string): string | undefined {
	for (const attribute of open.slice("<script".length).matchAll(ATTRIBUTE)) {
		const [, name, double, single, bare] = attribute;
		const value = double ?? single ?? bare;

		if (name.toLowerCase() === "src" && value !== undefined) return value;
	}

	return undefined;
}

/** The text with every character but the line breaks removed: it keeps the line numbers of what follows. */
const blank = (text: string) => text.replace(/[^\n]/g, "");

/**
 * The script text of a file: a .ts file whole; an .astro file's <script> blocks, never its frontmatter, each at the
 * line it has in the file, and a `<script src="...">` as the import of that file. Every <script> counts, including one
 * with `is:inline`, `define:vars` or an unusual `type` (which Astro leaves inline) and one inside an HTML comment: a
 * file that trips this on purpose is a false positive to fix, never a case to wave through.
 */
function clientText(file: string): string {
	return scriptTextOf(file, readFileSync(file, "utf8"));
}

/** `clientText` for a source text already read. */
function scriptTextOf(file: string, text: string): string {
	if (!file.endsWith(".astro")) return text;
	const markup = text.replace(FRONTMATTER, blank);
	let result = "";
	let last = 0;

	for (const block of markup.matchAll(SCRIPT_BLOCK)) {
		const [whole, open, inner] = block;
		const source = scriptSrc(open);

		result += blank(markup.slice(last, block.index)) + blank(open);
		result +=
			source === undefined
				? inner
				: `import ${JSON.stringify(source)};${blank(inner)}`;
		last = block.index + whole.length;
	}

	return result + blank(markup.slice(last));
}

/**
 * Every module specifier a source text names, type-only imports included: static imports and re-exports, `import = require`,
 * `require()` and `import()` with a literal. For an .astro file, the frontmatter and the <script> blocks (never the markup).
 * Parsed with the TypeScript parser, so comments between tokens and text inside strings do not matter.
 */
export function specifiersOf(file: string, text: string): string[] {
	const texts = file.endsWith(".astro")
		? [FRONTMATTER.exec(text)?.[0] ?? "", scriptTextOf(file, text)]
		: [text];

	return texts.flatMap((part) =>
		loadsOf(file, part, true).flatMap((load) =>
			load.kind === "module" ? [load.specifier] : [],
		),
	);
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

/** The file a path names (with a TypeScript or index file standing in for it), or undefined when none is code. */
function codeFileAt(base: string): string | undefined {
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

/** True for a specifier that names something fetched from elsewhere (a URL, a data: URI): never part of the bundle. */
function isExternal(specifier: string) {
	return /^(https?:|data:|\/\/)/.test(specifier);
}

/** The package a bare specifier names: `effect/Schema` is `effect`, `@scope/name/x` is `@scope/name`. */
function packageOf(specifier: string): string {
	const [first, second] = specifier.split("/");

	return first.startsWith("@") && second ? `${first}/${second}` : first;
}

/** The directory named for the package under a node_modules of `from`'s directory or above it, or undefined. */
function packageDirectory(name: string, from: string): string | undefined {
	for (let directory = dirname(from); ; directory = dirname(directory)) {
		const path = join(directory, "node_modules", name);

		if (existsSync(path) && statSync(path).isDirectory()) return path;

		if (dirname(directory) === directory) return undefined;
	}
}

/** True when a directory named for the package exists under a node_modules of `from`'s directory or above it. */
function isInstalled(name: string, from: string): boolean {
	return packageDirectory(name, from) !== undefined;
}

// The dependency fields that put a package's code in the bundle of whatever imports it.
const DEPENDENCY_FIELDS = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/** The package names a package.json lists under DEPENDENCY_FIELDS, or none when it cannot be read. */
function dependenciesOf(manifest: string): string[] {
	if (!existsSync(manifest)) return [];

	const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));

	if (!isJsonObject(parsed)) return [];

	return DEPENDENCY_FIELDS.flatMap((field) => {
		const listed = parsed[field];

		return isJsonObject(listed) ? Object.keys(listed) : [];
	});
}

/** An installed package's dependency on a forbidden module: which one, and the package.json files that lead to it. */
type Dependency = { forbidden: string; via: string[] };

/**
 * Whether the installed package `name` (found from `from`) depends on a forbidden module, directly or through the
 * packages it depends on. A package that is not installed ends the search: nothing of it can be read. `visited` stops a
 * dependency cycle; the directories are real paths, so pnpm's symlinks do not hide a package that was seen.
 */
function dependencyOnForbidden(
	name: string,
	from: string,
	allow: readonly string[],
	visited: Set<string>,
): Dependency | undefined {
	const directory = packageDirectory(packageOf(name), from);

	if (directory === undefined) return undefined;
	const real = realpathSync(directory);

	if (visited.has(real)) return undefined;
	visited.add(real);
	const manifest = join(real, "package.json");

	const dependencies = dependenciesOf(manifest);

	const direct = dependencies.find((dependency) =>
		isForbiddenPackage(dependency, allow),
	);

	if (direct !== undefined) return { forbidden: direct, via: [manifest] };

	for (const dependency of dependencies) {
		const deeper = dependencyOnForbidden(dependency, manifest, allow, visited);

		if (deeper)
			return { forbidden: deeper.forbidden, via: [manifest, ...deeper.via] };
	}

	return undefined;
}

/** What one specifier leads to: files to walk, bare names to judge, and a reason when it cannot be followed. */
type Resolved = { files: string[]; names: string[]; unresolved?: string };

/**
 * Where a specifier goes. A relative one is resolved from the file, a root-absolute one (`/src/...`) from the root, any
 * other root-relative URL (`/client.js`, as in `<script src>`) from public/ (unresolved when no code file is there), an
 * aliased one (tsconfig `paths`, package.json `imports`) through EVERY target of every alias that matches, and a bare
 * one is a package. A bare name that is not forbidden must still be a directory under node_modules (a node: built-in
 * aside), or it is unresolved: an alias or an import map the walker cannot read must fail the test, not pass it.
 */
function resolveSpecifier(
	specifier: string,
	from: string,
	root: string,
	aliases: Alias[],
): Resolved {
	const bare = specifier.split("?")[0];

	if (isExternal(bare)) return { files: [], names: [] };

	const bases: string[] = [];
	const names: string[] = [];

	if (bare.startsWith(".")) bases.push(resolve(dirname(from), bare));
	else if (bare.startsWith("/src/")) bases.push(join(root, bare));
	else if (bare.startsWith("/")) {
		// Any other root-relative URL is a file of public/, which Astro copies to the same path in dist/.
		const published = join(root, "public", bare);

		if (
			!existsSync(published) ||
			!statSync(published).isFile() ||
			![...EXTENSIONS].some((extension) => published.endsWith(extension))
		)
			return {
				files: [],
				names: [],
				unresolved: `"${bare}" is a root-relative URL with no code file at public${bare}`,
			};

		bases.push(published);
	} else {
		const targets = aliasTargets(aliases, bare);

		for (const target of targets.length > 0 ? targets : [bare])
			(isAbsolute(target) ? bases : names).push(target);
	}

	// A file under src/server is server code whatever its extension, so it is reported even when no walker reads it.
	const files = bases.flatMap((base) => {
		const code = codeFileAt(base);

		if (code !== undefined) return [code];

		return isServerFile(base, root) ? [base] : [];
	});

	const notInstalled = names.find(
		(name) =>
			!isForbiddenPackage(name, []) &&
			!isBuiltin(name) &&
			!isInstalled(packageOf(name), from),
	);

	return notInstalled === undefined
		? { files, names }
		: {
				files,
				names,
				unresolved: `"${notInstalled}" is not a relative path, an alias, a forbidden package or a package in node_modules`,
			};
}

/** The files an `import.meta.glob` pattern matches: relative to the file, from the root (`/`), or through an alias. */
function expandGlob(
	pattern: string,
	from: string,
	root: string,
	aliases: Alias[],
): string[] {
	if (pattern.startsWith("!")) return [];
	const [bare] = pattern.split("?");

	// A glob names a directory tree, so an alias counts here when its pattern ends in "/*", for each of its targets.
	const aliased = aliases.flatMap((alias) => {
		const matched = alias.pattern.endsWith("/*")
			? matchAlias(alias, bare)
			: undefined;

		return matched === undefined
			? []
			: alias.targets
					.filter((target) => target.endsWith("/*"))
					.map((target): [string, string] => [target.slice(0, -1), matched]);
	});

	const places: [string, string][] =
		aliased.length > 0
			? aliased
			: bare.startsWith("/")
				? [[root, bare.slice(1)]]
				: [[dirname(from), bare]];

	return places.flatMap(([cwd, relativePattern]) =>
		globSync(relativePattern, { cwd })
			.map((match) => resolve(cwd, match))
			.filter(
				(match) =>
					statSync(match).isFile() &&
					(isServerFile(match, root) ||
						[...EXTENSIONS, ".astro"].some((extension) =>
							match.endsWith(extension),
						)),
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
	reached?: Reached,
): (ClientGraphViolation | UnresolvedLoad)[] {
	const aliases = aliasesOf(root);
	const violations: (ClientGraphViolation | UnresolvedLoad)[] = [];
	const dependencies = new Map<string, Dependency | undefined>();
	const seen = new Set<string>();
	const shown = (file: string) => relative(root, file).split(sep).join("/");
	// A package's files are reached through real paths (symlinks resolved), so show them against the real root.
	const realRoot = realpathSync(root);

	const shownReal = (file: string) =>
		relative(realRoot, file).split(sep).join("/");

	for (const entry of clientEntries(root)) {
		const queue: { file: string; chain: string[] }[] = [
			{ file: entry, chain: [shown(entry)] },
		];

		while (queue.length > 0) {
			const current = queue.shift();

			if (!current || seen.has(`${entry}|${current.file}`)) continue;
			seen.add(`${entry}|${current.file}`);
			reached?.files.add(shown(current.file));

			for (const load of loadsOf(current.file, clientText(current.file))) {
				if (load.kind === "unresolved") {
					violations.push({
						import: "<unresolved>",
						chain: current.chain,
						line: load.line,
						reason: load.reason,
					});
					continue;
				}

				const found: Resolved =
					load.kind === "module"
						? resolveSpecifier(load.specifier, current.file, root, aliases)
						: {
								files: expandGlob(load.pattern, current.file, root, aliases),
								names: [],
							};

				const text = load.kind === "module" ? load.specifier : load.pattern;

				for (const name of found.names)
					if (!isBuiltin(name)) reached?.packages.add(packageOf(name));

				if (found.unresolved !== undefined)
					violations.push({
						import: text,
						chain: current.chain,
						line: load.line,
						reason: found.unresolved,
					});

				const forbidden =
					[text, ...found.names].some((name) =>
						isForbiddenPackage(name, allow),
					) || found.files.some((file) => isServerFile(file, root));

				if (forbidden) violations.push({ import: text, chain: current.chain });

				// An installed package browser code imports must not depend on Effect either: its own imports are in the bundle.
				for (const name of found.names) {
					if (
						isForbiddenPackage(name, allow) ||
						allow.includes(name) ||
						isBuiltin(name)
					)
						continue;

					const directory = packageDirectory(packageOf(name), current.file);

					if (directory === undefined) continue;
					const key = realpathSync(directory);

					if (!dependencies.has(key))
						dependencies.set(
							key,
							dependencyOnForbidden(name, current.file, allow, new Set()),
						);

					const dependency = dependencies.get(key);

					if (dependency)
						violations.push({
							import: dependency.forbidden,
							chain: [
								...current.chain,
								...dependency.via.map((file) => shownReal(file)),
							],
						});
				}

				for (const file of found.files)
					if (!isServerFile(file, root) && !file.endsWith(".astro"))
						queue.push({ file, chain: [...current.chain, shown(file)] });
			}
		}
	}

	return violations;
}
