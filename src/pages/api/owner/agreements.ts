import type { APIRoute } from 'astro';
import {
  previewAgreementRetention,
  applyAgreementRetention,
  type RetentionManifest,
} from '~/lib/agreement-retention';
import { z } from 'astro/zod';
import { nativeAgreementRoute, agreementRequest, nativeAgreementResponse } from '~/lib/agreement-request';
import { agreementJson, cleanupAgreementAccess } from '~/lib/agreement-access';
import { contractorSchema } from '~/lib/agreement-fields';
import {
  publishTemplate,
  renderAgreement,
  sampleAgreementValues,
  validateTemplate,
} from '~/lib/agreement-templates';
export const prerender = false;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('access-cleanup'), confirmed: z.literal(true) }),
  z.object({ action: z.literal('retention-preview') }),
  z.object({
    action: z.literal('retention-apply'),
    confirmed: z.literal(true),
    manifest: z.unknown(),
  }),
  z.object({
    action: z.enum(['preview', 'publish']),
    kind: z.enum(['msa', 'sow']),
    text: z.string().max(102400),
    expectedCurrentVersion: z.coerce.number().int().min(0),
    confirmed: z.boolean().optional(),
  }),
  z.object({ action: z.literal('setting'), enabled: z.boolean(), confirmed: z.literal(true) }),
  z.object({
    action: z.literal('config'),
    values: contractorSchema,
    expectedCurrentVersion: z.coerce.number().int().min(0),
  }),
]);
const post: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.MUSIC_DB;
  if (!locals.owner) return agreementJson({ ok: false }, 403);
  if (!db) return agreementJson({ ok: false }, 503);
  const body = await agreementRequest(request, 120000);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return agreementJson({ ok: false, error: 'Check required fields and limits.' }, 400);
  const c = parsed.data,
    at = new Date().toISOString(),
    actor = locals.owner.email;
  try {
    if (c.action === 'access-cleanup') {
      await cleanupAgreementAccess(db);
      return nativeAgreementResponse(request, agreementJson({ ok: true }), '/owner/agreements');
    }
    if (c.action === 'retention-preview' || c.action === 'retention-apply') {
      const env = locals.runtime.env;
      if (!env.AUDIO || !env.AGREEMENT_RETENTION_BINDING_ID)
        return agreementJson(
          { ok: false, error: 'Retention storage identity is not configured.' },
          503,
        );
      if (c.action === 'retention-preview')
        return agreementJson({
          ok: true,
          manifest: await previewAgreementRetention(
            db,
            env.AUDIO,
            env.AGREEMENT_RETENTION_BINDING_ID,
          ),
        });
      await applyAgreementRetention(
        db,
        env.AUDIO,
        env.AGREEMENT_RETENTION_BINDING_ID,
        c.manifest as RetentionManifest,
      );
      return agreementJson({ ok: true });
    }
    if (c.action === 'setting') {
      await db
        .prepare(
          'UPDATE software_signing_settings SET software_signing_enabled=?,updated_at=?,updated_by=? WHERE id=1',
        )
        .bind(c.enabled ? 1 : 0, at, actor)
        .run();
      return nativeAgreementResponse(request, agreementJson({ ok: true }), '/owner/agreements');
    }
    if (c.action === 'config') {
      await db.batch([
        db
          .prepare(
            `SELECT CASE WHEN COALESCE((SELECT max(version) FROM software_contractor_config),0)=? THEN 1 ELSE json_extract('Config changed','$') END`,
          )
          .bind(c.expectedCurrentVersion),
        db
          .prepare('INSERT INTO software_contractor_config VALUES(?,?,?,?)')
          .bind(c.expectedCurrentVersion + 1, JSON.stringify(c.values), at, actor),
      ]);
      return nativeAgreementResponse(request, agreementJson({ ok: true }), '/owner/agreements');
    }
    validateTemplate(c.kind, c.text);
    if (c.action === 'preview') {
      return agreementJson({ ok: true, text: renderAgreement(c.kind, c.text, sampleAgreementValues(c.kind, c.text)) });
    }
    if (!c.confirmed)
      return agreementJson(
        { ok: false, error: 'Confirm publication of a new immutable version.' },
        400,
      );
    return nativeAgreementResponse(
      request,
      agreementJson({
        ok: true,
        ...(await publishTemplate(db, c.kind, c.text, c.expectedCurrentVersion, actor)),
      }),
      '/owner/agreements',
    );
  } catch (error) {
    return agreementJson(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'The agreement could not be saved.',
      },
      409,
    );
  }
};

export const POST = nativeAgreementRoute(post, context => '/owner/agreements');
