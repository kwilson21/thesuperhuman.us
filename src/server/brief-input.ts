// The edge for the two brief suggestion bodies: the body of POST /api/software/brief/pass (a captcha token) and of
// POST /api/software/brief/suggest (the question, the text and the earlier answers). Effect Schema readers that answer as
// the Zod 3 schemas they replaced did (tests/server/brief-input-differential.test.ts holds them to frozen copies of those
// schemas): an unknown key refuses the whole body, a question is read with its straight apostrophes changed to curly ones
// before it is checked against the six questions, and the value keeps the field order of the schema, because the model's
// prompt is the JSON of that value. Any refusal makes the route answer as it did: nothing says why.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { musicRequest } from "../lib/music-request";

const QUESTIONS = [
	"What happens today?",
	"What’s the idea?",
	"Have a first result in mind?",
	"Have a first version in mind?",
	"What’s the website for?",
	"What should the app let people do?",
] as const;

const isQuestion = Schema.makeFilter((text: string) =>
	QUESTIONS.some((question) => question === text),
);

/** Up to 100 characters, then the straight apostrophes become curly ones, then the text must be one of the six questions. */
const questionField = Schema.String.check(Schema.isMaxLength(100)).pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((text: string) => text.replaceAll("'", "’")),
		encode: SchemaGetter.transform((text: string) => text),
	}),
	Schema.check(isQuestion),
);

const PATHS = ["workflow", "idea", "website", "webapp"] as const;

const earlierSchema = Schema.Struct({
	path: Schema.Literals(PATHS),
	today: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
	idea: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
	purpose: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
	appGoal: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
});

export const suggestSchema = Schema.Struct({
	question: questionField,
	text: Schema.String.check(Schema.isMaxLength(2000)),
	earlier: earlierSchema,
});

export const passSchema = Schema.Struct({
	token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});

/** Reads the suggest body: the value, or nothing (a refusal says nothing). Unknown keys refuse, at both levels. */
export const readSuggestInput = <Body>(body: Body) =>
	readStrict(suggestSchema, body);

/** Reads the pass body: the captcha token, or nothing. Unknown keys refuse. */
export const readPassInput = <Body>(body: Body) => readStrict(passSchema, body);

/** The schema decode with excess keys refused, as `.strict()` refused them. */
function readStrict<S extends Schema.ConstraintDecoder<unknown>, Body>(
	schema: S,
	body: Body,
): { ok: true; value: S["Type"] } | { ok: false } {
	const read = Schema.decodeUnknownResult(schema)(body, {
		onExcessProperty: "error",
	});

	return Result.isSuccess(read)
		? { ok: true, value: read.success }
		: { ok: false };
}

/** The request's body could not be read to the end (the client left, or the stream failed). */
export class BodyReadFailed extends Data.TaggedError("BodyReadFailed")<{
	readonly failure: unknown;
}> {}

/** Reads the body as `musicRequest` does (a refusal of the request itself is a Response in the value); a stream that fails is a BodyReadFailed. */
export const readBody = (request: Request, maxBytes: number) =>
	Effect.tryPromise({
		try: () => musicRequest(request, maxBytes),
		catch: (failure) => new BodyReadFailed({ failure }),
	});
