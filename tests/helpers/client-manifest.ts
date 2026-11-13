import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MANIFEST_PATH } from "../../scripts/client-bundle-manifest.mjs";

/** What scripts/client-bundle-manifest.mjs writes for the client build: the modules in every browser chunk. */
export type ClientManifest = {
	version: 2;
	chunks: {
		file: string;
		/** Hash of the code as written to dist/. */
		sha256: string;
		/** Hash of the trimmed code: the text Astro inlines into a page. */
		trimmedSha256: string;
		modules: string[];
	}[];
	/** Modules the bundler included but no chunk renders (data folded into the code that uses it). */
	unrendered: string[];
};

export { MANIFEST_PATH };

/**
 * Packages the browser must never load, by name or `name/...`. Zod is checked by version separately (v3 ships as
 * `astro/zod`; v4 is a server validator).
 */
export const FORBIDDEN_PACKAGES: readonly string[] = [
	"stripe",
	"resend",
	"pdf-lib",
	"xstate",
	"@xstate",
	"effect",
	"@effect",
];

/**
 * A module id with one of these prefixes is exempt from the forbidden-package check (but still needs its package in
 * the reviewed list). This is where `effect/Schema` goes when the browser is allowed to load it: add the package to
 * BROWSER_PACKAGES in browser-modules.ts and a prefix such as "npm:effect@" here (a prefix names a package and may
 * name its version: "npm:effect@4.1.0/dist/Schema").
 */
export const ALLOWED_FORBIDDEN_PREFIXES: readonly string[] = [];

const NPM = "npm:";

/** The package a `npm:<name>@<version>/<path>` label names, scoped or not. */
export function packageOf(label: string): string | undefined {
	return label.startsWith(NPM)
		? label.slice(NPM.length).match(/^(@[^/@]+\/)?[^/@]+/)?.[0]
		: undefined;
}

/** The installed version a `npm:<name>@<version>/<path>` label names, when it carries one. */
export function versionOf(label: string): string | undefined {
	const name = packageOf(label);

	return name
		? label.slice(NPM.length + name.length).match(/^@([^/]+)/)?.[1]
		: undefined;
}

/** Every distinct module label in browser code: those in a chunk and those folded into one. Sorted. */
export function bundledModules(manifest: ClientManifest): string[] {
	return [
		...new Set([
			...manifest.chunks.flatMap((chunk) => chunk.modules),
			...manifest.unrendered,
		]),
	].sort();
}

const isEntry = (module: string) =>
	module.startsWith("src/scripts/") ||
	(module.startsWith("src/") && module.endsWith(".astro"));

const isBuiltin = (module: string) => /^(node:|cloudflare:)/.test(module);

const isVirtual = (module: string) =>
	!module.startsWith(NPM) &&
	!module.startsWith("outside:") &&
	(module.startsWith("\0") || module.includes(":"));

const isRepoFile = (module: string) =>
	!module.startsWith(NPM) &&
	!module.startsWith("outside:") &&
	!isVirtual(module);

/** True when `name` at `version` is a package browser code must not hold. */
function forbidden(name: string, version: string | undefined): boolean {
	if (FORBIDDEN_PACKAGES.some((f) => name === f || name.startsWith(`${f}/`)))
		return true;

	// Zod v3 (astro/zod) is allowed; v4, or a version the label does not carry, is not.
	return name === "zod" && !(version && Number(version.split(".")[0]) < 4);
}

/**
 * What the manifest says that a reviewer did not allow. `repoModules` is the exact set of src/lib and src/data
 * files browser code holds; `packages` the exact set of installed package names; `virtualModules` the exact set of
 * virtual module ids (`\0...`, `astro:...`, `virtual:...`). Browser entries (src/scripts/** and the <script> of an
 * .astro file) are browser code by definition and not listed one by one. Every installed version that contributed
 * a module is checked (a label names the version of its own package directory).
 */
export function bundleViolations(
	manifest: ClientManifest,
	allowed: {
		repoModules: readonly string[];
		packages: readonly string[];
		virtualModules: readonly string[];
	},
): string[] {
	const modules = bundledModules(manifest);
	const problems: string[] = [];
	const held = modules.filter(isRepoFile).filter((module) => !isEntry(module));
	const virtuals = modules.filter(isVirtual).filter((m) => !isBuiltin(m));

	for (const module of modules) {
		if (module.startsWith("src/server/"))
			problems.push(`server module in browser code: ${module}`);

		if (isBuiltin(module) || module.includes("__vite-browser-external"))
			problems.push(`Node or Cloudflare module in browser code: ${module}`);

		if (module.startsWith("outside:"))
			problems.push(`file outside the repository in browser code: ${module}`);
	}

	for (const module of held.filter((m) => !allowed.repoModules.includes(m)))
		if (!module.startsWith("src/server/"))
			problems.push(`repository module not on the reviewed list: ${module}`);

	for (const module of allowed.repoModules.filter((m) => !held.includes(m)))
		problems.push(
			`reviewed module no longer in browser code, remove it: ${module}`,
		);

	for (const module of virtuals.filter(
		(m) =>
			!allowed.virtualModules.includes(m) &&
			!m.includes("__vite-browser-external"),
	))
		problems.push(`virtual module not on the reviewed list: ${module}`);

	for (const module of allowed.virtualModules.filter(
		(m) => !virtuals.includes(m),
	))
		problems.push(
			`reviewed virtual module no longer in browser code, remove it: ${module}`,
		);

	const names = [
		...new Set(modules.flatMap((module) => packageOf(module) ?? [])),
	].sort();

	for (const name of names.filter((n) => !allowed.packages.includes(n)))
		problems.push(`package not on the reviewed list: ${name}`);

	for (const name of allowed.packages.filter((n) => !names.includes(n)))
		problems.push(
			`reviewed package no longer in browser code, remove it: ${name}`,
		);

	for (const module of modules) {
		const name = packageOf(module);

		if (
			!name ||
			ALLOWED_FORBIDDEN_PREFIXES.some((prefix) => module.startsWith(prefix))
		)
			continue;

		const version = versionOf(module);

		if (forbidden(name, version))
			problems.push(
				`forbidden package in browser code: ${name}${version ? `@${version}` : ""}`,
			);
	}

	return [...new Set(problems)];
}

const sha256 = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");

/** Every file under `directory`, as paths relative to `base`. */
function filesUnder(directory: string, base: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		return entry.isDirectory()
			? filesUnder(path, base)
			: [relative(base, path)];
	});
}

/**
 * The `inlinedScripts` of an Astro server manifest (dist/_worker.js/manifest_*.mjs): the exact text Astro inlines
 * into pages, with the id of the script it came from. Read by scanning the balanced array after the key, strings
 * included, and parsing it as JSON (the manifest serializes the entries with JSON.stringify, so any escaping Astro
 * applies is undone by the parse).
 */
export function inlinedScripts(text: string): { id: string; code: string }[] {
	const key = '"inlinedScripts":';
	const at = text.indexOf(key);

	if (at === -1) return [];

	const start = at + key.length;
	let depth = 0;
	let inString = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];

		if (inString) {
			if (char === "\\") i++;
			else if (char === '"') inString = false;
		} else if (char === '"') inString = true;
		else if (char === "[") depth++;
		else if (char === "]" && --depth === 0)
			return (JSON.parse(text.slice(start, i + 1)) as [string, string][]).map(
				([id, code]) => ({ id, code }),
			);
	}

	throw new Error("inlinedScripts is not a balanced array");
}

/**
 * Why the manifest does not describe `dist`:
 * - every .js or .mjs file under dist/ outside the worker output (dist/_worker.js/) must match a manifest chunk
 *   by file name and hash, or be a copied public script on `publicScripts` (file path to content hash, a reviewed
 *   list: a change forces a review) with that hash;
 * - every manifest chunk with no file must be one Astro inlined into a page: its trimmed code hash must equal the
 *   hash of an entry of the server manifest's `inlinedScripts`;
 * - and every entry of `inlinedScripts` must match such a chunk, so a script inlined into a page that the plugin
 *   never recorded (emitted by a hook that ran after it) fails.
 * A manifest from an earlier build, or none, cannot pass.
 */
export function staleManifest(
	manifest: ClientManifest,
	dist: string,
	publicScripts: Readonly<Record<string, string>> = {},
): string[] {
	const problems: string[] = [];
	const byFile = new Map(manifest.chunks.map((chunk) => [chunk.file, chunk]));

	const scripts = filesUnder(dist, dist)
		.filter((file) => /\.m?js$/.test(file) && !file.startsWith("_worker.js/"))
		.sort();

	for (const file of scripts) {
		const hash = sha256(readFileSync(join(dist, file)));
		const chunk = byFile.get(file);

		if (chunk) {
			if (chunk.sha256 !== hash)
				problems.push(`${file} differs from the chunk the manifest describes`);
		} else if (file in publicScripts) {
			if (publicScripts[file] !== hash)
				problems.push(
					`${file} is a public script whose content changed: review it and update its hash`,
				);
		} else
			problems.push(
				`${file} is a browser script in dist/ that is neither in the manifest nor a reviewed public script`,
			);
	}

	for (const file of Object.keys(publicScripts).filter(
		(f) => !scripts.includes(f),
	))
		problems.push(`reviewed public script ${file} is not in dist/, remove it`);

	const worker = join(dist, "_worker.js");

	const inlined = existsSync(worker)
		? readdirSync(worker)
				.filter((name) => /^manifest_.*\.mjs$/.test(name))
				.flatMap((name) =>
					inlinedScripts(readFileSync(join(worker, name), "utf8")),
				)
		: [];

	const inlinedHashes = new Set(inlined.map((script) => sha256(script.code)));

	const unwritten = manifest.chunks.filter(
		(chunk) => !scripts.includes(chunk.file),
	);

	for (const chunk of unwritten.filter(
		(c) => !inlinedHashes.has(c.trimmedSha256),
	))
		problems.push(
			`${chunk.file} is in the manifest but neither in dist/ nor inlined into a page`,
		);

	const recorded = new Set(unwritten.map((chunk) => chunk.trimmedSha256));

	for (const script of inlined.filter((s) => !recorded.has(sha256(s.code))))
		problems.push(
			`an inlined script (${script.id.split("/").slice(-1)[0]}) has no chunk in the manifest`,
		);

	return problems;
}
