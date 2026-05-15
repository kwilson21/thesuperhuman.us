import { describe, it, expect, vi } from 'vitest';
import { loadResume, RESUME_FILENAMES } from '~/lib/resumes';
import type { ResumeAudience } from '~/lib/resume-requests';

function makeKv(value: ArrayBuffer | null) {
  return {
    get: vi.fn(async (_k: string, _type: 'arrayBuffer') => value),
  };
}

describe('RESUME_FILENAMES', () => {
  it('maps each audience to a downloadable filename', () => {
    expect(RESUME_FILENAMES.general).toBe('kazon-wilson-resume-general.pdf');
    expect(RESUME_FILENAMES.dod).toBe('kazon-wilson-resume-dod.pdf');
  });
});

describe('loadResume', () => {
  it('reads pdf:<audience> as arrayBuffer for known audiences', async () => {
    const bytes = new ArrayBuffer(4);
    const kv = makeKv(bytes);
    const result = await loadResume(kv as any, 'general');
    expect(kv.get).toHaveBeenCalledWith('pdf:general', 'arrayBuffer');
    expect(result).toBe(bytes);
  });

  it('passes through the correct audience key', async () => {
    const bytes = new ArrayBuffer(4);
    const kv = makeKv(bytes);
    await loadResume(kv as any, 'dod' as ResumeAudience);
    expect(kv.get).toHaveBeenCalledWith('pdf:dod', 'arrayBuffer');
  });

  it('returns null when the PDF is not in KV', async () => {
    const kv = makeKv(null);
    const result = await loadResume(kv as any, 'general');
    expect(result).toBeNull();
  });
});
