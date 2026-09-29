import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendAudioMessage, sendOwnerRequestNotice, sendStudioSignInNotice } from '~/lib/audio-resend';
import type { IntakeInput } from '~/lib/audio-intake';

const intake: IntakeInput = {
  service: 'vocal-mix',
  title: 'Night Drive',
  direction: 'preferences',
  preferences: { vocal: 'natural', space: 'dry' },
  preserve: 'Keep the ad-lib at the end.',
  referenceUrl: 'https://example.com/reference',
  referenceNote: 'Something like the bridge on this one.',
  name: 'Jane',
  email: 'jane@example.com',
  permission: true,
  turnstileToken: 'tok',
  fileLink: 'https://drive.google.com/example',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'em_1' }) } as any)));
});

it('keeps a timed-out email delivery unconfirmed', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('request timed out'));
  expect(await sendAudioMessage({ apiKey: 'k', payload: { from: 'a@example.com', to: ['b@example.com'], subject: 'Notice', text: 'Sign in.' } }))
    .toEqual({ ok: false, uncertain: true });
});

describe('sendOwnerRequestNotice', () => {
  it('posts to Resend with the service, title, client, files, direction, notes and a dashboard link', async () => {
    const res = await sendOwnerRequestNotice({ input: intake, requestId: 'req-1', apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(true);
    const calls = (fetch as any).mock.calls;
    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0][1].body);
    expect(body.from).toBe('noreply@notifs.x');
    expect(body.to).toEqual(['kazon@x']);
    expect(body.subject).toContain('Jane');
    expect(body.subject).toContain('Two-track vocal mixing');
    expect(body.subject).not.toContain('—');
    expect(body.text).not.toContain('—');
    expect(body.text).toContain('Service: Two-track vocal mixing');
    expect(body.text).toContain('Title: Night Drive');
    expect(body.text).toContain('Name: Jane');
    expect(body.text).toContain('Email: jane@example.com');
    expect(body.text).toContain('Files: https://drive.google.com/example');
    expect(body.text).toContain('Direction: I have a few preferences');
    expect(body.text).toContain('Vocal character: Natural & intimate');
    expect(body.text).toContain('Space: Close & dry');
    expect(body.text).toContain('Keep or avoid: Keep the ad-lib at the end.');
    expect(body.text).toContain('Reference link: https://example.com/reference');
    expect(body.text).toContain('Notes: Something like the bridge on this one.');
    expect(body.text).toContain('https://thesuperhuman.us/owner/requests/req-1');
    expect(body.reply_to).toBe('jane@example.com');
  });

  it('notes when no files were shared yet, without a Files line breaking', async () => {
    await sendOwnerRequestNotice({ input: { ...intake, fileLink: '' }, requestId: 'req-2', apiKey: 'k', from: 'a', to: 'b' });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toContain('Files: none provided yet.');
  });

  it('omits preferences, keep-or-avoid, reference and notes lines when none were given', async () => {
    const minimal: IntakeInput = { ...intake, direction: 'judgment', preferences: {}, preserve: '', referenceUrl: '', referenceNote: '' };
    await sendOwnerRequestNotice({ input: minimal, requestId: 'req-3', apiKey: 'k', from: 'a', to: 'b' });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toContain('Direction: Use your judgment');
    for (const label of ['Preferences:', 'Keep or avoid:', 'Reference link:', 'Notes:']) expect(body.text).not.toContain(label);
  });

  it('reports failure when Resend returns non-ok', async () => {
    (fetch as any).mockImplementation(async () => ({ ok: false, json: async () => ({}) } as any));
    const res = await sendOwnerRequestNotice({ input: intake, requestId: 'req-1', apiKey: 'k', from: 'noreply@notifs.x', to: 'kazon@x' });
    expect(res.ok).toBe(false);
  });

  it('does not call Resend when the owner address is not configured', async () => {
    const res = await sendOwnerRequestNotice({ input: intake, requestId: 'req-1', apiKey: '', from: '', to: '' });
    expect(res).toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('sends only a sign-in link for private project notices, as HTML with a plain-text twin', async () => {
  await sendStudioSignInNotice('k', 'studio@example.com', 'artist@example.com', 'Your private studio project');
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(body.to).toEqual(['artist@example.com']);
  expect(body.text).toContain('https://thesuperhuman.us/studio/sign-in');
  expect(body.html).toContain('href="https://thesuperhuman.us/studio/sign-in"');
  // Notices name no project, file, stage or payment: the client signs in to see those.
  for (const part of [body.text, body.html]) for (const detail of ['invoice', 'review mix is ready', 'balance', '$']) expect(part).not.toContain(detail);
  expect(body.text).toContain('You have a new studio update.');
});

it('opens a first invitation without calling it an update', async () => {
  await sendStudioSignInNotice('k', 'studio@example.com', 'artist@example.com', 'Your private studio project', 'invitation');
  const body = JSON.parse((fetch as any).mock.calls.at(-1)[1].body);
  expect(body.text).toMatch(/^Your song has a private studio\./);
  expect(body.text).not.toContain('update');
  expect(body.html).toContain('Open your studio');
});
