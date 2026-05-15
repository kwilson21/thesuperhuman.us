import type { APIRoute } from 'astro';
import {
  getResumeRequest,
  deleteResumeRequest,
} from '~/lib/resume-requests';
import { loadResume, RESUME_FILENAMES } from '~/lib/resumes';
import { sendResumeDelivery } from '~/lib/resend';

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
  body { background: var(--paper); color: var(--ink); font-family: 'Newsreader', Georgia, serif; margin: 0; padding: 6rem 1.5rem; }
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
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export const GET: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime.env as Env;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return htmlResponse(
      htmlPage(
        'Missing request id',
        '<h1>Missing request id</h1><p>This link is malformed.</p>',
      ),
      400,
    );
  }

  const stored = await getResumeRequest(env.RESUME_STORE, id);
  if (!stored) {
    return htmlResponse(
      htmlPage(
        'Request not found',
        '<h1>Already processed or expired</h1><p class="muted">This approval link has either been used already or expired. Requests are single-use and live for seven days.</p>',
      ),
      404,
    );
  }

  const pdf = await loadResume(env.RESUME_STORE, stored.audience);
  if (!pdf) {
    return htmlResponse(
      htmlPage(
        'Resume PDF not configured',
        `<h1>Resume not in storage</h1><p>The KV key <code>pdf:${stored.audience}</code> is empty. Upload the PDF with <code>wrangler kv key put</code> and click the approval link again. The request is still saved.</p>`,
      ),
      500,
    );
  }

  const sent = await sendResumeDelivery({
    apiKey: env.RESEND_API_KEY,
    from: env.CONTACT_FROM_EMAIL,
    to: stored.email,
    name: stored.name,
    audience: stored.audience,
    pdf,
    filename: RESUME_FILENAMES[stored.audience],
  });

  if (!sent.ok) {
    return htmlResponse(
      htmlPage(
        'Send failed',
        `<h1>Resume not sent</h1><p>The email delivery failed. The request is still saved. Try the approval link again, or check Resend's logs. Request is for ${stored.name} (${stored.email}).</p>`,
      ),
      500,
    );
  }

  // Only delete on confirmed send success (single-use, prevents replay).
  await deleteResumeRequest(env.RESUME_STORE, id);

  return htmlResponse(
    htmlPage(
      'Resume sent',
      `<h1>Resume sent</h1><p>Delivered the <strong>${stored.audience}</strong> resume to <strong>${stored.email}</strong>. The approval link is now consumed.</p>`,
    ),
    200,
  );
};
