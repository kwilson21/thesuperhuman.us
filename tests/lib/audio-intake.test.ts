import { describe, it, expect } from 'vitest';
import { validateIntake, directionFields, ownerRequestForIntake } from '~/lib/audio-intake';
const base = { service: 'vocal-mix', title: 'My song', direction: 'judgment', preferences: {}, preserve: '', referenceUrl: '', referenceNote: '', name: 'Artist', email: 'artist@example.com', permission: true, turnstileToken: 'test', fileLink: 'https://drive.google.com/example' };
describe('audio intake', () => {
  it('accepts delegated judgment without requiring references or preservation notes', () => {
    const result = validateIntake(base); expect(result.ok).toBe(true);
  });
  it('requires a direction note when specific direction is selected', () => {
    for (const referenceNote of ['', '   ']) {
      expect(validateIntake({ ...base, direction: 'specific', referenceNote })).toEqual({ ok: false, errors: { referenceNote: 'Describe the specific direction you have in mind.' } });
    }
    expect(validateIntake({ ...base, direction: 'specific', referenceNote: 'Keep the vocal close and dry.' }).ok).toBe(true);
  });
  it('supports partial artistic preferences and separates mastering from vocal edits', () => {
    expect(validateIntake({ ...base, direction: 'preferences', preferences: { space: 'dry' } }).ok).toBe(true);
    expect(validateIntake({ ...base, service: 'mastering', direction: 'preferences', preferences: { space: 'dry' } }).ok).toBe(false);
    expect(directionFields('mastering').map(f => f.id)).not.toContain('tuning');
  });
  it('does not require finished audio for a custom recording inquiry', () => {
    expect(validateIntake({ ...base, service: 'custom', fileLink: '', referenceNote: 'Help me record vocals at home.' }).ok).toBe(true);
    expect(validateIntake({ ...base, fileLink: '' }).ok).toBe(false);
    expect(validateIntake({ ...base, service: 'custom', fileLink: '', preserve: 'Keep vocals natural.', referenceNote: '' }).ok).toBe(false);
  });
  it('rejects unsafe links, invalid consent and oversized notes', () => {
    for (const changes of [{fileLink:'javascript:alert(1)'},{referenceUrl:'file:///secret'},{permission:false},{preserve:'x'.repeat(1201)},{email:'bad'}]) expect(validateIntake({...base,...changes}).ok).toBe(false);
  });
  it('does not turn old engineering priorities or arbitrary service names into an offer', () => {
    expect(validateIntake({ ...base, service: 'free-master' }).ok).toBe(false);
    expect(validateIntake({ ...base, direction: 'preferences', preferences: { clarity: 'off' } }).ok).toBe(false);
  });
  it('maps validated intake to a bounded owner request without retaining the challenge token', () => {
    const result = validateIntake(base);
    if (!result.ok) throw new Error('fixture should be valid');
    const request = ownerRequestForIntake(result.value);
    expect(request).toMatchObject({ kind: 'service', serviceId: 'vocal-mix', name: 'Artist', email: 'artist@example.com' });
    expect(request.summary).toBe('My song · Two-track vocal mixing');
    expect(JSON.stringify(request)).not.toContain('turnstileToken');
  });
});
