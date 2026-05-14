import { describe, it, expect } from 'vitest';
import { validateResumeRequestInput } from '~/lib/validation';

describe('validateResumeRequestInput', () => {
  const valid = {
    name: 'Jane',
    email: 'jane@example.com',
    company: 'Acme',
    audience: 'leadership',
    note: '',
    turnstileToken: 'tok',
  };

  it('accepts valid input', () => {
    const result = validateResumeRequestInput(valid);
    expect(result.ok).toBe(true);
  });

  it('rejects missing name', () => {
    const result = validateResumeRequestInput({ ...valid, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
  });

  it('rejects invalid email', () => {
    const result = validateResumeRequestInput({ ...valid, email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
  });

  it('rejects unknown audience', () => {
    const result = validateResumeRequestInput({ ...valid, audience: 'sales' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.audience).toBeDefined();
  });

  it('rejects missing audience', () => {
    const { audience: _drop, ...withoutAudience } = valid;
    const result = validateResumeRequestInput(withoutAudience);
    expect(result.ok).toBe(false);
  });

  it('rejects note longer than 1000 chars', () => {
    const result = validateResumeRequestInput({ ...valid, note: 'x'.repeat(1001) });
    expect(result.ok).toBe(false);
  });

  it('accepts empty company and note', () => {
    const result = validateResumeRequestInput({ ...valid, company: '', note: '' });
    expect(result.ok).toBe(true);
  });

  it('rejects missing turnstile token', () => {
    const result = validateResumeRequestInput({ ...valid, turnstileToken: '' });
    expect(result.ok).toBe(false);
  });

  it('trims string fields', () => {
    const result = validateResumeRequestInput({
      ...valid,
      name: '  Jane  ',
      company: '  Acme  ',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.name).toBe('Jane');
    expect(result.value.company).toBe('Acme');
  });
});
