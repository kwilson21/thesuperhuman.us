import { POST } from "~/pages/api/owner/projects/[id]/access";
import { POST as invite } from "~/pages/api/owner/projects/[id]/invitation";
import { POST as updates } from "~/pages/api/owner/projects/[id]/updates";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Step,
} from "./harness";
import {
	atStage,
	BODIES,
	EARLIER,
	rawStep,
	resendOk,
	routeStep,
	service,
	session,
	sql,
	STAGES,
	world,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/access: the owner closes a client's access to a project
// ({action:"revoke"}). revokeProjectAccess (src/lib/audio-project-revocation.ts) runs one batch: it stamps the project
// revoked (with a revocation id), revokes every unrevoked session of the request's email, deletes that email's sign-in
// code, and writes the audit row. Sessions and codes belong to the email, not to the project, so a client's other
// projects lose their sessions too (cases "another project of the same email").
//
// Response branches, and the cases that reach them (names start with the topic):
//
//   403 {ok:false}                      "not the owner": visitor, signed-in studio client
//   404 "Not found"                     "portal flag": off, "True", unset, flag off wins over no database
//   503 "Project access ..."           "unavailable": no MUSIC_DB, no id param, empty id param (no ctx is not needed)
//   musicRequest (1024 byte cap)        "origin" 403, "content type" 415, "no request body" 400, "body over 1024 bytes" 413
//                                       (one of exactly 1024 reaches the schema), "invalid JSON" 400
//   400 {ok:false}                      "schema": non-objects, action missing/unknown/wrong case/not text
//   200 {ok:true}                       "revoke": every project stage, a withdrawn or resolved request, sessions and codes of
//                                       the email (revoked, kept if already revoked, other emails untouched), extra fields
//                                       ignored, mixed-case request email, a request with no sessions
//   409 "already closed"                "revoke": already revoked, unknown id, a request that is not a service request, a
//                                       blank owner email, lost race (revoked in between)
//   503 catch                           "outage": the batch fails; "rolled back": an audit trigger aborts the batch
//   sequences                           "twice", "after": revoke then the invitation or an update is refused

const step = routeStep("access");

const TABLES = [
	"audio_projects",
	"audio_project_audit",
	"audio_client_sessions",
	"audio_client_codes",
];

const revoke = (extra: Partial<Step> = {}): Step =>
	step({ action: "revoke" }, { dump: { music: TABLES }, ...extra });

const ada = { email: "ada@example.test" };

const code = (over: { [column: string]: string | number | null } = {}) => ({
	email: "grace@example.test",
	code_hash: "code-1",
	attempts: 1,
	created_at: EARLIER,
	expires_at: "2026-11-13T12:10:00.000Z",
	...over,
});

/** A project at `stage` with one live session and one sign-in code for its client. */
const live = (stage = "in_progress", parts: Parts = {}): Partial<Case> => ({
	...world({
		project: atStage(stage),
		sessions: [session()],
		codes: [code()],
		...parts,
	}),
	fetches: resendOk,
});

const named = (name: string, base: Partial<Case>, ...steps: Step[]): Case => ({
	...base,
	name,
	steps,
});

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...live(),
	env,
	omit,
	steps: [revoke()],
});

const schema = (name: string, body: Step["json"]): Case =>
	named(`schema: ${name}`, live(), step(body, { dump: { music: TABLES } }));

const BATCH =
	/UPDATE audio_projects SET revoked_at=\?,updated_at=\?,access_revocation_id/;

const matrix: Case[] = STAGES.map((stage) =>
	named(`revoke: a project at ${stage}`, live(stage), revoke()),
);

const cases: Case[] = [
	named("not the owner: a visitor", live(), revoke({ as: asVisitor() })),
	named(
		"not the owner: a signed-in studio client",
		live(),
		revoke({ as: asClient("grace@example.test") }),
	),
	flag("portal flag: off", { AUDIO_CLIENT_PORTAL_ENABLED: "false" }),
	flag("portal flag: 'True' is not 'true'", {
		AUDIO_CLIENT_PORTAL_ENABLED: "True",
	}),
	flag("portal flag: not set", undefined, ["AUDIO_CLIENT_PORTAL_ENABLED"]),
	{
		name: "portal flag: off wins over a missing database",
		music: { missing: true },
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [revoke()],
	},
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		steps: [revoke()],
	},
	named("unavailable: no id param", live(), revoke({ params: {} })),
	named(
		"unavailable: an empty id param",
		live(),
		revoke({ params: { id: "" } }),
	),
	{
		...named(
			"unavailable: no execution context is not needed",
			live(),
			revoke(),
		),
		noContext: true,
	},
	// musicRequest
	named("origin: missing", live(), revoke({ headers: {} })),
	named(
		"origin: another site",
		live(),
		revoke({ headers: { origin: "https://example.test" } }),
	),
	named(
		"origin: the right host over http",
		live(),
		revoke({ headers: { origin: "http://thesuperhuman.us" } }),
	),
	named(
		"content type: missing",
		live(),
		rawStep("access", '{"action":"revoke"}', {
			headers: { origin: "https://thesuperhuman.us" },
		}),
	),
	named(
		"content type: text/plain",
		live(),
		rawStep("access", '{"action":"revoke"}', {
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "text/plain",
			},
		}),
	),
	named(
		"content type: a charset suffix is accepted",
		live(),
		rawStep("access", '{"action":"revoke"}', {
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json; charset=utf-8",
			},
			dump: { music: TABLES },
		}),
	),
	named("no request body", live(), {
		...rawStep("access", ""),
		body: undefined,
	}),
	named(
		"body over 1024 bytes",
		live(),
		rawStep(
			"access",
			JSON.stringify({ action: "revoke", pad: "a".repeat(1100) }),
		),
	),
	named(
		"body of exactly 1024 bytes reaches the schema and revokes",
		live(),
		rawStep(
			"access",
			JSON.stringify({
				action: "revoke",
				pad: "a".repeat(
					1024 - JSON.stringify({ action: "revoke", pad: "" }).length,
				),
			}),
			{ dump: { music: TABLES } },
		),
	),
	named("invalid JSON: bad text", live(), rawStep("access", "{not json")),
	named("invalid JSON: empty text", live(), rawStep("access", "")),
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "revoke"),
	schema("no action", {}),
	schema("an unknown action", { action: "restore" }),
	schema("action in capitals", { action: "REVOKE" }),
	schema("action that is a number", { action: 1 }),
	// revoke
	...matrix,
	named(
		"revoke: extra fields are ignored",
		live(),
		step(
			{ action: "revoke", reason: "spam", actor: "x" },
			{ dump: { music: TABLES } },
		),
	),
	named(
		"revoke: a withdrawn request",
		live("in_progress", { request: service({ status: "withdrawn" }) }),
		revoke(),
	),
	named(
		"revoke: a resolved request",
		live("in_progress", { request: service({ status: "resolved" }) }),
		revoke(),
	),
	named(
		"revoke: a new request",
		live("in_progress", { request: service({ status: "new" }) }),
		revoke(),
	),
	named(
		"revoke: a project with no session and no code",
		live("in_progress", { sessions: [], codes: [] }),
		revoke(),
	),
	named(
		"revoke: several sessions, one already revoked, one expired",
		live("in_progress", {
			sessions: [
				session({ token_hash: "a" }),
				session({ token_hash: "b", revoked_at: EARLIER }),
				session({ token_hash: "c", expires_at: "2026-11-01T00:00:00.000Z" }),
			],
		}),
		revoke(),
	),
	named(
		"revoke: another email's session and code are untouched",
		live("in_progress", {
			sessions: [
				session({ token_hash: "a" }),
				session({ token_hash: "z", email: "ada@example.test" }),
			],
			codes: [code(), code(ada)],
		}),
		revoke(),
	),
	named(
		"revoke: another project of the same email loses its sessions too",
		live("in_progress", {
			moreRequests: [
				rows.ownerRequest("r2", {
					service_id: "vocal-mix",
					status: "reviewed",
				}),
			],
		}),
		revoke(),
	),
	named(
		"revoke: a mixed-case request email does not match a lower-case session",
		live("in_progress", {
			request: service({ email: "Grace@Example.TEST" }),
		}),
		revoke(),
	),
	named(
		"revoke: a request with a blank email matches sessions and codes stored under a blank email",
		live("in_progress", {
			request: service({ email: "" }),
			sessions: [session({ email: "" })],
			codes: [code({ email: "" })],
		}),
		revoke(),
	),
	named(
		"revoke: the audit row names the owner as given",
		live(),
		revoke({ as: asOwner("Owner@Example.TEST") }),
	),
	named(
		"revoke: a blank owner email cannot revoke",
		live(),
		revoke({ as: asOwner("   ") }),
	),
	named(
		"revoke: already revoked",
		live("in_progress", {
			project: atStage("in_progress", {
				revoked_at: EARLIER,
				access_revocation_id: "rev-old",
			}),
		}),
		revoke(),
	),
	named(
		"revoke: unknown request id",
		live(),
		revoke({ params: { id: "nope" }, path: "/api/owner/projects/nope/access" }),
	),
	named(
		"revoke: a request that is not a service request has no project",
		live("in_progress", {
			request: rows.ownerRequest("r1", {
				kind: "purchase",
				status: "reviewed",
			}),
			payment: null,
			sessions: [],
			codes: [],
		}),
		revoke(),
	),
	{
		...named(
			"race: revoked by another request just before the write",
			live(),
			revoke(),
		),
		interleave: [
			{
				on: BATCH,
				label: "the project is revoked by another request",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z',access_revocation_id='other'`,
				),
			},
		],
	},
	{
		...named(
			"race: a session is created just before the write",
			live(),
			revoke(),
		),
		interleave: [
			{
				on: BATCH,
				label: "a new session is created",
				run: sql(
					`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES ('new','grace@example.test','2026-11-13T11:59:00.000Z','2026-12-30T00:00:00.000Z','2026-11-13T11:59:00.000Z')`,
				),
			},
		],
	},
	{
		...named("outage: the batch fails", live(), revoke()),
		failures: [{ on: BATCH, message: "D1 is down" }],
	},
	named(
		"rolled back: an audit trigger aborts the batch, so nothing is revoked",
		live("in_progress", {
			setup: (w) =>
				w.music.exec(
					`CREATE TRIGGER golden_audit_locked BEFORE INSERT ON audio_project_audit BEGIN SELECT RAISE(ABORT,'audit locked'); END`,
				),
		}),
		revoke(),
	),
	// sequences
	named(
		"twice: revoke, then revoke again",
		live(),
		revoke(),
		revoke({ advanceMs: 1000 }),
	),
	{
		...named(
			"after: the invitation cannot be sent to a revoked project",
			live("in_progress", {
				project: atStage("in_progress", { invitation_status: "failed" }),
			}),
			revoke(),
			{
				...routeStep("invitation")(
					{ action: "send" },
					{ dump: { music: TABLES }, advanceMs: 1000 },
				),
				handler: invite,
			},
		),
	},
	{
		...named(
			"after: an update cannot be saved on a revoked project",
			live(),
			revoke(),
			{
				...routeStep("updates")(BODIES.progress, {
					dump: { music: TABLES },
					advanceMs: 1000,
				}),
				handler: updates,
			},
		),
		omit: ["RESEND_API_KEY"],
	},
	{
		...named(
			"outage then repeat: the first revoke fails, the second closes access",
			live(),
			revoke(),
			revoke({ advanceMs: 1000 }),
		),
		failures: [{ on: BATCH, message: "D1 is down" }],
	},
];

defineCorpus("owner-project-access", POST, cases);
