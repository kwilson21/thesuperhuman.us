// The edge for POST /api/agreements/link: what a client's body must hold. A body that is not an object, or whose email
// is not text of at most 320 characters, or whose security-check token is not text of 1 to 2048 characters, is refused
// with the one sentence the route gives for any of them. The reader keeps every value as it arrived (the email is not
// trimmed here: the issuing flow normalises it). The differential test in tests/server/agreement-link-input.test.ts holds
// this reader to the Zod schema it replaced.
import * as Schema from "effect/Schema";
import { readAtEdge } from "./edge";

const AgreementLinkBody = Schema.Struct({
	email: Schema.String.check(
		Schema.isMaxLength(320, { message: "Invalid email." }),
	),
	turnstileToken: Schema.String.check(
		Schema.isMinLength(1, { message: "Complete the security check." }),
		Schema.isMaxLength(2048, { message: "Complete the security check." }),
	),
});

export type AgreementLinkInput = typeof AgreementLinkBody.Type;

/** Reads a link request body. `body` is whatever the visitor sent, parsed from JSON (or the form's fields). */
export const readAgreementLinkInput = <Body>(body: Body) =>
	readAtEdge(AgreementLinkBody, body);
