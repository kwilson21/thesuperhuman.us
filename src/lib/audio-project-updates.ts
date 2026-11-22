export type ProjectUpdate = {
	id: number;
	request_id: string;
	kind: "accepted" | "progress" | "work_started" | "date_changed";
	body: string;
	reason: "protect_song" | "client_clarification" | "schedule_conflict" | null;
	previous_due_at: string | null;
	new_due_at: string | null;
	actor: string;
	created_at: string;
	notification_status: "pending" | "sending" | "sent" | "failed";
	notification_attempted_at: string | null;
	file_id: string | null;
	milestone: "revision_started" | "completed" | null;
	file_version?: "review" | "final" | null;
};

const columns = `id,request_id,kind,body,reason,previous_due_at,new_due_at,actor,created_at,notification_status,notification_attempted_at,file_id,milestone`;

export async function listProjectUpdates(
	db: D1Database,
	requestId: string,
): Promise<ProjectUpdate[]> {
	const result = await db
		.prepare(`SELECT ${columns},(SELECT version FROM audio_project_files WHERE id=file_id) AS file_version
    FROM audio_project_updates WHERE request_id=? ORDER BY id`)
		.bind(requestId)
		.all<ProjectUpdate>();

	return result.results;
}

const firstUpdates = {
	mixing:
		"Thanks for sending this. I’m setting up the session and building a solid static mix first, then shaping it from there. You’ll see an update here when there’s something to hear.",
	mastering:
		"Thanks for sending this. I’m setting up the session and listening through your mix first, then shaping the master from there. You’ll see an update here when there’s something to hear.",
	custom:
		"Thanks for sending this. I’m setting up the session and starting on the plan we agreed. You’ll see an update here when there’s something to hear.",
};

/** The Accept form's starting first update for a service. The owner edits it before sending. */
export function defaultFirstUpdate(
	serviceId: string | null | undefined,
): string {
	return serviceId === "mastering"
		? firstUpdates.mastering
		: serviceId === "vocal-mix" || serviceId === "bundle"
			? firstUpdates.mixing
			: firstUpdates.custom;
}
