/** Build-time only. Never import this filesystem/compiler module into browser code. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { publicReleasePages } from "./sitemap-pages.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// One review point for server-rendered routes. Static documents are discovered automatically.
// Forms may be SOURCES of navigation, never speculative destinations. No-store pages likewise.
export const SERVER_PAGES = {
	"index.astro": "public",
	"about.astro": "public",
	"work.astro": "public",
	"building.astro": "public",
	"services.astro": "public",
	"privacy.astro": "public",
	"writing/index.astro": "public",
	"writing/ai-gives-you-speed.astro": "public",
	"audio/index.astro": "public",
	"audio/portfolio.astro": "public",
	"audio/releases.astro": "public",
	"audio/services.astro": "public",
	"audio/start.astro": "form",
	"software/start.astro": "form",
	"building/personal-website.astro": "no-store",
	"building/personal-website/story.astro": "no-store",
	"building/personal-website/archive.astro": "no-store",
	"building/threadline.astro": "no-store",
	"building/the-engineers-daily.astro": "no-store",
	"music/[slug].astro": "public-release",
	"services.html.astro": "redirect",
	"audio/about.astro": "redirect",
	"404.astro": "error",
};

export const EXCLUSION_REASONS = {
	private:
		"Owner, studio, offer and agreement pages contain authenticated or per-recipient data.",
	endpoint:
		"API, discovery and file endpoints are not document navigation; GET can have effects or deliver media.",
	form: "Dedicated intake pages may initialize form/security state; only navigate there on user action.",
	"no-store":
		"Live public feed pages explicitly opt out of caching; do not speculate until that policy is reviewed.",
	redirect: "Prefetch canonical destinations, not redirect aliases.",
	error: "An error response is not a navigation destination.",
};

/** An explicit dynamic prerender export must be reviewed, not guessed from text/comments. */
function staticDocument(source) {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);

	if (source.startsWith("---") && !match) return false;
	const frontmatter = match?.[1] ?? "";

	const parsed = ts.createSourceFile(
		"page.ts",
		frontmatter,
		ts.ScriptTarget.Latest,
		true,
	);

	if (parsed.parseDiagnostics.length) return false;

	for (const statement of parsed.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			(!statement.exportClause ||
				(ts.isNamedExports(statement.exportClause) &&
					statement.exportClause.elements.some(
						(item) => item.name.text === "prerender",
					)))
		)
			return false;

		if (
			!ts.isVariableStatement(statement) ||
			!statement.modifiers?.some(
				(item) => item.kind === ts.SyntaxKind.ExportKeyword,
			)
		)
			continue;

		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name)) return false;

			if (
				ts.isIdentifier(declaration.name) &&
				declaration.name.text === "prerender"
			)
				return declaration.initializer?.kind === ts.SyntaxKind.TrueKeyword;
		}
	}

	return true;
}

function assertPublicResponseSemantics(file, source) {
	if (/no-store|Astro\.cookies|Astro\.redirect/.test(source))
		throw new Error(`Review changed response semantics for ${file}`);
}

export function classifyPage(file, source) {
	if (/^(owner|studio|offer|agreements)(\/|\.(astro|md|mdx)$)/.test(file))
		return "private";

	if (
		/^(api|\.well-known|og|audio\/file|music\/file)(\/|\.(astro|md|mdx)$)/.test(
			file,
		) ||
		/\.(ts|js)$/.test(file)
	)
		return "endpoint";

	if (Object.hasOwn(SERVER_PAGES, file)) {
		const kind = SERVER_PAGES[file];

		if (kind === "public" || kind === "public-release")
			assertPublicResponseSemantics(file, source);

		return kind;
	}

	if (
		file.includes("[") ||
		(/\.(md|mdx)$/.test(file) && /\bprerender\b/.test(source)) ||
		!/\.(astro|md|mdx)$/.test(file) ||
		!staticDocument(source)
	)
		throw new Error(
			`Classify navigation safety for ${file} in scripts/navigation-inventory.mjs`,
		);

	assertPublicResponseSemantics(file, source);

	return "public";
}

function filesUnder(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		return entry.isDirectory() ? filesUnder(path) : [path];
	});
}

export function hasStaticOutput(config) {
	const parsed = ts.createSourceFile(
		"astro.config.mjs",
		config,
		ts.ScriptTarget.Latest,
		true,
	);

	const exported = parsed.statements.find((statement) =>
		ts.isExportAssignment(statement),
	);

	if (
		!exported ||
		!ts.isExportAssignment(exported) ||
		!ts.isCallExpression(exported.expression)
	)
		return false;
	const argument = exported.expression.arguments[0];

	if (!argument || !ts.isObjectLiteralExpression(argument)) return false;

	if (
		argument.properties.some(
			(property) =>
				ts.isSpreadAssignment(property) ||
				(property.name && ts.isComputedPropertyName(property.name)),
		)
	)
		return false;

	const outputs = argument.properties.filter(
		(property) =>
			ts.isPropertyAssignment(property) &&
			(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
			property.name.text === "output",
	);

	if (outputs.length !== 1) return false;

	return outputs.some(
		(property) =>
			ts.isPropertyAssignment(property) &&
			(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
			property.name.text === "output" &&
			ts.isStringLiteral(property.initializer) &&
			property.initializer.text === "static",
	);
}

export function buildNavigationInventory(repository = root) {
	const config = readFileSync(join(repository, "astro.config.mjs"), "utf8");

	if (!hasStaticOutput(config))
		throw new Error(
			"Review navigation static-page inference when Astro output changes",
		);
	const pages = join(repository, "src/pages");
	const sources = new Set();
	const targets = new Set();
	/** @type {Record<string, string>} */
	const classifications = {};

	for (const absolute of filesUnder(pages).sort()) {
		const file = relative(pages, absolute).replaceAll("\\", "/");
		const kind = classifyPage(file, readFileSync(absolute, "utf8"));
		classifications[file] = kind;

		if (!["public", "form", "no-store"].includes(kind)) continue;

		const path =
			`/${file.replace(/\.(astro|md|mdx)$/, "").replace(/(^|\/)index$/, "")}`.replace(
				/\/$/,
				"",
			) || "/";

		sources.add(path);

		if (kind === "public") targets.add(path);
	}

	for (const href of classifications["music/[slug].astro"] === "public-release"
		? publicReleasePages(
				new URL(`file://${join(repository, "src/content/releases")}/`),
				"https://thesuperhuman.us",
			)
		: []) {
		const path = new URL(href).pathname;
		sources.add(path);
		targets.add(path);
	}

	return {
		inventory: { sources: [...sources].sort(), targets: [...targets].sort() },
		classifications,
	};
}

export function generateNavigationInventory(repository = root) {
	const { inventory } = buildNavigationInventory(repository);
	writeFileSync(
		join(repository, "src/data/navigation-inventory.json"),
		`${JSON.stringify(inventory, null, "\t")}\n`,
	);

	return inventory;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const inventory = generateNavigationInventory();
	process.stdout.write(
		`Navigation inventory: ${inventory.sources.length} public source pages, ${inventory.targets.length} safe destinations.\n`,
	);
}
