// The edge for POST /api/owner/requests/[id]/brief-copy: what the owner's body must hold. The action is "send", and the
// confirmation that the owner checked the mail provider and the copy did not go out is a boolean when it is there. Anything
// else, a body that is not an object included, is refused with no word of why: the route answers a bare 400. A key the
// route does not know is dropped, as the Zod schema this replaced dropped it (tests/server/brief-copy-input.test.ts holds
// the reader to a frozen copy of that schema).
import * as Schema from "effect/Schema";
import { readAtEdge } from "./edge";

const BriefCopyBody = Schema.Struct({
	action: Schema.Literal("send"),
	confirmedNotSent: Schema.optional(Schema.Boolean),
});

export type BriefCopyInput = typeof BriefCopyBody.Type;

/** Reads the body of an owner's brief copy request. `body` is whatever the owner's page sent, parsed from JSON. */
export const readBriefCopyInput = <Body>(body: Body) =>
	readAtEdge(BriefCopyBody, body);
