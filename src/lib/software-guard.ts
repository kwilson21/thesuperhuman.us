// The two statements every software area adds to its batches: the guard that rolls a stale batch back, and the audit row.
// They read and write only what the caller binds, and import nothing, so an area can use them without loading
// src/lib/software-projects.ts (project mail, offers and Zod) or another area's storage.

/** Same atomic assertion as software offers: a stale write rolls back its whole batch. */
export const softwareGuard = (
	db: D1Database,
	query: string,
	values: (string | number | null)[],
) =>
	db
		.prepare(
			`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json_extract('Project changed. Reload and try again.','$') END`,
		)
		.bind(...values);

export const softwareAudit = (
	db: D1Database,
	id: string,
	action: string,
	actor: string,
	at: string,
	note = "",
) =>
	db
		.prepare(
			"INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note) VALUES (?,?,?,?,?)",
		)
		.bind(id, action, actor, at, note);
