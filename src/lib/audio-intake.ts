import { z } from 'astro/zod';

export const audioOffers = {
  'vocal-mix': { name: 'Two-track vocal mixing', price: 150, description: 'Your vocals over a finished stereo beat.', scope: 'One song up to five minutes, one stereo beat and up to eight prepared vocal tracks. Cleanup, light tuning and timing. Two revision rounds. Stereo WAV mix and MP3; mastering separate.', files: 'Your stereo beat and separate, prepared vocal tracks.', preparation: 'Choose your takes first. Name your files and export each from the same starting point. WAV is preferred. Include a rough mix if you have one, and note any effects already applied.' },
  mastering: { name: 'Mastering', price: 75, description: 'Your finished stereo mix, prepared for release.', scope: 'One stereo song up to five minutes. Overall tone, dynamics and level. Two revision rounds. Final WAV master and MP3. Mixing and specialist formats are separate.', files: 'Your finished stereo mix.', preparation: 'Send a WAV at its original sample rate without clipping. Tell me about processing that defines the sound before removing it. No arbitrary peak-level target is required.' },
  bundle: { name: 'Two-track vocal mix + master', price: 200, description: 'Both, from prepared vocals to final master.', scope: 'One song up to five minutes, one stereo beat and up to eight prepared vocal tracks. Cleanup and light tuning/timing. Two mix rounds, then one mastering adjustment. Approved WAV mix, final WAV master and MP3.', files: 'Your stereo beat and separate, prepared vocal tracks.', preparation: 'Choose your takes first. Name your files and export each from the same starting point. WAV is preferred. Include a rough mix and note existing effects. We approve the mix before mastering.' },
  custom: { name: 'Something else / not sure', price: null, description: 'Full mixing, production or recording support.', scope: 'Files and project needs are reviewed before acceptance. We agree on work, deliverables, revisions and timing in a custom quote.', files: 'A rough mix or representative recording, if available.', preparation: 'For full mixing, describe the instrumental and vocal tracks available. For recording support, describe your setup. You can start without finished audio.' },
} as const;
export type IntakeService = keyof typeof audioOffers;
export type Direction = 'judgment' | 'preferences' | 'specific';
type PreferenceField = { id: string; label: string; options: { value: string; label: string }[] };
const vocalFields: PreferenceField[] = [
  { id: 'vocal', label: 'Vocal character', options: [{ value: 'natural', label: 'Natural & intimate' }, { value: 'forward', label: 'Bold & upfront' }, { value: 'blended', label: 'Blended into the track' }] },
  { id: 'space', label: 'Space', options: [{ value: 'dry', label: 'Close & dry' }, { value: 'spacious', label: 'Spacious & atmospheric' }] },
  { id: 'tuning', label: 'Tuning character', options: [{ value: 'natural', label: 'Natural' }, { value: 'stylized', label: 'Noticeably stylized' }] },
];
const masterFields: PreferenceField[] = [
  { id: 'tone', label: 'Overall character', options: [{ value: 'warm', label: 'Warm & rounded' }, { value: 'bright', label: 'Bright & open' }] },
  { id: 'dynamics', label: 'Overall feel', options: [{ value: 'open', label: 'Open & dynamic' }, { value: 'dense', label: 'Dense & assertive' }] },
];
export function directionFields(service: IntakeService): PreferenceField[] { return service === 'mastering' ? masterFields : service === 'custom' ? [] : vocalFields; }
export function describePreferences(service: IntakeService, preferences: Record<string, string>): string[] {
  return directionFields(service).flatMap(field => { const option = field.options.find(o => o.value === preferences[field.id]); return option ? [`${field.label}: ${option.label}`] : []; });
}
const short = (max: number) => z.string().trim().max(max);
const optionalLink = short(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a complete HTTPS link, or leave this blank.');
const schema = z.object({
  service: z.enum(['vocal-mix', 'mastering', 'bundle', 'custom']),
  title: short(120).min(1, 'Add a song or project title.').refine(v => !/[\r\n]/.test(v)),
  direction: z.enum(['judgment', 'preferences', 'specific']),
  preferences: z.record(z.string().max(30), z.string().max(30)).default({}),
  preserve: short(1200).default(''), referenceUrl: optionalLink.default(''), referenceNote: short(2000).default(''),
  name: short(100).min(1, 'Add your name.').refine(v => !/[\r\n]/.test(v)),
  email: short(120).email('Add a valid email address.'),
  permission: z.literal(true, { errorMap: () => ({ message: 'Allow access to the files for this review.' }) }),
  turnstileToken: z.string().min(1, 'Complete the security check.').max(2048),
  fileLink: optionalLink.default(''),
});
export type IntakeInput = z.infer<typeof schema>;
export function validateIntake(input: unknown): { ok: true; value: IntakeInput } | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(input);
  if (!result.success) return { ok: false, errors: Object.fromEntries(result.error.issues.map(i => [String(i.path[0] ?? '_form'), i.message])) };
  const value = result.data, fields = directionFields(value.service);
  const errors: Record<string, string> = {};
  for (const [key, choice] of Object.entries(value.preferences)) {
    const field = fields.find(f => f.id === key);
    if (!field || (choice !== 'decide' && !field.options.some(o => o.value === choice))) errors.preferences = 'These preferences do not match your selected service.';
  }
  if (value.direction === 'judgment' && Object.values(value.preferences).some(v => v !== 'decide')) errors.preferences = 'Choose a preference path to include specific settings.';
  if (value.service !== 'custom' && !value.fileLink) errors.fileLink = 'Provide your files before submitting for review.';
  if (value.service === 'custom' && !value.referenceNote) errors.referenceNote = 'Briefly describe your project and what you need.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
