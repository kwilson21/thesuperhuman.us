/**
 * Every module under src/lib or src/data that the client build puts in browser code, reviewed one by one: each is
 * pure (constants, types, validators and formatting) and imports nothing server-side. The bundler's own list (the
 * manifest scripts/client-bundle-manifest.mjs writes) must equal this exactly: tests/architecture/client-bundle.test.ts.
 * The source walker in client-graph.test.ts checks the same list, plus the files it reaches that the bundler drops.
 * Adding a name is a review decision: read the module for server work first.
 */
export const BROWSER_MODULES: readonly string[] = [
	"src/lib/agreement-client-fields.ts",
	"src/lib/agreement-draft-fields.ts",
	"src/lib/audio-intake.ts",
	"src/lib/audio-peaks.ts",
	"src/lib/business-days.ts",
	"src/lib/home-motion.ts",
	"src/lib/line-diff.ts",
	"src/lib/project-story.ts",
	"src/lib/scroll-scenes.ts",
	"src/lib/software-inquiry.ts",
	"src/lib/software-project-display.ts",
	"src/lib/type-guards.ts",
	"src/lib/waveform.ts",
];

/**
 * Every installed package the client build puts in browser code (by package name, not by import specifier: the
 * source walker sees `astro/zod`, the bundler sees the `zod` v3 that astro ships). Zod v3 only: Zod v4, Effect and
 * the other server packages are forbidden in client-manifest.ts. Remove `zod` when the Zod to Effect Schema work
 * removes `astro/zod` from the browser; to let `effect/Schema` in later, add `effect` here and its module prefix to
 * ALLOWED_FORBIDDEN_PREFIXES in client-manifest.ts.
 */
export const BROWSER_PACKAGES: readonly string[] = ["zod"];

/**
 * Every virtual module id (`\0...`, `astro:...`, `virtual:...`) the client build puts in browser code. None today:
 * the browser bundle holds only repository files and the `zod` package. A virtual module can carry code a plugin
 * generates, so each id added here is reviewed for what it supplies.
 */
export const BROWSER_VIRTUAL_MODULES: readonly string[] = [];

/**
 * Scripts copied from public/ into dist/ unbundled (a `<script src="/x.js">`), by path under dist/ and the sha256
 * of the file. None today (public/ holds no .js or .mjs file). A change to a listed file changes its hash and
 * forces a review.
 */
export const PUBLIC_SCRIPTS: Readonly<Record<string, string>> = {};
