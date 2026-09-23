import { expect, it } from 'vitest';
import { POST } from '~/pages/api/owner/projects/[id]/files/[fileId]';

it('keeps file publication behind owner access and the disabled portal gate', async () => {
  const request = new Request('https://thesuperhuman.us/api/owner/projects/song-1/files/review-1', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish', note: 'Ready for review.', downloadable: false }),
  });
  const context = { params: { id: 'song-1', fileId: 'review-1' }, request,
    locals: { runtime: { env: { AUDIO_CLIENT_PORTAL_ENABLED: 'false' } } } } as any;
  expect((await POST(context)).status).toBe(403);
  context.locals.owner = { email: 'owner@example.com' };
  expect((await POST(context)).status).toBe(404);
});
