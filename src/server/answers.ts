// The answer a route gives to a failure it logs: once through `logUnexpected`, without what was sent, then the route's own
// fixed `answer`. The plain answers live next to each area's request helper (`musicRequest` in src/lib/music-request.ts,
// `agreementJson` in src/lib/agreement-access.ts, `mediaFailed` in src/lib/media-answers.ts).
import * as Effect from "effect/Effect";
import { logUnexpected } from "./failure";

export const loggedAnswer =
	(route: string, answer: () => Response) =>
	<Failure>(failure: Failure) =>
		Effect.sync(() => {
			logUnexpected(route, failure);

			return answer();
		});
