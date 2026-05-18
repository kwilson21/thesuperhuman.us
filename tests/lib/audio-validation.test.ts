import { describe, it, expect } from 'vitest';
import { validateAudioInquiry } from '~/lib/audio-validation';

const valid = {
  name: 'Jane',
  email: 'jane@example.com',
  services: ['mixing'],
  trackCount: 3,
  targetDate: '2026-08-01',
  flexible: false,
  references: 'https://example.com/ref',
  delivery: 'Dropbox',
  notes: 'A long enough description of the project that gives me real context to plan around.',
  turnstileToken: 'tok',
};

describe('validateAudioInquiry', () => {
  it('accepts a fully-valid payload', () => {
    const r = validateAudioInquiry(valid);
    expect(r.ok).toBe(true);
  });

  it('requires at least one service', () => {
    const r = validateAudioInquiry({ ...valid, services: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.services).toBeDefined();
  });

  it('rejects unknown service values', () => {
    const r = validateAudioInquiry({ ...valid, services: ['hypnosis'] });
    expect(r.ok).toBe(false);
  });

  it('requires a delivery method from the allowlist', () => {
    const r = validateAudioInquiry({ ...valid, delivery: 'CarrierPigeon' });
    expect(r.ok).toBe(false);
  });

  it('treats targetDate as optional when flexible is true', () => {
    const r = validateAudioInquiry({ ...valid, targetDate: '', flexible: true });
    expect(r.ok).toBe(true);
  });

  it('rejects too-short notes', () => {
    const r = validateAudioInquiry({ ...valid, notes: 'too short' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing email', () => {
    const r = validateAudioInquiry({ ...valid, email: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing turnstile token', () => {
    const r = validateAudioInquiry({ ...valid, turnstileToken: '' });
    expect(r.ok).toBe(false);
  });

  it('coerces trackCount=null to undefined and accepts', () => {
    const r = validateAudioInquiry({ ...valid, trackCount: null });
    expect(r.ok).toBe(true);
  });
});
