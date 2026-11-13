// The edge: where a form field, a part of the address, a request body or stored text becomes a typed value, with Effect's
// Schema. Plain code reads through readAtEdge or readFields; rules inside the app take the typed value and never parse
// again. Copied from kwilson21/tally `src/edge.ts`, with `readFields` added for the site's per-field error format.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

/**
 * What the edge reads: a piece of text, a parsed JSON body (what `musicRequest` and `request.json()` give), or nothing
 * where a field or part is not there. A schema checks it; no other code reads it.
 */
export type EdgeInput = Schema.Json | undefined;

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
 * Schema's, and is for a log only. A field or part that is not there is `undefined`, which no schema here reads.
 */
export function readAtEdge<S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	input: EdgeInput,
): { ok: true; value: S["Type"] } | { ok: false; say: string } {
	const read = Schema.decodeUnknownResult(schema)(input);

	return Result.isSuccess(read)
		? { ok: true, value: read.success }
		: { ok: false, say: read.failure.message };
}

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

function isJsonObject(input: EdgeInput): input is Schema.JsonObject {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

/**
 * Reads a body field by field, for the site's `{ ok: false, errors: { field: message } }` answer. Each field is decoded
 * on its own by its own schema, so one bad field never hides another, and each failure is that field's one sentence.
 * Only the named fields are read; any other key in the body is ignored. A body that is not an object has no fields, so
 * every field is read as missing.
 */
export function readFields<F extends FieldSchemas<F>>(
	fields: F,
	input: EdgeInput,
): { ok: true; value: FieldValues<F> } | { ok: false; errors: FieldErrors<F> } {
	const body = isJsonObject(input) ? input : undefined;
	// SAFETY: Object.keys of F lists its own enumerable string keys, and F's keys are the field names it was written with.
	const names = Object.keys(fields) as Extract<keyof F, string>[];
	const values: [string, F[keyof F]["Type"]][] = [];
	const errors: [string, string][] = [];

	for (const name of names) {
		const read = readAtEdge(
			fields[name],
			body !== undefined && Object.hasOwn(body, name) ? body[name] : undefined,
		);

		if (read.ok) values.push([name, read.value]);
		else errors.push([name, read.say]);
	}

	if (errors.length === 0)
		// SAFETY: each decoded value is stored under the field name it was decoded for, and its schema is F[name], so the entries are FieldValues<F>.
		return { ok: true, value: Object.fromEntries(values) as FieldValues<F> };

	// SAFETY: each sentence is stored under a field name from F's own keys, so the entries are FieldErrors<F>.
	return { ok: false, errors: Object.fromEntries(errors) as FieldErrors<F> };
}
