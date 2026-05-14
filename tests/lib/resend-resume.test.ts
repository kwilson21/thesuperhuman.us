import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendResumeApprovalRequest,
  sendResumeDelivery,
} from '~/lib/resend';
import type { StoredResumeRequest } from '~/lib/resume-requests';

const storedRequest: StoredResumeRequest = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  company: 'Acme Corp',
  audience: 'leadership',
  note: 'Reviewing your background for a staff role.',
  ts: 1700000000000,
};

describe('sendResumeApprovalRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('emails the operator with the approval link', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em' }) });

    const result = await sendResumeApprovalRequest({
      request: storedRequest,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
      approvalUrl: 'https://thesuperhuman.us/api/resume-approve?id=abc',
    });
    expect(result.ok).toBe(true);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(['kazon.wilson@thesuperhuman.us']);
    expect(body.subject).toContain('Jane Doe');
    expect(body.subject).toContain('leadership');
    expect(body.text).toContain('jane@example.com');
    expect(body.text).toContain('Acme Corp');
    expect(body.text).toContain('Reviewing your background');
    expect(body.text).toContain('https://thesuperhuman.us/api/resume-approve?id=abc');
    expect(body.reply_to).toBe('jane@example.com');
  });

  it('returns ok=false when send fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await sendResumeApprovalRequest({
      request: storedRequest,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
      approvalUrl: 'https://thesuperhuman.us/api/resume-approve?id=abc',
    });
    expect(result.ok).toBe(false);
  });

  it('omits company and note lines when those fields are empty', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em' }) });
    const lean: StoredResumeRequest = { ...storedRequest, company: '', note: '' };
    await sendResumeApprovalRequest({
      request: lean,
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'kazon.wilson@thesuperhuman.us',
      approvalUrl: 'https://thesuperhuman.us/api/resume-approve?id=abc',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).not.toContain('Company:');
    expect(body.text).not.toContain('Note:');
  });
});

describe('sendResumeDelivery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('emails the requester with the PDF attached', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em' }) });

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF"

    const result = await sendResumeDelivery({
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'jane@example.com',
      name: 'Jane Doe',
      audience: 'leadership',
      pdf: pdfBytes,
      filename: 'kazon-wilson-resume-leadership.pdf',
    });
    expect(result.ok).toBe(true);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(['jane@example.com']);
    expect(body.subject).toContain('resume');
    expect(body.text).toContain('Jane Doe');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe('kazon-wilson-resume-leadership.pdf');
    // "%PDF" base64-encoded = "JVBERg=="
    expect(body.attachments[0].content).toBe('JVBERg==');
  });

  it('returns ok=false when send fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await sendResumeDelivery({
      apiKey: 'key',
      from: 'noreply@thesuperhuman.us',
      to: 'jane@example.com',
      name: 'Jane Doe',
      audience: 'general',
      pdf: new ArrayBuffer(4),
      filename: 'kazon-wilson-resume-general.pdf',
    });
    expect(result.ok).toBe(false);
  });
});
