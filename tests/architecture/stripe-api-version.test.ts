// Keep the complete Stripe SDK call inventory small and reviewed. New adapters,
// aliases or endpoints must extend this guard and the wire-header regression.
import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { posix } from "node:path";
import { convertToTSX } from "@astrojs/compiler/sync";
import {
	globPatternsOf,
	isImportMetaGlob,
	runtimeGlobFiles,
	runtimeModuleResolver,
} from "../helpers/client-graph";
import { expect, it } from "vitest";

const adapters = [
	"src/lib/stripe-invoicing.ts",
	"src/lib/software-invoices.ts",
];

const resolveModule = runtimeModuleResolver(process.cwd());

const methods = [
	"stripe.customers.create",
	"stripe.invoices.create",
	"stripe.invoiceItems.create",
	"stripe.invoices.finalizeInvoice",
	"stripe.invoices.sendInvoice",
];

function runtimeSource(path: string, text: string) {
	// Compiler output retains executable frontmatter, template expressions and
	// scripts, rather than treating an Astro template as inert markup.
	return path.endsWith(".astro")
		? convertToTSX(text, { filename: path, includeScripts: true }).code
		: text;
}

function isInvoiceModule(path: string, specifier: string) {
	return resolveModule(specifier, path).files.some(
		(file) => posix.relative(process.cwd(), file) === adapters[0],
	);
}

const isStripeModule = (specifier: string) =>
	specifier === "stripe" || specifier.startsWith("stripe/");

const isRequire = (expression: ts.Expression) =>
	(ts.isIdentifier(expression) && expression.text === "require") ||
	(ts.isPropertyAccessExpression(expression) &&
		expression.name.text === "require") ||
	(ts.isElementAccessExpression(expression) &&
		ts.isStringLiteralLike(expression.argumentExpression) &&
		expression.argumentExpression.text === "require");

const sources = globSync("src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,astro}").map(
	(path) => ({
		path,
		text: runtimeSource(path, readFileSync(path, "utf8")),
	}),
);

function verifyInventory(inputs: typeof sources) {
	const found: string[] = [];
	const clients: string[] = [];
	const constructors: string[] = [];

	for (const { path, text } of inputs) {
		const source = ts.createSourceFile(
			path,
			text,
			ts.ScriptTarget.Latest,
			true,
			path.endsWith(".astro") || /\.[jt]sx$/.test(path)
				? ts.ScriptKind.TSX
				: ts.ScriptKind.TS,
		);

		const visit = (node: ts.Node) => {
			// Loader values must not escape under aliases; only direct calls are reviewed.
			if (ts.isExpression(node) && isRequire(node)) {
				const owner = node.parent;

				const propertyName =
					ts.isIdentifier(node) &&
					ts.isPropertyAccessExpression(owner) &&
					owner.name === node;

				if (!propertyName)
					expect(ts.isCallExpression(owner) && owner.expression === node).toBe(
						true,
					);
			}

			// Local executable dependencies must remain in the scanned source boundary.
			// Reuse canonical aliases/extension resolution, not hand-written path parsing.
			let moduleSpecifier: string | undefined;

			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteralLike(node.moduleSpecifier)
			)
				moduleSpecifier = node.moduleSpecifier.text;

			if (
				ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					isRequire(node.expression)) &&
				node.arguments[0] &&
				ts.isStringLiteralLike(node.arguments[0])
			)
				moduleSpecifier = node.arguments[0].text;

			if (moduleSpecifier !== undefined) {
				for (const file of resolveModule(moduleSpecifier, path).files) {
					if (/\.(?:[cm]?[jt]sx?|astro)$/.test(file))
						expect(posix.relative(process.cwd(), file).startsWith("src/")).toBe(
							true,
						);
				}
			}

			// Asset globs may not become an alternative runtime module loader. Use the
			// same alias/glob resolver as the browser graph; broad and eager code globs
			// are refused even when an `import` option conceals the exported factory.
			if (ts.isCallExpression(node) && isImportMetaGlob(node.expression)) {
				const patterns = node.arguments[0] && globPatternsOf(node.arguments[0]);
				expect(patterns).toBeDefined();

				for (const pattern of patterns ?? []) {
					expect(runtimeGlobFiles(pattern, path, process.cwd())).toEqual([]);
				}
			}

			if (
				ts.isExportDeclaration(node) &&
				node.exportClause &&
				ts.isNamedExports(node.exportClause)
			) {
				for (const element of node.exportClause.elements) {
					expect(["Stripe", "stripeClient"]).not.toContain(
						(element.propertyName ?? element.name).text,
					);
				}
			}

			// No runtime import-equals consumers are part of the reviewed boundary.
			if (ts.isImportEqualsDeclaration(node))
				expect(node.isTypeOnly).toBe(true);

			// Dynamic loads must be statically named and cannot obtain the SDK/factory.
			// This intentionally rejects unresolved expressions rather than guessing.
			if (
				ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					isRequire(node.expression))
			) {
				const module = node.arguments[0];
				expect(
					module &&
						(ts.isStringLiteral(module) ||
							ts.isNoSubstitutionTemplateLiteral(module)),
				).toBe(true);

				if (
					module &&
					(ts.isStringLiteral(module) ||
						ts.isNoSubstitutionTemplateLiteral(module))
				) {
					expect(
						isStripeModule(module.text) || isInvoiceModule(path, module.text),
					).toBe(false);
				}
			}

			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier) &&
				isInvoiceModule(path, node.moduleSpecifier.text)
			) {
				// Only explicit named imports can consume this module. Namespace/default
				// imports and re-exports could conceal a computed or aliased factory use.
				expect(ts.isImportDeclaration(node)).toBe(true);

				if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
					expect(node.importClause?.name).toBeUndefined();
					const bindings = node.importClause?.namedBindings;

					if (bindings && ts.isNamedImports(bindings)) {
						for (const element of bindings.elements) {
							if (
								(element.propertyName ?? element.name).text === "stripeClient"
							) {
								expect(path).toBe(adapters[1]);
								expect(element.propertyName).toBeUndefined();
								expect(element.name.text).toBe("stripeClient");
							}
						}
					}

					expect(
						node.importClause?.namedBindings &&
							ts.isNamedImports(node.importClause.namedBindings),
					).toBe(true);
				}
			}

			if (
				(ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
				isStripeModule(node.text) &&
				(ts.isImportDeclaration(node.parent) ||
					ts.isExportDeclaration(node.parent) ||
					(ts.isCallExpression(node.parent) &&
						(node.parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
							isRequire(node.parent.expression))))
			) {
				expect(ts.isImportDeclaration(node.parent)).toBe(true);
				const declaration = node.parent;

				if (
					ts.isImportDeclaration(declaration) &&
					!declaration.importClause?.isTypeOnly
				) {
					expect([adapters[0], "src/server/failure.ts"]).toContain(path);
					expect(declaration.importClause?.name?.text).toBe("Stripe");
				}
			}

			// The other runtime import classifies errors only, never creates a client.
			if (
				path === "src/server/failure.ts" &&
				ts.isIdentifier(node) &&
				node.text === "Stripe"
			) {
				if (!ts.isImportClause(node.parent)) {
					expect(
						ts.isPropertyAccessExpression(node.parent) &&
							node.parent.expression === node &&
							node.parent.name.text,
					).toBe("errors");
				}
			}

			// Conservative syntax guard: runtime Stripe values cannot escape via aliases.
			if (
				path === adapters[0] &&
				ts.isIdentifier(node) &&
				node.text === "Stripe"
			) {
				const owner = node.parent;

				const allowed =
					ts.isImportClause(owner) ||
					ts.isTypeReferenceNode(owner) ||
					ts.isQualifiedName(owner) ||
					(ts.isNewExpression(owner) && owner.expression === node) ||
					(ts.isPropertyAccessExpression(owner) &&
						owner.expression === node &&
						[
							"errors",
							"createFetchHttpClient",
							"createSubtleCryptoProvider",
						].includes(owner.name.text));

				expect(allowed).toBe(true);
			}

			if (
				ts.isNewExpression(node) &&
				node.expression.getText(source) === "Stripe"
			) {
				constructors.push(path);
			}

			if (ts.isIdentifier(node) && node.text === "stripeClient") {
				const parent = node.parent;

				if (ts.isCallExpression(parent) && parent.expression === node) {
					clients.push(path);
					const consumer = parent.parent;

					const target =
						path === adapters[0]
							? "createInvoiceWithClient"
							: "createSoftwareInvoiceWithClient";

					const adapter =
						ts.isCallExpression(consumer) &&
						consumer.arguments[0] === parent &&
						consumer.expression.getText(source) === target;

					const webhook =
						path === adapters[0] &&
						ts.isPropertyAccessExpression(consumer) &&
						consumer.expression === parent &&
						consumer.name.text === "webhooks" &&
						ts.isPropertyAccessExpression(consumer.parent) &&
						consumer.parent.name.text === "constructEventAsync" &&
						ts.isCallExpression(consumer.parent.parent) &&
						consumer.parent.parent.expression === consumer.parent;

					expect(adapter || webhook).toBe(true);
				} else if (ts.isImportSpecifier(parent)) {
					expect(path).toBe(adapters[1]);
					expect(parent.propertyName).toBeUndefined();
					expect(parent.name.text).toBe("stripeClient");
				} else {
					expect(ts.isFunctionDeclaration(parent) && parent.name === node).toBe(
						true,
					);
					expect(path).toBe(adapters[0]);
				}
			}

			if (ts.isIdentifier(node) && node.text === "stripe") {
				expect(adapters).toContain(path);

				if (ts.isParameter(node.parent) && node.parent.name === node) return;
				let expression: ts.Node = node;

				while (
					ts.isPropertyAccessExpression(expression.parent) &&
					expression.parent.expression === expression
				) {
					expression = expression.parent;
				}

				const call = expression.parent;
				expect(
					ts.isCallExpression(call) && call.expression === expression,
				).toBe(true);

				if (ts.isCallExpression(call)) {
					const method = expression.getText(source);
					expect(methods).toContain(method);
					const options = call.arguments.at(-1);
					expect(
						options &&
							ts.isCallExpression(options) &&
							options.expression.getText(source),
					).toBe("stripeInvoiceOptions");
					found.push(`${path}:${method}`);
				}
			}

			ts.forEachChild(node, visit);
		};

		visit(source);
	}

	expect(found.sort()).toEqual(
		adapters
			.flatMap((path) => methods.map((method) => `${path}:${method}`))
			.sort(),
	);
	expect(constructors).toEqual([adapters[0]]);
	// Audio booking/balance + signature verification (local only), software invoice.
	expect(clients.sort()).toEqual(
		[adapters[0], adapters[0], adapters[0], adapters[1]].sort(),
	);
}

it("pins every production Stripe network call and confines SDK construction/consumers", () => {
	verifyInventory(sources);
});

it.each([
	[
		"factory result alias",
		"stripeClient(env),",
		"(() => { const escaped = stripeClient(env); escaped.refunds.create({}); return escaped; })(),",
	],
	[
		"constructor alias",
		"return new Stripe(env.STRIPE_SECRET_KEY!, {",
		"const Alias = Stripe; new Alias(env.STRIPE_SECRET_KEY!); return new Stripe(env.STRIPE_SECRET_KEY!, {",
	],
	[
		"unpinned call",
		"stripeInvoiceOptions(`${rootKey}:send`)",
		"{idempotencyKey: `${rootKey}:send`}",
	],
])("rejects %s", (_name, before, after) => {
	const mutated = sources.map((source) =>
		source.path === adapters[0]
			? { ...source, text: source.text.replace(before, after) }
			: source,
	);

	expect(mutated.find((source) => source.path === adapters[0])?.text).not.toBe(
		sources.find((source) => source.path === adapters[0])?.text,
	);
	// Visit the mutation first so the rejection test need not traverse the
	// unchanged repository before reaching the failing boundary.
	mutated.sort(
		(a, b) => Number(b.path === adapters[0]) - Number(a.path === adapters[0]),
	);
	expect(() => verifyInventory(mutated)).toThrow();
});

it.each(["js", "jsx", "mjs", "mts", "cts", "astro"])(
	"rejects a new %s SDK consumer outside the reviewed boundary",
	(extension) => {
		const code =
			'import Stripe from "stripe"; new Stripe("sk_test_guard").refunds.create({});';

		const path = `src/new-consumer.${extension}`;

		const text = runtimeSource(
			path,
			extension === "astro" ? `---\n${code}\n---\n<p>Example</p>` : code,
		);

		expect(text).toContain("import Stripe");
		expect(() => verifyInventory([{ path, text }, ...sources])).toThrow();
	},
);

it.each([
	[
		"Astro template",
		"src/unsafe.astro",
		"<div>{(await import(`stripe`)).default}</div>",
	],
	[
		"namespace computed factory",
		"src/unsafe.ts",
		'import * as billing from "~/lib/stripe-invoicing"; billing["stripeClient"](env).refunds.create({});',
	],
	[
		"namespace dynamic factory key",
		"src/unsafe.ts",
		'import * as billing from "./lib/stripe-invoicing.js"; const key = "stripeClient"; billing[key](env).refunds.create({});',
	],
	[
		"template-literal import",
		"src/unsafe.ts",
		'const SDK = (await import(`stripe`)).default; new SDK("sk_test_guard").refunds.create({});',
	],
	[
		"template-literal require",
		"src/unsafe.cts",
		'const SDK = require(`stripe`); new SDK("sk_test_guard").refunds.create({});',
	],
	[
		"module.require",
		"src/unsafe.cjs",
		'const SDK = module.require(`stripe`); new SDK("sk_test_guard").refunds.create({});',
	],
	[
		"import equals",
		"src/unsafe.cts",
		'import SDK = require("stripe"); new SDK("sk_test_guard").refunds.create({});',
	],

	[
		"unresolved dynamic import",
		"src/unsafe.ts",
		'const module = "stripe"; const SDK = await import(module);',
	],
	[
		"dynamic factory import",
		"src/unsafe.ts",
		'const billing = await import("~/lib/stripe-invoicing"); billing["stripeClient"](env);',
	],
])("rejects %s", (_name, path, code) => {
	expect(() =>
		verifyInventory([{ path, text: runtimeSource(path, code) }, ...sources]),
	).toThrow();
});

it.each([
	[
		"string-named factory import",
		'import { "stripeClient" as make } from "~/lib/stripe-invoicing"; make(env).refunds.create({});',
	],
	[
		"string-named factory re-export",
		'export { "stripeClient" as make } from "~/lib/stripe-invoicing";',
	],
	[
		"eager glob",
		'const make = import.meta.glob("../lib/stripe-invoicing.ts", {eager:true, import:"stripeClient"});',
	],
	[
		"globEager",
		'const modules = import.meta.globEager("../lib/stripe-invoicing.ts");',
	],
	[
		"alias glob array",
		'const modules = import.meta.glob(["~/lib/*.ts", "!~/lib/stripe-invoicing.ts"], {eager:true});',
	],
	[
		"root glob",
		'const modules = import.meta.glob("/src/lib/stripe-invoicing.ts", {eager:true});',
	],
	[
		"unresolved glob",
		'const pattern = "../lib/stripe-invoicing.ts"; const modules = import.meta.glob(pattern);',
	],
])("rejects %s", (_name, text) => {
	expect(() =>
		verifyInventory([{ path: "src/pages/unsafe.ts", text }, ...sources]),
	).toThrow();
});

it("rejects string-named re-export of the SDK constructor", () => {
	const mutated = sources.map((source) =>
		source.path === adapters[0]
			? { ...source, text: source.text + '\nexport {"Stripe" as make};' }
			: source,
	);

	// Visit the mutation first so the rejection test need not traverse the
	// unchanged repository before reaching the failing boundary.
	mutated.sort(
		(a, b) => Number(b.path === adapters[0]) - Number(a.path === adapters[0]),
	);
	expect(() => verifyInventory(mutated)).toThrow();
});

it.each([
	[
		"normalized alias",
		'import { "stripeClient" as make } from "~/lib/../lib/stripe-invoicing"; make(env).refunds.create({});',
	],
	[
		"normalized relative alias",
		'import { "stripeClient" as make } from "./lib/../lib/stripe-invoicing"; make(env).refunds.create({});',
	],
	["escaped require", 'const load = require; const SDK = load("stripe");'],
	[
		"escaped module require",
		'const load = module.require; const SDK = load("stripe");',
	],
	[
		"escaped computed require",
		'const load = module["require"]; const SDK = load("stripe");',
	],
	["outside static helper", 'import helper from "../scripts/build-icons.mjs";'],
	[
		"outside dynamic helper",
		'const helper = await import("../scripts/build-icons.mjs");',
	],
	[
		"outside aliased helper",
		'import helper from "~/../scripts/build-icons.mjs";',
	],
	["outside reexport", 'export * from "../scripts/build-icons.mjs";'],
])("rejects %s", (_name, text) => {
	expect(() =>
		verifyInventory([{ path: "src/unsafe.ts", text }, ...sources]),
	).toThrow();
});
