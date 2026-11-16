// Seed builders shared by the three studio message corpora (audio project messages, software project messages and
// software review decisions). Times sit on the frozen clock's day (2026-11-13T12:00:00.000Z).
import { createHash } from "node:crypto";
import type { OfferTerms } from "~/lib/software-offers";
import { rows, type SeedRow, type World } from "../harness";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const ORIGIN = "https://thesuperhuman.us";
export const GRACE = "grace@example.test";
export const ADA = "ada@example.test";
export const OWNER = "owner@example.test";

// A studio_session value is two UUIDs, 72 characters of hex and hyphens. Each has letters so a capitalised copy hashes
// differently.
export const GRACE_TOKEN =
	"abcdef01-2345-4678-89ab-cdef01234567abcdef02-2345-4678-89ab-cdef01234567";

export const ADA_TOKEN =
	"abcdef03-2345-4678-89ab-cdef01234567abcdef04-2345-4678-89ab-cdef01234567";

export const OTHER_TOKEN =
	"abcdef05-2345-4678-89ab-cdef01234567abcdef06-2345-4678-89ab-cdef01234567";

export const hashOf = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export const session = (
	token: string,
	email: string,
	over: SeedRow = {},
): SeedRow => ({
	token_hash: hashOf(token),
	email,
	created_at: EARLIER,
	expires_at: "2026-12-01T00:00:00.000Z",
	last_seen_at: EARLIER,
	...over,
});

/** Grace's and Ada's signed-in sessions. */
export const sessions = () => [
	session(GRACE_TOKEN, GRACE),
	session(ADA_TOKEN, ADA),
];

/** A message row. The id is left to the table unless a case needs to name it. */
export const message = (
	requestId: string,
	actor: "owner" | "client",
	over: SeedRow = {},
): SeedRow => ({
	request_id: requestId,
	actor,
	actor_id: actor === "owner" ? OWNER : hashOf(GRACE_TOKEN),
	body: actor === "owner" ? "Mix is up." : "Thanks!",
	created_at: EARLIER,
	...over,
});

/** `count` client messages, the first `agoMs` before now and each a millisecond after the one before. */
export const clientMessages = (
	requestId: string,
	count: number,
	agoMs = 60_000,
): SeedRow[] =>
	Array.from({ length: count }, (_, index) =>
		message(requestId, "client", {
			body: `earlier ${index + 1}`,
			created_at: new Date(Date.parse(NOW) - agoMs + index).toISOString(),
		}),
	);

// ---------------------------------------------------------------- audio

/** A service request; its project row is created by the database trigger, with stage files_under_review. */
export const audioRequest = (id: string, over: SeedRow = {}): SeedRow =>
	rows.ownerRequest(id, { kind: "service", ...over });

/** Sets the project row's stage and revocation, which the trigger created. Use as a case `setup`. */
export const audioProjectState =
	(states: {
		[requestId: string]: { stage?: string; revokedAt?: string | null };
	}) =>
	(world: World) => {
		for (const [requestId, state] of Object.entries(states))
			world.music
				.prepare(
					`UPDATE audio_projects SET stage=COALESCE(?,stage),revoked_at=? WHERE request_id=?`,
				)
				.run(state.stage ?? null, state.revokedAt ?? null, requestId);
	};

let fileNumber = 0;

export const audioFile = (
	id: string,
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	version: "review",
	object_key: `projects/${requestId}/${id}-${(fileNumber += 1)}`,
	display_name: "Mix.mp3",
	media_type: "audio/mpeg",
	byte_size: 1000,
	downloadable: 0,
	status: "published",
	uploaded_at: EARLIER,
	published_at: EARLIER,
	...over,
});

/** `count` revision rounds the owner has begun. */
export const revisionRounds = (requestId: string, count: number): SeedRow[] =>
	Array.from({ length: count }, (_, index) => ({
		request_id: requestId,
		kind: "progress",
		body: "Revision started",
		actor: OWNER,
		created_at: new Date(Date.parse(EARLIER) + index * 1000).toISOString(),
		milestone: "revision_started",
	}));

/** The seed for one service request, Grace's and Ada's sessions and a published review file. */
export const audioSeed = (
	extra: { [table: string]: SeedRow[] } = {},
	request: SeedRow = {},
) => ({
	owner_requests: [audioRequest("r1", request)],
	audio_client_sessions: sessions(),
	audio_project_files: [audioFile("f1", "r1")],
	...extra,
});

export const AUDIO_TABLES = [
	"audio_projects",
	"audio_project_messages",
	"audio_project_audit",
];

// ------------------------------------------------------------- software

export const terms = (over: Partial<OfferTerms> = {}) =>
	JSON.stringify({
		outcome: "A scheduling tool",
		summary: "Builds a tool that schedules rehearsals.",
		milestones: [
			{
				name: "First",
				deliverables: ["Prototype", "Docs", "Deployment"],
				acceptance: ["Runs locally", "Has tests", "Is documented"],
				feeCents: 100_000,
			},
			{
				name: "Second",
				deliverables: ["Release"],
				acceptance: ["Ships"],
				feeCents: 200_000,
			},
		],
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode: "standard",
		...over,
	});

export const softwareSeed = (
	extra: { [table: string]: SeedRow[] } = {},
	project: SeedRow = {},
	request: SeedRow = {},
) => ({
	owner_requests: [
		rows.softwareRequest("r1", { status: "reviewed", ...request }),
	],
	software_offers: [rows.softwareOffer("o1", "r1")],
	software_projects: [
		rows.softwareProject("r1", "o1", {
			terms_json: terms(),
			state: "building",
			...project,
		}),
	],
	audio_client_sessions: sessions(),
	...extra,
});

let updateNumber = 0;

export const softwareUpdate = (
	id: string,
	kind: "direction_review" | "delivery_review" | "progress" | "handoff",
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: "r1",
	kind,
	status: "shared",
	milestone_index: 0,
	title: `Update ${(updateNumber += 1)}`,
	artifact_version:
		kind === "direction_review" ? "Direction v1" : "Delivery v1",
	evidence_type: "prototype",
	shared_at: EARLIER,
	shared_by: OWNER,
	created_by: OWNER,
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

export const SOFTWARE_MESSAGE_TABLES = [
	"software_project_messages",
	"software_projects",
	"software_project_audit",
];
