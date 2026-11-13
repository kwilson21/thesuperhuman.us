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

/** A decode that reads an input with `read`, or refuses with the sentence `read` gives. */
const readFrom = <I, T>(read: (input: I) => { value: T } | { say: string }) =>
	SchemaGetter.transformEffect<T, I>((input, options) => {
		const answer = read(input);

		return "value" in answer
			? Effect.succeed(answer.value)
			: Effect.fail(
					new SchemaIssue.InvalidValue({ message: answer.say }, input, options),
				);
	});

/** A decode that reads `text` into a value with `read`, or refuses with the sentence `read` gives. */
export const readText = <T>(
	read: (text: string) => { value: T } | { say: string },
) => readFrom<string, T>(read);

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

/** What a body held for a field, as it arrived: anything, and `undefined` for a field that is missing. */
export type RawValue = Schema.Unknown["Type"];

/** A body that is an object, read by name. */
export type Body = { readonly [name: string]: RawValue };

/**
 * What a value's kind is called in a sentence such as "Expected string, received number": the words Zod uses, so a
 * validator that says them can be matched. `undefined` and `null` are themselves, an array is "array", NaN is "nan".
 */
export function receivedKind(raw: RawValue): string {
	if (Predicate.isUndefined(raw)) return "undefined";

	if (Predicate.isNull(raw)) return "null";

	if (Array.isArray(raw)) return "array";

	if (Predicate.isNumber(raw)) return Number.isNaN(raw) ? "nan" : "number";

	if (Predicate.isString(raw)) return "string";

	if (Predicate.isBoolean(raw)) return "boolean";

	if (Predicate.isBigInt(raw)) return "bigint";

	if (Predicate.isSymbol(raw)) return "symbol";

	return Predicate.isFunction(raw) ? "function" : "object";
}

/**
 * A field read from the raw value, so the sentence can depend on what arrived: `read` gets exactly what the body held
 * (`undefined` for a field that is missing) and answers the typed value or the one sentence to give. The other
 * builders (`stringField`, `choiceField`) are written with it.
 */
export const fieldOf = <A>(
	read: (raw: RawValue) => { value: A } | { say: string },
) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(
			Schema.declare((_: unknown): _ is A => true),
			{
				decode: readFrom<RawValue, A>(read),
				encode: SchemaGetter.transform((value: A) => value),
			},
		),
	);

/** The two sentences a builder gives before it reads the value's content. */
export type KindSentences = {
	/** For a field that is missing (`undefined`). */
	readonly missing: string;
	/** For a value of the wrong type, given what arrived (`receivedKind`): "number", "null", "array". */
	readonly wrongType: (received: string) => string;
};

/**
 * A text field that keeps the raw value: a missing field gives `missing`, any other value that is not a string gives
 * `wrongType` naming what arrived, and a string is trimmed (unless `trim` is false) and then read by `checks`, in the
 * order given. Unlike `textField`, a value that is not a string is not read as empty.
 */
export const stringField = (
	sentences: KindSentences & { readonly trim?: boolean },
	...checks: readonly SchemaAST.Check<string>[]
) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(stringWith(checks), {
			decode: readFrom<RawValue, string>((raw) => {
				if (raw === undefined) return { say: sentences.missing };

				if (!Predicate.isString(raw))
					return { say: sentences.wrongType(receivedKind(raw)) };

				return { value: sentences.trim === false ? raw : raw.trim() };
			}),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

/**
 * One of a fixed set of strings, keeping the raw value: a missing field gives `missing`, a value that is not a string
 * gives `wrongType` naming what arrived, and a string that is not in the set gives `notOneOf`, which quotes it.
 */
export const choiceField = <const V extends readonly [string, ...string[]]>(
	values: V,
	sentences: KindSentences & {
		readonly notOneOf: (received: string) => string;
	},
) =>
	fieldOf<V[number]>((raw) => {
		if (raw === undefined) return { say: sentences.missing };

		if (!Predicate.isString(raw))
			return { say: sentences.wrongType(receivedKind(raw)) };

		const chosen = values.find((value) => value === raw);

		return chosen === undefined
			? { say: sentences.notOneOf(raw) }
			: { value: chosen };
	});

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
	| "undefined"
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
 *   `validateContactInput` does). A record refuses only the kinds it names (`undefined`, `null`, `array`, `string`, `number`, `boolean`, and
 *   `other` for a bigint, a symbol or a function), each with its own sentence (as Zod's "Expected object, received ..."
 *   does, which also refuses an array); an object is never refused. Without it, a body that is not an object has no
 *   fields and each is read as missing.
 * - `winner`: which sentence a field gives when several of its checks fail: the `first` check that failed (the default,
 *   an `else if` chain) or the `last` (Zod's `Object.fromEntries` over its issues).
 * - `defaults`: the value a field takes when it is missing or `undefined`, in place of reading it. Not checked.
 * - `alongside`: checks on the raw body (what the body held, before any field reads it), run even while field checks
 *   fail. Its sentences are merged into the field errors like `{ ...fieldErrors, ...alongside }`: a key both name keeps
 *   the place the field errors gave it and takes alongside's sentence, and a key only alongside names comes after the
 *   field errors, in alongside's order. When the merge is not empty the body is refused and `after` does not run. It is
 *   not run for a body that is not an object (an array is not one here). An entry whose value is `undefined` is dropped.
 * - `after`: checks across fields, run only once every field has been read, with the typed values. It answers the
 *   sentences to give (empty when all is well; an entry whose value is `undefined` is dropped); when it answers any,
 *   they are the result's errors.
 */
export type ReadFieldsOptions<F extends FieldSchemas<F>> = {
	readonly notObject?: string | { readonly [K in BodyKind]?: string };
	readonly winner?: "first" | "last";
	readonly defaults?: { readonly [K in keyof F]?: F[K]["Type"] };
	readonly alongside?: (input: Body) => FormErrors<F>;
	readonly after?: (value: FieldValues<F>) => FormErrors<F>;
};

/** The kind of a body that is not an object; "other" is a bigint, a symbol or a function. Never called for an object. */
function kindOf<Input>(input: Input): BodyKind {
	if (input === undefined) return "undefined";

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

	// An object (not an array) is what a body should be: no sentence is for it.
	return Predicate.isObject(input) ? undefined : notObject[kindOf(input)];
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

/** Sentences by name; an entry that is `undefined` says nothing. */
type Sentences = { readonly [name: string]: string | undefined };

/** What reading a set of fields left: each field's value, and each failing field's sentence, in the order of the fields. */
type Read = {
	readonly values: [string, unknown][];
	readonly errors: [string, string][];
};

/** Reads each field of `fields` from the body's own keys, on its own, so one bad field never hides another. */
function readEach<F extends FieldSchemas<F>, Input>(
	fields: F,
	input: Input,
	winner: "first" | "last",
	defaults: { readonly [K in keyof F]?: F[K]["Type"] } | undefined,
): Read {
	// SAFETY: Object.keys of F lists its own enumerable string keys, and F's keys are the field names it was written with.
	const names = Object.keys(fields) as Extract<keyof F, string>[];
	const values: [string, unknown][] = [];
	const errors: [string, string][] = [];

	for (const name of names) {
		// An array has no named fields, so it reads as a body with every field missing.
		const given =
			Predicate.isObject(input) && Object.hasOwn(input, name)
				? input[name]
				: undefined;

		if (given === undefined && defaults && Object.hasOwn(defaults, name)) {
			values.push([name, defaults[name]]);
			continue;
		}

		const read = sentenceOf(fields[name], given, winner);

		if (read.ok) values.push([name, read.value]);
		else errors.push([name, read.say]);
	}

	return { values, errors };
}

/** The entries of `sentences` that say something. */
const spoken = (sentences: Sentences | undefined) =>
	Object.entries(sentences ?? {}).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	);

/**
 * Decides the answer once the fields are read: the field errors merged with what `alongside` says of the raw body,
 * or, when there are none, what `after` says of the typed values. `V` is the shape the caller gives its values.
 */
function settle<V>(
	read: Read,
	body: Body | undefined,
	hooks: {
		readonly alongside?: (input: Body) => Sentences;
		readonly after?: (value: V) => Sentences;
	},
): { ok: true; value: V } | { ok: false; errors: Sentences } {
	const beside = body ? spoken(hooks.alongside?.(body)) : [];

	const merged = {
		...Object.fromEntries(read.errors),
		...Object.fromEntries(beside),
	};

	if (Object.keys(merged).length > 0) return { ok: false, errors: merged };

	// SAFETY: each decoded value is stored under the field name it was decoded for, and the caller states V as those entries.
	const value = Object.fromEntries(read.values) as V;
	const across = Object.fromEntries(spoken(hooks.after?.(value)));

	return Object.keys(across).length > 0
		? { ok: false, errors: across }
		: { ok: true, value };
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

	const settled = settle<FieldValues<F>>(
		readEach(fields, input, options.winner ?? "first", options.defaults),
		Predicate.isObject(input) ? input : undefined,
		options,
	);

	// SAFETY: every key of the errors is a field name of F, or one `alongside` or `after` answered, which are FormErrors<F>.
	return settled.ok
		? settled
		: { ok: false, errors: settled.errors as FormErrors<F> };
}

/** Several sets of fields, named by the value of one field: `{ workflow: { today: ... }, idea: { idea: ... } }`. */
type VariantFields<V> = {
	readonly [K in keyof V]: FieldSchemas<V[K]>;
};

/** Every field name any variant has. */
type VariantFieldName<V> = { [K in keyof V]: keyof V[K] }[keyof V];

/** The typed value of a variant read: a union, one member per variant, each tagged with the discriminator's value. */
export type VariantValues<D extends string, V extends VariantFields<V>> = {
	readonly [K in Extract<keyof V, string>]: { readonly [P in D]: K } & {
		readonly [N in keyof V[K]]: V[K][N] extends Schema.ConstraintDecoder<unknown>
			? V[K][N]["Type"]
			: never;
	};
}[Extract<keyof V, string>];

/** What `readVariants` answers with when it fails: a sentence per field of any variant, the discriminator, and `_form`. */
export type VariantErrors<D extends string, V extends VariantFields<V>> = {
	readonly [K in VariantFieldName<V> | D | "_form"]?: string;
};

/**
 * How `readVariants` answers. `unknownVariant` is the sentence for a discriminator that is missing, not a string or not
 * one of the variants' names (an inherited name such as "toString" is not one). `notObject`, `winner`, `alongside` and
 * `after` are those of `readFields`; `after` gets the typed union. `defaults` are per variant.
 */
export type ReadVariantsOptions<
	D extends string,
	V extends VariantFields<V>,
> = {
	readonly unknownVariant: string;
	readonly notObject?: ReadFieldsOptions<Record<string, never>>["notObject"];
	readonly winner?: "first" | "last";
	readonly defaults?: {
		readonly [K in keyof V]?: {
			readonly [N in keyof V[K]]?: V[K][N] extends Schema.ConstraintDecoder<unknown>
				? V[K][N]["Type"]
				: never;
		};
	};
	readonly alongside?: (input: Body) => VariantErrors<D, V>;
	readonly after?: (value: VariantValues<D, V>) => VariantErrors<D, V>;
};

/**
 * Reads a body whose fields depend on one field's value (the software inquiry has different fields per `path`). The
 * discriminator's value picks the variant, that variant's fields are read as `readFields` reads them, and the value is
 * the fields' values tagged with the discriminator. A discriminator that names no variant answers with
 * `unknownVariant` under the discriminator's own key and reads no field.
 */
export function readVariants<
	D extends string,
	V extends VariantFields<V>,
	Input,
>(
	discriminator: D,
	variants: V,
	input: Input,
	options: ReadVariantsOptions<D, V>,
):
	| { ok: true; value: VariantValues<D, V> }
	| { ok: false; errors: VariantErrors<D, V> } {
	const form = formSentence(input, options.notObject);

	if (form !== undefined) {
		// SAFETY: _form is a key of VariantErrors by definition, and this entry is the only one.
		return {
			ok: false,
			errors: Object.fromEntries([["_form", form]]) as VariantErrors<D, V>,
		};
	}

	const given =
		Predicate.isObject(input) && Object.hasOwn(input, discriminator)
			? input[discriminator]
			: undefined;

	const chosen = Object.keys(variants).find((name) => name === given);

	const read: Read =
		chosen === undefined
			? { values: [], errors: [[discriminator, options.unknownVariant]] }
			: tagged(
					discriminator,
					chosen,
					// SAFETY: `chosen` is one of the variants' own keys, so this is that variant's field schemas.
					readEach(
						variants[chosen as Extract<keyof V, string>],
						input,
						options.winner ?? "first",
						options.defaults?.[chosen as Extract<keyof V, string>],
					),
				);

	const settled = settle<VariantValues<D, V>>(
		read,
		Predicate.isObject(input) ? input : undefined,
		options,
	);

	// SAFETY: every key of the errors is the discriminator, a field name of some variant, or one `alongside` or `after` answered, which are VariantErrors<D, V>.
	return settled.ok
		? settled
		: { ok: false, errors: settled.errors as VariantErrors<D, V> };
}

/** The values of a read, led by the discriminator and the variant it chose. */
function tagged(discriminator: string, chosen: string, read: Read): Read {
	return {
		values: [[discriminator, chosen], ...read.values],
		errors: read.errors,
	};
}
