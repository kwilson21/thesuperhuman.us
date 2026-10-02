export const agreementEvent = (
  db: D1Database,
  action: string,
  actor: string,
  at: string,
  agreementId: string | null = null,
  offerId: string | null = null,
  reason: 'owner-abandoned' | null = null,
) =>
  db
    .prepare(
      'INSERT INTO software_agreement_events(id,agreement_id,offer_id,action,actor,occurred_at,reason) VALUES(?,?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), agreementId, offerId, action, actor, at, reason);
