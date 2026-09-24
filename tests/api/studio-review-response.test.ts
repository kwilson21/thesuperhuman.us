import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/studio/projects/[id]/messages';
import { postClientReviewDecision } from '~/lib/audio-project-messages';

vi.mock('~/lib/audio-client-access', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-client-access')>()),
  clientProjectForSession: vi.fn(async () => ({ request_id: 'song-1' })),
}));
vi.mock('~/lib/audio-project-messages', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-project-messages')>()),
  postClientReviewDecision: vi.fn(async (_db: unknown, _id: string, _token: string, _review: string, decision: string, body: string) => ({ id: 1, actor: 'client', body, review_decision: decision })),
  clientMessageRateLimited: vi.fn(async () => false),
}));

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
  expect((await POST(context({ action: 'respond', reviewId: 'review-1', decision: 'approved', body: '' }))).status).toBe(200);
  expect(postClientReviewDecision).toHaveBeenLastCalledWith({}, 'song-1', token, 'review-1', 'approved', 'I approve this mix.');
  expect((await POST(context({ action: 'respond', reviewId: 'review-1', decision: 'changes', body: '  ' }))).status).toBe(400);
  expect((await POST(context({ action: 'respond', reviewId: 'review-1', decision: 'changes', body: 'Vocal up in verse two.' }))).status).toBe(200);
});

it('passes a stop through with a default note', async () => {
  expect((await POST(context({ action: 'respond', reviewId: 'review-1', decision: 'stopped', body: '' }))).status).toBe(200);
  expect(postClientReviewDecision).toHaveBeenLastCalledWith({}, 'song-1', token, 'review-1', 'stopped', 'I’m stopping the project here.');
});

it('refuses an answer the project does not allow, and one without the review it answers', async () => {
  vi.mocked(postClientReviewDecision).mockResolvedValueOnce(null);
  expect((await POST(context({ action: 'respond', reviewId: 'review-1', decision: 'stopped', body: '' }))).status).toBe(409);
  expect((await POST(context({ action: 'respond', decision: 'approved', body: '' }))).status).toBe(400);
});
