import type { APIRoute } from 'astro';
import { validateAudioInquiry } from '~/lib/audio-validation';
import { verifyTurnstile } from '~/lib/turnstile';
import { sendAudioInquiry } from '~/lib/audio-resend';
import { checkRateLimit } from '~/lib/rate-limit';

export const prerender = false;

const ALLOWED_ORIGINS = [
  'https://thesuperhuman.us',
  'https://www.thesuperhuman.us',
  'https://audio.thesuperhuman.us',
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

  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const validation = validateAudioInquiry(body);
  if (!validation.ok) {
    return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
  }
  const input = validation.value;

  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const rl = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:audio:');
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: 'Please wait a few minutes before submitting again.' },
      { status: 429 },
    );
  }

  const turnstileOk = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileOk) {
    return Response.json({ ok: false, error: 'Captcha failed.' }, { status: 403 });
  }

  const send = await sendAudioInquiry({
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
