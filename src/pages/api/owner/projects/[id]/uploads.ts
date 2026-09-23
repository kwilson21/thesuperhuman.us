import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { abortProjectUpload, beginProjectUpload, expectedPartLength, finishProjectUpload,
  getProjectUpload, maxPartEtagLength, maxProjectFileSize, ownerProjectCanUpload, putProjectUploadPart, uploadPartSize } from '~/lib/audio-project-uploads';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const id = z.uuid();
const start = z.object({ action: z.literal('start'), version: z.enum(['review', 'final']),
  displayName: z.string().trim().min(1).max(160), mediaType: z.enum(['audio/mpeg', 'audio/wav']),
  byteSize: z.number().int().min(1).max(maxProjectFileSize) });
const complete = z.object({ action: z.literal('complete'), uploadId: id,
  parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(maxPartEtagLength) })).min(1).max(Math.ceil(maxProjectFileSize / uploadPartSize)) });
const abort = z.object({ action: z.literal('abort'), uploadId: id });
const recover = z.object({ action: z.literal('recover'), uploadId: id });
const input = z.discriminatedUnion('action', [start, complete, abort, recover]);
const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return fail('Owner access required.', 403);
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return fail('Not found.', 404);
  if (!params.id || !env.MUSIC_DB || !env.AUDIO) return fail('Private uploads are unavailable.', 503);
  const body = await musicRequest(request, 32_000);
  if (body instanceof Response) return body;
  const parsed = input.safeParse(body);
  if (!parsed.success) return fail('Check the file details and try again.', 400);
  try {
    if (parsed.data.action === 'start') {
      const upload = await beginProjectUpload(env.MUSIC_DB, env.AUDIO, params.id, parsed.data);
      if (!upload) return fail('This project is not ready for file upload.', 409);
      return Response.json({ ok: true, uploadId: upload.id, partSize: uploadPartSize });
    }
    const upload = await getProjectUpload(env.MUSIC_DB, params.id, parsed.data.uploadId);
    if (!upload) return fail('This upload is no longer available.', 404);
    if (parsed.data.action === 'abort') {
      await abortProjectUpload(env.MUSIC_DB, env.AUDIO, upload);
      return Response.json({ ok: true });
    }
    const result = await finishProjectUpload(env.MUSIC_DB, env.AUDIO, upload, parsed.data.action === 'complete' ? parsed.data.parts : null);
    if (result !== 'saved') return fail(result === 'size-mismatch' ? 'The file size did not match. It was not published.' : 'This upload cannot be finished now.', 409);
    return Response.json({ ok: true, fileId: upload.id });
  } catch {
    return fail('The upload could not be saved. Please try again.', 503);
  }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return fail('Owner access required.', 403);
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return fail('Not found.', 404);
  if (!params.id || !env.MUSIC_DB || !env.AUDIO) return fail('Private uploads are unavailable.', 503);
  const url = new URL(request.url);
  const uploadId = id.safeParse(url.searchParams.get('uploadId'));
  const partNumber = Number(url.searchParams.get('part'));
  if (!uploadId.success || !Number.isInteger(partNumber) || !request.body) return fail('Invalid file part.', 400);
  try {
    const upload = await getProjectUpload(env.MUSIC_DB, params.id, uploadId.data);
    if (!upload) return fail('This upload is no longer available.', 404);
    if (!await ownerProjectCanUpload(env.MUSIC_DB, params.id, upload.version)) return fail('This project is not ready for file upload.', 409);
    const length = expectedPartLength(upload.byte_size, partNumber);
    if (length === null || (request.headers.has('content-length') && Number(request.headers.get('content-length')) !== length)) {
      return fail('This file part has the wrong size.', 400);
    }
    // A part is at most 10 MiB. Buffering gives R2 a known length in workerd and in local dev.
    const body = await request.arrayBuffer();
    if (body.byteLength !== length) return fail('This file part has the wrong size.', 400);
    const part = await putProjectUploadPart(env.AUDIO, upload, partNumber, body);
    return Response.json({ ok: true, part });
  } catch {
    return fail('This part could not be uploaded. Please try again.', 503);
  }
};
