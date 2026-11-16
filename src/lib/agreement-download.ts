import { agreementHeaders } from "./agreement-host";
import { hashBytes } from "./agreement-artifacts";
import type { AgreementArtifact } from "./agreement-artifacts";

/**
 * The owner's download of an executed agreement's signed copy. The visitor's download (an archive, signing or studio
 * session) is the flow in src/server/flows/agreement-download.ts; this is the owner route's, which is the owner area's
 * and keeps its statements.
 */
export async function agreementDownload(env: Env, id: string) {
	const db = env.MUSIC_DB;

	if (!db || !env.AUDIO)
		return new Response("Unavailable", {
			status: 503,
			headers: agreementHeaders,
		});

	const notFound = () =>
		new Response("Not found", { status: 404, headers: agreementHeaders });

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
