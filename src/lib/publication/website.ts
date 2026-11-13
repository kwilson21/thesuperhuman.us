import { readProject, type ProjectFeed } from "./read";

/** Optional public data must never break page rendering. The pages call it without `read`; it exists so the reader can be swapped. */
export async function websiteFeed(
	env: Env,
	projectId = "threadline",
	read: typeof readProject = readProject,
): Promise<ProjectFeed | null> {
	if (
		!env.PUBLICATION_DB ||
		!(env.PUBLICATION_PROJECTS ?? "")
			.split(",")
			.map((p) => p.trim())
			.includes(projectId)
	)
		return null;

	try {
		return await read(env.PUBLICATION_DB, projectId);
	} catch {
		return null;
	}
}
