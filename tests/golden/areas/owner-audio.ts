import type { JsonValue } from "../../helpers/json";
// Shared builders for the owner audio-project corpora (updates, invitation, files/[fileId], uploads, access,
// messages). A service owner request fires a trigger that creates its audio_projects row, so that table cannot be
// seeded for it: `world()` seeds everything else and then moves the project to the state a case needs with a `setup`
// UPDATE (off the record). Every step carries the Origin header the routes' musicRequest check wants.
import type { SQLInputValue } from "node:sqlite";
import {
	asOwner,
	byHost,
	json,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const DUE = "2026-12-01";
export const LATER = "2026-12-15";
export const SITE = "https://thesuperhuman.us";

/** The Origin header musicRequest requires. */
export const ORIGIN_HEADER = { origin: SITE };

/** Origin plus the JSON content type, for a raw `body:` step (a `json:` step already sets the content type). */
export const RAW_HEADERS = {
	origin: SITE,
	"content-type": "application/json",
};

/** Resend accepts every email. The default for a case that is not about email. */
export const resendOk = byHost({ resend: json(200, { id: "em_golden" }) });

/** The tables a project-stage case usually dumps. */
export const PROJECT_TABLES = [
	"audio_projects",
	"audio_project_audit",
	"audio_project_updates",
];

export const FILE_TABLES = [
	"audio_projects",
	"audio_project_audit",
	"audio_project_files",
	"audio_project_updates",
];

export const UPLOAD_TABLES = [
	"audio_project_uploads",
	"audio_project_files",
	"audio_projects",
];

/** A step builder for one route of project `requestId`: `route` is "updates", or "files" with a file id. */
export function routeStep(route: string, fileId?: string, requestId = "r1") {
	const params =
		fileId === undefined ? { id: requestId } : { id: requestId, fileId };

	const path = `/api/owner/projects/${requestId}/${route}${fileId === undefined ? "" : `/${fileId}`}`;

	return (body: JsonValue | undefined, extra: Partial<Step> = {}): Step => ({
		as: asOwner(),
		path,
		params,
		json: body,
		headers: ORIGIN_HEADER,
		...extra,
	});
}

/** A raw-text step (malformed JSON and the like) with the JSON content type and Origin set. */
export function rawStep(
	route: string,
	text: string,
	extra: Partial<Step> = {},
	fileId?: string,
): Step {
	return {
		...routeStep(route, fileId)(undefined),
		json: undefined,
		body: text,
		headers: RAW_HEADERS,
		...extra,
	};
}

/** A service owner request for the project. Status `reviewed` by default (the owner has accepted the fit). */
export const service = (over: SeedRow = {}): SeedRow =>
	rows.ownerRequest("r1", {
		service_id: "vocal-mix",
		status: "reviewed",
		...over,
	});

/** The booking and the balance both paid by default. */
export const payment = (over: SeedRow = {}): SeedRow => ({
	request_id: "r1",
	approved_service: "vocal-mix",
	total_amount_cents: 20_000,
	currency: "usd",
	booking_amount_cents: 10_000,
	balance_amount_cents: 10_000,
	offer_accepted_at: EARLIER,
	booking_status: "paid",
	balance_status: "paid",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

/** The object key a file or upload uses in R2. */
export const keyOf = (fileId: string, ext = "mp3", requestId = "r1") =>
	`studio/projects/${requestId}/${fileId}.${ext}`;

/** An uploaded (draft) project file. Twelve bytes, review version, mp3. */
export const file = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	request_id: "r1",
	version: "review",
	object_key: keyOf(id),
	display_name: "Mix v1",
	media_type: "audio/mpeg",
	byte_size: 12,
	downloadable: 0,
	status: "uploaded",
	uploaded_at: EARLIER,
	...over,
});

/** A published project file. */
export const published = (id: string, over: SeedRow = {}): SeedRow =>
	file(id, {
		status: "published",
		published_at: EARLIER,
		publication_id: `pub-${id}`,
		...over,
	});

export const upload = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	request_id: "r1",
	upload_id: "upload-1",
	object_key: keyOf(id),
	version: "review",
	display_name: "Mix v1",
	media_type: "audio/mpeg",
	byte_size: 12,
	state: "pending",
	created_at: EARLIER,
	...over,
});

/** A row of the client timeline. `id` is the integer key. */
export const update = (id: number, over: SeedRow = {}): SeedRow => ({
	id,
	request_id: "r1",
	kind: "progress",
	body: "An earlier note",
	actor: "owner@example.test",
	created_at: EARLIER,
	notification_status: "pending",
	...over,
});

export const message = (over: SeedRow = {}): SeedRow => ({
	request_id: "r1",
	actor: "client",
	actor_id: "grace@example.test",
	body: "Hello",
	created_at: EARLIER,
	...over,
});

export const session = (over: SeedRow = {}): SeedRow => ({
	token_hash: "tok-1",
	email: "grace@example.test",
	created_at: EARLIER,
	expires_at: "2026-12-30T00:00:00.000Z",
	last_seen_at: EARLIER,
	...over,
});

/** The columns of audio_projects for a stage: due dates from `accepted` on, a completion time at `complete`. */
export function atStage(stage: string, over: SeedRow = {}): SeedRow {
	const columns: SeedRow = { stage };

	if (stage !== "files_under_review") {
		columns.original_due_at = DUE;
		columns.current_due_at = DUE;
	}

	if (stage === "complete") columns.completed_at = EARLIER;

	return { ...columns, ...over };
}

export type Parts = {
	/** The owner request. Default: `service()`. `null` seeds none. */
	readonly request?: SeedRow | null;
	/** Further owner requests, seeded after the first (for a second project on one email). */
	readonly moreRequests?: readonly SeedRow[];
	/** The payment. Default: both installments paid. `null` seeds none. */
	readonly payment?: SeedRow | null;
	/** Columns to set on the project row the trigger made. */
	readonly project?: SeedRow;
	readonly files?: readonly SeedRow[];
	readonly uploads?: readonly SeedRow[];
	readonly updates?: readonly SeedRow[];
	readonly messages?: readonly SeedRow[];
	readonly sessions?: readonly SeedRow[];
	readonly codes?: readonly SeedRow[];
	/** Runs after the project UPDATE, off the record. */
	readonly setup?: (world: World) => void;
};

function set(world: World, requestId: string, columns: SeedRow) {
	const names = Object.keys(columns);

	if (names.length === 0) return;

	const values: SQLInputValue[] = Object.values(columns);

	world.music
		.prepare(
			`UPDATE audio_projects SET ${names.map((name) => `${name}=?`).join(",")} WHERE request_id=?`,
		)
		.run(...values, requestId);
}

/** The database and setup of a case: the request, its payment, the project in its state, and what hangs off it. */
export function world(parts: Parts = {}): Pick<Case, "music" | "setup"> {
	const seed: { [table: string]: readonly SeedRow[] } = {};
	const request = parts.request === undefined ? service() : parts.request;
	const pay = parts.payment === undefined ? payment() : parts.payment;

	if (request) seed.owner_requests = [request, ...(parts.moreRequests ?? [])];

	if (pay && request) seed.audio_payments = [pay];

	if (parts.files?.length) seed.audio_project_files = parts.files;

	if (parts.uploads?.length) seed.audio_project_uploads = parts.uploads;

	if (parts.updates?.length) seed.audio_project_updates = parts.updates;

	if (parts.messages?.length) seed.audio_project_messages = parts.messages;

	if (parts.sessions?.length) seed.audio_client_sessions = parts.sessions;

	if (parts.codes?.length) seed.audio_client_signin_codes = parts.codes;

	const requestId = String(request?.id ?? "r1");
	const full: Seed = seed;

	return {
		music: { seed: full },
		setup: (world) => {
			set(world, requestId, parts.project ?? {});
			parts.setup?.(world);
		},
	};
}

// Shared by the updates and update-notices corpora (POST /api/owner/projects/[id]/updates).

export const NOTE = "Your vocals are tracked and I am starting the mix.";

/** One valid body per action. */
export const BODIES = {
	accept: { action: "accept", dueDate: LATER, body: NOTE },
	progress: { action: "progress", body: NOTE },
	start_work: { action: "start_work", body: NOTE },
	begin_revision: { action: "begin_revision", body: NOTE },
	complete: { action: "complete", body: NOTE },
	revise_date: {
		action: "revise_date",
		dueDate: "2026-12-20",
		reason: "protect_song",
		body: NOTE,
	},
} as const;

export const STAGES = [
	"files_under_review",
	"accepted",
	"in_progress",
	"review_ready",
	"revision_in_progress",
	"final_files_ready",
	"complete",
] as const;

/** A project at `stage`, reviewed, fully paid, with a published review and a published final, Resend accepting mail. */
export const at = (stage: string, over: Parts = {}): Partial<Case> => ({
	...world({
		project: atStage(stage),
		files: [
			published("fr"),
			published("ff", {
				version: "final",
				expires_at: "2027-11-13T11:00:00.000Z",
			}),
		],
		...over,
	}),
	fetches: resendOk,
});

const updates = routeStep("updates");

/** A request to the updates route, with the project tables dumped after it. */
export const act = (
	body: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => updates(body, { dump: { music: PROJECT_TABLES }, ...extra });

export const retry = (
	updateId: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => act({ action: "retry_email", updateId }, extra);

export const confirmed = (updateId: number, confirmedNotSent: boolean | null) =>
	act({ action: "retry_email", updateId, confirmedNotSent });

/** Raw SQL for an interleave: runs on the database just before the statement it is tied to. */
export const sql =
	(statement: string) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(statement);

export const withProject = (columns: string) =>
	sql(`UPDATE audio_projects SET ${columns} WHERE request_id='r1'`);
