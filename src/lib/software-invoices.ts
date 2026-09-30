import type { OfferTerms } from './software-offers';
import { projectTerms, softwareGuard, softwareAudit } from './software-projects';
import { stripeClient } from './stripe-invoicing';
import type { CreatedStripeInvoice } from './stripe-invoicing';

export type SoftwareInvoiceKind = 'deposit' | 'balance' | 'milestone';
export type SoftwareInvoice = {
  id: string; request_id: string; offer_id: string; due_at: string | null; refunded_at: string | null; creation_started_at: string | null; retention_fenced_at?: string | null; external_refs_deleted_at: string | null; milestone_index: number; kind: SoftwareInvoiceKind;
  amount_cents: number; days_until_due: 7 | 15 | 30; allow_card: number; attempt: number;
  stripe_customer_id: string | null; stripe_invoice_id: string | null; hosted_invoice_url: string | null;
  status: 'creating' | 'open' | 'paid' | 'payment_failed' | 'void' | 'uncollectible';
  status_updated_at: string | null; created_by: string; created_at: string; updated_at: string;
};

export const payableSoftwareInvoiceStatuses = "'creating','open','payment_failed','uncollectible'";
export const manualPaymentReminder = 'Void the open invoice in Stripe first, then record the payment.';
export const payableSoftwareInvoice = (invoices: SoftwareInvoice[], milestone: number, kinds: SoftwareInvoiceKind[]) =>
  invoices.some(invoice => invoice.milestone_index === milestone && kinds.includes(invoice.kind) && ['creating','open','payment_failed','uncollectible'].includes(invoice.status));
export const manualSoftwarePaymentGuard = (db: D1Database, id: string, offerId: string, milestone: number, deposit = false) => softwareGuard(db,
  `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_invoices WHERE request_id=? AND offer_id=? AND milestone_index=?
    AND kind IN (${deposit ? "'deposit'" : "'balance','milestone'"}) AND status IN (${payableSoftwareInvoiceStatuses}))`, [id,offerId,milestone]);

export const softwareInvoiceKindLabels = { deposit: 'Deposit', balance: 'Balance', milestone: 'Milestone' };
export const softwareInvoiceStatusLabels = { creating: 'Creating', open: 'Open', paid: 'Paid', payment_failed: 'Payment failed', void: 'Void', uncollectible: 'Uncollectible' };

export function softwareInvoiceTerms(terms: OfferTerms, milestone: number, kind: SoftwareInvoiceKind) {
  const item = terms.milestones[milestone];
  if (!['deposit', 'balance', 'milestone'].includes(kind) || !Number.isInteger(milestone) || milestone < 0 || !item
    || (terms.paymentMode === 'standard' ? kind === 'milestone' : kind !== 'milestone')) {
    throw new Error('Choose an invoice from the agreed milestone payment schedule.');
  }
  const deposit = Math.floor(item.feeCents / 2);
  return {
    amountCents: kind === 'deposit' ? deposit : kind === 'balance' ? item.feeCents - deposit : item.feeCents,
    daysUntilDue: (kind === 'deposit' ? 7 : kind === 'balance' ? 15 : 30) as 7 | 15 | 30,
  };
}

type InvoiceResult = { id: string; status?: string | null; hosted_invoice_url?: string | null; due_date?: number | null };
// The existing audio adapter uses this same small structural surface for mocked Stripe checks.
type SoftwareStripeClient = {
  customers: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
  invoices: {
    create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }>;
    finalizeInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
    sendInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
  };
  invoiceItems: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
};

export async function createSoftwareInvoiceWithClient(
  stripe: SoftwareStripeClient,
  request: { name: string; email: string },
  terms: OfferTerms,
  invoice: SoftwareInvoice,
): Promise<CreatedStripeInvoice & { dueAt: string | null }> {
  const agreed = softwareInvoiceTerms(terms, invoice.milestone_index, invoice.kind);
  if (invoice.amount_cents !== agreed.amountCents || invoice.days_until_due !== agreed.daysUntilDue
    || ![0, 1].includes(invoice.allow_card) || !Number.isSafeInteger(invoice.attempt) || invoice.attempt < 0) {
    throw new Error('Invoice does not match the project payment terms.');
  }
  const customerKey = `software-request:${invoice.request_id}`;
  const rootKey = `${customerKey}:offer-${invoice.offer_id}:milestone-${invoice.milestone_index}:${invoice.kind}:attempt-${invoice.attempt}`;
  const metadata = { software_request_id: invoice.request_id, milestone_index: String(invoice.milestone_index), kind: invoice.kind, software_invoice_id: invoice.id, software_offer_id: invoice.offer_id };
  const customerId = invoice.stripe_customer_id ?? (await stripe.customers.create({
    email: request.email, name: request.name || undefined,
    metadata: { software_request_id: invoice.request_id },
  }, { idempotencyKey: `${customerKey}:customer` })).id;
  const created = await stripe.invoices.create({
    customer: customerId, collection_method: 'send_invoice', days_until_due: invoice.days_until_due,
    auto_advance: false, description: `${terms.outcome} · Software by The Superhuman Group LLC`, metadata,
    payment_settings: { payment_method_types: invoice.allow_card ? ['us_bank_account', 'card'] : ['us_bank_account'] },
  }, { idempotencyKey: `${rootKey}:invoice` });
  const label = { deposit: '50% deposit', balance: 'remaining balance', milestone: 'full milestone price' }[invoice.kind];
  await stripe.invoiceItems.create({
    customer: customerId, invoice: created.id, amount: invoice.amount_cents, currency: 'usd',
    description: `Milestone ${invoice.milestone_index + 1} · ${terms.milestones[invoice.milestone_index].name} · ${label}`, metadata,
  }, { idempotencyKey: `${rootKey}:item` });
  await stripe.invoices.finalizeInvoice(created.id, {}, { idempotencyKey: `${rootKey}:finalize` });
  const sent = await stripe.invoices.sendInvoice(created.id, {}, { idempotencyKey: `${rootKey}:send` });
  if (sent.id !== created.id || sent.status !== 'open' || !sent.hosted_invoice_url?.startsWith('https://')) {
    throw new Error('Stripe did not return a hosted payment URL.');
  }
  return { stripeCustomerId: customerId, invoiceId: sent.id, hostedInvoiceUrl: sent.hosted_invoice_url, status: 'open', dueAt: sent.due_date ? new Date(sent.due_date * 1000).toISOString() : null };
}

export const listSoftwareInvoices = async (db: D1Database, id: string, offerId?: string) =>
  (await db.prepare(`SELECT * FROM software_invoices WHERE request_id=?${offerId ? ' AND offer_id=?' : ''} ORDER BY milestone_index,created_at,id`)
    .bind(id, ...(offerId ? [offerId] : [])).all<SoftwareInvoice>()).results;
export type ClientSoftwareInvoice = Pick<SoftwareInvoice, 'milestone_index' | 'kind' | 'amount_cents' | 'status' | 'due_at' | 'status_updated_at' | 'hosted_invoice_url' | 'refunded_at'>;
// Call only after the existing session-to-project authorization; bind both project identities.
export async function clientSoftwareInvoices(db: D1Database, project: { request_id: string; offer_id: string }) {
  return (await db.prepare(`SELECT milestone_index,kind,amount_cents,status,due_at,status_updated_at,hosted_invoice_url,refunded_at
    FROM software_invoices WHERE request_id=? AND offer_id=? AND external_refs_deleted_at IS NULL ORDER BY milestone_index,CASE kind WHEN 'deposit' THEN 0 WHEN 'balance' THEN 1 ELSE 2 END,created_at,id`)
    .bind(project.request_id,project.offer_id).all<ClientSoftwareInvoice>()).results;
}
export function invoiceAvailable(terms: OfferTerms, milestone: number, kind: SoftwareInvoiceKind,
  project: { milestone_index: number; completed_at: string | null } | null, delivered: boolean, paid: boolean) {
  try { softwareInvoiceTerms(terms,milestone,kind); } catch { return false; }
  if (paid || project?.completed_at) return false;
  return kind === 'deposit' ? !project ? milestone === 0 : milestone > project.milestone_index : Boolean(project && delivered);
}
export const paidFirstDeposit = (invoices: SoftwareInvoice[], offerId: string) =>
  invoices.find(invoice => invoice.offer_id === offerId && invoice.milestone_index === 0 && invoice.kind === 'deposit' && invoice.status === 'paid' && !invoice.refunded_at);
export async function depositOfferBlock(db: D1Database, id: string, decline = false) {
  const rows = await db.prepare(`SELECT i.status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id
    WHERE i.request_id=? AND i.milestone_index=0 AND i.kind='deposit' ${decline ? '' : "AND o.status='sent'"}
    AND i.refunded_at IS NULL AND i.status IN ('creating','open','payment_failed','uncollectible','paid')`).bind(id).all<{status:string}>();
  if (rows.results.some(row=>['creating','open','payment_failed','uncollectible'].includes(row.status))) return 'Void the open deposit invoice in Stripe first, then send the new offer.';
  if (!decline && rows.results.some(row=>row.status==='paid')) return 'A deposit is already paid for this offer. Start the project, or refund it in Stripe before sending new terms.';
  return null;
}
export const depositOfferGuard = (db: D1Database, id: string, decline = false) => softwareGuard(db,
  `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id
   WHERE i.request_id=? AND i.milestone_index=0 AND i.kind='deposit' ${decline ? '' : "AND o.status='sent'"}
   AND i.refunded_at IS NULL AND i.status IN (${decline ? "'creating','open','payment_failed','uncollectible'" : "'creating','open','payment_failed','uncollectible','paid'"}))`, [id]);

const invoiceDeliveryQuery = `SELECT 1 FROM software_project_updates u
  WHERE u.id=(SELECT id FROM software_project_updates WHERE request_id=? AND milestone_index=?
    AND kind='delivery_review' AND status='shared' ORDER BY shared_at DESC,id DESC LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM software_project_messages WHERE update_id=u.id AND decision='changes_requested')`;

export async function reserveSoftwareInvoice(db: D1Database, input: {
  requestId: string; offerId: string; milestone: number; kind: SoftwareInvoiceKind; allowCard: boolean; actor: string;
  retryId?: string; replaceId?: string;
}) {
  const { requestId: id, offerId, milestone, kind } = input;
  const offer = await db.prepare(`SELECT o.*,r.updated_at AS request_updated_at FROM software_offers o JOIN owner_requests r ON r.id=o.request_id
    WHERE o.id=? AND o.request_id=? AND r.kind='software' AND r.status NOT IN ('withdrawn','resolved') AND r.email<>''`).bind(offerId,id)
    .first<{terms_json:string; status:string; request_updated_at:string}>();
  if (!offer) throw new Error('Choose the current offer.');
  const project = await db.prepare('SELECT * FROM software_projects WHERE request_id=?').bind(id)
    .first<{offer_id:string;milestone_index:number;completed_at:string|null;revoked_at:string|null;content_deleted_at:string|null;updated_at:string}>();
  if (project ? project.offer_id !== offerId || project.revoked_at || project.content_deleted_at : offer.status !== 'sent') throw new Error('Choose the current offer.');
  const terms = projectTerms(offer), agreed = softwareInvoiceTerms(terms,milestone,kind);
  const delivered = Boolean(await db.prepare(invoiceDeliveryQuery).bind(id,milestone).first());
  const paid = Boolean(await db.prepare('SELECT 1 FROM software_milestone_payments WHERE request_id=? AND milestone_index=?').bind(id,milestone).first());
  const invoices = (await listSoftwareInvoices(db,id,offerId)).filter(row=>row.milestone_index===milestone && row.kind===kind);
  const previous = invoices.find(row=>row.id===(input.retryId ?? input.replaceId));
  if (kind==='deposit' && await db.prepare('SELECT 1 FROM software_milestone_deposits WHERE request_id=? AND milestone_index=?').bind(id,milestone).first()) throw new Error('This installment is already paid.');
  if (!invoiceAvailable(terms,milestone,kind,project,delivered,paid) && !input.retryId) throw new Error('This invoice is not available at this milestone.');
  if (invoices.some(row=>row.status==='paid' && !row.refunded_at)) throw new Error('This installment is already paid.');
  const at = new Date().toISOString();
  const guards = [softwareGuard(db,'SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_milestone_payments WHERE request_id=? AND milestone_index=?)',[id,milestone]), softwareGuard(db,'SELECT 1 FROM owner_requests WHERE id=? AND updated_at=?',[id,offer.request_updated_at]),
    project ? softwareGuard(db,'SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=? AND revoked_at IS NULL AND content_deleted_at IS NULL',[id,project.updated_at])
      : softwareGuard(db,"SELECT 1 FROM software_offers WHERE id=? AND status='sent' AND NOT EXISTS(SELECT 1 FROM software_projects WHERE request_id=?)",[offerId,id]),
    softwareGuard(db,"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_invoices WHERE request_id=? AND offer_id=? AND milestone_index=? AND kind=? AND status='paid' AND refunded_at IS NULL)",[id,offerId,milestone,kind])];
  if (kind!=='deposit') guards.push(softwareGuard(db,invoiceDeliveryQuery,[id,milestone]));
  if (kind==='deposit') guards.push(softwareGuard(db,'SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_milestone_deposits WHERE request_id=? AND milestone_index=?)',[id,milestone]));
  if (input.retryId) {
    // Stripe retains idempotency keys for at least 24 hours. Older uncertain attempts need webhook/Stripe reconciliation.
    if (!previous || previous.status!=='creating' || previous.external_refs_deleted_at || Date.parse(previous.created_at)<Date.now()-23*3600_000) throw new Error('Check Stripe and reconcile this invoice before retrying.');
    await db.batch([...guards, softwareGuard(db,"SELECT 1 FROM software_invoices WHERE id=? AND status='creating' AND (creation_started_at IS NULL OR creation_started_at<=?)",[previous.id,new Date(Date.now()-60_000).toISOString()]),
      db.prepare('UPDATE software_invoices SET creation_started_at=?,updated_at=? WHERE id=?').bind(at,at,previous.id)]);
    return (await listSoftwareInvoices(db,id,offerId)).find(row=>row.id===previous.id)!;
  }
  if (input.replaceId && (!previous || !['void','uncollectible'].includes(previous.status))) throw new Error('Void the invoice in Stripe before replacing it.');
  if (input.replaceId && previous?.status==='uncollectible') throw new Error('Void the uncollectible invoice in Stripe first; it can still be paid.');
  if (!input.replaceId && invoices.some(row=>['void','uncollectible'].includes(row.status))) throw new Error('Use Replace invoice after voiding the original in Stripe.');
  const newId=crypto.randomUUID(), attempt=Math.max(-1,...invoices.map(row=>row.attempt))+1;
  const customer=(await listSoftwareInvoices(db,id)).find(row=>row.stripe_customer_id)?.stripe_customer_id ?? null;
  await db.batch([...guards,
    ...(previous ? [softwareGuard(db,"SELECT 1 FROM software_invoices WHERE id=? AND status='void'",[previous.id])] : []),
    db.prepare(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,allow_card,attempt,stripe_customer_id,creation_started_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(newId,id,offerId,milestone,kind,agreed.amountCents,agreed.daysUntilDue,input.allowCard?1:0,attempt,customer,at,input.actor,at,at),
    softwareAudit(db,id,previous ? 'invoice-replaced' : 'invoice-created',input.actor,at,`${kind[0].toUpperCase()+kind.slice(1)} for milestone ${milestone+1} reserved`)]);
  return (await listSoftwareInvoices(db,id,offerId)).find(row=>row.id===newId)!;
}
export async function recordSoftwareInvoice(db: D1Database, invoice: SoftwareInvoice, result: CreatedStripeInvoice & {dueAt:string|null}) {
  await db.prepare(`UPDATE software_invoices SET stripe_customer_id=?,stripe_invoice_id=?,hosted_invoice_url=?,due_at=COALESCE(?,due_at),
    status=CASE WHEN status='creating' THEN 'open' ELSE status END,creation_started_at=NULL,updated_at=?
    WHERE id=? AND external_refs_deleted_at IS NULL AND retention_fenced_at IS NULL AND (stripe_invoice_id IS NULL OR stripe_invoice_id=?)`)
    .bind(result.stripeCustomerId,result.invoiceId,result.hostedInvoiceUrl,result.dueAt,new Date().toISOString(),invoice.id,result.invoiceId).run();
  const row=await db.prepare('SELECT * FROM software_invoices WHERE id=?').bind(invoice.id).first<SoftwareInvoice>();
  if (!row || row.stripe_invoice_id!==result.invoiceId) throw new Error('Invoice recovery is pending.');
  return row;
}
export async function createSoftwareInvoice(env: Env, request: {name:string;email:string}, terms: OfferTerms, invoice: SoftwareInvoice) {
  return createSoftwareInvoiceWithClient(stripeClient(env),request,terms,invoice);
}

export type SoftwareInvoiceEvent = {
  eventId:string; eventType:string; invoiceId:string; requestId:string; localId:string; offerId:string;
  milestone:string; kind:string; status:Exclude<SoftwareInvoice['status'],'creating'>; occurredAt:string;
  total:number; currency:string; customerId:string|null; hostedUrl:string|null; dueAt:string|null;
};
export async function applySoftwareInvoiceEvent(db: D1Database, event: SoftwareInvoiceEvent) {
  const invoice=await db.prepare('SELECT * FROM software_invoices WHERE id=? AND request_id=?').bind(event.localId,event.requestId).first<SoftwareInvoice>();
  const at=new Date().toISOString();
  if (!invoice || invoice.retention_fenced_at || invoice.external_refs_deleted_at || invoice.offer_id!==event.offerId || String(invoice.milestone_index)!==event.milestone || invoice.kind!==event.kind
    || (invoice.stripe_invoice_id ? invoice.stripe_invoice_id!==event.invoiceId : invoice.status!=='creating')
    || invoice.amount_cents!==event.total || event.currency!=='usd') {
    await db.prepare(`INSERT OR IGNORE INTO software_stripe_unmatched_events(event_id,event_type,invoice_id,request_id,status,occurred_at,received_at)
      VALUES (?,?,?,?,?,?,?)`).bind(event.eventId,event.eventType,event.invoiceId,event.requestId,event.status,event.occurredAt,at).run();
    return 'unmatched';
  }
  if (await db.prepare('SELECT 1 FROM stripe_webhook_events WHERE id=?').bind(event.eventId).first()) return 'duplicate';
  const eligible=`id=? AND external_refs_deleted_at IS NULL AND retention_fenced_at IS NULL AND status<>'paid' AND (status_updated_at IS NULL OR status_updated_at<? OR (status_updated_at=? AND ?='paid'))
    AND NOT EXISTS(SELECT 1 FROM stripe_webhook_events WHERE id=?)`;
  const args=[invoice.id,event.occurredAt,event.occurredAt,event.status,event.eventId];
  await db.batch([
    db.prepare(`INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note)
      SELECT request_id,'invoice-status-updated','stripe',?,? FROM software_invoices WHERE ${eligible}`)
      .bind(at,`${invoice.kind[0].toUpperCase()+invoice.kind.slice(1)} for milestone ${invoice.milestone_index+1} ${event.status}`, ...args),
    db.prepare(`UPDATE software_invoices SET stripe_invoice_id=?,stripe_customer_id=COALESCE(?,stripe_customer_id),hosted_invoice_url=COALESCE(?,hosted_invoice_url),due_at=COALESCE(?,due_at),
      status=?,status_updated_at=?,creation_started_at=NULL,updated_at=? WHERE ${eligible}`)
      .bind(event.invoiceId,event.customerId,event.hostedUrl?.startsWith('https://') ? event.hostedUrl : null,event.dueAt,event.status,event.occurredAt,at,...args),
    ...(event.status==='paid' && invoice.kind!=='deposit' ? [
      db.prepare(`INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note)
        SELECT i.request_id,'milestone-paid','stripe',?,? FROM software_invoices i JOIN software_projects p ON p.request_id=i.request_id AND p.offer_id=i.offer_id
        WHERE i.id=? AND i.external_refs_deleted_at IS NULL AND i.retention_fenced_at IS NULL AND i.status='paid' AND NOT EXISTS(SELECT 1 FROM software_milestone_payments m WHERE m.request_id=i.request_id AND m.milestone_index=i.milestone_index)`)
        .bind(event.occurredAt,`Paid in full · milestone ${invoice.milestone_index+1}`,invoice.id),
      db.prepare(`INSERT OR IGNORE INTO software_milestone_payments(request_id,milestone_index,paid_recorded_at,recorded_by)
        SELECT i.request_id,i.milestone_index,i.status_updated_at,'stripe' FROM software_invoices i JOIN software_projects p ON p.request_id=i.request_id AND p.offer_id=i.offer_id WHERE i.id=? AND i.external_refs_deleted_at IS NULL AND i.retention_fenced_at IS NULL AND i.status='paid'`)
        .bind(invoice.id),
    ] : []),
    db.prepare(`INSERT OR IGNORE INTO stripe_webhook_events(id,event_type,invoice_id,occurred_at,processed_at) SELECT ?,?,?,?,? FROM software_invoices WHERE id=? AND retention_fenced_at IS NULL AND external_refs_deleted_at IS NULL`).bind(event.eventId,event.eventType,event.invoiceId,event.occurredAt,at,invoice.id),
    db.prepare('DELETE FROM software_stripe_unmatched_events WHERE event_id=?').bind(event.eventId),
    db.prepare(`INSERT OR IGNORE INTO software_stripe_unmatched_events(event_id,event_type,invoice_id,request_id,status,occurred_at,received_at)
      SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM software_invoices WHERE id=? AND retention_fenced_at IS NULL AND external_refs_deleted_at IS NULL)`)
      .bind(event.eventId,event.eventType,event.invoiceId,event.requestId,event.status,event.occurredAt,at,invoice.id),
  ]);
  return await db.prepare('SELECT 1 FROM software_stripe_unmatched_events WHERE event_id=?').bind(event.eventId).first() ? 'unmatched' : 'processed';
}
