import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { escapeHtml } from "~/lib/email-template";
import { approveResume } from "~/server/flows/resume";
import { runRoute } from "~/server/run";
import { legacyBindingsOrDefect, liveMail } from "~/server/services";

export const prerender = false;

function htmlPage(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  :root { --paper: #FBF8F2; --ink: #0E0E0E; --muted: #4A4A4A; --rule: #E8E3DA; --accent: #AE5534; }
  @font-face { font-family: 'Libron'; src: url('/fonts/libron-v0.25/Libron-Regular.woff2') format('woff2'); font-display: swap; font-style: normal; font-weight: 400; }
  body { background: var(--paper); color: var(--ink); font-family: 'Libron', Georgia, serif; margin: 0; padding: 6rem 1.5rem; }
  main { max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 2rem; line-height: 1.15; letter-spacing: -0.015em; font-weight: 400; margin: 0 0 1.25rem; }
  p { font-size: 1.0625rem; line-height: 1.65; color: var(--ink); }
  p.muted { color: var(--muted); }
  a { color: var(--ink); border-bottom: 1px solid var(--accent); padding-bottom: 1px; text-decoration: none; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function htmlResponse(html: string, status: number): Response {
	return new Response(html, {
		status,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

export const GET: APIRoute = async (context) => {
	const { request, locals } = context;
	const env = locals.runtime.env;

	// A missing RESUME_STORE binding is a defect at its first read, as it always was (Astro answers 500).
	const services = Context.merge(
		legacyBindingsOrDefect(env),
		liveMail(env.RESEND_API_KEY),
	);

	return runRoute(
		services,
		approveResume({
			// An empty id counts as none, as it did.
			id: new URL(request.url).searchParams.get("id"),
			from: env.CONTACT_FROM_EMAIL,
		}).pipe(
			Effect.map((sent) =>
				htmlResponse(
					htmlPage(
						"Resume sent",
						`<h1>Resume sent</h1><p>Delivered the <strong>${escapeHtml(sent.audience)}</strong> resume to <strong>${escapeHtml(sent.email)}</strong>. The approval link is now consumed.</p>`,
					),
					200,
				),
			),
			Effect.catchTags({
				MissingRequestId: (refusal) =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Missing request id",
								`<h1>Missing request id</h1><p>${refusal.say}</p>`,
							),
							400,
						),
					),
				RequestNotFound: (refusal) =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Request not found",
								`<h1>Already processed or expired</h1><p class="muted">${refusal.say}</p>`,
							),
							404,
						),
					),
				ResumePdfMissing: (refusal) =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Resume PDF not configured",
								`<h1>Resume not in storage</h1><p>The KV key <code>pdf:${escapeHtml(refusal.audience)}</code> is empty. Upload the PDF with <code>wrangler kv key put</code> and click the approval link again. The request is still saved.</p>`,
							),
							500,
						),
					),
				ResumeNotSent: (refusal) =>
					Effect.succeed(
						htmlResponse(
							htmlPage(
								"Send failed",
								`<h1>Resume not sent</h1><p>The email delivery failed. The request is still saved. Try the approval link again, or check Resend's logs. Request is for ${escapeHtml(refusal.requesterName)} (${escapeHtml(refusal.email)}).</p>`,
							),
							500,
						),
					),
			}),
		),
	);
};
