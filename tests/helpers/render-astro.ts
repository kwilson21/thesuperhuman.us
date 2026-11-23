import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "@astrojs/compiler";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { build } from "esbuild";

/** A component the container can render. */
export type AstroComponent = Parameters<AstroContainer["renderToString"]>[0];

/**
 * Compiles .astro components (and what they import from src) into a scratch bundle the container can render, as
 * tests/pages/og-tags.test.ts does: styles become empty modules, `~/` resolves into src, and packages stay external.
 * Returns each entry's default export by name, and a function that removes the bundle.
 */
export async function bundleAstro(entries: Record<string, string>) {
	// Under node_modules/.cache, so bare imports still resolve from node_modules and the tree walkers never see it.
	await mkdir(resolve("node_modules/.cache"), { recursive: true });
	const directory = await mkdtemp(resolve("node_modules/.cache/astro-render-"));

	const components = new Map<string, AstroComponent>();

	// A failed build or import leaves no scratch directory behind.
	try {
		await build({
			entryPoints: entries,
			outdir: directory,
			outExtension: { ".js": ".mjs" },
			bundle: true,
			format: "esm",
			platform: "node",
			packages: "external",
			plugins: [
				{
					name: "astro-test-render",
					setup(builder) {
						builder.onResolve({ filter: /\.css(?:\?|$)|\?astro/ }, () => ({
							path: "empty-style",
							namespace: "empty",
						}));
						builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
							contents: "",
							loader: "js",
						}));
						builder.onResolve({ filter: /^~\// }, (args) => ({
							path:
								resolve("src", args.path.slice(2)) +
								(args.path.endsWith(".astro") ? "" : ".ts"),
						}));
						builder.onLoad({ filter: /\.astro$/ }, async (args) => ({
							contents: (
								await transform(await readFile(args.path, "utf8"), {
									filename: args.path,
									internalURL: "astro/compiler-runtime",
									astroGlobalArgs: '"https://thesuperhuman.us"',
									resolvePath: (specifier) => specifier,
								})
							).code,
							loader: "ts",
							resolveDir: dirname(args.path),
						}));
					},
				},
			],
		});

		for (const name of Object.keys(entries)) {
			const module: { default: AstroComponent } = await import(
				/* @vite-ignore */ pathToFileURL(resolve(directory, `${name}.mjs`)).href
			);

			components.set(name, module.default);
		}
	} catch (error) {
		await rm(directory, { recursive: true, force: true });

		throw error;
	}

	/** An entry's compiled component, for a caller that renders it with a container of its own. */
	const component = (name: string) => {
		const found = components.get(name);

		if (!found) throw new Error(`No compiled component named ${name}.`);

		return found;
	};

	return {
		component,
		/** Renders an entry's component with these options (its props) to HTML. */
		render: async (
			name: string,
			options: Parameters<AstroContainer["renderToString"]>[1],
		) =>
			(await AstroContainer.create()).renderToString(component(name), options),
		remove: () => rm(directory, { recursive: true, force: true }),
	};
}
