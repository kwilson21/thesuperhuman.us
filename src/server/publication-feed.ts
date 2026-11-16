// The project feed for the website's pages, which call it without a route: the feed or null. Optional public data must
// never break page rendering, so a failure of the store or a stored story that does not read gives null, and a defect is
// logged once through `logUnexpected` (which never logs what can quote stored text) and gives null too.
import * as Effect from "effect/Effect";
import type { ProjectFeed } from "../lib/publication/read";
import { logUnexpected } from "./failure";
import { readFeed } from "./flows/publication-feed";
import { listedProjects } from "./rules/publication-access";
import { bindingsOrUnavailable } from "./services";

export function websiteFeed(
	env: Env,
	projectId = "threadline",
): Promise<ProjectFeed | null> {
	const bindings = bindingsOrUnavailable(env, ["PUBLICATION_DB"]);

	if (
		!bindings.ok ||
		!listedProjects(env.PUBLICATION_PROJECTS).includes(projectId)
	)
		return Promise.resolve(null);

	return Effect.runPromise(
		readFeed(projectId).pipe(
			Effect.catchTags({
				PublicationStoreFailed: () => Effect.succeed(null),
				StoredPublicationInvalid: () => Effect.succeed(null),
			}),
			Effect.catchDefect((defect) =>
				Effect.sync(() => {
					logUnexpected("website feed", defect);

					return null;
				}),
			),
			Effect.provideContext(bindings.services),
		),
	);
}
