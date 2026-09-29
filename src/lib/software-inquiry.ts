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
  idea: 'What’s the idea?', audienceToday: 'Who is it for, and what do they do today instead?',
  firstVersion: 'What’s the one thing the first version must let them do?', signal: 'How will you know it’s worth building further? (optional)',
  company: 'Company (optional)', timing: 'Timing', timingReason: 'Why this timing? (optional)',
  budgetStatus: 'Budget status', budgetNote: 'Budget amount, if you’d like to share it (optional)',
  approver: 'Who will approve the project?', approverRole: 'Their role (optional)',
} as const;
export const softwareQuestions = { workflow: ['today', 'audience', 'firstResult'], idea: ['idea', 'audienceToday', 'firstVersion', 'signal'] } as const;
export const softwareDetailKeys = ['name', 'email', 'company', 'timing', 'timingReason', 'budgetStatus', 'budgetNote', 'approver', 'approverRole'] as const;
export const timingLabels = { flexible: 'Flexible', month: 'Within a month', quarter: 'In one to three months', date: 'By a specific date' } as const;
export const budgetLabels = { approved: 'Approved', pending: 'Waiting for approval', exploring: 'Still exploring', unsure: 'Not sure yet' } as const;
export const approverLabels = { self: 'I do', other: 'Someone else, and I can involve them', unsure: 'Not sure yet' } as const;
const single = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const required = (max: number) => single(max).min(1, 'This answer is required.');
const common = {
  path: z.enum(['workflow', 'idea'], { errorMap: () => ({ message: 'Choose a starting point.' }) }),
  name: single(100).min(1, 'Add your name.'), email: single(120).email('Add a valid email address.'),
  company: single(120).default(''), timing: z.enum(['flexible', 'month', 'quarter', 'date'], { errorMap: () => ({ message: 'Choose one.' }) }),
  timingReason: single(500).default(''), budgetStatus: z.enum(['approved', 'pending', 'exploring', 'unsure'], { errorMap: () => ({ message: 'Choose one.' }) }),
  budgetNote: single(200).default(''), approver: z.enum(['self', 'other', 'unsure'], { errorMap: () => ({ message: 'Choose one.' }) }),
  approverRole: single(120).default(''), turnstileToken: z.string().min(1, 'Complete the security check.').max(2048, 'Keep this under 2048 characters.'),
  submissionId: z.string().uuid('Invalid submission ID.'),
};
const schema = z.discriminatedUnion('path', [
  z.object({ ...common, path: z.literal('workflow'), today: required(2000), audience: required(1000), firstResult: required(2000) }),
  z.object({ ...common, path: z.literal('idea'), idea: required(1000), audienceToday: required(1000), firstVersion: required(1000), signal: single(500).default('') }),
]);
export type SoftwareInput = z.infer<typeof schema>;
export function validateSoftwareInquiry(input: unknown): { ok: true; value: SoftwareInput } | { ok: false; errors: Record<string, string> } {
  const lineErrors: Record<string, string> = {};
  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>;
    for (const key of ['name', 'email', 'company', 'timingReason', 'budgetNote', 'approverRole'])
      if (typeof raw[key] === 'string' && /[\r\n]/.test(raw[key])) lineErrors[key] = 'Use one line.';
    const questions = raw.path === 'idea' ? softwareQuestions.idea : raw.path === 'workflow' ? softwareQuestions.workflow : [];
    for (const key of [...questions, ...softwareDetailKeys])
      if (typeof raw[key] === 'string' && /[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(raw[key])) lineErrors[key] = 'Remove control characters.';
  }
  const parsed = schema.safeParse(input, { errorMap: (issue, context) => ({ message: issue.code === 'invalid_type' && !['path', 'timing', 'budgetStatus', 'approver'].includes(String(issue.path[0])) ? (issue.path.length ? 'This answer is required.' : 'Please send the form again.') : context.defaultError }) });
  if (!parsed.success || Object.keys(lineErrors).length) {
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? '_form')] ??= issue.path[0] === 'path' ? 'Choose a starting point.' : issue.message;
    return { ok: false, errors: { ...errors, ...lineErrors } };
  }
  const value = parsed.data;
  if (value.approver !== 'other') value.approverRole = '';
  return { ok: true, value };
}
export function softwareRequest(input: SoftwareInput): NewOwnerRequest {
  const firstLine = (input.path === 'idea' ? input.idea : input.firstResult).split(/\r?\n/, 1)[0];
  const summaryCharacters = Array.from(firstLine);
  return {
    kind: 'software', serviceId: input.path, submissionId: input.submissionId,
    name: input.name, email: input.email,
    summary: summaryCharacters.length > 120 ? `${summaryCharacters.slice(0, 117).join('').trimEnd()}…` : firstLine,
    details: Object.fromEntries(['path', ...softwareQuestions[input.path], ...softwareDetailKeys.filter(key => key !== 'name' && key !== 'email')].map(key => [key, input[key as keyof SoftwareInput]])),
  };
}
export function softwareBrief(request: OwnerRequest): Record<string, string> {
  const details = request.details;
  const path = details.path === 'idea' ? 'idea' : 'workflow';
  return Object.fromEntries(['path', ...softwareQuestions[path], ...softwareDetailKeys].filter(key => key !== 'approverRole' || details.approver === 'other').map(key => {
    const value = key === 'name' ? request.name : key === 'email' ? request.email : details[key];
    const display = key === 'path' ? softwarePaths[value as keyof typeof softwarePaths] :
      key === 'timing' ? timingLabels[value as keyof typeof timingLabels] :
      key === 'budgetStatus' ? budgetLabels[value as keyof typeof budgetLabels] :
      key === 'approver' ? approverLabels[value as keyof typeof approverLabels] : value;
    return [key, typeof display === 'string' && display ? display : 'Not provided'];
  }));
}
