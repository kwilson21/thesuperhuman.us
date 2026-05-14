import type { KvLike } from './rate-limit';

export const RESUME_AUDIENCES = ['general', 'leadership', 'dod'] as const;
export type ResumeAudience = (typeof RESUME_AUDIENCES)[number];

export interface ResumeRequest {
  name: string;
  email: string;
  company: string;
  audience: ResumeAudience;
  note: string;
}

export interface StoredResumeRequest extends ResumeRequest {
  ts: number;
}

interface ResumeKv extends KvLike {
  delete(key: string): Promise<void>;
}

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function key(id: string): string {
  return `req:${id}`;
}

export async function createResumeRequest(
  kv: ResumeKv,
  request: ResumeRequest,
): Promise<string> {
  const id = crypto.randomUUID();
  const payload: StoredResumeRequest = { ...request, ts: Date.now() };
  await kv.put(key(id), JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return id;
}

export async function getResumeRequest(
  kv: ResumeKv,
  id: string,
): Promise<StoredResumeRequest | null> {
  const raw = await kv.get(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredResumeRequest;
  } catch {
    return null;
  }
}

export async function deleteResumeRequest(
  kv: ResumeKv,
  id: string,
): Promise<void> {
  await kv.delete(key(id));
}
