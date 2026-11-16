import { describe, expect, it } from "vitest";
import { websiteFeed } from "~/server/publication-feed";
import { double, partial } from "../helpers/doubles";
import { publicationWorld } from "../helpers/publication-world";

const world = () => {
	const w = publicationWorld();

	return {
		w,
		env: partial<Env>({
			PUBLICATION_DB: w.db,
			PUBLICATION_PROJECTS: "threadline, the-engineers-daily",
		}),
	};
};

describe("optional project feeds", () => {
	it("preserves the default Threadline caller", async () => {
		const { env } = world();

		expect(await websiteFeed(env)).toMatchObject({
			projectId: "threadline",
			revision: 0,
		});
	});

	it("reads the requested allowed project, never another project", async () => {
		const { env, w } = world();

		expect(await websiteFeed(env, "the-engineers-daily")).toMatchObject({
			projectId: "the-engineers-daily",
		});
		expect(w.batches).toHaveLength(1);
	});

	it("does not query projects outside the allowlist or without a binding", async () => {
		const { env, w } = world();

		expect(await websiteFeed(env, "private-project")).toBeNull();
		expect(
			await websiteFeed(partial<Env>({ PUBLICATION_PROJECTS: "threadline" })),
		).toBeNull();
		expect(w.batches).toEqual([]);
	});

	it("does not break the page if optional publication data fails", async () => {
		const { env, w } = world();

		w.failing(/publication_events/);
		expect(await websiteFeed(env, "the-engineers-daily")).toBeNull();
	});

	it("does not break the page if the database throws where a failure was not named", async () => {
		const env = partial<Env>({
			PUBLICATION_DB: double<D1Database>({
				prepare: () => {
					throw new Error("offline");
				},
			}),
			PUBLICATION_PROJECTS: "threadline",
		});

		expect(await websiteFeed(env)).toBeNull();
	});
});
