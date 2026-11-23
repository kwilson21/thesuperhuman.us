// The site's Worker (docs/plans/2026-11-market-refresh.md, section 5): Astro's own request handler, unchanged, and the
// daily scheduled handler that runs the market refresh. Named in astro.config.mjs (`workerEntryPoint`); the cron is in
// wrangler.jsonc.
import { handle } from "@astrojs/cloudflare/handler";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { onScheduled } from "./server/market-refresh-job";

type Fetch = Parameters<typeof handle>;

export function createExports(manifest: SSRManifest) {
	const app = new App(manifest);

	return {
		default: {
			// Typed as the adapter's handler takes them (its own copy of @cloudflare/workers-types), as Astro's default entry is.
			fetch: (request: Fetch[2], env: Fetch[3], context: Fetch[4]) =>
				handle(manifest, app, request, env, context),
			scheduled: onScheduled(),
		},
	};
}
