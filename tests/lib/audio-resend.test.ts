import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendAudioInquiry } from '~/lib/audio-resend';
import type { AudioInquiryInput } from '~/lib/audio-validation';

const input: AudioInquiryInput = {
  name: 'Jane',
  email: 'jane@example.com',
  services: ['mixing', 'mastering'],
  trackCount: 3,
  targetDate: '2026-08-01',
  flexible: false,
  references: 'https://example.com/ref',
  delivery: 'Dropbox',
  notes: 'Long enough description of the project that explains the work clearly.',
  turnstileToken: 'tok',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'em_1' }) } as any)));
});

describe('sendAudioInquiry', () => {
  it('posts to Resend with the expected payload', async () => {
    const res = await sendAudioInquiry({ input, apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(true);
    const calls = (fetch as any).mock.calls;
    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0][1].body);
    expect(body.from).toBe('noreply@notifs.x');
    expect(body.to).toEqual(['kazon@x']);
    expect(body.subject).toContain('Audio inquiry');
    expect(body.subject).toContain('Jane');
    expect(body.subject).toContain('mixing');
    expect(body.text).toContain('Services: mixing, mastering');
    expect(body.text).toContain('Track count: 3');
    expect(body.text).toContain('Target date: 2026-08-01');
    expect(body.text).toContain('Delivery: Dropbox');
    expect(body.reply_to).toBe('jane@example.com');
  });

  it('reports failure when Resend returns non-ok', async () => {
    (fetch as any).mockImplementation(async () => ({ ok: false, json: async () => ({}) } as any));
    const res = await sendAudioInquiry({ input, apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(false);
  });

  it('renders "flexible" when no target date is set', async () => {
    (fetch as any).mockImplementation(async () => ({ ok: true } as any));
    const flex: AudioInquiryInput = { ...input, targetDate: undefined, flexible: true };
    await sendAudioInquiry({ input: flex, apiKey: 'k', from: 'a', to: 'b' });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toContain('Target date: flexible');
  });
});
