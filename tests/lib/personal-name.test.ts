import { describe, expect, it } from 'vitest';
import { personalName, personalNameSegments } from '../../src/lib/personal-name';

describe('personal name', () => {
  it('keeps the first-name and full-name text ordinary for copying and assistive technology', () => {
    expect(personalName('first')).toBe('Kazon');
    expect(personalName('full')).toBe('Kazon Wilson');
  });

  it('isolates first and full names inside visible prose without changing surrounding text', () => {
    expect(personalNameSegments('This is Kazon Wilson. Email Kazon.')).toEqual([
      { text: 'This is ', variant: null },
      { text: 'Kazon Wilson', variant: 'full' },
      { text: '. Email ', variant: null },
      { text: 'Kazon', variant: 'first' },
      { text: '.', variant: null },
    ]);
  });
});
