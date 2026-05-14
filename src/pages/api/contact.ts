import type { APIRoute } from 'astro';
import { validateContactInput } from '~/lib/validation';
import { verifyTurnstile } from '~/lib/turnstile';
import { checkRateLimit } from '~/lib/rate-limit';
import { sendContactEmails } from '~/lib/resend';

export const prerender = false;

const ALLOWED_ORIGINS = [
  'https://thesuperhuman.us',
  'https://www.thesuperhuman.us',
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Cloudflare Pages preview deployments
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
  const validation = validateContactInput(body);
  if (!validation.ok) {
    return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
  }
  const input = validation.value;

  // Rate limit by IP
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

  // Send emails
  const send = await sendContactEmails({
    input,
    apiKey: env.RESEND_API_KEY,
    from: env.CONTACT_FROM_EMAIL,
    to: env.CONTACT_TO_EMAIL,
  });
  if (!send.ok) {
    return Response.json(
      { ok: false, error: 'Email delivery failed. Please email kazon.wilson@thesuperhuman.us directly.' },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
};
