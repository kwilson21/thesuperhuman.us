import type { APIRoute } from "astro";
import { agreementDownload } from "~/lib/agreement-download";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) =>
	locals.owner
		? agreementDownload(locals.runtime.env, params.id ?? "")
		: new Response("Owner access required.", { status: 403 });
