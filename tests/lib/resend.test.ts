import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendContactEmails } from '~/lib/resend';
import type { ContactInput } from '~/lib/validation';

const input: ContactInput = {
  name: 'Jane',
  email: 'jane@example.com',
  company: 'Acme',
  projectType: ['Backend systems', 'Data pipelines'],
  timeline: 'Now',
  budget: '$10–50k',
  description: 'Need help with our ingestion pipeline; can pay well.',
  turnstileToken: 'tok',
};

describe('sendContactEmails', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends both primary and autoresponder emails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('primary email goes to CONTACT_TO_EMAIL with reply-to set to visitor', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    const primaryBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(primaryBody.to).toContain('kazon.wilson@thesuperhuman.us');
    expect(primaryBody.reply_to).toBe('jane@example.com');
    expect(primaryBody.subject).toContain('Jane');
  });

  it('autoresponder goes to the visitor email', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }) });
    await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    const autoBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(autoBody.to).toContain('jane@example.com');
    expect(autoBody.subject).toMatch(/thanks/i);
  });

  it('returns ok=false if primary email fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'fail' }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_2' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(false);
  });

  it('autoresponder failure does NOT fail the request (best-effort)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_1' }) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'fail' }) });
    const result = await sendContactEmails({
      input,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
    });
    expect(result.ok).toBe(true);
  });
});
