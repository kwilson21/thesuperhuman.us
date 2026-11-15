import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { fieldOf, type Issue, type RawValue, receivedKind } from "./fields";
import { leaf, type Reader, type RecordSentences } from "./readers";

// The readers of an MCP tool's arguments. They read with Effect Schema, and say what the MCP SDK's own argument check
// said while the tools gave it Zod 4 schemas: the same sentences, in the same order, so a client sees no change. The
// differential test (tests/server/mcp-tools-differential.test.ts) holds them to the old server, a frozen copy kept
// with the other reference copies of replaced validators. Arguments arrive as JSON, so a value is a string, a number, a
// boolean, null, a list or an object. The rules, as Zod 4 had them:
// - A value of the wrong type is reported once and nothing else is checked on it, except that the size checks of a text
//   still run on a value that has a length (a list, or an object with a `length` member).
// - Every other check reports when it fails, and the checks after it still run, except that a number that is not a whole
//   number is reported once and its range is not checked.
// - A text is measured in characters as a person counts them (an emoji is one), not in UTF-16 units.

/** What a value is called in a sentence such as "expected string, received number"; a number that is not finite is itself. */
const received = (raw: RawValue): string =>
	Predicate.isNumber(raw) && !Number.isFinite(raw)
		? String(raw)
		: receivedKind(raw);

const notKind = (expected: string, raw: RawValue) =>
	`Invalid input: expected ${expected}, received ${received(raw)}`;

/**
 * How many characters a text has, a pair of UTF-16 units that make one character counting once. It counts in place: the
 * public probe is handed texts of several megabytes, and a list of their characters would be as large again.
 */
export function characters(text: string): number {
	let count = text.length;

	for (let at = 0; at < text.length - 1; at++)
		if (
			(text.charCodeAt(at) & 0xfc00) === 0xd800 &&
			(text.charCodeAt(at + 1) & 0xfc00) === 0xdc00
		) {
			count--;
			at++;
		}

	return count;
}

/** One check on a text, in the order Zod ran them. */
export type TextCheck =
	| { readonly least: number }
	| { readonly most: number }
	| { readonly pattern: RegExp };

const textCheck = (check: TextCheck) =>
	Schema.makeFilter((value: string) => {
		if ("least" in check)
			return characters(value) >= check.least
				? true
				: `Too small: expected string to have >=${check.least} characters`;

		if ("most" in check)
			return characters(value) <= check.most
				? true
				: `Too big: expected string to have <=${check.most} characters`;

		return check.pattern.test(value)
			? true
			: `Invalid string: must match pattern ${check.pattern}`;
	});

/** The length a value that is not text claims to have: a list's, or an object's member named `length`. */
const claimedLength = (raw: RawValue): RawValue => {
	if (Array.isArray(raw)) return raw.length;

	return Predicate.isObject(raw)
		? new Map(Object.entries(raw)).get("length")
		: undefined;
};

/**
 * What a length check says of a value that is not text but has a length (Zod's size checks run on it after the sentence
 * for its type): a list is measured in items, any other object with a `length` member is "unknown", and the length is
 * compared as a number is, so a length that is not a number fails both ends.
 */
const sizeCheck = (check: TextCheck) =>
	Schema.makeFilter((raw: RawValue) => {
		const length = claimedLength(raw);

		if (length === undefined || Predicate.isString(raw)) return true;

		const unit = Array.isArray(raw);

		if ("least" in check)
			return Number(length) >= check.least
				? true
				: unit
					? `Too small: expected array to have >=${check.least} items`
					: `Too small: expected unknown to be >=${check.least}`;

		if ("most" in check)
			return Number(length) <= check.most
				? true
				: unit
					? `Too big: expected array to have <=${check.most} items`
					: `Too big: expected unknown to be <=${check.most}`;

		return true;
	});

/** A text that passes every check, each failed check giving its own sentence; a value that is not text stops it. */
export function mcpText(
	checks: readonly [TextCheck, ...TextCheck[]],
): Reader<string> {
	const [first, ...rest] = checks.map(textCheck);

	const schema = Schema.Unknown.check(
		Schema.makeFilter((raw: RawValue) =>
			Predicate.isString(raw) ? true : notKind("string", raw),
		),
		...checks.map(sizeCheck),
	).pipe(
		Schema.decodeTo(Schema.String.check(first, ...rest), {
			decode: SchemaGetter.transform((raw: RawValue) =>
				// The filter above refused anything that is not text.
				Predicate.isString(raw) ? raw : "",
			),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

	return leaf(schema, () => undefined);
}

/**
 * A whole number from `least` to `most`: a number that is not whole is reported once and its range is not checked; a whole
 * number beyond the safe range says so and is checked against the range as well; a value that is not a number, or is not
 * finite, stops it.
 */
export function mcpInteger(range: {
	readonly least: number;
	readonly most: number;
}): Reader<number> {
	const schema = Schema.Unknown.check(
		Schema.makeFilter((raw: RawValue) =>
			Predicate.isNumber(raw) && Number.isFinite(raw)
				? true
				: notKind("number", raw),
		),
	).pipe(
		Schema.decodeTo(
			Schema.Number.check(
				Schema.makeFilter((value: number) => {
					if (!Number.isInteger(value))
						return "Invalid input: expected int, received number";

					if (Number.isSafeInteger(value)) return true;

					return value > 0
						? `Too big: expected int to be <=${Number.MAX_SAFE_INTEGER}`
						: `Too small: expected int to be >=${Number.MIN_SAFE_INTEGER}`;
				}),
				Schema.makeFilter((value: number) =>
					!Number.isInteger(value) || value >= range.least
						? true
						: `Too small: expected number to be >=${range.least}`,
				),
				Schema.makeFilter((value: number) =>
					!Number.isInteger(value) || value <= range.most
						? true
						: `Too big: expected number to be <=${range.most}`,
				),
			),
			{
				decode: SchemaGetter.transform((raw: RawValue) =>
					// The filter above refused anything that is not a finite number.
					Predicate.isNumber(raw) ? raw : Number.NaN,
				),
				encode: SchemaGetter.transform((value: number) => value),
			},
		),
	);

	return leaf(schema, () => undefined);
}

/** The one number `value`. Anything else stops it. */
export function mcpLiteral<const V extends number>(value: V): Reader<V> {
	return leaf(
		fieldOf<V>((raw) =>
			raw === value ? { value } : { say: `Invalid input: expected ${value}` },
		),
		() => undefined,
	);
}

/** One of a fixed set of texts. Anything else stops it. */
export function mcpChoice<const V extends readonly [string, ...string[]]>(
	values: V,
): Reader<V[number]> {
	const expected = values.map((value) => `"${value}"`).join("|");

	return leaf(
		fieldOf<V[number]>((raw) => {
			const found = values.find((value) => value === raw);

			return found === undefined
				? { say: `Invalid option: expected one of ${expected}` }
				: { value: found };
		}),
		() => undefined,
	);
}

/** The sentences of an object that Zod 4 gave: for a value that is not an object, and for keys that should not be there. */
export const mcpObjectSentences: RecordSentences = {
	notObject: (raw) => notKind("object", raw),
	unrecognized: (keys) =>
		`Unrecognized key${keys.length > 1 ? "s" : ""}: ${keys.map((key) => `"${key}"`).join(", ")}`,
};

/** Where an issue was found, as the MCP SDK wrote it: names joined with dots, a position in brackets. */
const where = (path: Issue["path"]) =>
	path.reduce<string>(
		(soFar, step, index) =>
			Predicate.isNumber(step)
				? `${soFar}[${step}]`
				: index === 0
					? step
					: `${soFar}.${step}`,
		"",
	);

/** What the MCP SDK said of a refused argument list: each sentence, with where it was found, one to a line. */
export function mcpRefusal(issues: readonly Issue[]): string {
	return issues
		.map((issue) =>
			issue.path.length === 0
				? issue.message
				: `${issue.message} at ${where(issue.path)}`,
		)
		.join("\n");
}
