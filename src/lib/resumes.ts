import type { ResumeAudience } from './resume-requests';

export const RESUME_FILENAMES: Record<ResumeAudience, string> = {
  general: 'kazon-wilson-resume-general.pdf',
  dod: 'kazon-wilson-resume-dod.pdf',
};

interface BinaryKv {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
}

export async function loadResume(
  kv: BinaryKv,
  audience: ResumeAudience,
): Promise<ArrayBuffer | null> {
  return await kv.get(`pdf:${audience}`, 'arrayBuffer');
}
