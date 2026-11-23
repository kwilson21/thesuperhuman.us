/** Local-only experiment: a reviewed public document, never a shared cache policy.
 * About renders public content and the public Turnstile site key. If that changes,
 * remove this opt-in before introducing request-specific rendering.
 */
export function withAboutDocumentCache(
	request: Request,
	response: Response,
): Response {
	const url = new URL(request.url);
	const host = request.headers.get("host");

	const vary = (response.headers.get("vary") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	if (
		url.origin !== "https://thesuperhuman.us" ||
		url.pathname !== "/about" ||
		url.search ||
		(host !== null && host !== "thesuperhuman.us") ||
		!["GET", "HEAD"].includes(request.method) ||
		[
			"cookie",
			"authorization",
			"cf-access-jwt-assertion",
			"range",
			"cache-control",
			"pragma",
		].some((name) => request.headers.has(name)) ||
		response.status !== 200 ||
		response.redirected ||
		!/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
		[
			"cache-control",
			"cdn-cache-control",
			"cloudflare-cdn-cache-control",
			"surrogate-control",
			"expires",
			"pragma",
			"set-cookie",
			"location",
			"content-range",
		].some((name) => response.headers.has(name)) ||
		vary.includes("*")
	)
		return response;

	// Partition anonymous cached HTML before a credential-bearing request can reuse it.
	for (const name of ["Cookie", "Authorization", "CF-Access-Jwt-Assertion"]) {
		if (!vary.some((existing) => existing.toLowerCase() === name.toLowerCase()))
			vary.push(name);
	}

	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "private, max-age=60");
	headers.set("Vary", vary.join(", "));

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
