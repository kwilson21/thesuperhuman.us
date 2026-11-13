import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/project";
import { POST as clientMessages } from "~/pages/api/studio/software/[id]/messages";
import {
	asClient,
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	BASE,
	EARLIER,
	ORIGIN,
	owner,
	resendOk,
	running,
	stateBody,
	update,
} from "./areas/software-projects";

// The golden corpus for the "notice" and "revoke" actions of POST /api/owner/requests/[id]/project: the owner (re)sends
// the client the project-started email or an update email, and closes the client's access. Stateful: a notice is claimed,
// sent and recorded in three steps, and an uncertain send is held until the owner checks Resend.
//
// Every response branch of both actions and of deliverSoftwareNotice, queueSoftwareNotice and softwareAccessRevocation
// (src/lib/software-projects.ts), and the cases that reach each:
//
//   shared with the other project files: 403 visitor and signed-in client, 404 portal flag, 503 no database, musicRequest
//   (see owner-request-project-start), 400 the schema; here also updateId not text, confirmedNotSent not a boolean
//   404 {ok:false}                no project for the id
//   notice, the project invitation (no updateId, or updateId "")
//   200 {ok:true}                 queued from pending, failed, and sending when confirmed and attempted at least 60 seconds
//                                 ago (exactly 60 included), then sent: sent, refused 4xx (failed), 5xx and network down
//                                 (uncertain: left sending), no key or sender (failed), recipient lookup throws (failed); a
//                                 blank request email (queued, nothing sent, still 200, left pending); the project
//                                 revoked or the request withdrawn between queue and claim
//   409 "Check Resend"            status sent; sending without confirmation, inside 60 seconds, or with no attempt time;
//                                 revoked project; withdrawn request; a resolved request is allowed
//   notice, one update (updateId)
//   the same, for a shared update with email_client on and notification pending, failed or sending; subjects and bodies
//   for progress, direction review, delivery review and handoff; 409 for a draft or superseded update, email_client off,
//   not_requested, sent, an unknown id, another project's update
//   409 generic "could not be saved"   the queue throws, the claim throws (the status stays pending), the final write
//                                 throws (the email went out and the status stays sending), the project lookup throws once
//   handler rejects               the project lookup throws twice
//   revoke
//   200 {ok:true}                 closes every session of the client email, deletes the sign-in code, audits access-revoked,
//                                 on each project state including complete, on a resolved request; a session for another
//                                 email, and a session already revoked are left as they were. A mixed-case session and a
//                                 request email in capitals are seeded by hand (the app stores both lower-cased, so neither can
//                                 arise through it) only to pin that the SQL compares the email exactly
//   409 generic                   already revoked (a repeat), content deleted, withdrawn request, blank email, the batch throws,
//                                 a race that revokes first
//   400 schema                    confirmed missing, false or text
//
// Multi-step: notice twice; a 500, an unconfirmed retry, a confirmed retry after 61 seconds; revoke then a client message
// (the real client route, signed in) and a second revoke; update then invitation notices; notice after revoke.

const TABLES = [
	"owner_request_audit",
	"software_projects",
	"software_project_audit",
	"software_project_updates",
	"audio_client_sessions",
	"audio_client_codes",
];

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { dump: { music: TABLES }, ...extra });

const notice = (updateId?: JsonValue, confirmedNotSent?: JsonValue) => ({
	action: "notice",
	updateId,
	confirmedNotSent,
});

const REVOKE = { action: "revoke", confirmed: true };

const go = (
	name: string,
	body: JsonValue | undefined,
	seed: Seed = running(),
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	fetches: resendOk,
	steps: [act(body, step)],
	...extra,
});

/** A project whose invitation is in the given status, attempted at the given time. */
const invite = (
	status: string,
	attempted: string | null = null,
	over: { request?: SeedRow; project?: SeedRow } = {},
) =>
	running({
		request: over.request,
		project: {
			invitation_status: status,
			invitation_attempted_at: attempted,
			...over.project,
		},
	});

/** A project with one update "u1". */
const withUpdate = (over: SeedRow = {}, extra: SeedRow[] = []) =>
	running({
		extra: {
			software_project_updates: [
				update("u1", {
					kind: "progress",
					email_client: 1,
					notification_status: "pending",
					...over,
				}),
				...extra,
			],
		},
	});

const ago = (seconds: number) =>
	new Date(
		Date.parse("2026-11-13T12:00:00.000Z") - seconds * 1000,
	).toISOString();

const QUEUE = /SET invitation_status='pending'/;
const CLAIM = /SET invitation_status='sending'/;
const FINAL = /SET invitation_status=\?/;
const UQUEUE = /SET notification_status='pending'/;
const UCLAIM = /SET notification_status='sending'/;
const UFINAL = /SET notification_status=\?/;

const LOOKUP = /SELECT \* FROM software_projects WHERE request_id=\?/;

const RECIPIENT =
	/SELECT r\.email FROM owner_requests r JOIN software_projects p/;

const session = (
	token: string,
	email: string,
	revoked: string | null = null,
): SeedRow => ({
	token_hash: token,
	email,
	created_at: EARLIER,
	expires_at: "2026-12-01T00:00:00.000Z",
	last_seen_at: EARLIER,
	revoked_at: revoked,
});

const code = (email: string, hash: string): SeedRow => ({
	email,
	code_hash: hash,
	created_at: EARLIER,
	expires_at: "2026-12-01T00:00:00.000Z",
});

// Session s5 has a mixed-case email. The app lower-cases a session email when it stores it, so s5 cannot arise through the
// app; it is seeded by hand to pin that the revoke compares the email exactly and leaves s5 open.
const sessions = {
	audio_client_sessions: [
		session("s1", "grace@example.test"),
		session("s2", "grace@example.test"),
		session("s3", "grace@example.test", "2026-11-12T00:00:00.000Z"),
		session("s4", "ada@example.test"),
		session("s5", "Grace@Example.TEST"),
	],
	audio_client_codes: [
		code("grace@example.test", "c1"),
		code("ada@example.test", "c2"),
	],
};

const withSessions = (over: Parameters<typeof running>[0] = {}) =>
	running({ ...over, extra: { ...over.extra, ...sessions } });

const cases: Case[] = [
	// who and where
	go("a visitor sends a notice", notice(), running(), {}, { as: asVisitor() }),
	{
		name: "a signed-in client sends a notice",
		music: { seed: running() },
		fetches: resendOk,
		steps: [act(notice(), { as: asClient("grace@example.test") })],
	},
	go("a visitor revokes", REVOKE, running(), {}, { as: asVisitor() }),
	go("the portal flag is false for a notice", notice(), running(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	go("the portal flag is false for a revoke", REVOKE, running(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	{
		name: "no database binding for a notice",
		music: { missing: true },
		steps: [act(notice())],
	},
	{
		name: "no database binding for a revoke",
		music: { missing: true },
		steps: [act(REVOKE)],
	},
	go("no project for a notice", notice(), {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go("no project for a revoke", REVOKE, {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go(
		"a notice for an unknown request id",
		notice(),
		running(),
		{},
		{ path: `${BASE}/nope/project`, params: { id: "nope" } },
	),
	// schema
	go("an updateId that is not text", notice(5)),
	go("an updateId that is null", notice(null)),
	go("confirmedNotSent that is not a boolean", notice(undefined, "yes")),
	go("confirmedNotSent as a number", notice(undefined, 1)),
	go("a revoke with confirmed false", { action: "revoke", confirmed: false }),
	go("a revoke with confirmed missing", { action: "revoke" }),
	go("a revoke with confirmed as text", {
		action: "revoke",
		confirmed: "true",
	}),
	go("a notice with extra fields", { action: "notice", extra: [1] }),
	// the project invitation
	go("an invitation that is pending is sent", notice(), invite("pending")),
	go(
		"an invitation that failed is sent again",
		notice(),
		invite("failed", ago(600)),
	),
	go(
		"an invitation already sent is refused",
		notice(),
		invite("sent", ago(600)),
	),
	go(
		"an invitation stuck sending is refused",
		notice(),
		invite("sending", ago(600)),
	),
	go(
		"a sending invitation confirmed but attempted 30 seconds ago",
		notice(undefined, true),
		invite("sending", ago(30)),
	),
	go(
		"a sending invitation confirmed and attempted 59 seconds ago",
		notice(undefined, true),
		invite("sending", ago(59)),
	),
	go(
		"a sending invitation confirmed and attempted exactly 60 seconds ago",
		notice(undefined, true),
		invite("sending", ago(60)),
	),
	go(
		"a sending invitation confirmed and attempted 61 seconds ago",
		notice(undefined, true),
		invite("sending", ago(61)),
	),
	go(
		"a sending invitation confirmed with no attempt time",
		notice(undefined, true),
		invite("sending", null),
	),
	go(
		"a sending invitation confirmed false",
		notice(undefined, false),
		invite("sending", ago(600)),
	),
	go(
		"confirmedNotSent on a pending invitation changes nothing",
		notice(undefined, true),
		invite("pending"),
	),
	go("an empty updateId acts on the invitation", notice(""), invite("pending")),
	go(
		"an invitation on a resolved request",
		notice(),
		invite("pending", null, { request: { status: "resolved" } }),
	),
	go(
		"an invitation on a completed project",
		notice(),
		invite("pending", null, {
			project: { state: "complete", completed_at: EARLIER },
		}),
	),
	go(
		"an invitation on a project whose content was deleted",
		notice(),
		invite("pending", null, { project: { content_deleted_at: EARLIER } }),
	),
	go(
		"an invitation on a revoked project",
		notice(),
		invite("pending", null, { project: { revoked_at: EARLIER } }),
	),
	go(
		"an invitation on a withdrawn request",
		notice(),
		invite("pending", null, { request: { status: "withdrawn" } }),
	),
	go(
		"an invitation to a blank email",
		notice(),
		invite("pending", null, { request: { email: "" } }),
	),
	go(
		"an invitation to a request email seeded in mixed case by hand (cannot arise through the app)",
		notice(),
		invite("pending", null, { request: { email: "Grace@Example.TEST" } }),
	),
	go("an invitation with a siteOrigin missing", notice(), invite("pending"), {
		omit: ["SITE_ORIGIN"],
	}),
	go("an invitation refused with 422", notice(), invite("pending"), {
		fetches: byHost({ resend: json(422, {}) }),
	}),
	go("an invitation answered 500", notice(), invite("pending"), {
		fetches: byHost({ resend: json(500, {}) }),
	}),
	go("an invitation answered 429", notice(), invite("pending"), {
		fetches: byHost({ resend: json(429, {}) }),
	}),
	go("an invitation with the network down", notice(), invite("pending"), {
		fetches: byHost({ resend: networkDown() }),
	}),
	go("an invitation with no RESEND_API_KEY", notice(), invite("pending"), {
		omit: ["RESEND_API_KEY"],
	}),
	go("an invitation with no CONTACT_FROM_EMAIL", notice(), invite("pending"), {
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	go(
		"an invitation as a mixed-case owner email",
		notice(),
		invite("pending"),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	// update notices
	...(
		["progress", "direction_review", "delivery_review", "handoff"] as const
	).map((kind) =>
		go(`a ${kind} update notice`, notice("u1"), withUpdate({ kind })),
	),
	go(
		"an update notice that failed is sent again",
		notice("u1"),
		withUpdate({ notification_status: "failed" }),
	),
	go(
		"an update notice already sent",
		notice("u1"),
		withUpdate({ notification_status: "sent" }),
	),
	go(
		"an update notice never requested",
		notice("u1"),
		withUpdate({ notification_status: "not_requested" }),
	),
	go(
		"an update notice stuck sending",
		notice("u1"),
		withUpdate({
			notification_status: "sending",
			notification_attempted_at: ago(600),
		}),
	),
	go(
		"an update notice sending and confirmed after 61 seconds",
		notice("u1", true),
		withUpdate({
			notification_status: "sending",
			notification_attempted_at: ago(61),
		}),
	),
	go(
		"an update notice sending and confirmed after 30 seconds",
		notice("u1", true),
		withUpdate({
			notification_status: "sending",
			notification_attempted_at: ago(30),
		}),
	),
	go(
		"an update notice sending and confirmed with no attempt time",
		notice("u1", true),
		withUpdate({ notification_status: "sending" }),
	),
	go(
		"a notice for an update that is a draft",
		notice("u1"),
		withUpdate({ status: "draft", shared_at: null }),
	),
	go(
		"a notice for an update that is superseded",
		notice("u1"),
		withUpdate({ status: "superseded" }),
	),
	go(
		"a notice for an update with email_client off",
		notice("u1"),
		withUpdate({ email_client: 0 }),
	),
	go("a notice for an unknown update", notice("nope"), withUpdate()),
	go("a notice for another project's update", notice("u2"), {
		...running(),
		owner_requests: [
			rows.softwareRequest("r1", { status: "reviewed" }),
			rows.softwareRequest("r2", { status: "reviewed" }),
		],
		software_offers: [
			rows.softwareOffer("o1", "r1"),
			rows.softwareOffer("o2", "r2"),
		],
		software_projects: [
			rows.softwareProject("r1", "o1"),
			rows.softwareProject("r2", "o2"),
		],
		software_project_updates: [
			update("u2", {
				request_id: "r2",
				email_client: 1,
				notification_status: "pending",
			}),
		],
	}),
	go(
		"an update notice on a revoked project",
		notice("u1"),
		running({
			project: { revoked_at: EARLIER },
			extra: {
				software_project_updates: [
					update("u1", {
						kind: "progress",
						email_client: 1,
						notification_status: "pending",
					}),
				],
			},
		}),
	),
	go(
		"an update notice on a withdrawn request",
		notice("u1"),
		running({
			request: { status: "withdrawn" },
			extra: {
				software_project_updates: [
					update("u1", {
						kind: "progress",
						email_client: 1,
						notification_status: "pending",
					}),
				],
			},
		}),
	),
	go(
		"an update notice to a blank email",
		notice("u1"),
		running({
			request: { email: "" },
			extra: {
				software_project_updates: [
					update("u1", {
						kind: "progress",
						email_client: 1,
						notification_status: "pending",
					}),
				],
			},
		}),
	),
	go("an update notice answered 500", notice("u1"), withUpdate(), {
		fetches: byHost({ resend: json(500, {}) }),
	}),
	go("an update notice refused with 400", notice("u1"), withUpdate(), {
		fetches: byHost({ resend: json(400, {}) }),
	}),
	go("an update notice with the network down", notice("u1"), withUpdate(), {
		fetches: byHost({ resend: networkDown() }),
	}),
	go(
		"an update notice leaves the invitation alone",
		notice("u1"),
		withUpdate({}),
		{},
	),
	// outages and races
	go("the project lookup throws once", notice(), invite("pending"), {
		failures: [{ on: LOOKUP, message: "d1 down" }],
	}),
	go("the project lookup throws twice", notice(), invite("pending"), {
		failures: [
			{ on: LOOKUP, message: "d1 down" },
			{ on: LOOKUP, message: "d1 down" },
		],
	}),
	go("the invitation queue throws", notice(), invite("failed"), {
		failures: [{ on: QUEUE, message: "d1 down" }],
	}),
	go("the invitation claim throws", notice(), invite("failed"), {
		failures: [{ on: CLAIM, message: "d1 down" }],
	}),
	go("the invitation recipient lookup throws", notice(), invite("pending"), {
		failures: [{ on: RECIPIENT, message: "d1 down" }],
	}),
	go("the invitation final write throws", notice(), invite("pending"), {
		failures: [{ on: FINAL, message: "d1 down" }],
	}),
	go(
		"the update queue throws",
		notice("u1"),
		withUpdate({ notification_status: "failed" }),
		{ failures: [{ on: UQUEUE, message: "d1 down" }] },
	),
	go("the update claim throws", notice("u1"), withUpdate(), {
		failures: [{ on: UCLAIM, message: "d1 down" }],
	}),
	go("the update final write throws", notice("u1"), withUpdate(), {
		failures: [{ on: UFINAL, message: "d1 down" }],
	}),
	go(
		"access is revoked between the queue and the claim",
		notice(),
		invite("failed"),
		{
			interleave: [
				{
					on: CLAIM,
					label: "access is revoked",
					run: (sqlite) =>
						sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
				},
			],
		},
	),
	go(
		"the request is withdrawn between the claim and the recipient lookup",
		notice(),
		invite("pending"),
		{
			interleave: [
				{
					on: RECIPIENT,
					label: "the request is withdrawn",
					run: (sqlite) =>
						sqlite.exec("UPDATE owner_requests SET status='withdrawn'"),
				},
			],
		},
	),
	go(
		"another sender takes the claim before the final write",
		notice(),
		invite("pending"),
		{
			interleave: [
				{
					on: FINAL,
					label: "another sender claims it",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_projects SET invitation_attempted_at='2026-11-13T12:00:09.000Z'`,
						),
				},
			],
		},
	),
	go(
		"the update is unshared between the queue and the claim",
		notice("u1"),
		withUpdate({ notification_status: "failed" }),
		{
			interleave: [
				{
					on: UCLAIM,
					label: "the update is withdrawn",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE software_project_updates SET status='superseded'",
						),
				},
			],
		},
	),
	// revoke
	go(
		"a revoke closes the client's sessions and codes and leaves a mixed-case session seeded by hand open",
		REVOKE,
		withSessions(),
	),
	go("a revoke of a project with no sessions", REVOKE),
	go(
		"a revoke of a project that is waiting for input",
		REVOKE,
		withSessions({
			project: { state: "waiting_for_input", waiting_for: "Logo" },
		}),
	),
	go(
		"a revoke of a completed project",
		REVOKE,
		withSessions({ project: { state: "complete", completed_at: EARLIER } }),
	),
	go(
		"a revoke on a resolved request",
		REVOKE,
		withSessions({ request: { status: "resolved" } }),
	),
	go(
		"a revoke on a project already revoked",
		REVOKE,
		withSessions({ project: { revoked_at: EARLIER } }),
	),
	go(
		"a revoke on a project whose content was deleted",
		REVOKE,
		withSessions({ project: { content_deleted_at: EARLIER } }),
	),
	go(
		"a revoke on a withdrawn request",
		REVOKE,
		withSessions({ request: { status: "withdrawn" } }),
	),
	go(
		"a revoke on a request with a blank email",
		REVOKE,
		withSessions({ request: { email: "" } }),
	),
	go(
		"a revoke on a request email seeded in capitals by hand, so it differs in case from the sessions (cannot arise through the app)",
		REVOKE,
		withSessions({ request: { email: "GRACE@example.test" } }),
	),
	go(
		"a revoke as a mixed-case owner email",
		REVOKE,
		withSessions(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	go("the revoke batch throws", REVOKE, withSessions(), {
		failures: [
			{ on: /INSERT INTO software_project_audit/, message: "d1 down" },
		],
	}),
	go("the project lookup throws for a revoke", REVOKE, withSessions(), {
		failures: [{ on: LOOKUP, message: "d1 down" }],
	}),
	go("a revoke loses to another revoke", REVOKE, withSessions(), {
		interleave: [
			{
				on: /INSERT INTO software_project_audit/,
				label: "another revoke",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
			},
		],
	}),
	go("a revoke loses to a withdrawal", REVOKE, withSessions(), {
		interleave: [
			{
				on: /INSERT INTO software_project_audit/,
				label: "the request is withdrawn",
				run: (sqlite) =>
					sqlite.exec("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	// sequences
	{
		name: "a notice sent, then sent again",
		music: { seed: invite("pending") },
		fetches: resendOk,
		steps: [act(notice()), act(notice(), { advanceMs: 1000 })],
	},
	{
		name: "a 500, an unconfirmed retry, then a confirmed retry after 61 seconds",
		music: { seed: invite("pending") },
		fetches: byHost({ resend: [json(500, {}), json(200, {})] }),
		steps: [
			act(notice()),
			act(notice(), { advanceMs: 120_000 }),
			act(notice(undefined, true), { advanceMs: 1000 }),
		],
	},
	{
		name: "a refusal, then a retry that is sent",
		music: { seed: invite("pending") },
		fetches: byHost({ resend: [json(422, {}), json(200, {})] }),
		steps: [act(notice()), act(notice(), { advanceMs: 1000 })],
	},
	{
		name: "an update notice and then an invitation notice",
		music: { seed: withUpdate({ notification_status: "pending" }) },
		fetches: resendOk,
		steps: [act(notice("u1")), act(notice(), { advanceMs: 1000 })],
	},
	{
		name: "an update notice sent twice",
		music: { seed: withUpdate() },
		fetches: resendOk,
		steps: [act(notice("u1")), act(notice("u1"), { advanceMs: 1000 })],
	},
	{
		name: "a notice after access is revoked",
		music: { seed: invite("failed") },
		fetches: resendOk,
		steps: [act(REVOKE), act(notice(), { advanceMs: 1000 })],
	},
	{
		name: "a revoke repeated",
		music: { seed: withSessions() },
		steps: [act(REVOKE), act(REVOKE, { advanceMs: 1000 })],
	},
	{
		name: "a state change after the revoke",
		music: { seed: running() },
		steps: [
			act(REVOKE),
			act(stateBody({ expectedUpdatedAt: "2026-11-13T12:00:00.000Z" }), {
				advanceMs: 1000,
			}),
		],
	},
	{
		name: "the client writes, the owner revokes, the client writes again",
		music: { seed: running() },
		steps: [
			{
				as: asClient("grace@example.test"),
				handler: clientMessages,
				path: `/api/studio/software/r1/messages`,
				params: { id: "r1" },
				headers: { origin: ORIGIN },
				json: { action: "send", body: "Before the revoke" },
				dump: { music: ["software_project_messages", "audio_client_sessions"] },
			},
			act(REVOKE, { advanceMs: 1000 }),
			{
				as: asClient("grace@example.test"),
				handler: clientMessages,
				path: `/api/studio/software/r1/messages`,
				params: { id: "r1" },
				headers: { origin: ORIGIN },
				json: { action: "send", body: "After the revoke" },
				advanceMs: 1000,
				dump: { music: ["software_project_messages", "audio_client_sessions"] },
			},
		],
	},
];

defineCorpus("owner-request-project-notice", POST, cases);
