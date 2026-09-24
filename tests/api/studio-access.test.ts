import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as requestCode } from '~/pages/api/studio/code';
import { POST as completeCode } from '~/pages/api/studio/session';
import { POST as signOut } from '~/pages/api/studio/sign-out';
import { issueClientCode, completeClientCode, discardUndeliveredCode, revokeClientSession, takeStudioAllowance } from '~/lib/audio-client-access';
import { sendAudioMessage } from '~/lib/audio-resend';

vi.mock('~/lib/audio-client-access', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-client-access')>()),
  issueClientCode: vi.fn(),
  completeClientCode: vi.fn(),
  discardUndeliveredCode: vi.fn(),
  revokeClientSession: vi.fn(),
  takeStudioAllowance: vi.fn(async () => true),
}));
vi.mock('~/lib/audio-resend', () => ({ sendAudioMessage: vi.fn(async () => ({ ok: true })) }));

const email = 'Artist@Example.com';
function context(path: string, body: unknown, enabled = true) {
  const pending: Promise<unknown>[] = [];
  return {
    request: new Request(`https://thesuperhuman.us${path}`, {
      method: 'POST', headers: { origin: 'https://thesuperhuman.us', 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    locals: { runtime: { ctx: { waitUntil: vi.fn((work: Promise<unknown>) => { pending.push(work); }) }, env: {
      AUDIO_CLIENT_PORTAL_ENABLED: enabled ? 'true' : 'false', AUDIO_CLIENT_CODE_KEY: 'a'.repeat(32),
      MUSIC_DB: {},
      TURNSTILE_SECRET_KEY: 'test', RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'noreply@example.com',
    } } },
    pending,
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
    const knownContext = context('/api/studio/code', { email, turnstileToken: 'challenge' });
    const known = await requestCode(knownContext);
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(sendAudioMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({
      to: ['artist@example.com'], html: expect.stringContaining('1234 5678'), text: expect.stringContaining('1234 5678') }) }));
    await Promise.all(knownContext.pending);
  });

  it('responds without waiting for email delivery', async () => {
    vi.mocked(issueClientCode).mockResolvedValueOnce('12345678');
    let finishDelivery!: (result: { ok: boolean }) => void;
    vi.mocked(sendAudioMessage).mockReturnValueOnce(new Promise(resolve => { finishDelivery = resolve; }));
    const ctx = context('/api/studio/code', { email, turnstileToken: 'challenge' });
    const response = await Promise.race([
      requestCode(ctx),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Code response waited for email delivery')), 1000)),
    ]);
    expect(response.status).toBe(200);
    expect(ctx.locals.runtime.ctx.waitUntil).toHaveBeenCalledOnce();
    finishDelivery({ ok: true });
    await Promise.all(ctx.pending);
  });

  it('keeps access closed by default and sets a protected cookie after a valid code', async () => {
    expect((await requestCode(context('/api/studio/code', { email, turnstileToken: 'challenge' }, false))).status).toBe(404);
    expect(issueClientCode).not.toHaveBeenCalled();
    vi.mocked(completeClientCode).mockResolvedValueOnce('0'.repeat(72));
    const response = await completeCode(context('/api/studio/session', { email, code: '12345678' }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=1209600');
  });

  it('invalidates an undelivered code and revokes the current session on sign-out', async () => {
    vi.mocked(issueClientCode).mockResolvedValueOnce('12345678');
    vi.mocked(sendAudioMessage).mockResolvedValueOnce({ ok: false });
    const codeContext = context('/api/studio/code', { email, turnstileToken: 'challenge' });
    const codeResponse = await requestCode(codeContext);
    expect(codeResponse.status).toBe(200);
    await Promise.all(codeContext.pending);
    expect(discardUndeliveredCode).toHaveBeenCalled();

    const ctx = context('/api/studio/sign-out', {});
    ctx.request.headers.set('cookie', `studio_session=${'0'.repeat(72)}`);
    const response = await signOut(ctx);
    expect(response.status).toBe(200);
    expect(revokeClientSession).toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps a code whose delivery is uncertain, since the email may still arrive', async () => {
    vi.mocked(issueClientCode).mockResolvedValueOnce('12345678');
    vi.mocked(sendAudioMessage).mockResolvedValueOnce({ ok: false, uncertain: true });
    const codeContext = context('/api/studio/code', { email, turnstileToken: 'challenge' });
    expect((await requestCode(codeContext)).status).toBe(200);
    await Promise.all(codeContext.pending);
    expect(discardUndeliveredCode).not.toHaveBeenCalled();
  });

  it('refuses code requests and guesses past their allowance', async () => {
    vi.mocked(takeStudioAllowance).mockResolvedValueOnce(false);
    expect((await requestCode(context('/api/studio/code', { email, turnstileToken: 'challenge' }))).status).toBe(429);
    vi.mocked(takeStudioAllowance).mockResolvedValueOnce(false);
    expect((await completeCode(context('/api/studio/session', { email, code: '12345678' }))).status).toBe(429);
    expect(issueClientCode).not.toHaveBeenCalled();
    expect(completeClientCode).not.toHaveBeenCalled();
  });

  it('clears the browser cookie when session revocation fails', async () => {
    vi.mocked(revokeClientSession).mockRejectedValueOnce(new Error('Database unavailable'));
    const ctx = context('/api/studio/sign-out', {});
    ctx.request.headers.set('cookie', `studio_session=${'0'.repeat(72)}`);
    const response = await signOut(ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, localSignedOut: true });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
