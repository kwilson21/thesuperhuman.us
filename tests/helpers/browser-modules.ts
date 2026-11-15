/**
 * Every repository file other than a browser entry that the client build puts in browser code, reviewed one by one.
 * This is every non-entry file, not only src/lib and src/data: a `package.json`, `src/styles/global.css`, a
 * `public/` svg or a `?raw` JSON import each fail as unreviewed until listed. Entries (src/scripts/** and the
 * <script> of an .astro file) are browser code by definition and not listed. Today the list is pure modules
 * (constants, types, validators and formatting) that import nothing server-side. The bundler's own list (the
 * manifest scripts/client-bundle-manifest.mjs writes) must equal this exactly: tests/architecture/client-bundle.test.ts.
 * The source walker in client-graph.test.ts checks the same list, plus the files it reaches that the bundler drops.
 * Adding a name is a review decision: read the file for server work first.
 */
export const BROWSER_MODULES: readonly string[] = [
	"src/data/navigation-inventory.json",
	"src/lib/host-routing.ts",
	"src/lib/agreement-client-fields.ts",
	"src/lib/agreement-draft-fields.ts",
	"src/lib/audio-intake.ts",
	"src/lib/audio-peaks.ts",
	"src/lib/business-days.ts",
	"src/lib/fields.ts",
	"src/lib/home-motion.ts",
	"src/lib/line-diff.ts",
	"src/lib/navigation-prefetch.ts",
	"src/lib/link-check.ts",
	"src/lib/project-story.ts",
	"src/lib/scroll-scenes.ts",
	"src/lib/software-inquiry.ts",
	"src/lib/software-project-display.ts",
	"src/lib/type-guards.ts",
	"src/lib/waveform.ts",
];

/**
 * Every installed package the client build puts in browser code (by package name, not by import specifier).
 * The opt-in navigation experiment additionally loads js.foresight and its browser-only position-observer/tabbable dependencies.
 * These packages calculate DOM geometry and focus order, with no server imports or telemetry. Effect remains allowed only
 * for Effect Schema through the shared field helpers (src/lib/fields.ts). `effect/dist/Schema.js` imports about 68 other
 * effect modules, so the manifest check can only allow or forbid the whole package (ALLOWED_FORBIDDEN_PREFIXES in
 * client-manifest.ts, prefix "npm:effect@"); which effect modules browser SOURCE may import is a source-level rule that
 * the walker (client-graph.test.ts, ALLOWED_BROWSER_EFFECT_MODULES) carries, and the text markers in client-bundle.test.ts
 * catch the runtime parts a Schema-only bundle does not hold (Layer, Scope, Deferred). Zod, in either version, is gone
 * from the browser and forbidden outright; `@effect/*`, `@xstate/effect` and `xstate` stay forbidden.
 */
export const BROWSER_PACKAGES: readonly string[] = [
	"effect",
	"js.foresight",
	"position-observer",
	"tabbable",
];

/**
 * Reviewed Vite dynamic-import helper: preloads emitted local chunks/CSS only when
 * the explicit trial import runs, propagates CSP nonces and dispatches load errors.
 * No server code, telemetry, or eager import of the prediction package.
 */
export const BROWSER_VIRTUAL_MODULES: readonly string[] = [
	"\0vite/preload-helper.js",
];

/**
 * Scripts copied from public/ into dist/ unbundled (a `<script src="/x.js">`), by path under dist/ and the sha256
 * of the file. None today (public/ holds no .js or .mjs file). A change to a listed file changes its hash and
 * forces a review.
 */
export const PUBLIC_SCRIPTS: Readonly<Record<string, string>> = {};
