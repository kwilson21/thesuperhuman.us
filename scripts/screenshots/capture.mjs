#!/usr/bin/env node
// Opens every page at desktop and phone size, then runs each scenario in scripts/screenshots/scenarios.
// Exits non-zero on a page error, a console error, or an unexpected HTTP status.
// Images whose inputs match an earlier run in .screenshots/reference are copied from it instead (see
// cache.mjs); SCREENSHOTS_FULL=1 captures everything.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
	access,
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium } from "playwright";
import {
	ASSET_TYPES,
	globalKey,
	hashBody,
	inputsChange,
	listFiles,
	REFERENCE,
	responsesChange,
	routeFiles,
	routePattern,
	scenarioInputs,
	scenarioPlanner,
	sourceClosure,
	stateHash,
	unhashed,
	withoutViteVersion,
} from "./cache.mjs";
import { openLocalD1 } from "./local-d1.mjs";
import { prepareWithDiagnostics } from "./prepare.mjs";
import { settle, trackRequests } from "./settle.mjs";
import { createTimings } from "./timings.mjs";
import {
	ACCESS_AUDIENCE,
	ACCESS_ISSUER,
	expectedResourceError,
	missingScenarioRoutes,
	OUT,
	OWNER_EMAIL,
	PAGES,
	REDIRECTS,
	SCENARIO_PAGES,
	VIEWPORTS,
} from "./config.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4321";

// Enough to keep a 4-core runner busy alongside the dev server.
const PAGE_CONCURRENCY = 4;

// A throwaway Access issuer so owner pages render with the real JWT check.
const { publicKey, privateKey } = await generateKeyPair("RS256");

// A fresh key id per run, so a dev server that cached an earlier run's key fetches this one.
const kid = randomUUID();
const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

const issuer = createServer((_, response) => {
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify({ keys: [jwk] }));
});

await new Promise((done) =>
	issuer.listen(Number(new URL(ACCESS_ISSUER).port), "127.0.0.1", done),
);

const ownerToken = await new SignJWT({ email: OWNER_EMAIL })
	.setProtectedHeader({ alg: "RS256", kid })
	.setIssuer(ACCESS_ISSUER)
	.setAudience(ACCESS_AUDIENCE)
	.setIssuedAt()
	.setExpirationTime("1h")
	.sign(privateKey);

const ownerHeaders = { "cf-access-jwt-assertion": ownerToken };

await rm(OUT, { recursive: true, force: true });

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined,
});

const errors = [];

// Where the run's time goes. The summary is printed at the end of the log (see timings.mjs).
const timings = createTimings();

// The scope a capture or sql call belongs to: its scenario, or `pages` outside one.
const scopeName = () => currentScenario ?? "pages";

const timedStateHash = (scope) =>
	timings.time(scope, "stateHash", () => stateHash());

// Every path that rendered with the expected status, so seeded pages can be checked afterwards.
const captured = [];

// Same-origin requests each capture made, by file: the inputs a reused image is checked against.
const requestsByFile = new Map();

const global = await globalKey({
	node: process.version,
	browser: browser.version(),
});

const reference = await readReference();
const cache = { global, pagesWrote: false, pages: {}, scenarios: {} };

async function readReference() {
	if (process.env.SCREENSHOTS_FULL === "1")
		return console.log("SCREENSHOTS_FULL is set: capturing everything.");

	const data = await readFile(`${REFERENCE}/cache.json`, "utf8")
		.then(JSON.parse)
		.catch(() => null);

	if (!data)
		return console.log("No earlier run to reuse: capturing everything.");

	if (data.global !== global)
		return console.log(
			"Capture code, dependencies or config changed since the earlier run: capturing everything.",
		);

	return data;
}

/** Saves one PNG. Pass `owner` for owner pages, `cookie` for a studio session, `selector` for one section. */
async function capture({
	file,
	path,
	viewport = "desktop",
	owner = false,
	cookie,
	selector,
	status = 200,
	prepare,
	expectedResponses = [],
	expectedResourceErrors = [],
}) {
	// Read once, so a page capture running alongside others still lands in its own scenario's timings.
	const scope = scopeName();
	timings.count(scope, "captures");
	const size = VIEWPORTS.find((item) => item.name === viewport);

	const { context, page } = await timings.time(scope, "context", async () => {
		const context = await browser.newContext({
			viewport: { width: size.width, height: size.height },
			reducedMotion: "reduce",
		});

		// Access adds this header at the edge, so only our own origin sees it. Fonts and other hosts reject it.
		if (owner)
			await context.route(
				(url) => url.origin === new URL(BASE).origin,
				(route) =>
					route.continue({
						headers: { ...route.request().headers(), ...ownerHeaders },
					}),
			);

		if (cookie) await context.addCookies([{ ...cookie, url: BASE }]);
		const requests = [];
		context.on("request", (request) => {
			const url = new URL(request.url());

			if (url.origin === new URL(BASE).origin)
				requests.push({
					url: withoutViteVersion(url.pathname + url.search),
					method: request.method(),
					type: request.resourceType(),
					accept: request.headers().accept ?? "",
				});
		});
		requestsByFile.set(file, requests);
		const page = await context.newPage();

		return { context, page };
	});

	// Counts requests from the first navigation on. The page is still at about:blank until goto below.
	const tracker = trackRequests(page);

	const where = `${path} (${viewport})`;
	page.on("console", (message) => {
		const expected = expectedResourceError(message, [
			{ url: BASE + path, status },
			...expectedResourceErrors,
			...expectedResponses.map(({ path, status }) => ({
				url: BASE + path,
				status,
			})),
		]);

		if (message.type() === "error" && !expected)
			errors.push(`${where}: ${message.text()}`);
	});
	page.on("pageerror", (error) => errors.push(`${where}: ${error.message}`));

	const response = await timings.time(scope, "goto", () =>
		page.goto(BASE + path, {
			waitUntil: "load",
			timeout: 90_000,
		}),
	);

	if (response?.status() !== status)
		errors.push(`${where}: HTTP ${response?.status()}, expected ${status}`);
	else captured.push({ scenario: currentScenario, path });
	// Turnstile's script is not counted, since it keeps requesting in the background. A page with its widget
	// also waits for the widget to hold a token (see settle.mjs), so the image matches the drawn widget.
	await timings.time(scope, "idle", () => settle(page, tracker));
	await timings.time(scope, "fonts", () =>
		page.evaluate(() => document.fonts.ready),
	);

	if (prepare)
		await timings.time(scope, "prepare", () =>
			prepareWithDiagnostics(page, prepare, OUT, currentScenario, file),
		);
	const target = selector ? page.locator(selector).first() : page;
	const screenshotOptions = { path: `${OUT}/${file}`, animations: "disabled" };

	if (!selector) screenshotOptions.fullPage = true;
	await timings.time(scope, "screenshot", () =>
		target.screenshot(screenshotOptions),
	);
	await timings.time(scope, "close", () => context.close());

	return file;
}

// Opened on the first sql() call and closed when the run ends. The dev server has the same file open; the
// database runs in WAL mode and the connection waits for any lock (see local-d1.mjs).
let localD1;

// Synchronous on purpose: scenarios call sql() without await. They never read its result, so it returns nothing.
const sql = (command) => {
	const scope = scopeName();
	const started = timings.now();

	try {
		localD1 ??= openLocalD1({
			stateDirectory: resolve(".wrangler/state"),
			migrationsDirectory: resolve("migrations/music"),
		});
		localD1.exec(command);
	} finally {
		timings.add(scope, "sql", timings.now() - started);
		timings.count(scope, "sql");
	}
};

async function ownerFetch(path, body, method = "POST", headers = {}) {
	scenarioPaths.push(new URL(BASE + path).pathname);
	const binary = body instanceof Uint8Array;
	const scope = scopeName();
	timings.count(scope, "ownerFetch");

	const { response, json } = await timings.time(
		scope,
		"ownerFetch",
		async () => {
			const response = await fetch(BASE + path, {
				method,
				body: binary ? body : JSON.stringify(body),
				headers: {
					...ownerHeaders,
					origin: BASE,
					"content-type": binary
						? "application/octet-stream"
						: "application/json",
					...headers,
				},
			});

			const json = await response.json().catch(() => ({}));

			return { response, json };
		},
	);

	if (!response.ok)
		throw new Error(
			`${method} ${path} returned ${response.status}: ${JSON.stringify(json)}`,
		);

	return json;
}

const replayed = new Map();

/** Requests a recorded URL again and hashes what the server sends: status, redirect and body. */
function replay({ url, accept }, owner) {
	const key = `${owner}\n${accept}\n${url}`;

	if (unhashed(url)) return "not hashed";

	const headers = { accept };

	if (owner) Object.assign(headers, ownerHeaders);

	if (!replayed.has(key)) {
		replayed.set(
			key,
			fetch(BASE + url, {
				redirect: "manual",
				headers,
			})
				.then(
					async (response) =>
						`${response.status} ${response.headers.get("location") ?? ""} ${hashBody(await response.arrayBuffer())}`,
				)
				.catch((error) => `failed ${error.message}`),
		);
	}

	return replayed.get(key);
}

/** Replays each distinct request: `[url, accept, result]`, sorted. */
async function replayAll(requests, owner) {
	const unique = [
		...new Map(
			requests.map((request) => [`${request.accept}\n${request.url}`, request]),
		).values(),
	].sort((a, b) => (a.url + a.accept).localeCompare(b.url + b.accept));

	return Promise.all(
		unique.map(async (request) => [
			request.url,
			request.accept,
			await replay(request, owner),
		]),
	);
}

const asRequests = (responses) =>
	responses.map(([url, accept]) => ({ url, accept }));

const reusable = (files) =>
	Promise.all(files.map((file) => access(`${REFERENCE}/${file}`))).then(
		() => true,
		() => false,
	);

/** A page at one size: copied when every response it loaded is unchanged, otherwise captured. */
async function shoot(page, viewport) {
	const file = `${page.name}-${viewport.name}.png`;

	const params = {
		path: page.path,
		owner: Boolean(page.owner),
		status: page.status ?? 200,
	};

	const earlier = reference?.pages?.[file];

	if (
		earlier &&
		earlier.path === params.path &&
		earlier.owner === params.owner &&
		earlier.status === params.status &&
		(await reusable([file]))
	) {
		const responses = await timings.time("pages", "replay", () =>
			replayAll(asRequests(earlier.responses), params.owner),
		);

		const change = responsesChange(earlier.responses, responses);

		if (!change) {
			await copyFile(`${REFERENCE}/${file}`, `${OUT}/${file}`);
			cache.pages[file] = earlier;
			reusedPages++;

			return;
		}

		console.log(`Capturing ${file}: ${change} changed.`);
	}

	await capture({
		file,
		path: page.path,
		viewport: viewport.name,
		owner: page.owner,
		status: page.status,
	});
	const requests = requestsByFile.get(file);

	// A page that sent anything but GET can't be checked by replaying it.
	if (requests.every((request) => request.method === "GET"))
		cache.pages[file] = {
			...params,
			responses: await timings.time("pages", "replay", () =>
				replayAll(requests, params.owner),
			),
		};
}

let reusedPages = 0;
let currentScenario;

// Printed once: after the scenario summary on success, or from `finally` when the run throws.
let timingsPrinted = false;

function printTimings() {
	if (timingsPrinted) return;
	timingsPrinted = true;

	for (const line of timings.summary()) console.log(line);
}

// Paths each running scenario sent to ownerFetch, which runs server code without a browser.
let scenarioPaths = [];

try {
	for (const { from, to, status } of Object.values(REDIRECTS)) {
		const response = await fetch(BASE + from, { redirect: "manual" });
		const location = response.headers.get("location");

		if (
			response.status !== status ||
			(location && new URL(location, BASE).pathname) !== to
		) {
			errors.push(
				`${from}: HTTP ${response.status} to ${location}, expected ${status} to ${to}`,
			);
		}
	}

	// Pages only read data, so a few render at once. Scenarios below stay serial: each one sees the
	// rows the ones before it seeded.
	const shots = PAGES.flatMap((page) =>
		VIEWPORTS.map((viewport) => ({ page, viewport })),
	);

	const stateBeforePages = await timedStateHash("pages");
	await timings.wall(
		"pages",
		() =>
			Promise.all(
				Array.from({ length: PAGE_CONCURRENCY }, async () => {
					for (let shot = shots.shift(); shot; shot = shots.shift())
						await shoot(shot.page, shot.viewport);
				}),
			),
		PAGE_CONCURRENCY,
	);
	// Scenarios are checked against a run whose pages left the database untouched.
	cache.pagesWrote = (await timedStateHash("pages")) !== stateBeforePages;

	const scenarios = [];
	const directory = resolve("scripts/screenshots/scenarios");

	const names = (await readdir(directory))
		.filter((file) => file.endsWith(".mjs"))
		.sort()
		.map((file) => file.replace(/\.mjs$/, ""));

	const script = (name) => `scripts/screenshots/scenarios/${name}.mjs`;
	// Scenarios seed dates from the clock, in UTC and New York time, so a scenario image is reused
	// only while both dates are the ones it was taken on.
	const now = new Date();
	const day = `${now.toISOString().slice(0, 10)} ${now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`;

	const inputsFor = async (scope, name, { files, content, assets }) =>
		scenarioInputs({
			day,
			script: script(name),
			files,
			content,
			assets: await timings.time(scope, "replay", () =>
				replayAll(assets, false),
			),
		});

	// A scenario that no longer exists may have seeded rows the later ones showed.
	const removed = Object.keys(reference?.scenarios ?? {}).some(
		(name) => !names.includes(name),
	);

	const changed = new Set();

	await timings.wall("reuse-check", async () => {
		for (const name of names) {
			const earlier = reference?.scenarios?.[name];

			const why = !earlier
				? "new"
				: removed
					? "a scenario was removed"
					: reference.pagesWrote || cache.pagesWrote
						? "pages wrote to storage"
						: !(await reusable(earlier.images))
							? "images missing"
							: inputsChange(
									earlier.inputs,
									await inputsFor("reuse-check", name, {
										files: Object.keys(earlier.inputs.sources),
										content: earlier.content,
										assets: asRequests(earlier.inputs.assets),
									}),
								);

			if (why) {
				changed.add(name);
				console.log(`Scenario ${name} changed: ${why}.`);
			}
		}
	});

	const pageFiles = (await listFiles(["src/pages"])).filter((file) =>
		/\.(astro|ts|js|mjs)$/.test(file),
	);

	// Static files are replayed and hashed. Anything an endpoint serves, such as an owner-only image
	// from an API route, runs server code and may need credentials, so it is followed through the
	// module graph instead. Pages render HTML, so an image under a page's dynamic route is a static file.
	const endpoints = pageFiles.filter((file) => !file.endsWith(".astro"));

	const isAsset = (request) =>
		request.method === "GET" &&
		ASSET_TYPES.includes(request.type) &&
		!endpoints.some((file) =>
			routePattern(file).test(new URL(BASE + request.url).pathname),
		);

	const planner = scenarioPlanner(names, changed, reference?.scenarios);
	const ran = [];

	for (const name of names) {
		if (!planner.shouldRun(name)) {
			const earlier = reference.scenarios[name];
			timings.count(name, "reused");

			for (const file of earlier.images)
				await copyFile(`${REFERENCE}/${file}`, `${OUT}/${file}`);
			captured.push(...earlier.captured);
			scenarios.push({ name, title: earlier.title, steps: earlier.steps });
			cache.scenarios[name] = earlier;
			continue;
		}

		const scenario = (await import(pathToFileURL(script(name)).href)).default;
		currentScenario = name;
		scenarioPaths = [];
		const filesBefore = new Set(requestsByFile.keys());

		const { steps, wrote } = await timings.wall(name, async () => {
			const stateBefore = await timedStateHash(name);

			const steps = await scenario.run({
				base: BASE,
				capture,
				sql,
				ownerFetch,
			});

			const wrote = (await timedStateHash(name)) !== stateBefore;

			return { steps, wrote };
		});

		planner.ran(name, wrote);
		scenarios.push({ name, title: scenario.title, steps });

		const images = [...requestsByFile.keys()].filter(
			(file) => !filesBefore.has(file),
		);

		const requests = images.flatMap((file) => requestsByFile.get(file));
		ran.push({
			name,
			title: scenario.title,
			steps,
			images,
			wrote,
			paths: [
				...scenarioPaths,
				...requests.flatMap((request) =>
					isAsset(request) ? [] : [new URL(BASE + request.url).pathname],
				),
			],
			assets: requests.flatMap((request) =>
				isAsset(request) ? [{ url: request.url, accept: request.accept }] : [],
			),
			captured: captured.filter((item) => item.scenario === name),
		});
	}

	currentScenario = undefined;

	if (ran.length) {
		await timings.wall("inputs", async () => {
			// The dev server's module graph names the source files behind each route a scenario hit.
			const graph = await timings.time("inputs", "graph", () =>
				fetch(`${BASE}/__screenshots/deps`)
					.then((response) => response.json())
					.catch(() => {
						throw new Error(
							"No module graph at /__screenshots/deps: start the dev server with --config scripts/screenshots/dev.config.mjs.",
						);
					}),
			);

			for (const { name, paths, wrote, ...rest } of ran) {
				const roots = [
					"src/middleware.ts",
					...new Set(paths.flatMap((path) => routeFiles(path, pageFiles))),
				];

				const { files, content } = sourceClosure(graph, roots);

				const inputs = await inputsFor("inputs", name, {
					files,
					content,
					assets: rest.assets,
				});

				cache.scenarios[name] = {
					...rest,
					assets: undefined,
					content,
					inputs,
					writer: wrote,
				};
			}
		});
	}

	console.log(
		`Reused ${reusedPages} of ${PAGES.length * VIEWPORTS.length} page images.`,
	);
	console.log(
		`Scenarios run: ${ran.map((item) => item.name).join(", ") || "none"}. Reused: ${names.filter((name) => !ran.some((item) => item.name === name)).join(", ") || "none"}.`,
	);
	printTimings();
	errors.push(
		...missingScenarioRoutes(SCENARIO_PAGES, captured).map(
			(file) => `${file}: its scenario captured no page under its route`,
		),
	);
	await writeFile(
		`${OUT}/manifest.json`,
		JSON.stringify({ pages: PAGES, scenarios }, null, 2),
	);
	await writeFile(`${OUT}/cache.json`, JSON.stringify(cache));
} finally {
	printTimings();
	localD1?.close();
	await browser.close();
	issuer.close();
}

if (errors.length) {
	console.error(`Screenshot checks failed:\n${errors.join("\n")}`);
	process.exit(1);
}

console.log(`Saved screenshots to ${OUT}/`);
