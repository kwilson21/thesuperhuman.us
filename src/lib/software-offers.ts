import { z } from 'astro/zod';
import type { OwnerRequest } from './owner-model';
import { softwarePaths } from './software-inquiry';

const text = (max: number, oneLine = false) => z.string().trim().max(max, `Keep this under ${max} characters.`)
  .refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value), 'Remove control characters.')
  .refine(value => !oneLine || !/[\r\n]/.test(value), 'Use one line.');
const required = (max: number) => text(max, true).refine(value => value.length > 0, 'This answer is required.');
const cents = z.number().int('Use whole cents.').min(100, 'The fee must be at least $1.').max(100_000_000, 'The amount must be $1,000,000 or less.');
const estimateCents = z.number().int('Use whole cents.').min(0, 'Use a non-negative amount.').max(Number.MAX_SAFE_INTEGER, 'Use a safe whole-cent amount.');
const lines = (max: number, count: number) => z.array(required(max)).min(1, 'Add at least one line.').max(count, `Add no more than ${count} lines.`);
export const offerTermsSchema = z.object({
  outcome: required(120), summary: required(300),
  milestones: z.array(z.object({
    name: required(80), deliverables: lines(200, 8), acceptance: lines(300, 5), feeCents: cents,
    checkpoint: z.object({ label: required(120), cancellationPercent: z.number().int('Use a whole percentage.').min(51, 'Use a percentage from 51 to 95.').max(95, 'Use a percentage from 51 to 95.') }).optional(),
  })).min(1, 'Add at least one milestone.').max(3, 'Add no more than 3 milestones.'),
  clientInputs: text(1000), exclusions: text(1000), timing: text(500),
  paymentMode: z.enum(['standard', 'invoice'], { errorMap: () => ({ message: 'Choose a payment mode.' }) }),
  projectRange: z.object({ lowCents: estimateCents, highCents: estimateCents }).optional(),
}).superRefine((value, ctx) => {
  if (value.projectRange && value.projectRange.lowCents > value.projectRange.highCents)
    ctx.addIssue({ code: 'custom', path: ['projectRange', 'highCents'], message: 'The high estimate must be at least the low estimate.' });
  if (value.projectRange && value.projectRange.lowCents < offerTotal(value))
    ctx.addIssue({ code: 'custom', path: ['projectRange', 'lowCents'], message: 'The estimate must be at least the offer total.' });
});
export type OfferTerms = z.infer<typeof offerTermsSchema>;
export function validateOfferTerms(input: unknown) {
  const result = offerTermsSchema.safeParse(input, { errorMap: issue => ({ message: issue.path[0] === 'paymentMode' ? 'Choose a payment mode.' : 'This answer is required.' }) });
  if (result.success) return { ok: true as const, value: result.data };
  return { ok: false as const, errors: Object.fromEntries(result.error.issues.map(issue => [issue.path.join('.'), issue.message])) };
}
export const paymentSchedules = {
  standard: '50% of each milestone before it starts, the balance on delivery.',
  invoice: 'Each milestone is invoiced when it starts, due within 30 days. The next milestone starts after the previous one is paid.',
} as const;
export const offerTotal = (terms: Pick<OfferTerms, 'milestones'>) => terms.milestones.reduce((sum, milestone) => sum + milestone.feeCents, 0);
export const formatUSD = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export type SoftwareOffer = { id: string; request_id: string; version: number; status: 'draft' | 'sent' | 'superseded' | 'withdrawn'; terms_json: string; created_at: string; updated_at: string; sent_at: string | null; sent_by: string | null };
export async function listSoftwareOffers(db: D1Database, id: string) {
  return (await db.prepare('SELECT * FROM software_offers WHERE request_id=? ORDER BY version DESC').bind(id).all<SoftwareOffer>()).results;
}
// Explicit allowlist: client rendering never receives the owner record or audit data.
export function clientOffer(request: OwnerRequest, offer: SoftwareOffer, offers: SoftwareOffer[] = []) {
  return { name: request.name, company: typeof request.details.company === 'string' ? request.details.company : '',
    path: softwarePaths[request.serviceId === 'idea' ? 'idea' : 'workflow'], version: offer.version,
    replacesVersion: offers.filter(previous => previous.version < offer.version && previous.sent_at && ['sent', 'superseded'].includes(previous.status)).sort((a, b) => b.version - a.version)[0]?.version,
    terms: offerTermsSchema.parse(JSON.parse(offer.terms_json)) };
}
export type ClientOffer = ReturnType<typeof clientOffer>;
export async function hashOfferToken(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newOfferToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function getLinkedOffer(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.prepare(`SELECT o.* FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id
    JOIN owner_requests r ON r.id=o.request_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND o.status='sent'
    AND r.kind='software' AND r.status<>'withdrawn' AND r.email<>''`).bind(await hashOfferToken(token)).first<SoftwareOffer>();
}
