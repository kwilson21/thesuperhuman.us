import { z } from 'astro/zod';
import type { NewOwnerRequest } from './owner-requests';
import type { OwnerRequest } from './owner-model';

export const softwarePaths = {
  workflow: 'Make a workflow easier',
  idea: 'Bring an idea to life',
} as const;
export const softwareLabels = {
  path: 'Project', today: 'What happens today?', audience: 'Who needs this to work better?',
  firstResult: 'What would a useful first result look like?', name: 'Your name', email: 'Email',
  company: 'Company (optional)', timing: 'Timing', timingReason: 'Why this timing? (optional)',
  budgetStatus: 'Budget status', budgetNote: 'Budget amount, if you’d like to share it (optional)',
  approver: 'Who will approve the project?', approverRole: 'Their role (optional)',
} as const;
export const timingLabels = { flexible: 'Flexible', month: 'Within a month', quarter: 'In one to three months', date: 'By a specific date' } as const;
export const budgetLabels = { approved: 'Approved', pending: 'Waiting for approval', exploring: 'Still exploring', unsure: 'Not sure yet' } as const;
export const approverLabels = { self: 'I do', other: 'Someone else, and I can involve them', unsure: 'Not sure yet' } as const;
const single = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1, 'This answer is required.').max(max);
const schema = z.object({
  path: z.enum(['workflow', 'idea']), today: required(2000), audience: required(1000), firstResult: required(2000),
  name: single(100).min(1, 'Add your name.'), email: single(120).email('Add a valid email address.'),
  company: single(120).default(''), timing: z.enum(['flexible', 'month', 'quarter', 'date']),
  timingReason: single(500).default(''), budgetStatus: z.enum(['approved', 'pending', 'exploring', 'unsure']),
  budgetNote: single(200).default(''), approver: z.enum(['self', 'other', 'unsure']),
  approverRole: single(120).default(''), turnstileToken: z.string().min(1, 'Complete the security check.').max(2048),
  submissionId: z.string().uuid(),
});
export type SoftwareInput = z.infer<typeof schema>;
export function validateSoftwareInquiry(input: unknown): { ok: true; value: SoftwareInput } | { ok: false; errors: Record<string, string> } {
  const lineErrors: Record<string, string> = {};
  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>;
    for (const key of ['name', 'email', 'company', 'timingReason', 'budgetNote', 'approverRole'])
      if (typeof raw[key] === 'string' && /[\r\n]/.test(raw[key])) lineErrors[key] = 'Use one line.';
    for (const key of ['today', 'audience', 'firstResult', 'name', 'email', 'company', 'timingReason', 'budgetNote', 'approverRole'])
      if (typeof raw[key] === 'string' && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw[key])) lineErrors[key] = 'Remove control characters.';
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success || Object.keys(lineErrors).length) return { ok: false, errors: { ...Object.fromEntries((parsed.success ? [] : parsed.error.issues).map(issue => [String(issue.path[0] ?? '_form'), issue.message])), ...lineErrors } };
  const value = parsed.data;
  if (value.approver !== 'other') value.approverRole = '';
  return { ok: true, value };
}
export function softwareRequest(input: SoftwareInput): NewOwnerRequest {
  const firstLine = input.firstResult.split(/\r?\n/, 1)[0];
  return {
    kind: 'software', serviceId: input.path, submissionId: input.submissionId,
    name: input.name, email: input.email,
    summary: firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}…` : firstLine,
    details: Object.fromEntries(Object.keys(softwareLabels).filter(key => key !== 'name' && key !== 'email').map(key => [key, input[key as keyof SoftwareInput]])),
  };
}
export function softwareBrief(request: OwnerRequest): Record<string, string> {
  const details = request.details;
  return Object.fromEntries(Object.keys(softwareLabels).filter(key => key !== 'approverRole' || details.approver === 'other').map(key => {
    const value = key === 'name' ? request.name : key === 'email' ? request.email : details[key];
    const display = key === 'path' ? softwarePaths[value as keyof typeof softwarePaths] :
      key === 'timing' ? timingLabels[value as keyof typeof timingLabels] :
      key === 'budgetStatus' ? budgetLabels[value as keyof typeof budgetLabels] :
      key === 'approver' ? approverLabels[value as keyof typeof approverLabels] : value;
    return [key, typeof display === 'string' && display ? display : 'Not provided'];
  }));
}
