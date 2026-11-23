import type { APIRoute } from "astro";
import { agreementDownload } from "~/lib/agreement-download";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

// A failure on the site's side is logged once, never shown, and answers the download's fixed 500.
function unexpected<Failure>(failure: Failure) {
	logUnexpected("Owner signed copy", failure);
}

export const GET: APIRoute = async ({ locals, params }) =>
	locals.owner
		? agreementDownload(locals.runtime.env, params.id ?? "", { unexpected })
		: new Response("Owner access required.", { status: 403 });
