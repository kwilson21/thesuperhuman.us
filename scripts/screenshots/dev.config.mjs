// The site's Astro config plus two dev-only endpoints for screenshots. /__screenshots/deps lists the
// server's module graph, so capture.mjs knows which source files each scenario's routes loaded.
// POST /__screenshots/clock sets the server's frozen clock to a step's instant (see clock.mjs). Capture moves it.
// Start the preview with `astro dev --config scripts/screenshots/dev.config.mjs`. Never deployed.
import { clock } from "./clock-install.mjs";
import config from "../../astro.config.mjs";

// A clock body is one small JSON object. Anything longer is refused without being read to the end.
const CLOCK_BODY_LIMIT = 512;

/** The request body as text, or undefined when it is longer than `limit` bytes. */
async function readBody(request, limit) {
	const chunks = [];
	let size = 0;

	for await (const chunk of request) {
		size += chunk.length;

		if (size > limit) return undefined;
		chunks.push(chunk);
	}

	return Buffer.concat(chunks).toString("utf8");
}

/** The `now` of a `{ "now": <integer ms> }` body, or undefined when it is not one. */
function parseClockBody(text) {
	try {
		const { now } = JSON.parse(text);

		return Number.isSafeInteger(now) ? now : undefined;
	} catch {
		return undefined;
	}
}

const moduleGraph = {
	name: "screenshots-module-graph",
	apply: "serve",
	configureServer(server) {
		server.middlewares.use("/__screenshots/deps", (_, response) => {
			const graph = {};

			for (const [id, mod] of server.environments.ssr.moduleGraph
				.idToModuleMap) {
				graph[id] = {
					file: mod.file,
					imports: [...mod.importedModules].map((item) => item.id),
				};
			}

			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(graph));
		});
		server.middlewares.use(
			"/__screenshots/clock",
			async (request, response) => {
				// Mounted by prefix, so only the exact path is this endpoint.
				if (request.url !== "/") {
					response.statusCode = 404;

					return response.end();
				}

				if (request.method !== "POST") {
					response.statusCode = 405;
					response.setHeader("allow", "POST");

					return response.end();
				}

				const body = await readBody(request, CLOCK_BODY_LIMIT);

				if (body === undefined) {
					response.statusCode = 413;

					return response.end();
				}

				const now = parseClockBody(body);

				if (now === undefined) {
					response.statusCode = 400;

					return response.end();
				}

				clock.set(now);
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ ok: true, now }));
			},
		);
	},
};

export default {
	...config,
	vite: {
		...config.vite,
		plugins: [...(config.vite?.plugins ?? []), moduleGraph],
	},
};
