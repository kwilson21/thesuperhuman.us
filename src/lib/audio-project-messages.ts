import type { RawValue } from "./fields";
import { nonHttpsLinkText } from "./link-check";
import { isText } from "./type-guards";

export type ProjectMessage = {
	id: number;
	actor: "owner" | "client";
	body: string;
	created_at: string;
	read_at: string | null;
	/** Set when a client message answers a published review. */
	review_decision: ReviewDecision | null;
};

export type ReviewDecision = "approved" | "changes" | "stopped";

/** Revision rounds included with every project, bundle and custom quotes too, as the services page states. */
export const REVISION_ROUNDS = 2;

const messageColumns = "id,actor,body,created_at,read_at,review_decision";

/** `value` is the message text from a request body; only text is read. */
export function validateProjectMessage(value: RawValue): string | null {
	if (!isText(value)) return null;
	const body = value.trim();

	if (
		!body ||
		body.length > 4000 ||
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)
	)
		return null;

	if (nonHttpsLinkText(body)) return null;

	for (const match of body.matchAll(
		/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/gi,
	)) {
		if (!match[0].toLowerCase().startsWith("https://")) return null;

		try {
			const url = new URL(match[0].replace(/[.,!?;:)\]]+$/, ""));

			if (
				url.protocol !== "https:" ||
				!url.hostname ||
				url.username ||
				url.password
			)
				return null;
		} catch {
			return null;
		}
	}

	return body;
}

export async function listProjectMessages(
	db: D1Database,
	requestId: string,
): Promise<ProjectMessage[]> {
	const result = await db
		.prepare(
			`SELECT ${messageColumns} FROM audio_project_messages WHERE request_id=? ORDER BY id`,
		)
		.bind(requestId)
		.all<ProjectMessage>();

	return result.results;
}

/** SQL: revision rounds begun on this project, for a statement that reads or guards on them. */
export function roundsUsed(requestId: string) {
	return `(SELECT count(*) FROM audio_project_updates u WHERE u.request_id=${requestId} AND u.milestone='revision_started')`;
}

/** Revision rounds the client has left to request. */
export async function revisionRoundsLeft(
	db: D1Database,
	requestId: string,
): Promise<number> {
	const row = await db
		.prepare(`SELECT ${roundsUsed("?")} AS used`)
		.bind(requestId)
		.first<{ used: number }>();

	return Math.max(0, REVISION_ROUNDS - Number(row?.used ?? 0));
}

/** The client's decision on the latest published review, or null while it awaits one. */
export async function latestReviewDecision(
	db: D1Database,
	requestId: string,
): Promise<ReviewDecision | null> {
	const row = await db
		.prepare(`SELECT m.review_decision FROM audio_project_messages m
    WHERE m.request_id=? AND m.review_decision IS NOT NULL AND m.created_at>=(SELECT MAX(f.published_at)
      FROM audio_project_files f WHERE f.request_id=m.request_id AND f.version='review' AND f.status='published')
    ORDER BY m.id DESC LIMIT 1`)
		.bind(requestId)
		.first<{ review_decision: ReviewDecision }>();

	return row?.review_decision ?? null;
}
