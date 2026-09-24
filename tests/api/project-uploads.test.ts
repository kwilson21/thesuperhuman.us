import { expect, it } from 'vitest';
import { POST, PUT } from '~/pages/api/owner/projects/[id]/uploads';

const uuid = '98f3c6a7-9d1e-4f44-ae41-74db25122e14';
const url = 'https://thesuperhuman.us/api/owner/projects/song-1/uploads';

it('fails closed without owner access or the portal gate', async () => {
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', version: 'review', displayName: 'Song.wav', mediaType: 'audio/wav', byteSize: 10 }) });
  const context = { params: { id: 'song-1' }, request, locals: { runtime: { env: { AUDIO_CLIENT_PORTAL_ENABLED: 'false' } } } } as any;
  expect((await POST(context)).status).toBe(403);
  context.locals.owner = { email: 'owner@example.com' };
  expect((await POST(context)).status).toBe(404);
});

it('rejects a wrongly sized part before sending it to R2', async () => {
  let reachedR2 = false;
  const db = { prepare: (query: string) => ({ bind: () => ({ first: async () => query.includes('audio_project_uploads')
    ? { id: uuid, request_id: 'song-1', object_key: 'studio/projects/song-1/test.wav', upload_id: 'r2-id', byte_size: 10 }
    : { '1': 1 } }) }) };
  const request = new Request(`${url}?uploadId=${uuid}&part=1`, { method: 'PUT', headers: { 'content-length': '9' }, body: new Uint8Array(9) });
  const context = { params: { id: 'song-1' }, request, locals: { owner: { email: 'owner@example.com' }, runtime: { env: {
    AUDIO_CLIENT_PORTAL_ENABLED: 'true', MUSIC_DB: db, AUDIO: { resumeMultipartUpload: () => { reachedR2 = true; } },
  } } } } as any;
  expect((await PUT(context)).status).toBe(400);
  expect(reachedR2).toBe(false);
});
