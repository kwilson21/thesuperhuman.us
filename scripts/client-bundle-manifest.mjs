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
// not (a build of this site emits 44 client chunks, and 32 files remain under dist/_astro/). A chunk that a later
// hook emits and Astro then inlines would be missed here; the test closes that by requiring every entry of the
// server manifest's `inlinedScripts` to match a recorded chunk.
//
// The module lists are read in `generateBundle` and the manifest is written in `writeBundle`, where each chunk's hash
// is taken from the code that was written.
//
// The manifest is written to .astro/ (gitignored, a build cache, outside dist/), so it is not part of what the
// Worker's static assets serve (wrangler.jsonc `assets.directory` is ./dist) and not under any deployed path.
// Each chunk carries a hash of its code (and of its trimmed code, which is the text Astro inlines), so the test can
// bind the manifest to the dist/ it describes.

export const MANIFEST_PATH = ".astro/client-bundle-manifest.json";

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
 * A stable label for a module id: root-relative for a repository file, `npm:<package>@<version>/<path>` for an
 * installed package (the version of that very package directory, so two installed versions never share a label;
 * pnpm's `.pnpm/<dir>/node_modules/<name>` layout and a plain `node_modules/<name>` alike, the innermost
 * `node_modules` winning), the id itself for a virtual module (`\0vite/...`, `astro:...`), and `outside:<path>` for a
 * file elsewhere on disk. A query (`?raw`, `?astro&type=script`) is dropped: the file is what counts.
 *
 * @param {string} id
 * @param {string} root absolute repository root
 * @param {(directory: string) => string | undefined} [versionOf] installed version of a package directory
 */
export function moduleLabel(id, root, versionOf = () => undefined) {
	const path = id.includes("?") ? id.slice(0, id.indexOf("?")) : id;

	if (path.startsWith("\0") || !path.startsWith("/")) return path;

	const found = packageParts(path);

	if (found) {
		const version = versionOf(found.directory);

		return `npm:${found.name}${version ? `@${version}` : ""}/${found.rest.join("/")}`;
	}

	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;

	return path.startsWith(prefix)
		? path.slice(prefix.length)
		: `outside:${path}`;
}

/**
 * @param {string} file the chunk's file name in the bundle
 * @param {{ code: string; modules: Record<string, unknown> }} chunk
 * @param {string} root
 * @param {(directory: string) => string | undefined} [versionOf]
 */
export function chunkEntry(file, chunk, root, versionOf) {
	return {
		file,
		...hashes(chunk.code),
		modules: [
			...new Set(
				Object.keys(chunk.modules).map((id) =>
					moduleLabel(id, root, versionOf),
				),
			),
		].sort(),
	};
}

/** The hash of a chunk's code, and of the code trimmed, which is the text Astro inlines into a page. */
function hashes(code) {
	return {
		sha256: createHash("sha256").update(code).digest("hex"),
		trimmedSha256: createHash("sha256").update(code.trim()).digest("hex"),
	};
}

/**
 * Other plugins rewrite a chunk's code after this plugin's `generateBundle` (Vite adds its preload map to a chunk
 * with a dynamic import), so the hashes of a chunk that is written come from the bundle `writeBundle`
 * sees. A chunk Astro inlined into a page was removed from the bundle by then and keeps what was read before.
 *
 * @param {ReturnType<typeof chunkEntry>[]} entries
 * @param {Record<string, { type: string; code?: string }>} written
 */
export function settleChunks(entries, written) {
	return entries.map((entry) => {
		const output = written[entry.file];

		return output?.type === "chunk" && output.code !== undefined
			? { ...entry, ...hashes(output.code) }
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
 * @param {(directory: string) => string | undefined} [versionOf]
 */
export function unrenderedModules(chunks, infos, root, versionOf) {
	const rendered = new Set(
		[...chunks].flatMap((chunk) => Object.keys(chunk.modules)),
	);

	return [
		...new Set(
			[...infos].flatMap(([id, info]) =>
				info?.isIncluded && !rendered.has(id)
					? [moduleLabel(id, root, versionOf)]
					: [],
			),
		),
	].sort();
}

/**
 * @param {ReturnType<typeof chunkEntry>[]} chunks
 * @param {string[]} unrendered
 */
export function manifestFromChunks(chunks, unrendered = []) {
	return {
		version: 2,
		chunks: [...chunks].sort((a, b) => a.file.localeCompare(b.file)),
		unrendered,
	};
}

/** @returns {import("vite").Plugin} */
export function clientBundleManifest() {
	let root = process.cwd();
	/** @type {ReturnType<typeof manifestFromChunks> | undefined} */
	let read;
	/** @type {Map<string, string | undefined>} */
	const versions = new Map();

	/** The installed version of a package directory, read once from its package.json. */
	const versionOf = (directory) => {
		if (!versions.has(directory))
			versions.set(
				directory,
				JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
					.version,
			);

		return versions.get(directory);
	};

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
					output.type === "chunk"
						? [chunkEntry(file, output, root, versionOf)]
						: [],
				);

				const infos = new Map(
					[...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)]),
				);

				read = manifestFromChunks(
					chunks,
					unrenderedModules(outputs, infos, root, versionOf),
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
