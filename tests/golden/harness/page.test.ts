import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asVisitor, runCase, START, uuidFor, type Case } from "./index";
import { astroPages, streamBroke, type AstroPages } from "./page";

// The checks on the page handler (page.ts): a compiled .astro page answers a step with its own status, headers, cookies
// and HTML, rendered streamed and compact as production renders it; what it does through locals.runtime.env is
// recorded like a route's; the frozen clock and seeded ids reach the bundled copy; a page that throws in its
// frontmatter is recorded as `rejected`, never as a 500 the container made up; and a page whose body stream fails after
// its status and headers keeps them, with the bytes it sent and the harness's marker.

/**
 * A page that does what the verify pages do: read the env, set its status, headers and a cookie, return a Response, or
 * throw in its frontmatter. Its layout renders the slot after the status and headers are sent, so a throw there
 * (`template`, at once; `late`, after a read of the database) fails the body stream instead.
 */
const SOURCE = `---
import Layout from "./Layout.astro";

const mode = Astro.url.searchParams.get("mode");

if (mode === "throw") throw new Error("the page threw");

if (mode === "redirect")
	return new Response(null, {
		status: 303,
		headers: { location: "/next", "set-cookie": "golden=1; Path=/; HttpOnly" },
	});

const db = Astro.locals.runtime.env.MUSIC_DB;
const row = await db.prepare("SELECT COUNT(*) AS n FROM owner_requests").first();

Astro.response.status = 418;
Astro.response.headers.set("X-Page", "golden");
Astro.cookies.set("visited", "yes", { path: "/", httpOnly: true });

const at = new Date().toISOString();
const id = crypto.randomUUID();
const late = () => db.prepare("SELECT 1 AS n").first().then(() => JSON.parse("not json"));
---
<Layout>
	<p id="count">{row.n}</p>
	<p id="param">{Astro.params.name}</p>
	<p id="at">{at}</p>
	<p id="id">{id}</p>
	<p id="late">{mode === "template" ? JSON.parse("not json") : mode === "late" ? late() : "rendered"}</p>
</Layout>
`;

/** The layout: the head and the opening of the body come before the slot. */
const LAYOUT = `<html lang="en">
	<head><title>Golden</title></head>
	<body><main><slot /></main></body>
</html>
`;

/** What the page answers in full, compact (the whitespace between elements collapsed to one space). */
const WHOLE = `<!DOCTYPE html><html lang="en"> <head><title>Golden</title></head> <body><main> <p id="count">0</p> <p id="param">golden-param</p> <p id="at">${START}</p> <p id="id">${uuidFor(1)}</p> <p id="late">rendered</p> </main></body></html>`;

/** The page's headers: no Content-Length, as a streamed page has none, and no X-Astro-Noop. */
const HEADERS = { "content-type": "text/html", "x-page": "golden" };

let directory = "";
let pages: AstroPages<"page"> | undefined;

beforeAll(async () => {
	// Under node_modules/.cache, as render-astro.ts keeps its bundles, so no tree walker or checker reads the page.
	await mkdir(resolve("node_modules/.cache"), { recursive: true });
	directory = await mkdtemp(resolve("node_modules/.cache/golden-page-"));
	await writeFile(resolve(directory, "page.astro"), SOURCE);
	await writeFile(resolve(directory, "Layout.astro"), LAYOUT);
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
	it("answers with the page's own status, headers, cookies and whole HTML, streamed and compact, with its params, the frozen clock and the seeded ids", async () => {
		const [step] = (await record()).steps;

		expect(step.answer).toStrictEqual({
			outcome: "response",
			status: 418,
			headers: HEADERS,
			setCookies: ["visited=yes; Path=/; HttpOnly"],
			body: WHOLE,
		});
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

	it("records a page that throws in its frontmatter as rejected, not as a 500", async () => {
		const { steps } = await record("throw");

		expect(steps[0].answer).toStrictEqual({ outcome: "rejected" });
	});

	it("keeps the status, headers and cookies of a page whose slot throws, and ends its body with the marker", async () => {
		const [step] = (await record("template")).steps;

		// The slot throws while the renderer still holds the page's first bytes, so none of them reach the body.
		expect(step.answer).toStrictEqual({
			outcome: "response",
			status: 418,
			headers: HEADERS,
			setCookies: ["visited=yes; Path=/; HttpOnly"],
			body: streamBroke("SyntaxError"),
		});
	});

	it("records the bytes a page sent before its body stream failed, then the marker", async () => {
		const { steps, effects } = await record("late");

		// The renderer hands over what it has while the slot waits for the database; then the slot throws.
		expect(steps[0].answer).toStrictEqual({
			outcome: "response",
			status: 418,
			headers: HEADERS,
			setCookies: ["visited=yes; Path=/; HttpOnly"],
			body: `${WHOLE.slice(0, WHOLE.indexOf('<p id="late">') + '<p id="late">'.length)}${streamBroke("SyntaxError")}`,
		});
		expect(effects).toContainEqual(
			expect.objectContaining({
				kind: "d1",
				sql: "SELECT 1 AS n",
				phase: "request",
			}),
		);
	});

	it("records identical answers and effects on two runs", async () => {
		for (const mode of ["", "template", "late"]) {
			const first = await record(mode);
			const second = await record(mode);

			expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		}
	});
});
