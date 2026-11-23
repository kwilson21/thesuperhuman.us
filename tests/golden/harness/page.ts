// An Astro page as a corpus handler. The page is compiled the way tests/helpers/render-astro.ts compiles one (esbuild,
// with what it imports from src bundled in and packages left external), with the whitespace between elements collapsed
// as Astro's `compressHTML` does in production (its default; astro.config.mjs does not set it). Astro's container then
// renders it streamed, as production does (`new App(manifest)` in @astrojs/cloudflare's server entrypoint, whose
// `streaming` defaults to true), with the step's own request, params and locals. A step records the page's answer: its
// status, its headers (those the page sets and the content type the renderer adds; a streamed page has no
// Content-Length), every cookie and the whole HTML. A Response the page returns from its frontmatter (a redirect) is
// answered as it is.
//
// Two things production adds are not here. The site's middleware (src/middleware.ts) does not run, as in every corpus
// (tests/golden/README.md). And production's build links each page's stylesheets (`/_astro/*.css`) into its head;
// here the styles are stubbed, so the recorded HTML has no stylesheet links of the site's own.
//
// The step is recorded as a route's is (world.ts). The env reaches the page through `locals.runtime.env`, as on
// Workers, so its D1, KV, R2 and fetch calls go through the harness's recording fakes; the clock, ids and randomness
// are global (determinism.ts), so the bundled copy of src sees the frozen ones.
//
// How a failure is recorded depends on where it happens, as it does in production:
//   - In the frontmatter (before the first byte of the body), the container rejects and the harness records the step
//     as `rejected`, as it records a route handler that throws: production answers a bare 500.
//   - While the template renders (after the status and headers are set), the response exists and its body stream
//     fails. The handler reads the body itself, and when the stream fails it answers the same status and headers with
//     the bytes read so far followed by `streamBroke(name)`, a fixed line that names the error's class (its `name`,
//     never its message). Workers render through the same Astro renderer (`isNode` is true on workerd with
//     `nodejs_compat`). What a visitor gets depends on timing, which the recording does not model: workerd sends the
//     status and headers once the turn that returned the Response ends, so a body that fails within that turn gets
//     no response at all (a client sees an empty reply), and one that fails later (after an I/O wait or a timer) is
//     a 200 that breaks partway, whether or not bytes came first. Checked with workerd 1.20261110.1 at the site's
//     compatibility date, locally; through Cloudflare's network a visitor may see an error page instead of an empty
//     reply. The recording keeps the status, the headers, the bytes read before the failure and the marker.
//
// The handler builds a new Response from what it read, with two changes to the headers: `X-Astro-Noop`, which Astro's
// stand-in middleware adds when a site has none, is removed (the site has its own middleware, so it never sends it);
// and each cookie the page set through `Astro.cookies` is appended as a `Set-Cookie` header, as the adapter does
// (`App.getSetCookieFromResponse`).
//
// Kept out of index.ts so the corpora that do not render a page do not load the compiler and the container.
import { App } from "astro/app";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { bundleAstro } from "../../helpers/render-astro";
import type { Handler } from "./world";

/** The marker of Astro's stand-in middleware (`NOOP_MIDDLEWARE_HEADER` in astro/dist/core/constants.js). */
const NOOP_HEADER = "x-astro-noop";

/**
 * The line that ends a body whose stream failed: the bytes before it are what the page had sent. It names the error's
 * class (`SyntaxError`), or says the stream failed with a value that is not an Error; never the error's message.
 */
export const streamBroke = (name: string) =>
	`\n[golden harness: the page's body stream failed here: ${name}]\n`;

export type AstroPages<Name extends string> = {
	/** The handler that renders the page compiled under `name`. */
	readonly page: (name: Name) => Handler;
	/** Removes the compiled bundle. Call it once the corpus has run (`afterAll`). */
	readonly remove: () => Promise<void>;
};

/** The whole body; or, when the stream fails, the bytes before the failure and `streamBroke` with its name. */
async function readBody(response: Response): Promise<Uint8Array<ArrayBuffer>> {
	const chunks: Uint8Array[] = [];
	let failed: string | null = null;

	if (response.body) {
		const reader = response.body.getReader();

		try {
			for (;;) {
				const read = await reader.read();

				if (read.done) break;

				chunks.push(read.value);
			}
		} catch (error) {
			failed =
				error instanceof Error ? error.name : "a value that is not an Error";
		}
	}

	if (failed !== null)
		chunks.push(new TextEncoder().encode(streamBroke(failed)));

	const bytes = new Uint8Array(
		chunks.reduce((total, chunk) => total + chunk.length, 0),
	);

	let offset = 0;

	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}

	return bytes;
}

/**
 * Compiles these pages (name to path under the repository, such as `src/pages/agreements/verify.astro`) and returns a
 * handler for each. One container renders every step: it is made here, before any case installs its frozen clock.
 */
export async function astroPages<const Name extends string>(
	entries: {
		readonly [Key in Name]: string;
	},
): Promise<AstroPages<Name>> {
	const bundle = await bundleAstro({ ...entries }, { compact: true });

	let container: AstroContainer;

	try {
		container = await AstroContainer.create({ streaming: true });
	} catch (error) {
		await bundle.remove();

		throw error;
	}

	return {
		page: (name) => {
			const component = bundle.component(name);

			// A whole page (`partial: false`), with its doctype.
			return async (context) => {
				const rendered = await container.renderToResponse(component, {
					partial: false,
					request: context.request,
					params: context.params,
					locals: context.locals,
				});

				const headers = new Headers(rendered.headers);

				headers.delete(NOOP_HEADER);

				for (const cookie of App.getSetCookieFromResponse(rendered))
					headers.append("set-cookie", cookie);

				const bytes = await readBody(rendered);

				return new Response(bytes.length > 0 ? bytes : null, {
					status: rendered.status,
					statusText: rendered.statusText,
					headers,
				});
			};
		},
		remove: bundle.remove,
	};
}
