import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MANIFEST_PATH } from "../../scripts/client-bundle-manifest.mjs";

/** What scripts/client-bundle-manifest.mjs writes for the client build: the modules in every browser chunk. */
export type ClientManifest = {
	version: 1;
	/** Installed version of each package that supplied a module. */
	packages: Record<string, string>;
	chunks: { file: string; sha256: string; tail: string; modules: string[] }[];
	/** Modules the bundler included but no chunk renders (data folded into the code that uses it). */
	unrendered: string[];
};

export { MANIFEST_PATH };

/**
 * Packages the browser must never load, by name or `name/...`, and what the failure says. Zod is checked by version
 * separately (v3 ships as `astro/zod`; v4 is a server validator).
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
 * BROWSER_PACKAGES in client-bundle.test.ts and a prefix such as "npm:effect/dist/Schema" here.
 */
export const ALLOWED_FORBIDDEN_PREFIXES: readonly string[] = [];

const NPM = "npm:";

/** The package a `npm:` label names, scoped or not. */
export function packageOf(label: string): string | undefined {
	return label.startsWith(NPM)
		? label.slice(NPM.length).match(/^(@[^/]+\/)?[^/]+/)?.[0]
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

const isRepoFile = (module: string) =>
	!module.startsWith(NPM) &&
	!module.startsWith("outside:") &&
	!module.includes(":") &&
	!module.startsWith("\0");

/**
 * What the manifest says that a reviewer did not allow. `repoModules` is the exact set of src/lib and src/data
 * files browser code holds; `packages` the exact set of installed packages. Browser entries (src/scripts/** and the
 * <script> of an .astro file) are browser code by definition and not listed one by one.
 */
export function bundleViolations(
	manifest: ClientManifest,
	allowed: { repoModules: readonly string[]; packages: readonly string[] },
): string[] {
	const modules = bundledModules(manifest);
	const problems: string[] = [];
	const repoFiles = modules.filter(isRepoFile);
	const held = repoFiles.filter((module) => !isEntry(module));

	for (const module of modules) {
		if (module.startsWith("src/server/"))
			problems.push(`server module in browser code: ${module}`);

		if (
			/^(node:|cloudflare:)/.test(module) ||
			module.includes("__vite-browser-external")
		)
			problems.push(`Node or Cloudflare module in browser code: ${module}`);

		if (module.startsWith("outside:"))
			problems.push(`file outside the repository in browser code: ${module}`);
	}

	for (const module of held.filter(
		(file) => !allowed.repoModules.includes(file),
	))
		if (!module.startsWith("src/server/"))
			problems.push(`repository module not on the reviewed list: ${module}`);

	for (const module of allowed.repoModules.filter(
		(file) => !held.includes(file),
	))
		problems.push(
			`reviewed module no longer in browser code, remove it: ${module}`,
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

		const forbidden =
			FORBIDDEN_PACKAGES.some((f) => name === f || name.startsWith(`${f}/`)) ||
			(name === "zod" && Number(manifest.packages.zod?.split(".")[0]) >= 4);

		if (forbidden)
			problems.push(`forbidden package in browser code: ${name}`);
	}

	return [...new Set(problems)];
}

const sha256 = (path: string) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

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
 * Why the manifest does not describe `dist`: it must hold every script under dist/_astro/ with the same hash, and
 * every chunk it lists that has no file there must be one Astro inlined into a page (its last characters appear in
 * the server manifest under dist/_worker.js/). A manifest from an earlier build, or none, cannot pass.
 */
export function staleManifest(
	manifest: ClientManifest,
	dist: string,
): string[] {
	const problems: string[] = [];
	const byFile = new Map(manifest.chunks.map((chunk) => [chunk.file, chunk]));
	const astro = join(dist, "_astro");
	const scripts = existsSync(astro)
		? filesUnder(astro, dist)
				.filter((file) => /\.m?js$/.test(file))
				.sort()
		: [];

	for (const file of scripts) {
		const chunk = byFile.get(file);

		if (!chunk) problems.push(`${file} is in dist/ but not in the manifest`);
		else if (chunk.sha256 !== sha256(join(dist, file)))
			problems.push(`${file} differs from the chunk the manifest describes`);
	}

	const worker = join(dist, "_worker.js");
	const serverManifests = existsSync(worker)
		? readdirSync(worker)
				.filter((name) => /^manifest_.*\.mjs$/.test(name))
				.map((name) => readFileSync(join(worker, name), "utf8"))
		: [];

	for (const chunk of manifest.chunks.filter(
		(c) => !scripts.includes(c.file),
	)) {
		const escaped = JSON.stringify(chunk.tail).slice(1, -1);

		if (!serverManifests.some((text) => text.includes(escaped)))
			problems.push(
				`${chunk.file} is in the manifest but neither in dist/ nor inlined into a page`,
			);
	}

	return problems;
}
