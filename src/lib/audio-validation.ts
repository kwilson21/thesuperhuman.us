export const AUDIO_SERVICES = ['mixing', 'mastering', 'production', 'recording'] as const;
export type AudioServiceChoice = (typeof AUDIO_SERVICES)[number];

export const DELIVERY_METHODS = ['Google Drive', 'Dropbox', 'WeTransfer', 'Other'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export type AudioInquiryInput = {
  name: string;
  email: string;
  services: AudioServiceChoice[];
  trackCount?: number;
  targetDate?: string;
  flexible: boolean;
  references?: string;
  delivery: DeliveryMethod;
  notes: string;
  turnstileToken: string;
};

export type AudioValidationResult =
  | { ok: true; value: AudioInquiryInput }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAudioInquiry(input: unknown): AudioValidationResult {
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

  const services = Array.isArray(v.services)
    ? v.services.filter((s): s is string => typeof s === 'string')
    : [];
  if (services.length === 0) {
    errors.services = 'Pick at least one service.';
  } else if (!services.every((s) => (AUDIO_SERVICES as readonly string[]).includes(s))) {
    errors.services = 'Unknown service.';
  }

  let trackCount: number | undefined = undefined;
  if (v.trackCount !== null && v.trackCount !== undefined && v.trackCount !== '') {
    const n = typeof v.trackCount === 'number' ? v.trackCount : parseInt(String(v.trackCount), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) trackCount = n;
    else errors.trackCount = 'Track count must be a positive integer.';
  }

  const flexible = v.flexible === true;
  let targetDate: string | undefined = undefined;
  if (typeof v.targetDate === 'string' && v.targetDate.trim()) {
    if (!DATE_RE.test(v.targetDate.trim())) {
      errors.targetDate = 'Use YYYY-MM-DD.';
    } else {
      targetDate = v.targetDate.trim();
    }
  } else if (!flexible) {
    // either a date or "flexible" is required
    errors.targetDate = 'Pick a date or check "flexible".';
  }

  const references = typeof v.references === 'string' ? v.references.trim() : '';
  if (references.length > 2000) errors.references = 'Reference field is too long.';

  const delivery = typeof v.delivery === 'string' ? v.delivery.trim() : '';
  if (!(DELIVERY_METHODS as readonly string[]).includes(delivery)) {
    errors.delivery = 'Pick a delivery method.';
  }

  const notes = typeof v.notes === 'string' ? v.notes.trim() : '';
  if (notes.length < 40) errors.notes = 'Please write at least 40 characters.';
  else if (notes.length > 4000) errors.notes = 'Description is too long.';

  const turnstileToken = typeof v.turnstileToken === 'string' ? v.turnstileToken : '';
  if (!turnstileToken) errors.turnstileToken = 'Captcha missing.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      email,
      services: services as AudioServiceChoice[],
      trackCount,
      targetDate,
      flexible,
      references: references || undefined,
      delivery: delivery as DeliveryMethod,
      notes,
      turnstileToken,
    },
  };
}
