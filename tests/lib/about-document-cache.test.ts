import assert from "node:assert/strict";
import { withAboutDocumentCache } from "~/lib/about-document-cache";
import { it } from "vitest";

it("keeps About browser freshness narrowly scoped and credential-partitioned", async () => {
	const url = "https://thesuperhuman.us/about";

	const response = (headers = {}, status = 200) =>
		new Response(status === 204 ? null : "public about", {
			status,
			headers: { "content-type": "text/html; charset=utf-8", ...headers },
		});

	let checks = 0;

	const skip = (request: Request, res: Response) => {
		assert.equal(withAboutDocumentCache(request, res), res);
		checks++;
	};

	for (const method of ["GET", "HEAD"]) {
		const r = withAboutDocumentCache(
			new Request(url, { method }),
			response({
				vary: "Accept-Encoding",
				"x-content-type-options": "nosniff",
			}),
		);

		assert.equal(r.headers.get("cache-control"), "private, max-age=60");
		assert.equal(
			r.headers.get("vary"),
			"Accept-Encoding, Cookie, Authorization, CF-Access-Jwt-Assertion",
		);
		assert.equal(r.headers.get("x-content-type-options"), "nosniff");
		checks++;
	}

	for (const path of [
		"/",
		"/about/",
		"/about?x=1",
		"/owner",
		"/studio",
		"/api/contact",
		"/contact",
		"/audio/about",
	])
		skip(new Request("https://thesuperhuman.us" + path), response());

	for (const origin of [
		"http://thesuperhuman.us",
		"https://www.thesuperhuman.us",
		"https://audio.thesuperhuman.us",
		"https://test.workers.dev",
		"https://localhost",
		"https://thesuperhuman.us:444",
	])
		skip(new Request(origin + "/about"), response());

	for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
		skip(new Request(url, { method }), response());

	for (const name of [
		"cookie",
		"authorization",
		"cf-access-jwt-assertion",
		"range",
		"cache-control",
		"pragma",
	])
		skip(new Request(url, { headers: { [name]: "present" } }), response());
	skip(new Request(url, { headers: { host: "evil.example" } }), response());

	for (const status of [
		201, 204, 206, 301, 302, 303, 307, 308, 401, 403, 404, 500,
	])
		skip(new Request(url), response({}, status));

	for (const name of [
		"cache-control",
		"cdn-cache-control",
		"cloudflare-cdn-cache-control",
		"surrogate-control",
		"expires",
		"pragma",
		"set-cookie",
		"location",
		"content-range",
	])
		skip(new Request(url), response({ [name]: "present" }));

	for (const policy of ["private, no-store", "no-cache", "public, max-age=300"])
		skip(new Request(url), response({ "cache-control": policy }));
	skip(new Request(url), response({ vary: "Accept-Encoding, *" }));
	skip(new Request(url), response({ "content-type": "application/json" }));

	const r = withAboutDocumentCache(
		new Request(url),
		response({ vary: "cookie, AUTHORIZATION" }),
	);

	assert.equal(
		r.headers.get("vary"),
		"cookie, AUTHORIZATION, CF-Access-Jwt-Assertion",
	);
	checks++;
	assert.equal(await r.text(), "public about");
	checks++;
	assert.equal(checks, 56);
});
