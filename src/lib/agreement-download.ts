import { agreementHeaders } from "./agreement-host";
import { hashBytes } from "./agreement-artifacts";
import type { AgreementArtifact } from "./agreement-artifacts";

/** Logs a failure on the site's side once, before its 500. The route passes `logUnexpected` with its label. */
export type DownloadFailures = {
	readonly unexpected: <Failure>(failure: Failure) => void;
};

/**
 * The owner's download of an executed agreement's signed copy. The visitor's download (an archive, signing or studio
 * session) is the flow in src/server/flows/agreement-download.ts; this is the owner route's, which is the owner area's
 * and keeps its statements. A failed read, and a ready copy whose object is gone, are logged once and answer 500 "Signed
 * copy unavailable. Contact Kazon." (behaviour fixes B2 and B8 of docs/plans/2026-11-signing-conversion.md; the owner
 * already knows the row exists, so a missing object is an unexpected store state, not the visitor's 404: judgment call
 * J1).
 */
export async function agreementDownload(
	env: Env,
	id: string,
	failures: DownloadFailures,
) {
	const db = env.MUSIC_DB;

	if (!db || !env.AUDIO)
		return new Response("Unavailable", {
			status: 503,
			headers: agreementHeaders,
		});

	const notFound = () =>
		new Response("Not found", { status: 404, headers: agreementHeaders });

	const unavailable = <Failure>(failure: Failure) => {
		failures.unexpected(failure);

		return new Response("Signed copy unavailable. Contact Kazon.", {
			status: 500,
			headers: agreementHeaders,
		});
	};

	let digest: string | null, bytes: ArrayBuffer;

	try {
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
			return unavailable(new Error("The ready copy's object is missing."));

		digest = artifact.pdf_sha256;
		bytes = await object.arrayBuffer();
	} catch (error) {
		return unavailable(error);
	}

	if (!digest || (await hashBytes(bytes)) !== digest)
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
