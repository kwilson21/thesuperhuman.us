import { beforeEach, describe, expect, it, vi } from "vitest";
import { websiteFeed } from "~/lib/publication/website";
import type { readProject as ReadProject } from "~/lib/publication/read";
import { double, partial } from "../helpers/doubles";

const readProject = vi.fn<typeof ReadProject>();

const env = partial<Env>({
	PUBLICATION_DB: double<D1Database>({}),
	PUBLICATION_PROJECTS: "threadline, the-engineers-daily",
});

beforeEach(() => vi.clearAllMocks());

describe("optional project feeds", () => {
	it("preserves the default Threadline caller", async () => {
		await websiteFeed(env, undefined, readProject);
		expect(readProject).toHaveBeenCalledWith(env.PUBLICATION_DB, "threadline");
	});
	it("reads the requested allowed project, never another project", async () => {
		await websiteFeed(env, "the-engineers-daily", readProject);
		expect(readProject).toHaveBeenCalledTimes(1);
		expect(readProject).toHaveBeenCalledWith(
			env.PUBLICATION_DB,
			"the-engineers-daily",
		);
	});
	it("does not query projects outside the allowlist or without a binding", async () => {
		expect(await websiteFeed(env, "private-project", readProject)).toBeNull();
		expect(
			await websiteFeed(
				partial<Env>({ PUBLICATION_PROJECTS: "threadline" }),
				undefined,
				readProject,
			),
		).toBeNull();
		expect(readProject).not.toHaveBeenCalled();
	});
	it("does not break the page if optional publication data fails", async () => {
		vi.mocked(readProject).mockRejectedValueOnce(new Error("offline"));
		expect(
			await websiteFeed(env, "the-engineers-daily", readProject),
		).toBeNull();
	});
});
