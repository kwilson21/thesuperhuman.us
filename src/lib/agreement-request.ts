import { musicRequest } from './music-request';
import { agreementJson } from './agreement-access';
/** Native forms use the same bounded JSON parser and Origin check as enhanced requests. */
export async function agreementRequest(request: Request, max = 16384) {
  if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return agreementJson({ ok: false, error: 'Forbidden' }, 403);
    const reader = request.body?.getReader();
    if (!reader) return agreementJson({ ok: false }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        return agreementJson({ ok: false, error: 'Request too large' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const fields = Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)));
    if (fields['cf-turnstile-response']) fields.turnstileToken = fields['cf-turnstile-response'];
    for (const key of [
      'business_engagement',
      'consent',
      'authority',
      'intent',
      'naming',
      'confirmed',
      'confirmedNotSent',
      'confirmedStale',
      'enabled',
      'held',
    ])
      if (key in fields)
        (fields as Record<string, unknown>)[key] = fields[key] === 'true' || fields[key] === 'on';
    for (const key of ['documents', 'values', 'manifest'])
      if (fields[key]) {
        try {
          (fields as Record<string, unknown>)[key] = JSON.parse(fields[key]);
        } catch {
          return agreementJson({ ok: false, error: 'Invalid fields' }, 400);
        }
      }
    if (fields.action === 'config' && !fields.values) {
      const { action, expectedCurrentVersion, ...values } = fields;
      return {
        action,
        expectedCurrentVersion,
        values: {
          ...values,
          registered_agent_confirmed: fields.registered_agent_confirmed === 'on',
        },
      };
    }
    if (fields.legal_name && !fields.action && !fields.values) {
      const { csrf_nonce, ...values } = fields;
      return {
        csrf_nonce,
        values: { ...values, naming: (values as Record<string, unknown>).naming === true },
      };
    }
    if (fields.action === 'hold')
      (fields as Record<string, unknown>).held = (fields as Record<string, unknown>).held === true;
    if (fields.action === 'setting' && !('enabled' in fields))
      (fields as Record<string, unknown>).enabled = false;
    return fields;
  }
  return musicRequest(request, max);
}
export async function nativeAgreementResponse(request: Request, response: Response, path: string) {
  if (
    !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') ||
    !response.ok
  )
    return response;
  const headers = new Headers(response.headers);
  headers.set('location', path);
  return new Response(null, { status: 303, headers });
}
