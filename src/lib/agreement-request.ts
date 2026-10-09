import type { APIRoute } from 'astro';
import { escapeHtml } from './email-template';
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
      'consent',
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
        values,
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

/** Preserve bounded API errors as readable pages for native form submissions. */
export function nativeAgreementRoute(handler: APIRoute, returnPath: (context: Parameters<APIRoute>[0]) => string): APIRoute {
  return async context => {
    const response = await handler(context);
    if (!context.request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') || response.status === 303) return response;
    const body = await response.clone().json().catch(() => null) as { error?: string; text?: string } | null;
    if (response.ok && !body?.text) return response;
    const message = body?.text ?? body?.error ?? 'The request could not be completed. Return to the form and check the fields.';
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('referrer-policy','no-referrer');
    headers.set('x-robots-tag','noindex, nofollow');
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Agreement ${response.ok?'preview':'needs attention'}</title></head><body><main><h1>${response.ok?'Agreement preview':'Check your agreement form'}</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere" role="${response.ok?'document':'alert'}">${escapeHtml(message)}</pre><p>Use your browser’s Back button to keep your entered fields, or <a href="${escapeHtml(returnPath(context))}">return to the agreement page</a>.</p></main></body></html>`,{status:response.status,headers});
  };
}
