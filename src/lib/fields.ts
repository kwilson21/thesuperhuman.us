// The shared field helpers: how a form field, a request body or stored text becomes a typed value with Effect's Schema, for
// the site's per-field error format (`{ ok: false, errors: { field: message } }`). Pure and synchronous, so a browser
// bundle and a server route read the same body the same way. It imports only the Schema modules listed in
// `ALLOWED_BROWSER_EFFECT_MODULES` (tests/helpers/client-graph.ts); it never imports `effect/Effect`, a service or a Layer.
// `src/server/edge.ts` re-exports everything here and adds the readers that run an Effect (`readAtEdge`, `readText`).
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

/** The email pattern Zod 3.25 checked with, kept so that an address is accepted or refused exactly as it was. */
export const emailPattern =
	/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

/** The UUID pattern Zod 3.25 checked with (it is not RFC 4122's: it asks for no version), kept for the same reason. */
export const uuidPattern =
	/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;

/** The type with its `readonly` marks removed, for a value a caller may change. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Sentences by field name, without the entries that say nothing, as a new plain object a caller may change. */
export function plainErrors(errors: {
	readonly [name: string]: string | undefined;
}): Record<string, string> {
	return Object.fromEntries(
		Object.entries(errors).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

/** One thing wrong with a body: where (the names and positions down to the field) and the sentence. */
export type Issue = {
	readonly path: readonly (string | number)[];
	readonly message: string;
};

/**
 * What `parse` functions throw: the failures, each with its path and sentence (`issues`, as a Zod error had) and by field
 * (`errors`, the last sentence for each path joined with "."). The message is the JSON of the failures, so it starts with
 * `[` as the message of a Zod error did (the review route shows a message to the visitor unless it starts with `[`).
 */
export class FieldsRefused extends Error {
	readonly issues: readonly Issue[];
	readonly errors: Record<string, string>;

	constructor(failures: Record<string, string> | readonly Issue[]) {
		const issues: readonly Issue[] = Array.isArray(failures)
			? failures
			: Object.entries(failures).map(([field, message]) => ({
					path: [field],
					message,
				}));

		super(JSON.stringify(issues, null, 2));
		this.name = "FieldsRefused";
		this.issues = issues;
		this.errors = Object.fromEntries(
			issues.map((issue) => [issue.path.join("."), issue.message]),
		);
	}
}

/** A check on text: `Schema.isMaxLength(...)`, `Schema.makeFilter(...)`. */
type StringCheck = Parameters<typeof Schema.String.check>[0];

/** Schema.String with the checks given (none is allowed). */
const stringWith = (checks: readonly StringCheck[]) => {
	const [first, ...rest] = checks;

	return first ? Schema.String.check(first, ...rest) : Schema.String;
};

/**
 * A text field as the site's validators read it: anything that is not a string reads as `""` (a missing field, a number,
 * `null`, an array), and a string is trimmed. `checks` run on the trimmed text, in the order given.
 */
export const textField = (...checks: readonly StringCheck[]) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(stringWith(checks), {
			decode: SchemaGetter.transform((value) =>
				Predicate.isString(value) ? value.trim() : "",
			),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);

/** Like `textField`, but a string is kept as it arrived (a token or a password is not trimmed). */
export const rawTextField = (...checks: readonly StringCheck[]) =>
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

/** What a value is called in the sentences Zod 3 used ("Expected string, received number"). */
export type Kind =
	| "undefined"
	| "null"
	| "array"
	| "string"
	| "number"
	| "nan"
	| "boolean"
	| "bigint"
	| "symbol"
	| "function"
	| "promise"
	| "map"
	| "set"
	| "date"
	| "object";

/**
 * What a value's kind is called in a sentence such as "Expected string, received number": the words Zod 3 used, so a
 * validator that says them can be matched. `undefined` and `null` are themselves, an array is "array", NaN is "nan", and
 * an object is "object" unless it is a promise, a map, a set or a date.
 */
export function receivedKind(raw: RawValue): Kind {
	if (Predicate.isUndefined(raw)) return "undefined";

	if (Predicate.isNull(raw)) return "null";

	if (Array.isArray(raw)) return "array";

	if (Predicate.isNumber(raw)) return Number.isNaN(raw) ? "nan" : "number";

	if (Predicate.isString(raw)) return "string";

	if (Predicate.isBoolean(raw)) return "boolean";

	if (Predicate.isBigInt(raw)) return "bigint";

	if (Predicate.isSymbol(raw)) return "symbol";

	if (Predicate.isFunction(raw)) return "function";

	if (
		Predicate.isPromiseLike(raw) &&
		"catch" in raw &&
		Predicate.isFunction(raw.catch)
	)
		return "promise";

	if (raw instanceof Map) return "map";

	if (raw instanceof Set) return "set";

	return raw instanceof Date ? "date" : "object";
}

/** What reading a raw value gives: the typed value, or the one sentence to say. */
type Reading<A> = { value: A } | { say: string };

/** The schema that refuses with the sentence `read` gives, or lets the raw value through to be decoded. */
const refusing = <A>(read: (raw: RawValue) => Reading<A>) =>
	Schema.Unknown.check(
		Schema.makeFilter((raw: RawValue) => {
			const answer = read(raw);

			return "say" in answer ? answer.say : true;
		}),
	);

/** The decode of a raw value that `refusing` let through: its typed value. */
const readValue = <A>(read: (raw: RawValue) => Reading<A>) =>
	SchemaGetter.transform((raw: RawValue): A => {
		const answer = read(raw);

		// `refusing` already refused every raw value that says something, so a value that gets here has a value.
		if ("value" in answer) return answer.value;

		throw new Error(answer.say);
	});

/**
 * A field read from the raw value, so the sentence can depend on what arrived: `read` gets exactly what the body held
 * (`undefined` for a field that is missing) and answers the typed value or the one sentence to give. The other
 * builders (`stringField`, `choiceField`) are written with it.
 */
export const fieldOf = <A>(read: (raw: RawValue) => Reading<A>) =>
	refusing(read).pipe(
		Schema.decodeTo(
			Schema.declare((_: unknown): _ is A => true),
			{
				decode: readValue(read),
				encode: SchemaGetter.transform((value: A) => value),
			},
		),
	);

/** Then `change` on the text, once every check has passed (a check that fails stops it). */
export const afterwards = <From extends Schema.ConstraintDecoder<string>>(
	text: From,
	change: (text: string) => string,
) =>
	Schema.decodeTo<typeof Schema.String, From>(Schema.String, {
		decode: SchemaGetter.transform(change),
		encode: SchemaGetter.transform((value: string) => value),
	})(text);

/** The two sentences a builder gives before it reads the value's content. */
export type KindSentences = {
	/** For a field that is missing (`undefined`). */
	readonly missing: string;
	/** For a value of the wrong type, given what arrived (`receivedKind`): "number", "null", "array". */
	readonly wrongType: (received: Kind) => string;
};

/**
 * A text field that keeps the raw value: a missing field gives `missing`, any other value that is not a string gives
 * `wrongType` naming what arrived, and a string is trimmed (unless `trim` is false) and then read by `checks`, in the
 * order given. Unlike `textField`, a value that is not a string is not read as empty.
 */
export const stringField = (
	sentences: KindSentences & { readonly trim?: boolean },
	...checks: readonly StringCheck[]
) => {
	const read = (raw: RawValue): Reading<string> => {
		if (raw === undefined) return { say: sentences.missing };

		if (!Predicate.isString(raw))
			return { say: sentences.wrongType(receivedKind(raw)) };

		return { value: sentences.trim === false ? raw : raw.trim() };
	};

	return refusing(read).pipe(
		Schema.decodeTo(stringWith(checks), {
			decode: readValue(read),
			encode: SchemaGetter.transform((value: string) => value),
		}),
	);
};

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

/** What kind of value a body is, for the refusal of a body that is not an object: any `Kind` but an object. */
export type BodyKind = Exclude<Kind, "object">;

/** Every kind a body that is not an object can be. */
export const bodyKinds: readonly BodyKind[] = [
	"undefined",
	"null",
	"array",
	"string",
	"number",
	"nan",
	"boolean",
	"bigint",
	"symbol",
	"function",
	"promise",
	"map",
	"set",
	"date",
];

/** The `notObject` option that gives one sentence for a body of any kind that is not an object (an array is refused too). */
export const refuseEveryKind = (
	sentence: string,
): { readonly [K in BodyKind]: string } =>
	// SAFETY: every BodyKind is a key of the result, since `bodyKinds` lists them all.
	Object.fromEntries(bodyKinds.map((kind) => [kind, sentence])) as {
		readonly [K in BodyKind]: string;
	};

/**
 * How `readFields` answers, beyond reading each field on its own.
 * - `notObject`: the `_form` sentence for a body that is not an object. A string refuses `null`, text, numbers,
 *   booleans and anything else that is not an object, and treats an array as an object with no fields (as
 *   `validateContactInput` does). A record refuses only the kinds it names (any `BodyKind`: `undefined`, `null`, `array`, `string`, `number`, `nan`,
 *   `boolean`, `bigint`, `symbol`, `function`, `promise`, `map`, `set` and `date`), each with its own sentence (as Zod's
 *   "Expected object, received ..." does, which also refuses an array); an object is never refused. Without it, a body that is not an object has no
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

/** The `_form` sentence for a body that is not an object, or undefined when it is read as one. */
function formSentence<Input>(
	input: Input,
	notObject: string | { readonly [K in BodyKind]?: string } | undefined,
): string | undefined {
	if (notObject === undefined) return undefined;

	if (Predicate.isString(notObject))
		return Predicate.isObjectOrArray(input) ? undefined : notObject;

	// An object (not an array, a date, a map, a set or a promise) is what a body should be: no sentence is for it.
	const kind = receivedKind(input);

	return kind === "object" ? undefined : notObject[kind];
}

/** Reads one value with one schema: its typed value, or the sentence the `winner` check gives (see `ReadFieldsOptions`). */
export function readOne<S extends Schema.ConstraintDecoder<unknown>, Input>(
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

		const read = readOne(fields[name], given, winner);

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

/**
 * Several sets of fields, named by the value of one field `D`: `{ workflow: { today: ... }, idea: { idea: ... } }`. No
 * variant may have a field named `D`: the discriminator is the tag, and a field of that name could carry another value.
 */
type VariantFields<D extends string, V> = {
	readonly [K in keyof V]: FieldSchemas<V[K]> & { readonly [P in D]?: never };
};

/** Every field name any variant has. */
type VariantFieldName<V> = { [K in keyof V]: keyof V[K] }[keyof V];

/** The typed value of a variant read: a union, one member per variant, each tagged with the discriminator's value. */
export type VariantValues<D extends string, V extends VariantFields<D, V>> = {
	readonly [K in Extract<keyof V, string>]: { readonly [P in D]: K } & {
		readonly [N in keyof V[K]]: V[K][N] extends Schema.ConstraintDecoder<unknown>
			? V[K][N]["Type"]
			: never;
	};
}[Extract<keyof V, string>];

/** What `readVariants` answers with when it fails: a sentence per field of any variant, the discriminator, and `_form`. */
export type VariantErrors<D extends string, V extends VariantFields<D, V>> = {
	readonly [K in VariantFieldName<V> | D | "_form"]?: string;
};

/**
 * How `readVariants` answers. `unknownVariant` is the sentence for a discriminator that is missing, not a string or not
 * one of the variants' names (an inherited name such as "toString" is not one). `notObject`, `winner`, `alongside` and
 * `after` are those of `readFields`; `after` gets the typed union. `defaults` are per variant.
 */
export type ReadVariantsOptions<
	D extends string,
	V extends VariantFields<D, V>,
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
	V extends VariantFields<D, V>,
	Input,
>(
	discriminator: D,
	variants: V,
	input: Input,
	options: ReadVariantsOptions<D, V>,
):
	| { ok: true; value: VariantValues<D, V> }
	| { ok: false; errors: VariantErrors<D, V> } {
	for (const [name, fields] of Object.entries(variants))
		if (Object.hasOwn(Object(fields), discriminator))
			throw new Error(
				`Variant "${name}" declares a field named "${discriminator}", the discriminator. Name the field something else.`,
			);

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

/** The values of a read, followed by the discriminator and the variant it chose, so nothing read can override it. */
function tagged(discriminator: string, chosen: string, read: Read): Read {
	return {
		values: [...read.values, [discriminator, chosen]],
		errors: read.errors,
	};
}
