export const invoiceStatuses = ['not_created', 'draft', 'open', 'paid', 'payment_failed', 'void', 'uncollectible'] as const;
export type InvoiceStatus = typeof invoiceStatuses[number];
export type Installment = 'booking' | 'balance';

export type AudioPayment = {
  requestId: string;
  approvedService: string;
  totalAmountCents: number;
  currency: 'usd';
  bookingAmountCents: number;
  balanceAmountCents: number;
  offerAcceptedAt: string;
  stripeCustomerId: string | null;
  bookingInvoiceId: string | null;
  bookingInvoiceUrl: string | null;
  bookingStatus: InvoiceStatus;
  bookingStatusUpdatedAt: string | null;
  bookingAttemptCount: number;
  balanceInvoiceId: string | null;
  balanceInvoiceUrl: string | null;
  balanceStatus: InvoiceStatus;
  balanceStatusUpdatedAt: string | null;
  balanceAttemptCount: number;
  externalRefsDeletedAt: string | null;
  bookingRecoveryEventId: string | null;
  balanceRecoveryEventId: string | null;
  bookingCreationStartedAt: string | null;
  balanceCreationStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentRow = {
  request_id: string; approved_service: string; total_amount_cents: number; currency: 'usd';
  booking_amount_cents: number; balance_amount_cents: number; offer_accepted_at: string;
  stripe_customer_id: string | null; booking_invoice_id: string | null; booking_invoice_url: string | null;
  booking_status: InvoiceStatus; balance_invoice_id: string | null; balance_invoice_url: string | null;
  booking_status_updated_at: string | null; booking_attempt_count: number; balance_status: InvoiceStatus;
  balance_status_updated_at: string | null; balance_attempt_count: number;
  external_refs_deleted_at: string | null; booking_recovery_event_id: string | null; balance_recovery_event_id: string | null;
  booking_creation_started_at: string | null; balance_creation_started_at: string | null; created_at: string; updated_at: string;
};

const columns = `request_id,approved_service,total_amount_cents,currency,booking_amount_cents,
  balance_amount_cents,offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,
  booking_status,booking_status_updated_at,booking_attempt_count,balance_invoice_id,balance_invoice_url,balance_status,
  balance_status_updated_at,balance_attempt_count,external_refs_deleted_at,booking_recovery_event_id,
  balance_recovery_event_id,booking_creation_started_at,balance_creation_started_at,created_at,updated_at`;

function fromRow(row: PaymentRow): AudioPayment {
  return {
    requestId: row.request_id, approvedService: row.approved_service,
    totalAmountCents: Number(row.total_amount_cents), currency: row.currency,
    bookingAmountCents: Number(row.booking_amount_cents), balanceAmountCents: Number(row.balance_amount_cents),
    offerAcceptedAt: row.offer_accepted_at, stripeCustomerId: row.stripe_customer_id,
    bookingInvoiceId: row.booking_invoice_id, bookingInvoiceUrl: row.booking_invoice_url,
    bookingStatus: row.booking_status, balanceInvoiceId: row.balance_invoice_id,
    bookingStatusUpdatedAt: row.booking_status_updated_at,
    bookingAttemptCount: Number(row.booking_attempt_count),
    balanceInvoiceUrl: row.balance_invoice_url, balanceStatus: row.balance_status,
    balanceStatusUpdatedAt: row.balance_status_updated_at,
    balanceAttemptCount: Number(row.balance_attempt_count),
    externalRefsDeletedAt: row.external_refs_deleted_at,
    bookingRecoveryEventId: row.booking_recovery_event_id, balanceRecoveryEventId: row.balance_recovery_event_id,
    bookingCreationStartedAt: row.booking_creation_started_at, balanceCreationStartedAt: row.balance_creation_started_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function validTimestamp(value: string, label: string) {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${label}.`);
}

export async function getAudioPayment(db: D1Database, requestId: string): Promise<AudioPayment | null> {
  const row = await db.prepare(`SELECT ${columns} FROM audio_payments WHERE request_id=?`)
    .bind(requestId).first<PaymentRow>();
  return row ? fromRow(row) : null;
}

export async function approveAudioPayment(db: D1Database, input: {
  requestId: string; approvedService: string; totalAmountCents: number;
  offerAcceptedAt: string; actor: string;
}): Promise<AudioPayment> {
  if (!Number.isSafeInteger(input.totalAmountCents) || input.totalAmountCents < 1 || input.totalAmountCents > 100_000_000) {
    throw new Error('Invalid fixed project price.');
  }
  const approvedService = input.approvedService.trim();
  if (!approvedService || approvedService.length > 160) throw new Error('Invalid approved service.');
  validTimestamp(input.offerAcceptedAt, 'offer acceptance time');
  if (!input.actor.trim()) throw new Error('Invalid request actor.');
  const request = await db.prepare('SELECT kind FROM owner_requests WHERE id=?').bind(input.requestId).first<{ kind: string }>();
  if (!request) throw new Error('Request not found.');
  if (request.kind !== 'service') throw new Error('Payment approval requires an audio service request.');
  const existing = await getAudioPayment(db, input.requestId);
  if (existing) {
    if (existing.approvedService === approvedService && existing.totalAmountCents === input.totalAmountCents
      && existing.offerAcceptedAt === input.offerAcceptedAt) return existing;
    throw new Error('Payment terms are already approved.');
  }
  const booking = Math.ceil(input.totalAmountCents / 2);
  const balance = input.totalAmountCents - booking;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO audio_payments
      (request_id,approved_service,total_amount_cents,currency,booking_amount_cents,balance_amount_cents,
        offer_accepted_at,booking_status,balance_status,created_at,updated_at)
      VALUES (?,?,?,'usd',?,?,?,'not_created','not_created',?,?)`)
      .bind(input.requestId, approvedService, input.totalAmountCents, booking, balance, input.offerAcceptedAt, now, now),
    db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      VALUES (?,'payment-approved',?,?,?)`)
      .bind(input.requestId, input.actor.trim().toLowerCase(), `${approvedService}; USD ${(input.totalAmountCents / 100).toFixed(2)}`, now),
  ]);
  return (await getAudioPayment(db, input.requestId))!;
}

export async function recordInvoice(db: D1Database, input: {
  requestId: string; installment: Installment; stripeCustomerId: string; invoiceId: string;
  hostedInvoiceUrl: string; status: Exclude<InvoiceStatus, 'not_created'>; actor: string;
}): Promise<AudioPayment> {
  const payment = await getAudioPayment(db, input.requestId);
  if (!payment) throw new Error('Payment terms are not approved.');
  if (!input.actor.trim()) throw new Error('Invalid request actor.');
  if (input.installment === 'balance' && payment.bookingStatus !== 'paid') {
    throw new Error('The booking invoice must be paid before creating the balance invoice.');
  }
  const currentId = input.installment === 'booking' ? payment.bookingInvoiceId : payment.balanceInvoiceId;
  if (currentId === input.invoiceId) return payment;
  if (currentId) throw new Error(`${input.installment === 'booking' ? 'Booking' : 'Balance'} invoice already exists.`);
  if (!input.stripeCustomerId || !input.invoiceId || !input.hostedInvoiceUrl.startsWith('https://')) {
    throw new Error('Invalid Stripe invoice response.');
  }
  if (!invoiceStatuses.includes(input.status)) throw new Error('Invalid invoice status.');
  const prefix = input.installment === 'booking' ? 'booking' : 'balance';
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id IS NULL
      )`).bind(input.requestId, `${prefix}-invoice-created`, input.actor.trim().toLowerCase(), input.invoiceId, now, input.requestId),
    db.prepare(`UPDATE audio_payments SET stripe_customer_id=?,${prefix}_invoice_id=?,
      ${prefix}_invoice_url=?,${prefix}_status=?,${prefix}_creation_started_at=NULL,updated_at=?
      WHERE request_id=? AND ${prefix}_invoice_id IS NULL`)
      .bind(input.stripeCustomerId, input.invoiceId, input.hostedInvoiceUrl, input.status, now, input.requestId),
    db.prepare(`INSERT OR IGNORE INTO stripe_invoice_attempts(invoice_id,request_id,installment,created_at)
      VALUES (?,?,?,?)`).bind(input.invoiceId, input.requestId, input.installment, now),
  ]);
  const updated = await getAudioPayment(db, input.requestId);
  if (!updated || updated[`${prefix}InvoiceId`] !== input.invoiceId) throw new Error('Invoice already exists.');
  return updated;
}

export async function replaceTerminalInvoice(db: D1Database, input: {
  requestId: string; installment: Installment; actor: string;
}): Promise<AudioPayment> {
  const payment = await getAudioPayment(db, input.requestId);
  if (!payment) throw new Error('Payment terms are not approved.');
  if (!input.actor.trim()) throw new Error('Invalid request actor.');
  const prefix = input.installment;
  const status = payment[`${prefix}Status`];
  const invoiceId = payment[`${prefix}InvoiceId`];
  if (!invoiceId || status !== 'void') throw new Error('Only a void invoice can be replaced.');
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=? AND ${prefix}_status='void'
      )`).bind(input.requestId, `${prefix}-invoice-replaced`, input.actor.trim().toLowerCase(), invoiceId, now,
        input.requestId, invoiceId),
    db.prepare(`UPDATE stripe_invoice_attempts SET replaced_at=? WHERE invoice_id=? AND replaced_at IS NULL
      AND EXISTS (SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=? AND ${prefix}_status='void')`)
      .bind(now, invoiceId, input.requestId, invoiceId),
    db.prepare(`UPDATE audio_payments SET ${prefix}_invoice_id=NULL,${prefix}_invoice_url=NULL,
      ${prefix}_status='not_created',${prefix}_status_updated_at=NULL,${prefix}_recovery_event_id=NULL,
      ${prefix}_creation_started_at=NULL,${prefix}_attempt_count=${prefix}_attempt_count+1,updated_at=?
      WHERE request_id=? AND ${prefix}_invoice_id=? AND ${prefix}_status='void'`)
      .bind(now, input.requestId, invoiceId),
  ]);
  return (await getAudioPayment(db, input.requestId))!;
}

export async function reserveInvoiceCreation(db: D1Database, input: {
  requestId: string; installment: Installment;
}): Promise<AudioPayment> {
  const prefix = input.installment;
  const now = new Date().toISOString();
  const reservation = await db.prepare(`UPDATE audio_payments SET ${prefix}_creation_started_at=?,updated_at=?
    WHERE request_id=? AND ${prefix}_invoice_id IS NULL AND ${prefix}_creation_started_at IS NULL`)
    .bind(now, now, input.requestId).run();
  if (reservation.meta.changes !== 1) throw new Error('Invoice creation is already pending or complete.');
  const payment = await getAudioPayment(db, input.requestId);
  if (!payment || !payment[`${prefix}CreationStartedAt`] || payment[`${prefix}InvoiceId`]) {
    throw new Error('Invoice creation is already pending or complete.');
  }
  return payment;
}

export async function isKnownInvoiceAttempt(db: D1Database, invoiceId: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT invoice_id FROM stripe_invoice_attempts WHERE invoice_id=?').bind(invoiceId).first());
}

export async function recordUnmatchedStripeEvent(db: D1Database, input: {
  eventId: string; eventType: string; invoiceId: string; requestId: string; installment: Installment;
  status: Exclude<InvoiceStatus, 'not_created'>; occurredAt: string; reason: 'request-not-found' | 'invoice-conflict';
}): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO stripe_unmatched_events
    (event_id,event_type,invoice_id,request_id,installment,status,occurred_at,received_at,reason)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(input.eventId, input.eventType, input.invoiceId, input.requestId,
    input.installment, input.status, input.occurredAt, new Date().toISOString(), input.reason).run();
}

export async function recoverInvoiceFromWebhook(db: D1Database, input: {
  eventId: string; eventType: string; requestId: string; installment: Installment; invoiceId: string;
  stripeCustomerId: string | null; hostedInvoiceUrl: string | null;
  status: Exclude<InvoiceStatus, 'not_created'>; occurredAt: string; totalAmountCents: number; currency: string;
}): Promise<'recovered' | 'discarded' | 'unmatched'> {
  const payment = await getAudioPayment(db, input.requestId);
  if (payment?.externalRefsDeletedAt) return 'discarded';
  const prefix = input.installment;
  const currentId = payment?.[`${prefix}InvoiceId`];
  const receivedAt = new Date().toISOString();
  const expectedAmount = payment?.[`${prefix}AmountCents`];
  const invalidInvoice = payment && (input.totalAmountCents !== expectedAmount || input.currency !== payment.currency
    || (input.installment === 'balance' && payment.bookingStatus !== 'paid'));
  if (!payment || currentId || invalidInvoice) {
    await recordUnmatchedStripeEvent(db, {
      eventId: input.eventId, eventType: input.eventType, invoiceId: input.invoiceId, requestId: input.requestId,
      installment: input.installment, status: input.status, occurredAt: input.occurredAt,
      reason: payment ? 'invoice-conflict' : 'request-not-found',
    });
    return 'unmatched';
  }
  await db.batch([
    db.prepare(`UPDATE audio_payments SET stripe_customer_id=COALESCE(?,stripe_customer_id),
      ${prefix}_invoice_id=?,${prefix}_invoice_url=?,${prefix}_status=?,${prefix}_status_updated_at=?,
      ${prefix}_recovery_event_id=?,${prefix}_creation_started_at=NULL,updated_at=?
      WHERE request_id=? AND ${prefix}_invoice_id IS NULL`)
      .bind(input.stripeCustomerId, input.invoiceId, input.hostedInvoiceUrl, input.status, input.occurredAt,
        input.eventId, receivedAt, input.requestId),
    db.prepare(`INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_recovery_event_id=?
      )`).bind(input.requestId, `${prefix}-payment-updated`, 'stripe-recovery',
        `${input.eventType}: ${input.status}; recovered ${input.invoiceId}`, receivedAt, input.requestId, input.eventId),
    db.prepare(`INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=? AND ${prefix}_recovery_event_id IS NOT ?
          AND ${prefix}_status<>'paid' AND (${prefix}_status_updated_at IS NULL OR ${prefix}_status_updated_at<=?)
      )`).bind(input.requestId, `${prefix}-payment-updated`, 'stripe', `${input.eventType}: ${input.status}`,
        receivedAt, input.requestId, input.invoiceId, input.eventId, input.occurredAt),
    db.prepare(`UPDATE audio_payments SET ${prefix}_status=?,${prefix}_status_updated_at=?,updated_at=?
      WHERE request_id=? AND ${prefix}_invoice_id=? AND ${prefix}_recovery_event_id IS NOT ?
        AND ${prefix}_status<>'paid' AND (${prefix}_status_updated_at IS NULL OR ${prefix}_status_updated_at<=?)`)
      .bind(input.status, input.occurredAt, receivedAt, input.requestId, input.invoiceId, input.eventId, input.occurredAt),
    db.prepare(`INSERT OR IGNORE INTO stripe_invoice_attempts(invoice_id,request_id,installment,created_at)
      SELECT ?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=?
      )`).bind(input.invoiceId, input.requestId, input.installment, receivedAt, input.requestId, input.invoiceId),
    db.prepare(`INSERT OR IGNORE INTO stripe_webhook_events(id,event_type,invoice_id,occurred_at,processed_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=?
      )`).bind(input.eventId, input.eventType, input.invoiceId, input.occurredAt, receivedAt,
        input.requestId, input.invoiceId),
    db.prepare(`INSERT OR IGNORE INTO stripe_unmatched_events
      (event_id,event_type,invoice_id,request_id,installment,status,occurred_at,received_at,reason)
      SELECT ?,?,?,?,?,?,?,?,'invoice-conflict' WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id IS NOT NULL AND ${prefix}_invoice_id<>?
      )`).bind(input.eventId, input.eventType, input.invoiceId, input.requestId, input.installment,
        input.status, input.occurredAt, receivedAt, input.requestId, input.invoiceId),
    db.prepare(`DELETE FROM stripe_unmatched_events WHERE event_id=? AND EXISTS (
      SELECT 1 FROM audio_payments WHERE request_id=? AND ${prefix}_invoice_id=?
    )`).bind(input.eventId, input.requestId, input.invoiceId),
  ]);
  const unmatched = await db.prepare('SELECT event_id FROM stripe_unmatched_events WHERE event_id=?')
    .bind(input.eventId).first();
  return unmatched ? 'unmatched' : 'recovered';
}

export async function applyStripeInvoiceEvent(db: D1Database, input: {
  eventId: string; eventType: string; invoiceId: string; status: Exclude<InvoiceStatus, 'not_created'>; occurredAt: string;
}): Promise<{ applied: boolean; payment: AudioPayment | null }> {
  if (!input.eventId || !input.eventType || !input.invoiceId) throw new Error('Invalid Stripe event.');
  if (!invoiceStatuses.includes(input.status)) throw new Error('Invalid invoice status.');
  validTimestamp(input.occurredAt, 'Stripe event time');
  const duplicate = await db.prepare('SELECT id FROM stripe_webhook_events WHERE id=?').bind(input.eventId).first();
  if (duplicate) {
    const current = await db.prepare(`SELECT ${columns} FROM audio_payments
      WHERE booking_invoice_id=? OR balance_invoice_id=?`).bind(input.invoiceId, input.invoiceId).first<PaymentRow>();
    return { applied: false, payment: current ? fromRow(current) : null };
  }
  const row = await db.prepare(`SELECT ${columns} FROM audio_payments
    WHERE booking_invoice_id=? OR balance_invoice_id=?`).bind(input.invoiceId, input.invoiceId).first<PaymentRow>();
  if (!row) return { applied: false, payment: null };
  const installment = row.booking_invoice_id === input.invoiceId ? 'booking' : 'balance';
  const processedAt = new Date().toISOString();
  const currentStatus = row[`${installment}_status`];
  const currentEventAt = row[`${installment}_status_updated_at`];
  const shouldApply = currentStatus !== 'paid' && (!currentEventAt || input.occurredAt >= currentEventAt);
  const statements = [
    db.prepare(`INSERT INTO stripe_webhook_events (id,event_type,invoice_id,occurred_at,processed_at)
      VALUES (?,?,?,?,?)`).bind(input.eventId, input.eventType, input.invoiceId, input.occurredAt, processedAt),
  ];
  if (shouldApply) statements.unshift(
    db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM audio_payments WHERE request_id=? AND ${installment}_invoice_id=?
          AND ${installment}_status<>'paid'
          AND (${installment}_status_updated_at IS NULL OR ${installment}_status_updated_at<=?)
      )`).bind(row.request_id, `${installment}-payment-updated`, 'stripe', `${input.eventType}: ${input.status}`, processedAt,
        row.request_id, input.invoiceId, input.occurredAt),
    db.prepare(`UPDATE audio_payments SET ${installment}_status=?,${installment}_status_updated_at=?,updated_at=?
      WHERE request_id=? AND ${installment}_invoice_id=?
        AND ${installment}_status<>'paid'
        AND (${installment}_status_updated_at IS NULL OR ${installment}_status_updated_at<=?)`)
      .bind(input.status, input.occurredAt, processedAt, row.request_id, input.invoiceId, input.occurredAt),
  );
  await db.batch(statements);
  return { applied: shouldApply, payment: await getAudioPayment(db, row.request_id) };
}
