// Keep the complete Stripe SDK call inventory small and reviewed. New adapters,
// aliases or endpoints must extend this guard and the wire-header regression.
import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

const adapters = [
	"src/lib/stripe-invoicing.ts",
	"src/lib/software-invoices.ts",
];

const methods = [
	"stripe.customers.create",
	"stripe.invoices.create",
	"stripe.invoiceItems.create",
	"stripe.invoices.finalizeInvoice",
	"stripe.invoices.sendInvoice",
];

function runtimeSource(path: string, text: string) {
	// Astro server code lives in frontmatter; browser scripts have a separate
	// client-graph guard. Other runtime source files are parsed directly.
	return path.endsWith(".astro")
		? (text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "")
		: text;
}

const sources = globSync("src/**/*.{ts,tsx,js,mjs,cjs,astro}").map((path) => ({
	path,
	text: runtimeSource(path, readFileSync(path, "utf8")),
}));

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
		);

		const visit = (node: ts.Node) => {
			if (
				ts.isStringLiteral(node) &&
				node.text === "stripe" &&
				(ts.isImportDeclaration(node.parent) ||
					ts.isExportDeclaration(node.parent) ||
					(ts.isCallExpression(node.parent) &&
						(node.parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
							node.parent.expression.getText(source) === "require")))
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
	expect(() => verifyInventory(mutated)).toThrow();
});

it.each(["js", "mjs", "astro"])(
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
		expect(() => verifyInventory([...sources, { path, text }])).toThrow();
	},
);
