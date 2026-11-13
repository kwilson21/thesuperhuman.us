// The site's Astro config plus two dev-only endpoints for screenshots. /__screenshots/deps lists the
// server's module graph, so capture.mjs knows which source files each scenario's routes loaded.
// /__screenshots/clock/reset puts the server's clock back at CLOCK_BASE before each scenario.
// Start the preview with `astro dev --config scripts/screenshots/dev.config.mjs`. Never deployed.
import { clock } from "./clock-install.mjs";
import config from "../../astro.config.mjs";

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
			"/__screenshots/clock/reset",
			(request, response) => {
				if (request.method !== "POST") {
					response.statusCode = 405;
					response.setHeader("allow", "POST");

					return response.end();
				}

				clock.reset();
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ ok: true }));
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
