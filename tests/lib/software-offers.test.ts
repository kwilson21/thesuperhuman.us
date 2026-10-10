import { describe, expect, it } from 'vitest';
import { validateOfferTerms, offerTotal, clientOffer, hashOfferToken, newOfferToken } from '~/lib/software-offers';
export const terms = { outcome: 'Onboarding', summary: 'A shared view.', milestones: [{ name: 'Tracker', deliverables: ['Status view'], acceptance: ['Add a client and identify their next action.'], feeCents: 240000 }], clientInputs: '', exclusions: '', timing: '', paymentMode: 'standard' };
const errors = (value: unknown) => { const result = validateOfferTerms(value); expect(result.ok).toBe(false); return result.ok ? {} : result.errors; };
describe('software offer terms', () => {
  it('validates complete terms and derives the total', () => { const result = validateOfferTerms(terms); expect(result.ok).toBe(true); expect(offerTotal(terms)).toBe(240000); });
  it.each([['outcome',121],['summary',301],['clientInputs',1001],['exclusions',1001],['timing',501]])('bounds %s', (field, length) => {
    expect(errors({ ...terms, [field]: 'x'.repeat(length) })[field]).toBe(`Keep this under ${length - 1} characters.`);
  });
  it('requires titles, one line and readable text', () => {
    expect(errors({ ...terms, outcome: '' }).outcome).toBe('This answer is required.');
    expect(errors({ ...terms, summary: 'a\nb' }).summary).toBe('Use one line.');
    expect(errors({ ...terms, outcome: 'a\x00b' }).outcome).toBe('Remove control characters.');
    expect(errors({ ...terms, summary: undefined }).summary).toBe('This answer is required.');
  });
  it('requires one to three milestones and acceptance examples', () => {
    expect(errors({ ...terms, milestones: [] }).milestones).toBe('Add at least one milestone.');
    expect(errors({ ...terms, milestones: Array(4).fill(terms.milestones[0]) }).milestones).toBe('Add no more than 3 milestones.');
    expect(errors({ ...terms, milestones: [{ ...terms.milestones[0], acceptance: [] }] })['milestones.0.acceptance']).toBe('Add at least one line.');
  });
  it.each([['name', 'x'.repeat(81), 'Keep this under 80 characters.'],['deliverables',['x'.repeat(201)],'Keep this under 200 characters.'],['acceptance',['x'.repeat(301)],'Keep this under 300 characters.'],['deliverables',Array(9).fill('x'),'Add no more than 8 lines.'],['acceptance',Array(6).fill('x'),'Add no more than 5 lines.'],['feeCents',99,'The fee must be at least $1.'],['feeCents',100000001,'The amount must be $1,000,000 or less.'],['feeCents',100.5,'Use whole cents.']])('bounds milestone %s', (field,value,message) => {
    expect(Object.values(errors({ ...terms, milestones: [{ ...terms.milestones[0], [field]: value }] }))).toContain(message);
  });
  it.each([50,96,75.5])('bounds checkpoints at %s', percent => {
    expect(Object.values(errors({ ...terms, milestones: [{ ...terms.milestones[0], checkpoint: { label: 'Direction approved', cancellationPercent: percent } }] }))).toContain(percent === 75.5 ? 'Use a whole percentage.' : 'Use a percentage from 51 to 95.');
  });
  it('bounds checkpoint label and range', () => {
    expect(Object.values(errors({ ...terms, milestones: [{ ...terms.milestones[0], checkpoint: { label: 'x'.repeat(121), cancellationPercent: 75 } }] }))).toContain('Keep this under 120 characters.');
    expect(errors({ ...terms, projectRange: { lowCents: 239999, highCents: 500000 } })['projectRange.lowCents']).toBe('The estimate must be at least the offer total.');
    expect(errors({ ...terms, projectRange: { lowCents: 500000, highCents: 400000 } })['projectRange.highCents']).toBe('The high estimate must be at least the low estimate.');
  });
  it('projects only client identity, version, path and validated terms', () => {
    const projection = clientOffer({ name: 'Alex', privateNote: 'SECRET', email: 'private@example.com', details: { company: 'Example', fit: 'SECRET' }, serviceId: 'workflow' } as any, { version: 2, terms_json: JSON.stringify({ ...terms, privateNote: 'SECRET' }), sent_by: 'private@example.com', status: 'sent' } as any);
    expect(Object.keys(projection)).toEqual(['name','company','path','version','replacesVersion','terms']);
    expect(JSON.stringify(projection)).not.toMatch(/SECRET|private@example|sent_by|status/);
  });
  it('generates opaque tokens and stores only an irreversible digest', async () => { const token = newOfferToken(); expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(await hashOfferToken(token)).toMatch(/^[0-9a-f]{64}$/); });
});

it('allows a whole-project estimate above an individual milestone ceiling', () => {
  expect(validateOfferTerms({ ...terms, milestones: Array(3).fill({ ...terms.milestones[0], feeCents:100000000 }), projectRange: { lowCents:300000000, highCents:500000000 } }).ok).toBe(true);
});

it.each([undefined, 'unknown'])('labels missing or unknown payment mode %s', paymentMode => { expect(errors({ ...terms, paymentMode }).paymentMode).toBe('Choose a payment mode.'); });

it('rejects repeated deliverable lines after case and whitespace normalization',()=>{
  const value={...terms,milestones:[{...terms.milestones[0],deliverables:['Status view',' STATUS   VIEW ']}]};
  expect(validateOfferTerms(value)).toMatchObject({ok:false,errors:{'milestones.0.deliverables':'Each deliverable needs to be different.'}});
});
