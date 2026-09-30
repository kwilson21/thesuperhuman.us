import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { issueAgreementCode, agreementJson } from '~/lib/agreement-access';
import { agreementRequest } from '~/lib/agreement-request';
export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await agreementRequest(request, 4096);
  if (body instanceof Response) return body;
  const input = z
    .object({ email: z.string().max(320), turnstileToken: z.string().min(1).max(2048) })
    .safeParse(body);
  if (!input.success)
    return agreementJson({ ok: false, error: 'Complete the security check.' }, 400);
  try {
    const response = await issueAgreementCode(locals.runtime.env, request, input.data);
    if (
      response.ok &&
      request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
    ) {
      const receipt = (await response.json()) as { challenge_id: string };
      return new Response(null, {
        status: 303,
        headers: {
          location: `/agreements?challenge=${encodeURIComponent(receipt.challenge_id)}`,
          'cache-control': 'private, no-store',
        },
      });
    }
    return response;
  } catch {
    return agreementJson(
      { ok: false, error: 'Agreement sign-in is temporarily unavailable.' },
      503,
    );
  }
};
