import type { APIRoute } from 'astro';
import { audioOffers, describePreferences, validateIntake } from '~/lib/audio-intake';
import { musicRequest } from '~/lib/music-request';
import { checkRateLimit } from '~/lib/rate-limit';
import { verifyTurnstile } from '~/lib/turnstile';
import { sendAudioMessage } from '~/lib/audio-resend';
export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request, 32768);
  if (body instanceof Response) return body;
  const result = validateIntake(body);
  if (!result.ok) return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  const env = locals.runtime?.env;
  if (!env?.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL || !env.CONTACT_TO_EMAIL || !env.TURNSTILE_SECRET_KEY || !env.RATE_LIMIT) {
    return Response.json({ ok: false, error: 'Sending is unavailable right now. Your details are still here. Please email kazon.wilson@thesuperhuman.us.' }, { status: 503 });
  }
  const input = result.value;
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    const limit = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:audio:');
    if (!limit.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending again.' }, { status: 429 });
    if (!await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip)) return Response.json({ ok: false, errors: { turnstileToken: 'Please complete the security check again.' } }, { status: 403 });
    const offer = audioOffers[input.service];
    const text = [
      'Audio project submitted for FILE REVIEW ONLY. No booking or payment.',
      `Name: ${input.name}`, `Email: ${input.email}`, `Project: ${input.title}`,
      `Service: ${offer.name}`, `Starting price: ${offer.price ? `$${offer.price} USD; final quote after review` : 'Custom quote'}`,
      `Scope shown: ${offer.scope}`, `Files: ${input.fileLink || 'None; custom inquiry'}`,
      `Direction: ${input.direction}`, ...describePreferences(input.service, input.preferences),
      'Unspecified artistic choices: use your judgment.',
      `Reference: ${input.referenceUrl || 'None'}`, `Notes: ${input.referenceNote || 'None'}`,
      `Preserve / avoid: ${input.preserve || 'None specified'}`, 'Permission to access files for review: confirmed.',
    ].join('\n');
    const sent = await sendAudioMessage({ apiKey: env.RESEND_API_KEY, payload: { from: env.CONTACT_FROM_EMAIL, to: [env.CONTACT_TO_EMAIL], reply_to: input.email, subject: `Song review: ${input.title}`, text } });
    if (!sent.ok) return Response.json({ ok: false, error: 'We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.' }, { status: 502 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Sending is temporarily unavailable. Your details are still here. Please try again later.' }, { status: 503 });
  }
};
