import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyTurnstile } from '~/lib/turnstile';

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns true when Cloudflare says success', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(true);
  });

  it('returns false when Cloudflare says failure', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('returns false when fetch rejects', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('returns false when fetch returns non-OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    const result = await verifyTurnstile('tok', 'secret', '1.2.3.4');
    expect(result).toBe(false);
  });

  it('sends token, secret, and remoteip in the form body', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    await verifyTurnstile('TOKEN', 'SECRET', '9.9.9.9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('challenges.cloudflare.com');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('response')).toBe('TOKEN');
    expect(body.get('secret')).toBe('SECRET');
    expect(body.get('remoteip')).toBe('9.9.9.9');
  });
});
