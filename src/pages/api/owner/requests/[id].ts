import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { changeOwnerRequest } from '~/lib/owner-requests';
export const prerender = false;

const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['review', 'resolve', 'reopen', 'withdraw']) }),
  z.object({ action: z.literal('note'), note: z.string().trim().max(1000) }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  if (!locals.runtime.env.MUSIC_DB || !params.id) return Response.json({ ok: false }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  try {
    const requestRecord = await changeOwnerRequest(locals.runtime.env.MUSIC_DB, { id: params.id, actor: locals.owner.email, ...parsed.data });
    return Response.json({ ok: true, request: requestRecord }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message === 'Request not found.' ? 404 : 409;
    return Response.json({ ok: false }, { status, headers: { 'cache-control': 'private, no-store' } });
  }
};
