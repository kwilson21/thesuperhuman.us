import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asVisitor, runCase, START, uuidFor, type Case } from "./index";
import { astroPages, type AstroPages } from "./page";

// The checks on the page handler (page.ts): a compiled .astro page answers a step with its own status, headers, cookies
// and HTML; what it does through locals.runtime.env is recorded like a route's; the frozen clock and seeded ids reach
// the bundled copy; and a page that throws is recorded as `rejected`, never as a 500 the container made up.

/** A page that does what the verify pages do: read the env, set its status and headers, return a Response, or throw. */
const SOURCE = `---
const mode = Astro.url.searchParams.get("mode");

if (mode === "throw") throw new Error("the page threw");

if (mode === "redirect")
	return new Response(null, {
		status: 303,
		headers: { location: "/next", "set-cookie": "golden=1; Path=/; HttpOnly" },
	});

const row = await Astro.locals.runtime.env.MUSIC_DB.prepare(
	"SELECT COUNT(*) AS n FROM owner_requests",
).first();

Astro.response.status = 418;
Astro.response.headers.set("X-Page", "golden");

const at = new Date().toISOString();
const id = crypto.randomUUID();
---
<p id="count">{row.n}</p><p id="param">{Astro.params.name}</p><p id="at">{at}</p><p id="id">{id}</p>
`;

let directory = "";
let pages: AstroPages<"page"> | undefined;

beforeAll(async () => {
	// Under node_modules/.cache, as render-astro.ts keeps its bundles, so no tree walker or checker reads the page.
	await mkdir(resolve("node_modules/.cache"), { recursive: true });
	directory = await mkdtemp(resolve("node_modules/.cache/golden-page-"));
	await writeFile(resolve(directory, "page.astro"), SOURCE);
	pages = await astroPages({ page: resolve(directory, "page.astro") });
});

afterAll(async () => {
	await pages?.remove();

	if (directory) await rm(directory, { recursive: true, force: true });
});

const visit = (mode = ""): Case => ({
	name: "page",
	steps: [
		{
			as: asVisitor(),
			method: "GET",
			path: `/things/golden${mode ? `?mode=${mode}` : ""}`,
			params: { name: "golden-param" },
		},
	],
});

const record = (mode = "") => {
	if (!pages) throw new Error("the page was not compiled");

	return runCase(pages.page("page"), visit(mode));
};

describe("a page as a corpus handler", () => {
	it("answers with the page's own status, headers and whole HTML, with the params it was given", async () => {
		const [step] = (await record()).steps;

		expect(step.answer).toStrictEqual({
			outcome: "response",
			status: 418,
			headers: {
				"content-length": expect.any(String),
				"content-type": "text/html",
				"x-page": "golden",
			},
			setCookies: [],
			body: expect.stringMatching(/^<!DOCTYPE html>/),
		});

		if (step.answer.outcome === "response")
			expect(step.answer.body).toContain(
				'<p id="count">0</p><p id="param">golden-param</p>',
			);
	});

	it("does not record the stand-in middleware's marker", async () => {
		const [step] = (await record()).steps;

		expect(step.answer.outcome).toBe("response");

		if (step.answer.outcome === "response")
			expect(Object.keys(step.answer.headers)).not.toContain("x-astro-noop");
	});

	it("records what the page does through locals.runtime.env, waited for by the answer", async () => {
		const { effects } = await record();

		expect(effects).toContainEqual(
			expect.objectContaining({
				kind: "d1",
				db: "MUSIC_DB",
				via: "first",
				sql: "SELECT COUNT(*) AS n FROM owner_requests",
				step: 0,
				phase: "request",
			}),
		);
	});

	it("gives the bundled page the frozen clock and the seeded ids", async () => {
		const [step] = (await record()).steps;

		expect(step.answer.outcome).toBe("response");

		if (step.answer.outcome === "response") {
			expect(step.answer.body).toContain(`<p id="at">${START}</p>`);
			expect(step.answer.body).toContain(`<p id="id">${uuidFor(1)}</p>`);
		}
	});

	it("answers a Response the page returns as it is, with its cookies", async () => {
		const [step] = (await record("redirect")).steps;

		expect(step.answer).toStrictEqual({
			outcome: "response",
			status: 303,
			headers: { location: "/next" },
			setCookies: ["golden=1; Path=/; HttpOnly"],
			body: "",
		});
	});

	it("records a page that throws as rejected, not as a 500", async () => {
		const { steps } = await record("throw");

		expect(steps[0].answer).toStrictEqual({ outcome: "rejected" });
	});

	it("records identical answers and effects on two runs", async () => {
		const first = await record();
		const second = await record();

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});
