// An Astro page as a corpus handler. The page is compiled the way tests/helpers/render-astro.ts compiles one (esbuild,
// with what it imports from src bundled in and packages left external) and rendered by Astro's container with the
// step's own request, params and locals, so a step records the page's answer: its status, its headers (those the page
// sets and the content type the renderer adds), every cookie and the whole HTML. A response the page returns from its
// frontmatter (a redirect) is answered as it is.
//
// The step is recorded as a route's is (world.ts). The env reaches the page through `locals.runtime.env`, as on
// Workers, so its D1, KV, R2 and fetch calls go through the harness's recording fakes; the clock, ids and randomness
// are global (determinism.ts), so the bundled copy of src sees the frozen ones. A page that throws is not turned into a
// 500: the container rejects, and the harness records the step as `rejected`, as it records a route handler that
// throws.
//
// One header is taken off: `X-Astro-Noop`, which Astro's stand-in middleware adds when a site has none. The container
// runs no middleware (neither does any corpus, see tests/golden/README.md), and the site has its own
// (src/middleware.ts), so the site never sends it and it says nothing about the page.
//
// Kept out of index.ts so the corpora that do not render a page do not load the compiler and the container.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { bundleAstro } from "../../helpers/render-astro";
import type { Handler } from "./world";

/** The marker of Astro's stand-in middleware (`NOOP_MIDDLEWARE_HEADER` in astro/dist/core/constants.js). */
const NOOP_HEADER = "x-astro-noop";

export type AstroPages<Name extends string> = {
	/** The handler that renders the page compiled under `name`. */
	readonly page: (name: Name) => Handler;
	/** Removes the compiled bundle. Call it once the corpus has run (`afterAll`). */
	readonly remove: () => Promise<void>;
};

/**
 * Compiles these pages (name to path under the repository, such as `src/pages/agreements/verify.astro`) and returns a
 * handler for each. One container renders every step: it is made here, before any case installs its frozen clock.
 */
export async function astroPages<const Name extends string>(
	entries: {
		readonly [Key in Name]: string;
	},
): Promise<AstroPages<Name>> {
	const bundle = await bundleAstro({ ...entries });

	let container: AstroContainer;

	try {
		container = await AstroContainer.create();
	} catch (error) {
		await bundle.remove();

		throw error;
	}

	return {
		page: (name) => {
			const component = bundle.component(name);

			// A whole page (`partial: false`), with its doctype, as the site serves it.
			return async (context) => {
				const response = await container.renderToResponse(component, {
					partial: false,
					request: context.request,
					params: context.params,
					locals: context.locals,
				});

				response.headers.delete(NOOP_HEADER);

				return response;
			};
		},
		remove: bundle.remove,
	};
}
