import { hashValue } from "./client-portal";

export type ProjectFile = {
	id: string;
	request_id: string;
	version: "review" | "final";
	object_key: string;
	display_name: string;
	media_type: "audio/mpeg" | "audio/wav";
	byte_size: number;
	downloadable: number;
	published_at: string;
	expires_at: string | null;
	peaks: string | null;
};

const fileColumns =
	"f.id,f.request_id,f.version,f.object_key,f.display_name,f.media_type,f.byte_size,f.downloadable,f.published_at,f.expires_at,f.peaks";

const clientFileScope = `FROM audio_project_files f
  JOIN audio_projects p ON p.request_id=f.request_id
  JOIN owner_requests r ON r.id=p.request_id
  JOIN audio_client_sessions s ON s.email=r.email
  LEFT JOIN audio_payments pay ON pay.request_id=p.request_id
  WHERE f.request_id=? AND f.status='published' AND f.published_at IS NOT NULL AND f.published_at<=? AND f.revoked_at IS NULL
    AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
    AND (f.expires_at IS NULL OR f.expires_at>?)
    AND ((f.version='review' AND p.stage IN ('review_ready','revision_in_progress') AND pay.booking_status='paid')
      OR (f.version='final' AND f.expires_at IS NOT NULL AND p.stage IN ('final_files_ready','complete')
        AND pay.booking_status='paid' AND pay.balance_status='paid'))`;

export function privateProjectObjectKey(
	requestId: string,
	fileId: string,
	mediaType: ProjectFile["media_type"],
): string | null {
	if (
		!/^[a-z0-9-]{1,100}$/.test(requestId) ||
		!/^[a-z0-9-]{1,100}$/.test(fileId)
	)
		return null;

	return `studio/projects/${requestId}/${fileId}.${mediaType === "audio/mpeg" ? "mp3" : "wav"}`;
}

function fileAvailable(
	file: ProjectFile,
	requestId: string,
	now: Date,
): boolean {
	if (
		file.object_key !==
		privateProjectObjectKey(requestId, file.id, file.media_type)
	)
		return false;

	if (file.version !== "final") return true;
	const delivered = new Date(file.published_at);

	if (Number.isNaN(delivered.valueOf())) return false;
	delivered.setUTCFullYear(delivered.getUTCFullYear() + 1);

	return now < delivered;
}

export async function clientProjectFiles(
	db: D1Database,
	requestId: string,
	token: string,
	now = new Date(),
): Promise<ProjectFile[]> {
	const tokenHash = await hashValue(token);
	const at = now.toISOString();

	const result = await db
		.prepare(
			`SELECT ${fileColumns} ${clientFileScope} ORDER BY f.published_at DESC`,
		)
		.bind(requestId, at, tokenHash, at, at)
		.all<ProjectFile>();

	return result.results.filter((file) => fileAvailable(file, requestId, now));
}
