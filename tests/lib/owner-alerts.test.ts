import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendUrgentOwnerAlert } from '~/lib/owner-alerts';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))));

describe('urgent owner alerts', () => {
  it('sends only a safe category, route, request ID, code and time', async () => {
    const ok = await sendUrgentOwnerAlert({
      RESEND_API_KEY: 'secret',
      CONTACT_FROM_EMAIL: 'noreply@notifs.thesuperhuman.us',
      CONTACT_TO_EMAIL: 'owner@example.com',
    } as Env, {
      category: 'request-storage',
      route: '/api/audio-intake',
      requestId: 'request-123',
      code: 'd1-write-failed',
      occurredAt: '2026-09-19T12:00:00.000Z',
    });
    expect(ok).toBe(true);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.text).toContain('request-123');
    expect(payload.text).not.toContain('artist@example.com');
    expect(payload.reply_to).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('stays quiet when alert delivery is not configured', async () => {
    await expect(sendUrgentOwnerAlert({} as Env, {
      category: 'request-storage', route: '/api/music-interest', requestId: 'request-456',
      code: 'd1-write-failed', occurredAt: '2026-09-19T12:00:00.000Z',
    })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
