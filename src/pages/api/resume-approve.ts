import type { APIRoute } from "astro";

export const prerender = false;

const privateHeaders = {
	"cache-control": "private, no-store",
	"content-security-policy":
		"default-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
	"referrer-policy": "strict-origin",
	"x-content-type-options": "nosniff",
	"x-robots-tag": "noindex, nofollow, noarchive",
};

function ownerApprovalUrl(requestUrl: string, id: string | null): string {
	const target = new URL("/owner/resume-approve", requestUrl);

	if (id) target.searchParams.set("id", id);

	return target.pathname + target.search;
}

export const GET: APIRoute = async ({ request, url }) =>
	new Response(null, {
		status: 303,
		headers: {
			...privateHeaders,
			location: ownerApprovalUrl(request.url, url.searchParams.get("id")),
		},
	});

export const HEAD: APIRoute = async ({ request, url }) =>
	new Response(null, {
		status: 303,
		headers: {
			...privateHeaders,
			location: ownerApprovalUrl(request.url, url.searchParams.get("id")),
		},
	});

export const POST: APIRoute = async () =>
	new Response("Resume approval must be completed from the owner center.", {
		status: 405,
		headers: { ...privateHeaders, allow: "GET, HEAD" },
	});
