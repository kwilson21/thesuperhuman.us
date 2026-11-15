// The answer the agreement routes give to a failure they log: once through `logUnexpected`, without what was sent, then the
// route's own fixed `answer`. The plain answers (`agreementJson`, `agreementText`) live in src/lib/agreement-access.ts, as the
// music routes keep theirs next to `musicRequest` (src/lib/music-request.ts).
import * as Effect from "effect/Effect";
import { logUnexpected } from "./failure";

export const loggedAnswer =
	(route: string, answer: () => Response) =>
	<Failure>(failure: Failure) =>
		Effect.sync(() => {
			logUnexpected(route, failure);

			return answer();
		});
