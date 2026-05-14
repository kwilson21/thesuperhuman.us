export const PROJECT_TYPES = [
  'Backend systems',
  'Data pipelines',
  'Contract role',
  'Advisory',
  'Other',
] as const;

export const TIMELINES = ['Now', '1–3 months', 'Just exploring'] as const;

export const BUDGETS = ['Under $10k', '$10–50k', '$50k+', 'Not sure yet'] as const;

export type ContactInput = {
  name: string;
  email: string;
  company: string;
  projectType: string[];
  timeline: string;
  budget: string;
  description: string;
  turnstileToken: string;
};

export type ValidationResult =
  | { ok: true; value: ContactInput }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactInput(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { _form: 'Invalid request body.' } };
  }
  const v = input as Record<string, unknown>;

  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name) errors.name = 'Name is required.';
  else if (name.length > 100) errors.name = 'Name is too long.';

  const email = typeof v.email === 'string' ? v.email.trim() : '';
  if (!email) errors.email = 'Email is required.';
  else if (email.length > 120 || !EMAIL_RE.test(email)) errors.email = 'Invalid email.';

  const company = typeof v.company === 'string' ? v.company.trim() : '';
  if (company.length > 120) errors.company = 'Company is too long.';

  const projectType = Array.isArray(v.projectType)
    ? v.projectType.filter((t): t is string => typeof t === 'string')
    : [];
  if (projectType.length === 0) {
    errors.projectType = 'Pick at least one project type.';
  } else if (!projectType.every(t => (PROJECT_TYPES as readonly string[]).includes(t))) {
    errors.projectType = 'Unknown project type.';
  }

  const timeline = typeof v.timeline === 'string' ? v.timeline : '';
  if (!(TIMELINES as readonly string[]).includes(timeline)) {
    errors.timeline = 'Pick a timeline.';
  }

  const budget = typeof v.budget === 'string' ? v.budget : '';
  if (budget && !(BUDGETS as readonly string[]).includes(budget)) {
    errors.budget = 'Unknown budget.';
  }

  const description = typeof v.description === 'string' ? v.description.trim() : '';
  if (description.length < 40) {
    errors.description = 'Please write at least 40 characters.';
  } else if (description.length > 4000) {
    errors.description = 'Description is too long.';
  }

  const turnstileToken = typeof v.turnstileToken === 'string' ? v.turnstileToken : '';
  if (!turnstileToken) errors.turnstileToken = 'Captcha missing.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { name, email, company, projectType, timeline, budget, description, turnstileToken },
  };
}
