import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { issueAgreementLink, agreementJson } from '~/lib/agreement-access';
import { nativeAgreementRoute, agreementRequest } from '~/lib/agreement-request';
export const prerender = false;
const post: APIRoute = async ({ request, locals, params }) => {
  const body = await agreementRequest(request, 4096);
  if (body instanceof Response) return body;
  const input = z.object({ turnstileToken: z.string().min(1).max(2048) }).safeParse(body);
  if (!input.success)
    return agreementJson({ ok: false, error: 'Complete the security check.' }, 400);
  try {
    const response = await issueAgreementLink(
      locals.runtime.env,
      request,
      input.data,
      params.token,
    );
    if (
      response.ok &&
      request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
    ) {
      return new Response(null, {
        status: 303,
        headers: {
          location: `/offer/${params.token}/sign?email=sent`,
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

export const POST = nativeAgreementRoute(post, context => `/offer/${context.params.token}/sign`);
