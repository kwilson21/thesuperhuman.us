import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as requestCode } from '~/pages/api/studio/code';
import { POST as completeCode } from '~/pages/api/studio/session';
import { issueClientCode, completeClientCode } from '~/lib/audio-client-access';
import { sendAudioMessage } from '~/lib/audio-resend';

vi.mock('~/lib/audio-client-access', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-client-access')>()),
  issueClientCode: vi.fn(),
  completeClientCode: vi.fn(),
}));
vi.mock('~/lib/audio-resend', () => ({ sendAudioMessage: vi.fn(async () => ({ ok: true })) }));

const email = 'Artist@Example.com';
function context(path: string, body: unknown, enabled = true) {
  return {
    request: new Request(`https://thesuperhuman.us${path}`, {
      method: 'POST', headers: { origin: 'https://thesuperhuman.us', 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    locals: { runtime: { env: {
      AUDIO_CLIENT_PORTAL_ENABLED: enabled ? 'true' : 'false', AUDIO_CLIENT_CODE_KEY: 'a'.repeat(32),
      MUSIC_DB: {}, RATE_LIMIT: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
      TURNSTILE_SECRET_KEY: 'test', RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'noreply@example.com',
    } } },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
});

describe('studio access routes', () => {
  it('keeps project existence out of the code-request response', async () => {
    vi.mocked(issueClientCode).mockResolvedValueOnce(null).mockResolvedValueOnce('12345678');
    const unknown = await requestCode(context('/api/studio/code', { email, turnstileToken: 'challenge' }));
    expect(unknown.status).toBe(200);
    expect(sendAudioMessage).not.toHaveBeenCalled();
    const known = await requestCode(context('/api/studio/code', { email, turnstileToken: 'challenge' }));
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(sendAudioMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ to: ['artist@example.com'] }) }));
  });

  it('keeps access closed by default and sets a protected cookie after a valid code', async () => {
    expect((await requestCode(context('/api/studio/code', { email, turnstileToken: 'challenge' }, false))).status).toBe(404);
    expect(issueClientCode).not.toHaveBeenCalled();
    vi.mocked(completeClientCode).mockResolvedValueOnce('0'.repeat(72));
    const response = await completeCode(context('/api/studio/session', { email, code: '12345678' }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=1209600');
  });
});
