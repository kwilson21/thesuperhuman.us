import { agreementSession, agreementHeaders } from "./agreement-access";
import {
	studioSessionFromRequest,
	clientSoftwareProjectForSession,
} from "./audio-client-access";
import { hashBytes } from "./agreement-artifacts";
import type { AgreementArtifact } from "./agreement-artifacts";

export async function agreementDownload(
	env: Env,
	request: Request,
	id: string,
	owner = false,
) {
	const db = env.MUSIC_DB;

	if (!db || !env.AUDIO)
		return new Response("Unavailable", {
			status: 503,
			headers: agreementHeaders,
		});

	// A visitor is checked before the agreement is looked up. With no valid session the answer is the same 401 for any id.
	// With one, anything they cannot download (an unknown id, an agreement still in review or closed by retention, another
	// client's) answers the same 404, so a verified visitor cannot tell ids apart either, and is not told to verify again.
	const signInFirst = () =>
		new Response("Verify your agreement email first.", {
			status: 401,
			headers: agreementHeaders,
		});

	const notFound = () =>
		new Response("Not found", { status: 404, headers: agreementHeaders });

	const archive = owner ? null : await agreementSession(db, request, "archive"),
		signing = owner ? null : await agreementSession(db, request, "agreement"),
		studio = owner ? null : studioSessionFromRequest(request);

	const studioIdentity = studio
		? await db
				.prepare(
					"SELECT email FROM audio_client_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL",
				)
				.bind(
					await (await import("./audio-client-access")).hashValue(studio),
					new Date().toISOString(),
				)
				.first<{ email: string }>()
		: null;

	if (!owner && !archive && !signing && !studioIdentity) return signInFirst();

	const agreement = await db
		.prepare(
			"SELECT a.id,a.offer_id,a.request_id,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=? AND a.status='executed' AND a.archive_closed_at IS NULL",
		)
		.bind(id)
		.first<{
			id: string;
			offer_id: string;
			request_id: string;
			recipient_email: string;
		}>();

	if (!agreement) return notFound();

	if (!owner) {
		const project = studio
			? await clientSoftwareProjectForSession(db, studio, agreement.request_id)
			: null;

		const projectAgreement = project
			? await db
					.prepare(
						"SELECT agreement_id FROM software_projects WHERE request_id=?",
					)
					.bind(project.request_id)
					.first<{ agreement_id: string }>()
			: null;

		const linked = projectAgreement?.agreement_id
			? await db
					.prepare("SELECT msa_id FROM software_agreements WHERE id=?")
					.bind(projectAgreement.agreement_id)
					.first<{ msa_id: string }>()
			: null;

		const allowed =
			archive?.recipient_email === agreement.recipient_email ||
			(signing?.recipient_email === agreement.recipient_email &&
				(signing.offer_id === agreement.offer_id ||
					Boolean(
						await db
							.prepare(
								"SELECT 1 FROM software_offers WHERE id=? AND reused_msa_id=?",
							)
							.bind(signing.offer_id, id)
							.first(),
					))) ||
			(studioIdentity?.email === agreement.recipient_email &&
				(projectAgreement?.agreement_id === id || linked?.msa_id === id));

		if (!allowed) return notFound();
	}

	const artifact = await db
		.prepare(
			"SELECT * FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'",
		)
		.bind(id)
		.first<AgreementArtifact>();

	if (!artifact?.pdf_key)
		return new Response(
			"Signed by both parties. Copy preparation needs attention.",
			{
				status: 409,
				headers: agreementHeaders,
			},
		);
	const object = await env.AUDIO.get(artifact.pdf_key);

	if (!object)
		return new Response("Signed copy unavailable. Contact Kazon.", {
			status: 503,
			headers: agreementHeaders,
		});
	const bytes = await object.arrayBuffer();

	if (!artifact.pdf_sha256 || (await hashBytes(bytes)) !== artifact.pdf_sha256)
		return new Response(
			"Signed copy failed its integrity check. Contact Kazon.",
			{
				status: 503,
				headers: agreementHeaders,
			},
		);

	return new Response(bytes, {
		headers: {
			...agreementHeaders,
			"content-type": "application/pdf",
			"content-disposition": 'attachment; filename="signed-agreement.pdf"',
			"x-content-type-options": "nosniff",
		},
	});
}
