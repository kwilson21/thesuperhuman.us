import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSoftwareInvoiceWithClient, softwareInvoiceTerms, type SoftwareInvoice } from '~/lib/software-invoices';
import type { OfferTerms } from '~/lib/software-offers';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const terms: OfferTerms = { outcome: 'Shared tracker', summary: 'Client status', milestones: [{ name: 'Tracker', feeCents: 101, deliverables: ['View'], acceptance: ['Add a client'] }], clientInputs: '', exclusions: '', timing: '', paymentMode: 'standard' };
const invoice: SoftwareInvoice = { id: 'local-invoice', request_id: 'software', offer_id: 'offer', due_at: null, refunded_at: null, creation_started_at: null, external_refs_deleted_at: null, milestone_index: 0, kind: 'deposit', amount_cents: 50, days_until_due: 7, allow_card: 0, attempt: 0, stripe_customer_id: null, stripe_invoice_id: null, hosted_invoice_url: null, status: 'creating', status_updated_at: null, created_by: 'owner', created_at: 'now', updated_at: 'now' };
function stripe() {
  return { customers: { create: vi.fn(async () => ({ id: 'cus_test' })) }, invoices: {
    create: vi.fn(async () => ({ id: 'in_test' })),
    finalizeInvoice: vi.fn(async () => ({ id: 'in_test', status: 'open' })),
    sendInvoice: vi.fn(async () => ({ id: 'in_test', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/test' })),
  }, invoiceItems: { create: vi.fn(async () => ({ id: 'ii_test' })) } };
}
describe('software invoice amounts and Stripe adapter', () => {
  it('rounds deposits down and gives the balance the remainder', () => {
    expect(softwareInvoiceTerms(terms, 0, 'deposit')).toEqual({ amountCents: 50, daysUntilDue: 7 });
    expect(softwareInvoiceTerms(terms, 0, 'balance')).toEqual({ amountCents: 51, daysUntilDue: 15 });
    expect(softwareInvoiceTerms({ ...terms, paymentMode: 'invoice' }, 0, 'milestone')).toEqual({ amountCents: 101, daysUntilDue: 30 });
    for (const index of [-1, 0.5, 1]) expect(() => softwareInvoiceTerms(terms, index, 'deposit')).toThrow();
    expect(() => softwareInvoiceTerms(terms, 0, 'milestone')).toThrow();
    expect(() => softwareInvoiceTerms({ ...terms, paymentMode: 'invoice' }, 0, 'deposit')).toThrow();
  });
  it('sends exactly one item, using ACH and stable attempt keys', async () => {
    const client = stripe();
    expect(await createSoftwareInvoiceWithClient(client, { name: 'Example', email: 'example@example.com' }, terms, invoice)).toEqual({ stripeCustomerId: 'cus_test', invoiceId: 'in_test', hostedInvoiceUrl: 'https://invoice.stripe.com/test', status: 'open', dueAt: null });
    expect(client.customers.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { software_request_id: 'software' } }), { idempotencyKey: 'software-request:software:customer' });
    expect(client.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ collection_method: 'send_invoice', auto_advance: false, days_until_due: 7, payment_settings: { payment_method_types: ['us_bank_account'] }, metadata: { software_request_id: 'software', milestone_index: '0', kind: 'deposit', software_invoice_id: 'local-invoice', software_offer_id: 'offer' } }), { idempotencyKey: 'software-request:software:offer-offer:milestone-0:deposit:attempt-0:invoice' });
    expect(client.invoiceItems.create).toHaveBeenCalledOnce();
    expect(client.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 50, currency: 'usd', description: 'Milestone 1 · Tracker · 50% deposit' }), expect.anything());
  });
  it('reuses customers and allows cards only when explicitly selected', async () => {
    const client = stripe();
    await createSoftwareInvoiceWithClient(client, { name: '', email: 'example@example.com' }, terms, { ...invoice, allow_card: 1, attempt: 2, stripe_customer_id: 'cus_existing' });
    expect(client.customers.create).not.toHaveBeenCalled();
    expect(client.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_existing', payment_settings: { payment_method_types: ['us_bank_account', 'card'] } }), { idempotencyKey: 'software-request:software:offer-offer:milestone-0:deposit:attempt-2:invoice' });
  });
  it('retries a send failure with identical idempotency keys', async () => {
    const client = stripe(); client.invoices.sendInvoice.mockRejectedValueOnce(new Error('uncertain'));
    await expect(createSoftwareInvoiceWithClient(client, { name: '', email: 'example@example.com' }, terms, invoice)).rejects.toThrow('uncertain');
    await createSoftwareInvoiceWithClient(client, { name: '', email: 'example@example.com' }, terms, invoice);
    for (const method of [client.customers.create, client.invoices.create, client.invoiceItems.create, client.invoices.finalizeInvoice, client.invoices.sendInvoice]) expect(method.mock.calls[0]).toEqual(method.mock.calls[1]);
  });
  it('rejects altered amounts and incomplete provider responses', async () => {
    const client = stripe();
    await expect(createSoftwareInvoiceWithClient(client, { name: '', email: 'example@example.com' }, terms, { ...invoice, amount_cents: 51 })).rejects.toThrow('terms');
    expect(client.customers.create).not.toHaveBeenCalled();
    client.invoices.sendInvoice.mockResolvedValueOnce({ id: 'in_wrong', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/test' });
    await expect(createSoftwareInvoiceWithClient(client, { name: '', email: 'example@example.com' }, terms, invoice)).rejects.toThrow('hosted');
  });
});

it('migration preserves audit ids and notes and constrains active invoice rows', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql') && name < '0022').sort())
    db.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
  db.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('software','software','example@example.com','Tool','new','now','now');
    INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('offer','software',1,'sent','{}','now','now');
    INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at)
      VALUES ('software','offer','{}','standard','now','now','now','owner','now','now');
    INSERT INTO software_project_audit(id,request_id,action,note,actor,occurred_at) VALUES (42,'software','started','Keep note','owner','now');`);
  const audit = db.prepare('SELECT * FROM software_project_audit').all();
  db.exec(readFileSync(new URL('../../migrations/music/0022_software_invoices.sql', import.meta.url), 'utf8'));
  expect(db.prepare('SELECT * FROM software_project_audit').all()).toEqual(audit);
  for (const action of ['invoice-created','invoice-status-updated','invoice-replaced']) db.prepare("INSERT INTO software_project_audit(request_id,action,actor,occurred_at) VALUES ('software',?,'owner','later')").run(action);
  expect(db.prepare('SELECT max(id) AS id FROM software_project_audit').get()).toEqual({ id: 45 });
  const insert = db.prepare(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,allow_card,status,stripe_invoice_id,created_by,created_at,updated_at)
    VALUES (?,'software','offer',0,'deposit',50,7,0,?,?,'owner','now','now')`);
  insert.run('first','creating',null);
  for (const status of ['creating','open','payment_failed']) expect(() => insert.run(status,status,null)).toThrow();
  db.exec("UPDATE software_invoices SET status='void' WHERE id='first'");
  insert.run('second','open','in_test');
  expect(() => insert.run('duplicate-stripe','void','in_test')).toThrow();
  for (const [column,value] of [['kind','wrong'],['milestone_index',3],['amount_cents',0],['days_until_due',14],['allow_card',2],['status','draft'],['attempt',-1]])
    expect(() => db.prepare(`UPDATE software_invoices SET ${column}=? WHERE id='second'`).run(value)).toThrow();
  // Event bookkeeping is deliberately shared without an audio installment or foreign key.
  db.exec("INSERT INTO stripe_webhook_events VALUES ('software-event','invoice.sent','in_test','now','now')");
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  db.close();
});

it('limits buttons to the agreed mode, before-start deposits, delivered balances and unpaid milestones',async()=>{
  const {invoiceAvailable}=await import('~/lib/software-invoices');
  expect(invoiceAvailable(terms,0,'deposit',null,false,false)).toBe(true);
  expect(invoiceAvailable(terms,0,'balance',null,true,false)).toBe(false);
  expect(invoiceAvailable(terms,0,'milestone',null,true,false)).toBe(false);
  const later={...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Next'}]};
  const project={milestone_index:0,completed_at:null};
  expect(invoiceAvailable(later,1,'deposit',project,false,false)).toBe(true);
  expect(invoiceAvailable(later,0,'deposit',project,false,false)).toBe(false);
  expect(invoiceAvailable(later,0,'balance',project,false,false)).toBe(false);
  expect(invoiceAvailable(later,0,'balance',project,true,false)).toBe(true);
  expect(invoiceAvailable(later,0,'balance',project,true,true)).toBe(false);
  expect(invoiceAvailable({...later,paymentMode:'invoice'},0,'milestone',project,true,false)).toBe(true);
  expect(invoiceAvailable({...later,paymentMode:'invoice'},0,'deposit',project,false,false)).toBe(false);
  expect(invoiceAvailable(later,0,'balance',{...project,completed_at:'now'},true,false)).toBe(false);
});
