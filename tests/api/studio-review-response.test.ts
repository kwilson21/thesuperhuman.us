import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/studio/projects/[id]/messages';
import { postClientReviewDecision } from '~/lib/audio-project-messages';
import { revokeProjectAccess } from '~/lib/audio-project-revocation';

vi.mock('~/lib/audio-client-access', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-client-access')>()),
  clientProjectForSession: vi.fn(async () => ({ request_id: 'song-1' })),
}));
vi.mock('~/lib/audio-project-messages', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-project-messages')>()),
  postClientReviewDecision: vi.fn(async (_db: unknown, _id: string, _token: string, decision: string, body: string) => ({ id: 1, actor: 'client', body, review_decision: decision })),
  clientMessageRateLimited: vi.fn(async () => false),
}));
vi.mock('~/lib/audio-project-revocation', () => ({ revokeProjectAccess: vi.fn(async () => true) }));

const token = '00000000-0000-4000-8000-000000000000'.repeat(2);
function context(body: unknown) {
  return {
    params: { id: 'song-1' },
    request: new Request('https://thesuperhuman.us/api/studio/projects/song-1/messages', {
      method: 'POST', headers: { origin: 'https://thesuperhuman.us', 'content-type': 'application/json', cookie: `studio_session=${token}` }, body: JSON.stringify(body),
    }),
    locals: { runtime: { env: { AUDIO_CLIENT_PORTAL_ENABLED: 'true', MUSIC_DB: {} } } },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it('approves with a default note, requires notes for changes, and never closes access for either', async () => {
  expect((await POST(context({ action: 'respond', decision: 'approved', body: '' }))).status).toBe(200);
  expect(postClientReviewDecision).toHaveBeenLastCalledWith({}, 'song-1', token, 'approved', 'I approve this mix.');
  expect((await POST(context({ action: 'respond', decision: 'changes', body: '  ' }))).status).toBe(400);
  expect((await POST(context({ action: 'respond', decision: 'changes', body: 'Vocal up in verse two.' }))).status).toBe(200);
  expect(revokeProjectAccess).not.toHaveBeenCalled();
});

it('closes the client’s access when they stop the project', async () => {
  expect((await POST(context({ action: 'respond', decision: 'stopped', body: '' }))).status).toBe(200);
  expect(postClientReviewDecision).toHaveBeenLastCalledWith({}, 'song-1', token, 'stopped', 'I’m stopping the project here.');
  expect(revokeProjectAccess).toHaveBeenCalledWith({}, 'song-1', 'client-stopped');
});

it('refuses an answer the project does not allow without closing access', async () => {
  vi.mocked(postClientReviewDecision).mockResolvedValueOnce(null);
  expect((await POST(context({ action: 'respond', decision: 'stopped', body: '' }))).status).toBe(409);
  expect(revokeProjectAccess).not.toHaveBeenCalled();
});
