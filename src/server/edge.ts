// The edge: where a form field, a part of the address, a request body or stored text becomes a typed value, with Effect's
// Schema. Plain code reads through readAtEdge or readFields; rules inside the app take the typed value and never parse
// again. Copied from kwilson21/tally `src/edge.ts`, with `readFields` added for the site's per-field error format.
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

/** A decode that reads `text` into a value with `read`, or refuses with the sentence `read` gives. */
export const readText = <T>(
	read: (text: string) => { value: T } | { say: string },
) =>
	SchemaGetter.transformEffect<T, string>((text, options) => {
		const answer = read(text);

		return "value" in answer
			? Effect.succeed(answer.value)
			: Effect.fail(
					new SchemaIssue.InvalidValue({ message: answer.say }, text, options),
				);
	});

/**
 * Reads one value at the edge, from plain code: the typed value, or the sentence that says why not. An edge whose words
 * a person reads gives its own sentence (readText, or a `message` on a filter); any other failure's sentence is
 * Schema's, and is for a log only. A field or part that is not there is `undefined`, which no schema here reads. The
 * input is whatever arrived: a piece of text, a parsed JSON body (what `request.json()` gives), or nothing. It is typed
 * by inference (`Input`) so that an `unknown` body compiles, and the schema is the only code that reads it.
 */
export function readAtEdge<S extends Schema.ConstraintDecoder<unknown>, Input>(
	schema: S,
	input: Input,
): { ok: true; value: S["Type"] } | { ok: false; say: string } {
	const read = Schema.decodeUnknownResult(schema)(input);

	return Result.isSuccess(read)
		? { ok: true, value: read.success }
		: { ok: false, say: read.failure.message };
}

/** Schema.String with the checks given (none is allowed). */
const stringWith = (checks: readonly SchemaAST.Check<string>[]) => {
	const [first, ...rest] = checks;

	return first ? Schema.String.check(first, ...rest) : Schema.String;
};

/**
 * A text field as the site's validators read it: anything that is not a string reads as `""` (a missing field, a number,
 * `null`, an array), and a string is trimmed. `checks` run on the trimmed text, in the order given.
 */
export const textField = (...checks: readonly SchemaAST.Check<string>[]) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(stringWith(checks), {
			decode: SchemaGetter.transform((value) =>
				Predicate.isString(value) ? value.trim() : "",
			),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

/** Like `textField`, but a string is kept as it arrived (a token or a password is not trimmed). */
export const rawTextField = (...checks: readonly SchemaAST.Check<string>[]) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(stringWith(checks), {
			decode: SchemaGetter.transform((value) =>
				Predicate.isString(value) ? value : "",
			),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

/** The field names to read, each with the small schema that reads it. */
type FieldSchemas<F> = {
	readonly [K in keyof F]: Schema.ConstraintDecoder<unknown>;
};

/** The typed value of every field. */
export type FieldValues<F extends FieldSchemas<F>> = {
	readonly [K in keyof F]: F[K]["Type"];
};

/** The sentence for each field that failed, keyed by the field names that were asked for and no others. */
export type FieldErrors<F extends FieldSchemas<F>> = {
	readonly [K in keyof F]?: string;
};

/** What `readFields` answers with when it fails: a sentence per field, and `_form` for the body as a whole. */
export type FormErrors<F extends FieldSchemas<F>> = {
	readonly [K in keyof F | "_form"]?: string;
};

/** What kind of value a body is, for the refusal of a body that is not an object. */
export type BodyKind =
	| "null"
	| "array"
	| "string"
	| "number"
	| "boolean"
	| "other";

/**
 * How `readFields` answers, beyond reading each field on its own.
 * - `notObject`: the `_form` sentence for a body that is not an object. A string refuses `null`, text, numbers,
 *   booleans and anything else that is not an object, and treats an array as an object with no fields (as
 *   `validateContactInput` does). A record refuses only the kinds it names, each with its own sentence (as Zod's
 *   "Expected object, received ..." does, which also refuses an array). Without it, a body that is not an object has no
 *   fields and each is read as missing.
 * - `winner`: which sentence a field gives when several of its checks fail: the `first` check that failed (the default,
 *   an `else if` chain) or the `last` (Zod's `Object.fromEntries` over its issues).
 * - `defaults`: the value a field takes when it is missing or `undefined`, in place of reading it. Not checked.
 * - `after`: checks across fields, run only once every field has been read, with the typed values. It answers the
 *   sentences to give (empty when all is well); when it answers any, they are the result's errors.
 */
export type ReadFieldsOptions<F extends FieldSchemas<F>> = {
	readonly notObject?: string | { readonly [K in BodyKind]?: string };
	readonly winner?: "first" | "last";
	readonly defaults?: { readonly [K in keyof F]?: F[K]["Type"] };
	readonly after?: (value: FieldValues<F>) => FormErrors<F>;
};

function kindOf<Input>(input: Input): BodyKind {
	if (Predicate.isNull(input)) return "null";

	if (Array.isArray(input)) return "array";

	if (Predicate.isString(input)) return "string";

	if (Predicate.isNumber(input)) return "number";

	return Predicate.isBoolean(input) ? "boolean" : "other";
}

/** The `_form` sentence for a body that is not an object, or undefined when it is read as one. */
function formSentence<Input>(
	input: Input,
	notObject: string | { readonly [K in BodyKind]?: string } | undefined,
): string | undefined {
	if (notObject === undefined) return undefined;

	if (Predicate.isString(notObject))
		return Predicate.isObjectOrArray(input) ? undefined : notObject;

	return notObject[kindOf(input)];
}

/** The sentence one field gives: the one `winner` picks from every check that failed. */
function sentenceOf<S extends Schema.ConstraintDecoder<unknown>, Input>(
	schema: S,
	input: Input,
	winner: "first" | "last",
): { ok: true; value: S["Type"] } | { ok: false; say: string } {
	const read = Schema.decodeUnknownResult(schema)(input, { errors: "all" });

	if (Result.isSuccess(read)) return { ok: true, value: read.success };

	const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(
		read.failure.issue,
	);

	const issue = winner === "last" ? issues.at(-1) : issues.at(0);

	return { ok: false, say: issue?.message ?? read.failure.message };
}

/**
 * Reads a body field by field, for the site's `{ ok: false, errors: { field: message } }` answer. Each field is decoded
 * on its own by its own schema, so one bad field never hides another, and each failure is that field's one sentence
 * (see `ReadFieldsOptions.winner`). The error keys follow the order the fields are written in `fields`, whatever the
 * order of the body's keys. Only the named fields are read, from the body's own keys; any other key is ignored. A body
 * that is not an object has no fields, so every field is read as missing, unless `notObject` answers for it.
 */
export function readFields<F extends FieldSchemas<F>, Input>(
	fields: F,
	input: Input,
	options: ReadFieldsOptions<F> = {},
): { ok: true; value: FieldValues<F> } | { ok: false; errors: FormErrors<F> } {
	const form = formSentence(input, options.notObject);

	if (form !== undefined) {
		// SAFETY: _form is a key of FormErrors<F> by definition, and this entry is the only one.
		return {
			ok: false,
			errors: Object.fromEntries([["_form", form]]) as FormErrors<F>,
		};
	}

	// SAFETY: Object.keys of F lists its own enumerable string keys, and F's keys are the field names it was written with.
	const names = Object.keys(fields) as Extract<keyof F, string>[];
	const values: [string, F[keyof F]["Type"]][] = [];
	const errors: [string, string][] = [];

	for (const name of names) {
		// An array has no named fields, so it reads as a body with every field missing.
		const given =
			Predicate.isObject(input) && Object.hasOwn(input, name)
				? input[name]
				: undefined;

		if (
			given === undefined &&
			options.defaults &&
			Object.hasOwn(options.defaults, name)
		) {
			values.push([name, options.defaults[name]]);
			continue;
		}

		const read = sentenceOf(fields[name], given, options.winner ?? "first");

		if (read.ok) values.push([name, read.value]);
		else errors.push([name, read.say]);
	}

	if (errors.length > 0)
		// SAFETY: each sentence is stored under a field name from F's own keys, so the entries are FormErrors<F>.
		return { ok: false, errors: Object.fromEntries(errors) as FormErrors<F> };

	// SAFETY: each decoded value is stored under the field name it was decoded for, and its schema is F[name], so the entries are FieldValues<F>.
	const value = Object.fromEntries(values) as FieldValues<F>;
	const across = options.after?.(value) ?? {};

	return Object.keys(across).length > 0
		? { ok: false, errors: across }
		: { ok: true, value };
}
