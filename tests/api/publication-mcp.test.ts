import type { APIContext } from "astro";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { publicationMcp, projectAccess } from "~/lib/publication/mcp";
import { publicationOAuthRoute } from "~/lib/publication/oauth";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { readJson } from "../helpers/json";

const env = partial<TestRuntime["env"]>({
	PUBLICATION_OWNER_ID: "10987837",
	PUBLICATION_PROJECTS: "threadline",
	PUBLICATION_DB: double<D1Database>({}),
});

const identity = { ownerId: "10987837", scopes: ["publication:threadline"] };

it("requires both current project allowlisting and a matching owner/project grant", () => {
	expect(projectAccess(env, identity, "threadline")).toBe(true);
	expect(
		projectAccess(env, { ...identity, ownerId: "other" }, "threadline"),
	).toBe(false);
	expect(projectAccess(env, { ...identity, scopes: [] }, "threadline")).toBe(
		false,
	);
	expect(
		projectAccess({ ...env, PUBLICATION_PROJECTS: "" }, identity, "threadline"),
	).toBe(false);
	expect(
		projectAccess(
			{ ...env, PUBLICATION_PROJECTS: "threadline,other" },
			identity,
			"other",
		),
	).toBe(false);
});

it("exposes tools with explicit mutating annotations and denies unauthorized projects before storage", async () => {
	const request = (method: string, params = {}) =>
		new Request("https://thesuperhuman.us/api/publication/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		});

	const response = await publicationMcp(request("tools/list"), env, identity);

	const list = await readJson<{
		result: {
			tools: { name: string; annotations: { destructiveHint: boolean } }[];
		};
	}>(response);

	expect(list.result.tools).toHaveLength(2);
	expect(
		list.result.tools.find((t) => t.name === "publish_project_update")
			?.annotations.destructiveHint,
	).toBe(true);

	for (const name of ["get_project_progress"]) {
		const reply = await publicationMcp(
			request("tools/call", { name, arguments: { projectId: "private" } }),
			env,
			identity,
		);

		expect(
			(await readJson<{ result: { isError: boolean } }>(reply)).result.isError,
		).toBe(true);
	}
});

it("fails closed before OAuth runtime loading when deployment credentials are absent", async () => {
	const call = (url: string) =>
		publicationOAuthRoute(
			partial<APIContext>({
				request: new Request(url),
				locals: {
					runtime: partial<TestRuntime>({
						env,
						ctx: double<ExecutionContext>({}),
					}),
				},
			}),
		);

	expect(
		(await call("https://thesuperhuman.us/api/publication/mcp")).status,
	).toBe(503);
	expect(
		(await call("https://preview.workers.dev/api/publication/mcp")).status,
	).toBe(404);
});

it("enables the website in deployment config without widening existing grants", () => {
	const config = readFileSync(
		new URL("../../wrangler.jsonc", import.meta.url),
		"utf8",
	);

	const projects = JSON.parse(
		config.match(/"PUBLICATION_PROJECTS"\s*:\s*("[^"\n]*")/)![1],
	);

	const deployed = { ...env, PUBLICATION_PROJECTS: projects };

	const websiteOwner = {
		...identity,
		scopes: ["publication:personal-website"],
	};

	expect(projectAccess(deployed, websiteOwner, "personal-website")).toBe(true);
	expect(projectAccess(deployed, identity, "personal-website")).toBe(false);
	expect(
		projectAccess(
			deployed,
			{ ...websiteOwner, ownerId: "other" },
			"personal-website",
		),
	).toBe(false);
	expect(projectAccess(deployed, websiteOwner, "threadline")).toBe(false);
});
