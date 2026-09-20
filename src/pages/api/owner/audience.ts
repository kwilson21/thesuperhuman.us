import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
export const prerender = false;
const schema = z.object({ action: z.literal('withdraw'), email: z.string().trim().toLowerCase().email().max(120) });
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const db = locals.runtime.env.MUSIC_DB;
  if (!db) return Response.json({ ok: false }, { status: 503 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const parsed = schema.safeParse(body); if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const now = new Date().toISOString();
  const [, result] = await db.batch([
    db.prepare(`INSERT INTO owner_audience_audit(email,action,actor,occurred_at)
      SELECT email,'withdrawn',?,? FROM owner_audience_permissions WHERE email=? AND status='subscribed'`)
      .bind(locals.owner.email, now, parsed.data.email),
    db.prepare(`UPDATE owner_audience_permissions SET status='unsubscribed',withdrawn_at=?,updated_at=? WHERE email=? AND status='subscribed'`)
      .bind(now, now, parsed.data.email),
  ]);
  return Response.json({ ok: true, changed: result.meta.changes > 0 }, { headers: { 'cache-control': 'private, no-store' } });
};
