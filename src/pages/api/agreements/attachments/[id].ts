import type { APIRoute } from 'astro';
import { agreementSession, agreementHeaders } from '~/lib/agreement-access';
export const prerender = false;
export const GET: APIRoute = async ({ locals, request, params }) => {
  const env = locals.runtime.env,
    db = env.MUSIC_DB;
  if (!db) return new Response('Unavailable', { status: 503 });
  const session = await agreementSession(db, request);
  if (!session)
    return new Response('Verify email first.', { status: 401, headers: agreementHeaders });
  const row = await db
    .prepare(
      `SELECT a.object_key FROM software_agreement_attachments a JOIN software_offers o ON o.request_id=a.request_id WHERE a.id=? AND o.id=? AND EXISTS(SELECT 1 FROM json_each(o.agreement_details_json,'$.attachments') WHERE json_extract(value,'$.key')=a.object_key AND json_extract(value,'$.sha256')=a.sha256)`,
    )
    .bind(params.id, session.offer_id)
    .first<{ object_key: string }>();
  if (!row) return new Response('Not found', { status: 404 });
  const object = await env.AUDIO.get(row.object_key);
  return object
    ? new Response(object.body, {
        headers: {
          ...agreementHeaders,
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="agreement-attachment.pdf"',
          'x-content-type-options': 'nosniff',
        },
      })
    : new Response('Unavailable', { status: 503 });
};
