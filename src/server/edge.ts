// The edge: where a form field, a part of the address, a request body or stored text becomes a typed value, with Effect's
// Schema. Plain code reads through readAtEdge or readFields; rules inside the app take the typed value and never parse
// again. Copied from kwilson21/tally `src/edge.ts`, with `readFields` added for the site's per-field error format. The
// field helpers (`readFields`, `readVariants`, `textField`, `stringField`, `choiceField`, `fieldOf`) live in
// src/lib/fields.ts, which a browser bundle may import; this file re-exports them and keeps the readers that run an Effect.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

export * from "../lib/fields";

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
