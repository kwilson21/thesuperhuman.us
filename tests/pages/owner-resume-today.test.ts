import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bundleAstro } from "../helpers/render-astro";
import type { listResumeRequestsToday } from "~/lib/resume-requests-today";
import { fakeLocals } from "../helpers/runtime";
import { sqliteD1 } from "../helpers/sqlite-d1";

let site: Awaited<ReturnType<typeof bundleAstro>>;

beforeAll(async () => {
	site = await bundleAstro({ today: "src/pages/owner/index.astro" });
});

afterAll(async () => {
	await site?.remove();
});

type TodayStore = Parameters<typeof listResumeRequestsToday>[0];

async function render(store?: TodayStore) {
	const sql = new DatabaseSync(":memory:");

	try {
		sql.exec(readFileSync("db/music.sql", "utf8"));
		const env: Partial<Env> = { MUSIC_DB: sqliteD1(sql) };

		if (store) {
			// SAFETY: Today reads only the bulk text get and prefixed list methods implemented by this fixture.
			env.RESUME_STORE = store as KVNamespace;
		}

		return await site.render("today", {
			locals: fakeLocals(env, { email: "owner@example.test" }),
			request: new Request("https://thesuperhuman.us/owner"),
		});
	} finally {
		sql.close();
	}
}

it("renders the protected review link and destination without an inline send action", async () => {
	const id = "test-pending";

	const store: TodayStore = {
		list: async () => ({ keys: [{ name: "req:" + id }], list_complete: true }),
		get: async () =>
			new Map([
				[
					"req:" + id,
					JSON.stringify({
						name: "Sample <Owner test>",
						email: "recipient@example.test",
						company: "Fictional business",
						audience: "general",
						ts: Date.now() - 1000,
					}),
				],
			]),
	};

	const html = await render(store);

	expect(html).toContain("/owner/resume-approve?id=test-pending");
	expect(html).toContain("recipient@example.test");
	expect(html).toContain("Sample &lt;Owner test&gt;");
	expect(html).not.toContain("Approve and send resume");
});

it("does not say no requests when the list is incomplete", async () => {
	const store: TodayStore = {
		list: async () => ({ keys: [], list_complete: false, cursor: "next" }),
		get: async () => {
			throw new Error("An empty list must not be read.");
		},
	};

	const html = await render(store);

	expect(html).toContain("Could not check all requests");
	expect(html).not.toContain(">No pending requests</h2>");
});

it("says the queue is unavailable when its storage binding is missing", async () => {
	const html = await render();

	expect(html).toContain("Request status unavailable");
	expect(html).not.toContain(">No pending requests</h2>");
});
