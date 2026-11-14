import type { APIRoute } from "astro";
import { agreementHeaders } from "~/lib/agreement-access";
import { agreementDownload } from "~/lib/agreement-download";
import { logUnexpected } from "~/server/failure";

export const prerender = false;

const ROUTE = "/api/agreements/[id]/file";

export const GET: APIRoute = async ({ locals, request, params }) => {
	try {
		return await agreementDownload(locals.runtime.env, request, params.id!);
	} catch (error) {
		logUnexpected(ROUTE, error);

		return new Response("Signed copy unavailable. Contact Kazon.", {
			status: 500,
			headers: agreementHeaders,
		});
	}
};
