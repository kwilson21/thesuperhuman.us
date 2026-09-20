import { describe, expect, it } from 'vitest';
import { audiencePermissionKey, safeExternalUrl } from '~/lib/owner-model';

describe('owner audit identifiers', () => {
  it('normalizes the email and binds the identifier to a private key', async () => {
    const first = await audiencePermissionKey(' Fan@Example.com ', 'a'.repeat(32));
    expect(first).toBe(await audiencePermissionKey('fan@example.com', 'a'.repeat(32)));
    expect(first).not.toBe(await audiencePermissionKey('fan@example.com', 'b'.repeat(32)));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when the private key is too short', async () => {
    await expect(audiencePermissionKey('fan@example.com', 'short')).rejects.toThrow('unavailable');
  });
});

describe('owner supplied links', () => {
  it('allows only valid HTTPS links', () => {
    expect(safeExternalUrl('https://drive.google.com/example')).toBe('https://drive.google.com/example');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a URL')).toBeNull();
  });
});
