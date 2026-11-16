import { deleteRetiredCodes } from "./audio-client-access";

export async function revokeProjectAccess(
	db: D1Database,
	requestId: string,
	actor: string,
	now = new Date(),
): Promise<boolean> {
	if (!actor.trim()) return false;
	const at = now.toISOString();
	const revocationId = crypto.randomUUID();

	const [changed] = await db.batch([
		db
			.prepare(`UPDATE audio_projects SET revoked_at=?,updated_at=?,access_revocation_id=?
      WHERE request_id=? AND revoked_at IS NULL RETURNING request_id`)
			.bind(at, at, revocationId, requestId),
		db
			.prepare(`UPDATE audio_client_sessions SET revoked_at=? WHERE revoked_at IS NULL AND email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
			.bind(at, requestId, revocationId),
		db
			.prepare(`DELETE FROM audio_client_signin_codes WHERE email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
			.bind(requestId, revocationId),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'revoked',?,? FROM audio_projects WHERE request_id=? AND access_revocation_id=?`)
			.bind(actor, at, requestId, revocationId),
	]);

	if (changed.results.length > 0) await deleteRetiredCodes(db, requestId);

	return changed.results.length > 0;
}
