import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { escapeHtml } from "~/lib/email-template";
import { approveResume } from "~/server/flows/resume";
import { runRoute } from "~/server/run";
import { legacyBindingsOrDefect, liveMail } from "~/server/services";

export const prerender = false;

const isApprovalId = Schema.is(Schema.NonEmptyString);

function htmlPage(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  :root { --paper: #FBF8F2; --ink: #0E0E0E; --muted: #4A4A4A; --accent: #AE5534; }
  body { background: var(--paper); color: var(--ink); font-family: Georgia, serif; margin: 0; padding: 6rem 1.5rem; }
  main { max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 2rem; line-height: 1.15; font-weight: 400; margin: 0 0 1.25rem; }
  p { font-size: 1.0625rem; line-height: 1.65; }
  button { min-height: 44px; padding: .75rem 1rem; color: var(--ink); background: var(--paper); border: 1px solid var(--accent); font: inherit; cursor: pointer; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "private, no-store",
			"referrer-policy": "strict-origin",
			"x-robots-tag": "noindex, nofollow, noarchive",
			"x-content-type-options": "nosniff",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
		},
	});
}

export const GET: APIRoute = async ({ url }) => {
	const id = url.searchParams.get("id") ?? "";

	const body = id
		? `<h1>Approve resume request</h1>
<p>Confirm that you want to email the requested resume to the person who submitted the request.</p>
<form method="post" action="/api/resume-approve">
<input type="hidden" name="id" value="${escapeHtml(id)}" />
<button type="submit">Approve and send resume</button>
</form>`
		: "<h1>Invalid approval link</h1><p>This link is missing its approval token.</p>";

	return htmlResponse(
		htmlPage("Resume request approval", body),
		id ? 200 : 400,
	);
};

export const HEAD: APIRoute = async ({ url }) => {
	const hasId = Boolean(url.searchParams.get("id"));

	return htmlResponse("", hasId ? 200 : 400);
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (request.headers.get("origin") !== new URL(request.url).origin) {
		return htmlResponse(
			htmlPage(
				"Forbidden",
				"<h1>Forbidden</h1><p>Open the approval link again.</p>",
			),
			403,
		);
	}

	let id: FormDataEntryValue | null;

	try {
		id = (await request.formData()).get("id");
	} catch {
		return htmlResponse(
			htmlPage(
				"Invalid request",
				"<h1>Invalid request</h1><p>Open the approval link again.</p>",
			),
			400,
		);
	}

	if (!isApprovalId(id)) {
		return htmlResponse(
			htmlPage(
				"Invalid request",
				"<h1>Invalid request</h1><p>Open the approval link again.</p>",
			),
			400,
		);
	}

	const env = locals.runtime.env;

	const services = Context.merge(
		legacyBindingsOrDefect(env),
		liveMail(env.RESEND_API_KEY),
	);

	return runRoute(
		services,
		approveResume({ id, from: env.CONTACT_FROM_EMAIL }).pipe(
			Effect.map(() =>
				htmlResponse(
					htmlPage(
						"Resume sent",
						"<h1>Resume sent</h1><p>The requested resume was emailed. The approval link is now used.</p>",
					),
				),
			),
			Effect.catchTags({
				MissingRequestId: () =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Missing request id",
								"<h1>Missing request id</h1><p>This link is malformed.</p>",
							),
							400,
						),
					),
				RequestNotFound: (refusal) =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Request not found",
								`<h1>Already processed or expired</h1><p>${escapeHtml(refusal.say)}</p>`,
							),
							404,
						),
					),
				ResumePdfMissing: () =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Resume not configured",
								"<h1>Resume not in storage</h1><p>The requested PDF is unavailable. The request is still saved.</p>",
							),
							500,
						),
					),
				ResumeNotSent: () =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Delivery not confirmed",
								"<h1>Delivery not confirmed</h1><p>Check your email delivery logs before trying again.</p>",
							),
							500,
						),
					),
			}),
		),
		{
			route: "Resume approval",
			answer: () =>
				htmlResponse(
					htmlPage(
						"Delivery status unknown",
						"<h1>Delivery status unknown</h1><p>Check your email delivery logs before trying again.</p>",
					),
					500,
				),
		},
	);
};
