// The step the music file flow and the link preview video flow share: the bytes a Range header asks for, from the size the
// file turned out to have. The rule refuses a header the file cannot serve; the refusal carries no facts, so the size the
// route's 416 must name is added here.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { decideMediaRange } from "../rules/media-range";

/** The Range header asks for bytes the file of `size` bytes does not have. The route answers 416 and names the size. */
export class RangeOutsideFile extends Data.TaggedError("RangeOutsideFile")<{
	readonly size: number;
}> {}

/** The bytes to read for the request, or `null` for the whole file (and always for HEAD). */
export const sliceOf = (
	request: { readonly method: string; readonly range: string | null },
	size: number,
) =>
	decideMediaRange
		.decide(request, { size })
		.pipe(
			Effect.catchTag("RangeUnsatisfiable", () =>
				Effect.fail(new RangeOutsideFile({ size })),
			),
		);
