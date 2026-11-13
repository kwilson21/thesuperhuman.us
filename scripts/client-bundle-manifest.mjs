import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

// Records which modules the real client build put into each browser chunk, for
// tests/architecture/client-bundle.test.ts. The bundler's own list is the guarantee that server code stays out
// of the browser; the source walker in tests/helpers/client-graph.ts only approximates it.
//
// The plugin only reads: it changes no emitted file. It runs in the client build only (the server build holds
// Effect, Stripe and the rest on purpose) and registers `generateBundle` with `order: "pre"`, before Astro's own
// hook. Astro inlines small page scripts into the page (the server manifest's `inlinedScripts`) and deletes their
// chunks from the client bundle in its `generateBundle`; read before that, every chunk is still listed, inlined or
// not (a build of this site emits 44 client chunks, and 32 files remain under dist/_astro/).
//
// The module lists are read in `generateBundle` and the manifest is written in `writeBundle`, where each chunk's hash
// is taken from the code that was written.
//
// The manifest is written to .astro/ (gitignored, a build cache, outside dist/), so it is not part of what the
// Worker's static assets serve (wrangler.jsonc `assets.directory` is ./dist) and not under any deployed path.
// Each chunk carries a hash of its code and the last characters of it, so the test can bind the manifest to the
// dist/ it describes: a script under dist/ must match a chunk here, and a chunk with no file must show up
// inlined in the server manifest.

export const MANIFEST_PATH = ".astro/client-bundle-manifest.json";

const TAIL_LENGTH = 60;

const MARKER = `${sep}node_modules${sep}`;

/** The package an absolute path lies in (the innermost `node_modules`), its directory and the path inside it. */
function packageParts(path) {
	const at = path.lastIndexOf(MARKER);

	if (at === -1) return undefined;

	const [first, second, ...rest] = path.slice(at + MARKER.length).split(sep);
	const scoped = first.startsWith("@");
	const name = scoped ? `${first}/${second}` : first;
	const inside = scoped ? rest : [second, ...rest];

	return {
		name,
		rest: inside,
		directory: path.slice(0, at + MARKER.length) + name,
	};
}

/**
 * The directory of the installed package a module id belongs to (query ignored), or undefined for a repository
 * file or a virtual module.
 *
 * @param {string} id
 */
export function packageDirectory(id) {
	const path = id.includes("?") ? id.slice(0, id.indexOf("?")) : id;

	return path.startsWith("/") ? packageParts(path)?.directory : undefined;
}

/**
 * A stable label for a module id: root-relative for a repository file, `npm:<package>/<path>` for an installed
 * package (pnpm's `.pnpm/<dir>/node_modules/<name>` layout and a plain `node_modules/<name>` alike, the innermost
 * `node_modules` winning), the id itself for a virtual module (`\0vite/...`, `astro:...`), and `outside:<path>` for a
 * file elsewhere on disk. A query (`?raw`, `?astro&type=script`) is dropped: the file is what counts.
 *
 * @param {string} id
 * @param {string} root absolute repository root
 */
export function moduleLabel(id, root) {
	const path = id.includes("?") ? id.slice(0, id.indexOf("?")) : id;

	if (path.startsWith("\0") || !path.startsWith("/")) return path;

	const found = packageParts(path);

	if (found) return `npm:${found.name}/${found.rest.join("/")}`;

	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;

	return path.startsWith(prefix)
		? path.slice(prefix.length)
		: `outside:${path}`;
}

/**
 * @param {string} file the chunk's file name in the bundle
 * @param {{ code: string; modules: Record<string, unknown> }} chunk
 * @param {string} root
 */
export function chunkEntry(file, chunk, root) {
	return {
		file,
		sha256: createHash("sha256").update(chunk.code).digest("hex"),
		tail: chunk.code.trimEnd().slice(-TAIL_LENGTH),
		modules: [
			...new Set(Object.keys(chunk.modules).map((id) => moduleLabel(id, root))),
		].sort(),
	};
}

/**
 * Other plugins rewrite a chunk's code after this plugin's `generateBundle` (Vite adds its preload map to a chunk
 * with a dynamic import), so the hash and tail of a chunk that is written come from the bundle `writeBundle`
 * sees. A chunk Astro inlined into a page was removed from the bundle by then and keeps what was read before.
 *
 * @param {ReturnType<typeof chunkEntry>[]} entries
 * @param {Record<string, { type: string; code?: string }>} written
 */
export function settleChunks(entries, written) {
	return entries.map((entry) => {
		const output = written[entry.file];

		return output?.type === "chunk" && output.code !== undefined
			? {
					...entry,
					sha256: createHash("sha256").update(output.code).digest("hex"),
					tail: output.code.trimEnd().slice(-TAIL_LENGTH),
				}
			: entry;
	});
}

/**
 * Modules the bundler included but no chunk renders: a JSON file or constant whose value was folded into the
 * code that uses it leaves no entry in any chunk's `modules`, yet its data ships. Modules the bundler dropped
 * (not included, such as an import tree-shaken away) are not browser code and are skipped.
 *
 * @param {Iterable<{ modules: Record<string, unknown> }>} chunks
 * @param {Map<string, { isIncluded?: boolean | null } | null>} infos module info by id
 * @param {string} root
 */
export function unrenderedModules(chunks, infos, root) {
	const rendered = new Set(
		[...chunks].flatMap((chunk) => Object.keys(chunk.modules)),
	);

	return [
		...new Set(
			[...infos]
				.filter(([id, info]) => info?.isIncluded && !rendered.has(id))
				.map(([id]) => moduleLabel(id, root)),
		),
	].sort();
}

/**
 * @param {ReturnType<typeof chunkEntry>[]} chunks
 * @param {Record<string, string>} packages installed version of each package that supplied a module
 * @param {string[]} unrendered
 */
export function manifestFromChunks(chunks, packages, unrendered = []) {
	return {
		version: 1,
		packages: Object.fromEntries(
			Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)),
		),
		chunks: [...chunks].sort((a, b) => a.file.localeCompare(b.file)),
		unrendered,
	};
}

/** @returns {import("vite").Plugin} */
export function clientBundleManifest() {
	let root = process.cwd();
	/** @type {ReturnType<typeof manifestFromChunks> | undefined} */
	let read;

	return {
		name: "client-bundle-manifest",
		apply: "build",
		configResolved(config) {
			root = config.root;
		},
		generateBundle: {
			order: "pre",
			handler(_options, bundle) {
				if (this.environment?.name !== "client") return;

				const outputs = Object.values(bundle).flatMap((output) =>
					output.type === "chunk" ? [output] : [],
				);
				const chunks = Object.entries(bundle).flatMap(([file, output]) =>
					output.type === "chunk" ? [chunkEntry(file, output, root)] : [],
				);
				const infos = new Map(
					[...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)]),
				);
				const ids = new Set([
					...outputs.flatMap((output) => Object.keys(output.modules)),
					...[...infos].flatMap(([id, info]) => (info?.isIncluded ? [id] : [])),
				]);
				const packages = {};

				for (const id of ids) {
					const directory = packageDirectory(id);
					const name = moduleLabel(id, root).match(
						/^npm:((?:@[^/]+\/)?[^/]+)/,
					)?.[1];

					if (directory && name && !(name in packages))
						packages[name] = JSON.parse(
							readFileSync(join(directory, "package.json"), "utf8"),
						).version;
				}

				read = manifestFromChunks(
					chunks,
					packages,
					unrenderedModules(outputs, infos, root),
				);
			},
		},
		writeBundle(_options, bundle) {
			if (this.environment?.name !== "client" || !read) return;

			const path = join(root, MANIFEST_PATH);

			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(
				path,
				`${JSON.stringify({ ...read, chunks: settleChunks(read.chunks, bundle) }, null, "\t")}\n`,
			);
		},
	};
}
