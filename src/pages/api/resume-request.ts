import type { APIRoute } from 'astro';
import { validateResumeRequestInput } from '~/lib/validation';
import { verifyTurnstile } from '~/lib/turnstile';
import { checkRateLimit } from '~/lib/rate-limit';
import { createResumeRequest } from '~/lib/resume-requests';
import { sendResumeApprovalRequest } from '~/lib/resend';

export const prerender = false;

const ALLOWED_ORIGINS = [
  'https://thesuperhuman.us',
  'https://www.thesuperhuman.us',
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.thesuperhuman-us\.pages\.dev$/.test(origin)) return true;
  return false;
}

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime.env as Env;

  // Origin check
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  // Parse JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate
  const validation = validateResumeRequestInput(body);
  if (!validation.ok) {
    return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
  }
  const input = validation.value;

  // Rate limit by IP (shares the RATE_LIMIT namespace + window with the contact form)
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const rl = await checkRateLimit(env.RATE_LIMIT, ip);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: 'Please wait a few minutes before submitting again.' },
      { status: 429 },
    );
  }

  // Turnstile
  const turnstileOk = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileOk) {
    return Response.json({ ok: false, error: 'Captcha failed.' }, { status: 403 });
  }

  // Store pending request in KV (single-use, 7-day TTL)
  const requestId = await createResumeRequest(env.RESUME_STORE, {
    name: input.name,
    email: input.email,
    company: input.company,
    audience: input.audience,
    note: input.note,
  });

  // Build approval URL from the request's origin (so preview deploys link to preview)
  const approvalUrl = new URL(
    `/api/resume-approve?id=${requestId}`,
    new URL(request.url).origin,
  ).toString();

  // Email the operator with the approval link
  const sent = await sendResumeApprovalRequest({
    request: {
      ...input,
      ts: Date.now(),
    },
    apiKey: env.RESEND_API_KEY,
    from: env.CONTACT_FROM_EMAIL,
    to: env.CONTACT_TO_EMAIL,
    approvalUrl,
  });
  if (!sent.ok) {
    return Response.json(
      { ok: false, error: 'Could not send the request right now. Please email kazon.wilson@thesuperhuman.us directly.' },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
};
