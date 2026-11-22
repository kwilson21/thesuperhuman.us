// The edge for the two studio sign-in routes that take a body: POST /api/studio/code (an address and the security
// check's token) and POST /api/studio/session (an address and the emailed code). Effect Schema readers that accept and
// refuse every body as the Zod 4 schemas they replace did, with the same value (tests/server/validators-differential.test.ts
// holds each to a frozen copy of its schema): a body that is not an object, or a field that does not read, refuses the
// whole body, and the route answers its one sentence whatever was wrong. The value keeps the two fields only, in the
// order written below. A length is counted as Zod 4 counted it, in characters (a pair of UTF-16 units that make one
// character counts once, a lone half counts as one), not in UTF-16 units: an address of 160 emoji was within its 320.
// The address is kept as it arrived: `normalizeClientEmail` (src/lib/client-portal.ts) trims, lower-cases and checks it
// after the body is read, where the routes check it today. POST /api/studio/sign-out has no body.
import * as Schema from "effect/Schema";
import { characters } from "../lib/mcp-readers";
import { readAtEdge } from "./edge";

/** Text of `least` to `most` characters, counted as Zod 4 counted them (`characters`, the MCP readers' count). */
const textOf = (least: number, most: number) =>
	Schema.String.check(
		Schema.makeFilter((text: string) => {
			const count = characters(text);

			return count >= least && count <= most;
		}),
	);

/** The address as it arrived: text of at most 320 characters. */
const address = textOf(0, 320);

const CodeRequestBody = Schema.Struct({
	email: address,
	turnstileToken: textOf(1, 2048),
});

/** The emailed code: exactly eight digits, 0 to 9. */
const EIGHT_DIGITS = /^\d{8}$/;

const SessionRequestBody = Schema.Struct({
	email: address,
	code: Schema.String.check(Schema.isPattern(EIGHT_DIGITS)),
});

/** A code request, read: the address and the security check's token. */
export type CodeRequest = typeof CodeRequestBody.Type;

/** A code entry, read: the address and the eight digits typed. */
export type SessionRequest = typeof SessionRequestBody.Type;

/** Reads a code request body. `body` is what `musicRequest` parsed from JSON. */
export const readCodeRequest = <Body>(body: Body) =>
	readAtEdge(CodeRequestBody, body);

/** Reads a code entry body. `body` is what `musicRequest` parsed from JSON. */
export const readSessionRequest = <Body>(body: Body) =>
	readAtEdge(SessionRequestBody, body);
