// A test stand-in for Astro's virtual `astro:content` module (vitest.config.ts aliases the specifier here). It reads the
// real collections from src/content, so a test that imports code using getCollection sees the real catalog data.
//
// Data collections are JSON files; content collections are Markdown with flat `key: value` front matter (strings,
// booleans, numbers). Each entry is checked against the schema in src/content/config.ts, as the build does. An entry's
// id is its file name without the extension.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "astro/zod";
import type { JsonObject } from "./json";

export { z };

type CollectionConfig = {
	type?: "content" | "data";
	schema?: z.ZodType;
};

/** What src/content/config.ts passes to defineCollection; returned unchanged, as Astro does. */
export const defineCollection = <T extends CollectionConfig>(config: T): T =>
	config;

export type Entry = {
	id: string;
	collection: string;
	data: JsonObject;
	body?: string;
};

// What Astro's glob loader reads for each collection type: a file such as .gitkeep is not an entry, so an empty collection
// loads as empty. Only the formats this repository's collections use are parsed here (JSON for data, Markdown for content).
const DATA_FILES = [".json"];
const CONTENT_FILES = [".md", ".mdx"];

const root = fileURLToPath(new URL("../../src/content/", import.meta.url));

function frontMatter(text: string) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);

	if (!match) return { data: {}, body: text };

	const data: JsonObject = {};

	for (const line of match[1].split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);

		if (!pair) continue;

		const raw = pair[2].trim();

		data[pair[1]] =
			raw === "true"
				? true
				: raw === "false"
					? false
					: raw !== "" && !Number.isNaN(Number(raw))
						? Number(raw)
						: raw.replace(/^(["'])([\s\S]*)\1$/, "$2");
	}

	return { data, body: match[2] };
}

async function load(name: string): Promise<Entry[]> {
	// Loaded when first used: config.ts imports this module, so importing it up front would be circular.
	const { collections } = await import("../../src/content/config");

	// SAFETY: the collections of config.ts are keyed by name and each holds what defineCollection above returned.
	const config = (collections as { [name: string]: CollectionConfig })[name];

	if (!config) throw new Error(`astro:content: no collection named "${name}"`);

	const directory = `${root}${name}/`;

	const extensions = config.type === "data" ? DATA_FILES : CONTENT_FILES;

	return readdirSync(directory)
		.filter(
			(file) =>
				extensions.includes(extname(file)) &&
				statSync(`${directory}${file}`).isFile(),
		)
		.sort()
		.map((file) => {
			const text = readFileSync(`${directory}${file}`, "utf8");
			const parsed = config.type === "data" ? undefined : frontMatter(text);
			const given = parsed ? parsed.data : JSON.parse(text);
			const data = config.schema ? config.schema.parse(given) : given;

			const entry: Entry = {
				id: basename(file, extname(file)),
				collection: name,
				data,
			};

			if (parsed) entry.body = parsed.body;

			return entry;
		});
}

export async function getCollection(
	name: string,
	filter?: (entry: Entry) => boolean,
): Promise<Entry[]> {
	const entries = await load(name);

	return filter ? entries.filter(filter) : entries;
}

export async function getEntry(
	name: string,
	id: string,
): Promise<Entry | undefined> {
	return (await load(name)).find((entry) => entry.id === id);
}
