import { describe, it, expect } from 'vitest';
import { validateContactInput } from '~/lib/validation';

describe('validateContactInput', () => {
  const validInput = {
    name: 'Jane',
    email: 'jane@example.com',
    company: '',
    projectType: ['Backend systems'],
    timeline: 'Now',
    budget: '',
    description: 'A long enough description that explains the project clearly.',
    turnstileToken: 'tok',
  };

  it('accepts valid input', () => {
    const result = validateContactInput(validInput);
    expect(result.ok).toBe(true);
  });

  it('rejects missing name', () => {
    const result = validateContactInput({ ...validInput, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
  });

  it('rejects invalid email', () => {
    const result = validateContactInput({ ...validInput, email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
  });

  it('rejects description shorter than 40 chars', () => {
    const result = validateContactInput({ ...validInput, description: 'too short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.description).toBeDefined();
  });

  it('rejects description longer than 4000 chars', () => {
    const result = validateContactInput({ ...validInput, description: 'a'.repeat(4001) });
    expect(result.ok).toBe(false);
  });

  it('rejects empty projectType array', () => {
    const result = validateContactInput({ ...validInput, projectType: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.projectType).toBeDefined();
  });

  it('rejects unknown projectType value', () => {
    const result = validateContactInput({ ...validInput, projectType: ['Cryptocurrency'] });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown timeline value', () => {
    const result = validateContactInput({ ...validInput, timeline: 'Soon' });
    expect(result.ok).toBe(false);
  });

  it('rejects missing turnstile token', () => {
    const result = validateContactInput({ ...validInput, turnstileToken: '' });
    expect(result.ok).toBe(false);
  });

  it('accepts optional fields when empty', () => {
    const result = validateContactInput({ ...validInput, company: '', budget: '' });
    expect(result.ok).toBe(true);
  });
});
