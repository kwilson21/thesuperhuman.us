import { softwareGuard } from "../../src/lib/software-guard";

// The signing batches' guards A1 and A2, as the store builds them (src/server/agreement-store.ts, `signingLiveGuard` and
// `signingSessionGuard`, which it does not export), copied for the rule tests that hold each guard to the rule deciding
// the same on a read. Each copy is held to the store's own text (tests/rules/signing-offer.test.ts for A1,
// tests/rules/signing-draft.test.ts for A2). Before the client routes' conversion these were `liveSigningGuard`
// (src/lib/agreement-access.ts) and `sessionGuard` (src/lib/software-agreements.ts), text for text.

/** A1: the offer is sent through the link with this token hash to this recipient, open, with no project, signing on. */
export const LIVE_SIGNING_GUARD =
	"SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END";

/** A2: the session is unexpired at the batch's time and unrevoked. */
export const SESSION_GUARD =
	"SELECT 1 FROM software_agreement_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL";

/** A1, bound as the store binds it. */
export const liveSigningGuard = (
	db: D1Database,
	offerId: string,
	linkHash: string,
	email: string,
) => db.prepare(LIVE_SIGNING_GUARD).bind(offerId, linkHash, email);

/** A2, bound to the session's token hash and the clock now, as the store binds it with the time the flow read. */
export const sessionGuard = <Session extends { readonly token_hash: string }>(
	db: D1Database,
	session: Session,
) =>
	softwareGuard(db, SESSION_GUARD, [
		session.token_hash,
		new Date().toISOString(),
	]);
