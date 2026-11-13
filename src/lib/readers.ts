import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import {
	afterwards,
	choiceField,
	emailPattern,
	FieldsRefused,
	fieldOf,
	type Issue,
	type KindSentences,
	type RawValue,
	readEvery,
	receivedKind,
	stringField,
} from "./fields";

// Nested readers (objects, arrays, numbers, dates, choices) read with Effect Schema field by field, and the failures kept
// as a list of issues, each with its path down to the field, in the order and with the sentences Zod 3 gave them: a
// value that fails two checks gives both issues, in the order of the checks (the owner request route lists every failed
// field of a rejected agreement details payload word for word, last sentence per path). The differential tests
// (tests/server/validators-differential.test.ts) compare the whole issue list, path and sentence, in order. The rules, as
// Zod 3 had them:
// - A value of the wrong type, a choice that is not one, and a text that is too long STOP that value: nothing is read from
//   it and the object that holds it is stopped too, so a check across fields (`refined`) never runs.
// - Any other failure (a number out of range, a date that is not a date, a blank answer, a control character, a list of
//   the wrong length, a key that should not be there) is reported and reading goes on with the value as it was.

/** What reading a value gave: its value (absent when it was stopped) and every issue found on the way. */
export type Read<T> =
	| { readonly stopped: true; readonly issues: readonly Issue[] }
	| {
			readonly stopped: false;
			readonly value: T;
			readonly issues: readonly Issue[];
	  };

/** One reader of one value: it takes the raw value and where it was found. */
export type Reader<T> = (
	raw: RawValue,
	path: readonly (string | number)[],
) => Read<T>;

/** The value type a reader reads. */
export type Value<S> = S extends Reader<infer T> ? T : never;

/** Zod's sentence for a value that is not the kind asked for. */
const notKind = (expected: string, raw: RawValue) =>
	raw === undefined
		? "Required"
		: `Expected ${expected}, received ${receivedKind(raw)}`;

/** A reader from an Effect schema that reads one value; `keep` says whether a failure leaves a value to go on with. */
export function leaf<T>(
	schema: Schema.ConstraintDecoder<T>,
	keep: (sentence: string, raw: RawValue) => { value: T } | undefined,
): Reader<T> {
	return (raw, path) => {
		const read = readEvery(schema, raw);

		if (read.ok) return { stopped: false, value: read.value, issues: [] };

		const issues = read.says.map((message) => ({ path, message }));
		const kept = keep(read.says.at(-1) ?? "", raw);

		return kept
			? { stopped: false, value: kept.value, issues }
			: { stopped: true, issues };
	};
}

/** The value a reader gives when the field is missing, in place of reading it (Zod's `.default`). */
export function withDefault<T>(reader: Reader<T>, value: T): Reader<T> {
	return (raw, path) => reader(raw === undefined ? value : raw, path);
}

/** A reader for a field that may be left out (Zod's `.optional()`): a missing field is not in the value. */
export function optional<T>(reader: Reader<T>): Reader<T | undefined> {
	return (raw, path) =>
		raw === undefined
			? { stopped: false, value: undefined, issues: [] }
			: reader(raw, path);
}

/** A reader that also takes `null` as a value of its own (Zod's `.nullable()`). */
export function nullable<T>(reader: Reader<T>): Reader<T | null> {
	return (raw, path) =>
		raw === null
			? { stopped: false, value: null, issues: [] }
			: reader(raw, path);
}

const control = "Remove control characters.";
const required = "This answer is required.";

/** The sentences Zod 3 gave a text that is not text, and a text that is too long. */
export const zodText = {
	kinds: {
		missing: "Required",
		wrongType: (received) => `Expected string, received ${received}`,
	},
	tooLong: (max: number) => `String must contain at most ${max} character(s)`,
} satisfies { kinds: KindSentences; tooLong: (max: number) => string };

/**
 * A text that is trimmed, at most `max` long, free of control characters, and normalised to NFC; with `needed`, not blank.
 * Too long, or not text, stops it; a control character or a blank answer does not.
 */
export function text(
	schema: Schema.ConstraintDecoder<string>,
	needed: boolean,
): Reader<string> {
	return leaf(schema, (sentence, raw) =>
		Predicate.isString(raw) &&
		(sentence === control || (needed && sentence === required))
			? { value: raw.trim().normalize("NFC") }
			: undefined,
	);
}

/** A text, as written, that has to be a valid date; a date that is not valid does not stop it. */
export function dateText(
	valid: (value: string) => boolean,
	message: string,
): Reader<string> {
	return leaf(
		stringField(
			{ ...zodText.kinds, trim: false },
			Schema.makeFilter((value: string) => (valid(value) ? true : message)),
		),
		(sentence, raw) =>
			Predicate.isString(raw) && sentence === message
				? { value: raw }
				: undefined,
	);
}

/** A text, as written, that has to match a pattern, with Zod's "Invalid"; a text that does not match does not stop it. */
export function patternText(pattern: RegExp): Reader<string> {
	return leaf(
		stringField(
			{ ...zodText.kinds, trim: false },
			Schema.isPattern(pattern, { message: "Invalid" }),
		),
		(sentence, raw) =>
			Predicate.isString(raw) && sentence === "Invalid"
				? { value: raw }
				: undefined,
	);
}

/** A trimmed email address of at most 320 characters, lower-cased. Any failure stops it. */
export const emailText: Reader<string> = leaf(
	afterwards(
		stringField(
			zodText.kinds,
			Schema.isPattern(emailPattern, { message: "Invalid email" }),
			Schema.isMaxLength(320, { message: zodText.tooLong(320) }),
		),
		(value) => value.toLowerCase(),
	),
	() => undefined,
);

/** One check on a number, in the order Zod ran them. */
export type NumberCheck =
	| "int"
	| { readonly above: number }
	| { readonly least: number }
	| { readonly most: number };

/** The sentence of one number check, or true when the number passes it. */
const numberCheck = (check: NumberCheck) =>
	Schema.makeFilter((value: number) => {
		if (check === "int")
			return Number.isInteger(value)
				? true
				: "Expected integer, received float";

		if ("above" in check)
			return value > check.above
				? true
				: `Number must be greater than ${check.above}`;

		if ("least" in check)
			return value >= check.least
				? true
				: `Number must be greater than or equal to ${check.least}`;

		return value <= check.most
			? true
			: `Number must be less than or equal to ${check.most}`;
	});

/**
 * A number that passes every check, each failed check giving its own sentence in order; a number out of range does not
 * stop it, a value that is not a number (or is NaN) does.
 */
export function integer(checks: readonly NumberCheck[]): Reader<number> {
	const [first, ...rest] = checks.map(numberCheck);

	const schema = Schema.Unknown.check(
		Schema.makeFilter((raw: RawValue) =>
			Predicate.isNumber(raw) && !Number.isNaN(raw)
				? true
				: notKind("number", raw),
		),
	).pipe(
		Schema.decodeTo(
			first ? Schema.Number.check(first, ...rest) : Schema.Number,
			{
				decode: SchemaGetter.transform((raw: RawValue) =>
					// The filter above refused anything that is not a number.
					Predicate.isNumber(raw) ? raw : Number.NaN,
				),
				encode: SchemaGetter.transform((value: number) => value),
			},
		),
	);

	return leaf(schema, (_sentence, raw) =>
		Predicate.isNumber(raw) && !Number.isNaN(raw) ? { value: raw } : undefined,
	);
}

/** A boolean. Anything else stops it. */
export const truth: Reader<boolean> = leaf(
	fieldOf<boolean>((raw) =>
		raw === true || raw === false
			? { value: raw }
			: { say: notKind("boolean", raw) },
	),
	() => undefined,
);

/** The one value `true`, with Zod's sentence for anything else (which stops it). */
export const alwaysTrue: Reader<true> = leaf(
	fieldOf<true>((raw) =>
		raw === true
			? { value: true }
			: { say: "Invalid literal value, expected true" },
	),
	() => undefined,
);

/** One of a fixed set of texts, with Zod's sentences. Anything else stops it. */
export function oneOf<const V extends readonly [string, ...string[]]>(
	values: V,
): Reader<V[number]> {
	const expected = values.map((value) => `'${value}'`).join(" | ");

	return leaf(
		choiceField(values, {
			missing: "Required",
			wrongType: (received) => `Expected ${expected}, received ${received}`,
			notOneOf: (received) =>
				`Invalid enum value. Expected ${expected}, received '${received}'`,
		}),
		() => undefined,
	);
}

/** A list of one reader, of a length within `min` and `max`; a list of the wrong length does not stop it. */
export function list<T>(
	element: Reader<T>,
	length: { readonly min?: number; readonly max?: number },
): Reader<T[]> {
	return (raw, path) => {
		if (!Array.isArray(raw))
			return {
				stopped: true,
				issues: [{ path, message: notKind("array", raw) }],
			};

		const issues: Issue[] = [];

		if (length.min !== undefined && raw.length < length.min)
			issues.push({
				path,
				message: `Array must contain at least ${length.min} element(s)`,
			});

		if (length.max !== undefined && raw.length > length.max)
			issues.push({
				path,
				message: `Array must contain at most ${length.max} element(s)`,
			});

		const values: T[] = [];
		let stopped = false;

		raw.forEach((item: RawValue, index: number) => {
			const read = element(item, [...path, index]);

			issues.push(...read.issues);

			if (read.stopped) stopped = true;
			else values.push(read.value);
		});

		return stopped ? { stopped, issues } : { stopped, value: values, issues };
	};
}

/** The readers of the fields of an object, in the order they are written. */
type Fields = { readonly [name: string]: Reader<never> | Reader<unknown> };

/** The object a set of field readers reads. */
export type Fielded<F extends Fields> = Flat<
	{
		-readonly [K in keyof F as undefined extends Value<F[K]>
			? never
			: K]: Value<F[K]>;
	} & {
		-readonly [K in keyof F as undefined extends Value<F[K]>
			? K
			: never]?: Exclude<Value<F[K]>, undefined>;
	}
>;

/** One object type with the properties of an intersection. */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * An object that holds these fields and, with `strict`, nothing else (an unknown key is reported, and does not stop it).
 * The fields are read in order, each from the body's key of that name, and the value has the fields in that order.
 */
export function record<F extends Fields>(
	fields: F,
	options: { readonly strict: boolean },
): Reader<Fielded<F>> {
	return (raw, path) => {
		if (receivedKind(raw) !== "object" || !Predicate.isObject(raw))
			return {
				stopped: true,
				issues: [{ path, message: notKind("object", raw) }],
			};

		const issues: Issue[] = [];
		const values: [string, unknown][] = [];
		let stopped = false;

		for (const name of Object.keys(fields)) {
			// SAFETY: the reader of a field was written for the field's value, and Fields lists each name once.
			const read = (fields[name] as Reader<unknown>)(raw[name], [
				...path,
				name,
			]);

			issues.push(...read.issues);

			if (read.stopped) stopped = true;
			else if (read.value !== undefined) values.push([name, read.value]);
		}

		if (options.strict) {
			const extra: string[] = [];

			for (const key in raw) if (!Object.hasOwn(fields, key)) extra.push(key);

			if (extra.length > 0)
				issues.push({
					path,
					message: `Unrecognized key(s) in object: ${extra.map((key) => `'${key}'`).join(", ")}`,
				});
		}

		// SAFETY: every value was read by the reader of the field it is stored under, which Fielded<F> names.
		return stopped
			? { stopped, issues }
			: { stopped, value: Object.fromEntries(values) as Fielded<F>, issues };
	};
}

/**
 * A reader with a check across its fields, run when the reader was not stopped (even when it reported issues). `check`
 * adds an issue for a path and sentence; paths are written as one string, as the sentences of this check always were.
 */
export function refined<T>(
	reader: Reader<T>,
	check: (value: T, add: (path: string, message: string) => void) => void,
): Reader<T> {
	return (raw, path) => {
		const read = reader(raw, path);

		if (read.stopped) return read;

		const issues = [...read.issues];

		check(read.value, (field, message) =>
			issues.push({ path: [...path, field], message }),
		);

		return { stopped: false, value: read.value, issues };
	};
}

/** What reading a whole body answers: its value, or every issue. */
export function readWith<T>(
	reader: Reader<T>,
	input: RawValue,
): { ok: true; value: T } | { ok: false; issues: readonly Issue[] } {
	const read = reader(input, []);

	return read.stopped || read.issues.length > 0
		? { ok: false, issues: read.issues }
		: { ok: true, value: read.value };
}

/** The value of a body, or a thrown `FieldsRefused` that lists every issue (its message starts with `[`). */
export function parseWith<T>(reader: Reader<T>, input: RawValue): T {
	const read = readWith(reader, input);

	if (!read.ok) throw new FieldsRefused(read.issues);

	return read.value;
}
