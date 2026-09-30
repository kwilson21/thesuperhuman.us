import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { agreementSession, agreementJson, signingEnabled } from '~/lib/agreement-access';
import { agreementRequest, nativeAgreementResponse } from '~/lib/agreement-request';
import { getLinkedOffer } from '~/lib/software-offers';
import { deliverAgreementNotifications } from '~/lib/agreement-artifacts';
import { signAgreements, offerAgreements } from '~/lib/software-agreements';
export const prerender = false;
export const POST: APIRoute = async ({ request, locals, params }) => {
  const db = locals.runtime.env.MUSIC_DB;
  if (!db) return agreementJson({ ok: false }, 503);
  const body = await agreementRequest(request);
  if (body instanceof Response) return body;
  const input = z
    .object({
      csrf_nonce: z.string().min(1),
      documents: z
        .array(z.object({ id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) }))
        .min(1)
        .max(2),
      consent: z.literal(true),
      authority: z.literal(true),
      intent: z.literal(true),
    })
    .safeParse(body);
  const offer = params.token ? await getLinkedOffer(db, params.token) : null,
    session = offer ? await agreementSession(db, request, 'agreement', offer.id) : null;
  if (!(await signingEnabled(db)) || !session)
    return agreementJson(
      { ok: false, error: 'Request a fresh code, then review the agreement again.' },
      401,
    );
  if (!input.success)
    return agreementJson(
      {
        ok: false,
        error: 'Confirm consent, authority and intent after reviewing the exact documents.',
      },
      400,
    );
  if (input.data.csrf_nonce !== session.csrf_nonce)
    return agreementJson({ ok: false, error: 'Reload and try again.' }, 403);
  try {
    const receipt_id = await signAgreements(db, offer!, session, input.data.documents, request);
    const sow = (await offerAgreements(db, offer!.id)).find((d) => d.kind === 'sow');
    if (sow)
      try {
        await deliverAgreementNotifications(locals.runtime.env, sow.id);
      } catch {
        /* Saved signatures survive notification failures. */
      }
    return nativeAgreementResponse(
      request,
      agreementJson({ ok: true, receipt_id }),
      `/offer/${params.token}/sign`,
    );
  } catch {
    return agreementJson(
      { ok: false, error: 'The reviewed agreement changed. Reload and review it again.' },
      409,
    );
  }
};
