import { describe, it, expect } from 'vitest';
import { validateIntake, directionFields } from '~/lib/audio-intake';
const base = { service: 'vocal-mix', title: 'My song', direction: 'judgment', preferences: {}, preserve: '', referenceUrl: '', referenceNote: '', name: 'Artist', email: 'artist@example.com', permission: true, turnstileToken: 'test', fileLink: 'https://drive.google.com/example' };
describe('audio intake', () => {
  it('accepts delegated judgment without requiring references or preservation notes', () => {
    const result = validateIntake(base); expect(result.ok).toBe(true);
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
});
