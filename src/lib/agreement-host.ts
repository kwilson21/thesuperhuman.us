// What src/middleware.ts needs of the agreement pages: whether a request came to the canonical site, and the private
// headers every agreement answer carries. Pure, so the middleware does not load src/lib/agreement-access.ts (links,
// sessions, mail and Turnstile).
import { siteOrigin } from "./site-origin.mjs";

export const agreementHeaders = {
	"cache-control": "private, no-store",
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
};

export function canonicalAgreementRequest(env: Env, request: Request) {
	try {
		const canonical = new URL(siteOrigin(env.SITE_ORIGIN));
		const url = new URL(request.url);

		return (
			url.origin === canonical.origin &&
			(!request.headers.has("host") ||
				request.headers.get("host")?.toLowerCase() === canonical.host)
		);
	} catch {
		return false;
	}
}
