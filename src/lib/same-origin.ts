/**
 * Whether a state-changing request comes from this site, the one rule the middleware's cross-site checks and the
 * agreement routes' form reader share. A browser names the site in `Origin`, except that a native form post from a page
 * whose referrer policy is `no-referrer` (the agreement, offer and studio pages set it, so a link's key never reaches a
 * Referer header) carries `Origin: null`. Such a post is still this site's when the browser's own `Sec-Fetch-Site`
 * header, which no page can set, says `same-origin`. A post from another site says `cross-site` (or `same-site` from a
 * sibling host), and a request without `Sec-Fetch-Site` is refused as before.
 */
export function fromThisSite(request: Request, siteOrigin: string) {
	const origin = request.headers.get("origin");

	return (
		origin === siteOrigin ||
		(origin === "null" &&
			request.headers.get("sec-fetch-site") === "same-origin")
	);
}
