import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '~/lib/owner-model';

describe('owner supplied links', () => {
  it('allows only valid HTTPS links', () => {
    expect(safeExternalUrl('https://drive.google.com/example')).toBe('https://drive.google.com/example');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a URL')).toBeNull();
  });
});
