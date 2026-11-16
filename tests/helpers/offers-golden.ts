import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import ts from "typescript";

// What the golden corpus of the owner's software request route (tests/golden/owner-request-software-*.test.ts and their
// fixtures) recorded, for the tests of the offers store, services and answers that the conversion builds: each case's
// answers, the SQL texts its statements ran, the Resend request bodies it sent, and the patterns its hooks pick
// statements by. The fixtures are the old route's behaviour, so what is compared here is what a converted route must keep.

export const SOFTWARE_AREAS = [
	"fit",
	"question",
	"decline",
	"revoke",
	"offer-draft",
	"offer-send",
	"offer-signing",
] as const;

export type SoftwareArea = (typeof SOFTWARE_AREAS)[number];

/** A recorded answer, as the harness writes it. */
export type RecordedAnswer = {
	readonly outcome: string;
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly setCookies: readonly string[];
	readonly body: string;
};

/** One recorded effect: a D1 statement or batch, an outside request, a console line, or a harness marker. */
type RecordedEffect = {
	readonly kind: string;
	readonly sql?: string;
	readonly statements?: readonly { readonly sql: string }[];
	readonly host?: string;
	readonly body?: string;
	readonly level?: string;
	readonly args?: readonly unknown[];
	readonly step?: number;
};

export type RecordedCase = {
	readonly name: string;
	readonly steps: readonly { readonly answer: RecordedAnswer }[];
	readonly effects: readonly RecordedEffect[];
};

const cases = new Map<SoftwareArea, readonly RecordedCase[]>();

const root = new URL("../../", import.meta.url);

/** Every recorded case of an area's corpus. */
export function softwareCases(area: SoftwareArea): readonly RecordedCase[] {
	const cached = cases.get(area);

	if (cached) return cached;

	// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases in the shape above.
	const read = JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(
					`tests/golden/fixtures/owner-request-software-${area}.json.gz`,
					root,
				),
			),
		).toString("utf8"),
	) as RecordedCase[];

	cases.set(area, read);

	return read;
}

/** The recorded case with this name; a name the corpus does not have fails the test. */
export function softwareCase(area: SoftwareArea, name: string): RecordedCase {
	const found = softwareCases(area).find((recorded) => recorded.name === name);

	if (!found) throw new Error(`No recorded ${area} case named "${name}".`);

	return found;
}

/** The answer of a recorded case's step (the first by default). */
export function recordedAnswer(
	area: SoftwareArea,
	name: string,
	step = 0,
): RecordedAnswer {
	const answer = softwareCase(area, name).steps[step]?.answer;

	if (!answer)
		throw new Error(`The ${area} case "${name}" has no step ${step}.`);

	return answer;
}

/** A Response as the harness records an answer. */
export async function asRecorded(response: Response): Promise<RecordedAnswer> {
	return {
		outcome: "response",
		status: response.status,
		headers: Object.fromEntries(response.headers),
		setCookies: response.headers.getSetCookie(),
		body: await response.text(),
	};
}

/** The body of each Resend request a recorded case sent, in order. */
export function resendBodies(area: SoftwareArea, name: string): string[] {
	return softwareCase(area, name).effects.flatMap((effect) =>
		effect.kind === "fetch" &&
		effect.host === "resend" &&
		effect.body !== undefined
			? [effect.body]
			: [],
	);
}

/** The arguments of each console line a recorded case wrote at this level, in order. */
export function consoleLines(
	area: SoftwareArea,
	name: string,
	level = "error",
): (readonly unknown[])[] {
	return softwareCase(area, name).effects.flatMap((effect) =>
		effect.kind === "console" && effect.level === level
			? [effect.args ?? []]
			: [],
	);
}

/** Every SQL text any statement of the seven corpora ran, alone or in a batch. */
export function recordedSql(): ReadonlySet<string> {
	const texts = new Set<string>();

	for (const area of SOFTWARE_AREAS)
		for (const recorded of softwareCases(area))
			for (const effect of recorded.effects) {
				if (effect.kind === "d1" && effect.sql !== undefined)
					texts.add(effect.sql);

				for (const statement of effect.statements ?? [])
					texts.add(statement.sql);
			}

	return texts;
}

/** The SQL texts of every batch the seven corpora ran, each in its order, as JSON. */
export function recordedBatches(): ReadonlySet<string> {
	const batches = new Set<string>();

	for (const area of SOFTWARE_AREAS)
		for (const recorded of softwareCases(area))
			for (const effect of recorded.effects)
				if (effect.kind === "d1-batch" && effect.statements)
					batches.add(
						JSON.stringify(effect.statements.map((statement) => statement.sql)),
					);

	return batches;
}

/** A regular expression literal's text (`/source/flags`) as a RegExp. */
function regExpOf(literal: string): RegExp {
	const end = literal.lastIndexOf("/");

	return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

/**
 * Every pattern the seven corpora's hooks (an `interleave` or a `failures` entry) pick statements by, read from the syntax
 * tree of the test files: the value of each `on` property, a regular expression literal or a name bound by a `const` to
 * one (`onBatch`, `liveCheck`, `afterTheEmail`). An `on` of any other form fails, so that no hook's pattern is missed.
 */
export function hookPatterns(): readonly RegExp[] {
	const found = new Map<string, RegExp>();

	for (const area of SOFTWARE_AREAS) {
		const file = `tests/golden/owner-request-software-${area}.test.ts`;

		const source = ts.createSourceFile(
			file,
			readFileSync(new URL(file, root), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);

		const bound = new Map<string, string[]>();
		const hooks: ts.Node[] = [];

		const visit = (node: ts.Node) => {
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer !== undefined &&
				ts.isRegularExpressionLiteral(node.initializer) &&
				ts.isVariableDeclarationList(node.parent) &&
				(node.parent.flags & ts.NodeFlags.Const) !== 0
			)
				bound.set(node.name.text, [
					...(bound.get(node.name.text) ?? []),
					node.initializer.text,
				]);

			if (
				(ts.isPropertyAssignment(node) ||
					ts.isShorthandPropertyAssignment(node)) &&
				ts.isIdentifier(node.name) &&
				node.name.text === "on"
			)
				hooks.push(
					ts.isPropertyAssignment(node) ? node.initializer : node.name,
				);

			ts.forEachChild(node, visit);
		};

		visit(source);

		for (const value of hooks) {
			const named = ts.isIdentifier(value) ? bound.get(value.text) : undefined;

			const literal = ts.isRegularExpressionLiteral(value)
				? value.text
				: named?.length === 1
					? named[0]
					: undefined;

			if (literal === undefined)
				throw new Error(
					`${file}: the hook pattern \`${value.getText(source)}\` is neither a regular expression literal nor the name of one const bound to one.`,
				);

			found.set(literal, regExpOf(literal));
		}
	}

	return [...found.values()];
}
