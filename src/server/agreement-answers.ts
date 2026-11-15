// The fixed answers the two signed-document download routes share, as the music routes keep theirs next to
// `musicRequest` (src/lib/music-request.ts): a plain-text answer with the agreement headers, and the answer for a failure
// the route logs once through `logUnexpected` before it gives its fixed sentence.
import * as Effect from "effect/Effect";
import { agreementHeaders } from "../lib/agreement-access";
import { logUnexpected } from "./failure";

/** A plain-text answer with the agreement headers (private, no store, no index). */
export const agreementText = (body: string, status: number) =>
	new Response(body, { status, headers: agreementHeaders });

/** The answer to a failure: logged once for `route`, without what was sent, then the route's own fixed `answer`. */
export const loggedAnswer =
	(route: string, answer: () => Response) =>
	<Failure>(failure: Failure) =>
		Effect.sync(() => {
			logUnexpected(route, failure);

			return answer();
		});
