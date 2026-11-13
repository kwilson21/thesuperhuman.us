import { GET } from "~/pages/api/studio/software/[id]/updates/[updateId]/visual";
import { POST as signOut } from "~/pages/api/studio/sign-out";
import {
	asClient,
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	audioClient,
	GRACE,
	mergeSeeds,
	OTHER,
	sessionRow,
	softwareClient,
	softwareUpdate,
	sql,
	T1,
	T2,
	T4,
} from "./areas/studio-access";

// The golden corpus for GET /api/studio/software/[id]/updates/[updateId]/visual: a signed-in client loads the picture
// the owner attached to a shared progress update of their own software project. Unlike the audio file route this handler
// has no try/catch, so a database or R2 failure is a rejected handler (Astro would answer 500); that is recorded as
// "rejected". Every refusal is a bare 404 with no body and the same private headers.
//
// Every response branch of the handler, clientSoftwareProjectForSession (src/lib/audio-client-access.ts) and
// softwareVisualKey (src/lib/software-visuals.ts), and its cases:
//
//   404 empty body + private headers (cache-control private no-store, x-robots-tag noindex nofollow, nosniff)
//     portal flag unset, "false", "TRUE" (read first, before the bindings)
//     no cookie, a cookie that is not 72 hex characters, an unknown token, an upper-case token, no id param, an empty id
//     session: expired (past and at the instant), revoked, another client's, an email with no request
//     project: another client's project, a project that does not exist, a project of the same client under another id,
//       revoked, content deleted, request withdrawn, contact email erased (empty), request email changed, an audio request
//       with that id (no software project)
//     update: unknown id, an update of another project, a draft, no visual key, a key under another request or update id
//       (including a longer update id that shares the prefix), a key with a path in it, a gif, capitals, R2 object missing
//   503 empty body                 no MUSIC_DB, no AUDIO bucket (answered before the cookie is looked at)
//   200 object body                png, jpeg, webp as stored, shared and superseded updates, a software project in any state,
//                                  a stored media type that does not match the bytes (the stored one is sent), a null media
//                                  type (sent as the text "null")
//   rejected                       the session query, the project query, the update query failing; R2 get failing
//   sequences                      real sign-in then read, sign-out then read, two reads, two projects of one client

const BASE = "/api/studio/software/s1/updates/u1/visual";
const KEY = "software/s1/u1/v1.png";
const PICTURE = "picture-bytes";

const get = (extra: Partial<Step> = {}): Step => ({
	as: asClientCookie(T1.value),
	method: "GET",
	path: BASE,
	params: { id: "s1", updateId: "u1" },
	...extra,
});

const at = (id: string, updateId: string, extra: Partial<Step> = {}) =>
	get({
		path: `/api/studio/software/${encodeURIComponent(id)}/updates/${encodeURIComponent(updateId)}/visual`,
		params: { id, updateId },
		...extra,
	});

type Scene = {
	readonly request?: SeedRow;
	readonly project?: SeedRow;
	readonly update?: SeedRow;
	readonly more?: SeedRow[];
	readonly extra?: Seed;
	readonly sessions?: SeedRow[];
	readonly sql?: string[];
	readonly r2?: { [key: string]: { body: string } };
};

const scene = (o: Scene = {}): Partial<Case> => ({
	music: {
		seed: mergeSeeds(
			softwareClient("s1", GRACE, { request: o.request, project: o.project }),
			{
				software_project_updates: [
					softwareUpdate("u1", "s1", o.update),
					...(o.more ?? []),
				],
				audio_client_sessions: o.sessions ?? [sessionRow(T1, GRACE)],
			},
			o.extra ?? {},
		),
	},
	setup: sql(...(o.sql ?? [])),
	r2: { seed: o.r2 ?? { [KEY]: { body: PICTURE } } },
});

const open = (
	name: string,
	o: Scene = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(o),
	steps: [get()],
	...extra,
});

const withStep = (
	name: string,
	step: Partial<Step>,
	o: Scene = {},
	extra: Partial<Case> = {},
): Case => open(name, o, { steps: [get(step)], ...extra });

const second = (id: string) => softwareClient(id, GRACE);

const cases: Case[] = [
	// gates
	open("portal flag unset", {}, { omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] }),
	open(
		"portal flag false",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } },
	),
	open(
		"portal flag TRUE in capitals",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" } },
	),
	open(
		"portal flag off wins over missing bindings",
		{},
		{
			omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
			music: { missing: true },
			r2: { missing: true },
		},
	),
	open("no database binding", {}, { music: { missing: true } }),
	open("no audio bucket", {}, { r2: { missing: true } }),
	open(
		"no bindings and no cookie: still 503",
		{},
		{ music: { missing: true }, steps: [get({ as: asVisitor() })] },
	),
	// who is asking
	withStep("a signed-in client reads the picture", {}),
	withStep("no cookie", { as: asVisitor() }),
	withStep("a cookie that is not a session token", {
		as: asVisitor(),
		headers: { cookie: "studio_session=abc" },
	}),
	withStep("an unknown token of the right shape", {
		as: asClientCookie(T2.value),
	}),
	withStep(
		"an upper-case token",
		{ as: asClientCookie(T4.value.toUpperCase()) },
		{ sessions: [sessionRow(T4, GRACE)] },
	),
	withStep("the owner without a cookie", { as: asOwner() }),
	withStep(
		"an expired session",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T11:59:59.000Z" }),
			],
		},
	),
	withStep(
		"a session that expires at this instant",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { expires_at: "2026-11-13T12:00:00.000Z" }),
			],
		},
	),
	withStep(
		"a revoked session",
		{},
		{
			sessions: [
				sessionRow(T1, GRACE, { revoked_at: "2026-11-13T11:30:00.000Z" }),
			],
		},
	),
	withStep(
		"another client's session",
		{ as: asClientCookie(T2.value) },
		{
			extra: softwareClient("s2", OTHER),
			sessions: [sessionRow(T1, GRACE), sessionRow(T2, OTHER)],
		},
	),
	withStep(
		"a session for an email with no request",
		{ as: asClientCookie(T2.value) },
		{ sessions: [sessionRow(T2, "nobody@example.test")] },
	),
	// ids
	withStep("no id param", { params: { updateId: "u1" } }),
	withStep("an empty id param", { params: { id: "", updateId: "u1" } }),
	withStep("an unknown project id", at("s9", "u1")),
	withStep("an unknown update id", at("s1", "u9")),
	withStep("an id that looks like SQL", at("s1' OR '1'='1", "u1")),
	withStep("an update id that looks like SQL", at("s1", "u1' OR '1'='1")),
	withStep("ids in capitals", at("S1", "U1")),
	// the project
	open("the project is revoked", {
		project: { revoked_at: "2026-11-13T11:30:00.000Z" },
	}),
	open("the project has content deleted", {
		project: { content_deleted_at: "2026-11-13T11:30:00.000Z" },
	}),
	open("the request is withdrawn", { request: { status: "withdrawn" } }),
	open("the request is resolved", { request: { status: "resolved" } }),
	open("the contact email is erased", { request: { email: "" } }),
	open("the request's email is changed", {
		request: { email: "someone@example.test" },
	}),
	open("the project is complete", { project: { state: "complete" } }),
	withStep("the id is another of this client's projects", at("s2", "u1"), {
		extra: second("s2"),
	}),
	withStep("an update of another of this client's projects", at("s1", "u2"), {
		extra: second("s2"),
		more: [
			softwareUpdate("u2", "s2", {
				visual_key: "software/s2/u2/v1.png",
			}),
		],
		r2: { "software/s2/u2/v1.png": { body: PICTURE } },
	}),
	withStep(
		"the same client reads the picture of the other project",
		at("s2", "u2"),
		{
			extra: second("s2"),
			more: [
				softwareUpdate("u2", "s2", {
					visual_key: "software/s2/u2/v1.png",
				}),
			],
			r2: { "software/s2/u2/v1.png": { body: PICTURE } },
		},
	),
	withStep(
		"an audio request with that id has no software project",
		at("a1", "u1"),
		{
			extra: audioClient("a1", GRACE),
		},
	),
	// the update
	open("a draft update", { update: { status: "draft", shared_at: null } }),
	open("a superseded update", { update: { status: "superseded" } }),
	open("an update with no visual", {
		update: { visual_key: null, visual_media_type: null },
	}),
	open("a key under another update id", {
		update: { visual_key: "software/s1/u9/v1.png" },
		r2: { "software/s1/u9/v1.png": { body: PICTURE } },
	}),
	open("a key under another request id", {
		update: { visual_key: "software/s2/u1/v1.png" },
		r2: { "software/s2/u1/v1.png": { body: PICTURE } },
	}),
	open("a key whose update id only starts like this one", {
		update: { visual_key: "software/s1/u10/v1.png" },
		r2: { "software/s1/u10/v1.png": { body: PICTURE } },
	}),
	open("a key with a path in it", {
		update: { visual_key: "software/s1/u1/../u2/v1.png" },
		r2: { "software/s1/u1/../u2/v1.png": { body: PICTURE } },
	}),
	open("a key with a deeper path", {
		update: { visual_key: "software/s1/u1/sub/v1.png" },
		r2: { "software/s1/u1/sub/v1.png": { body: PICTURE } },
	}),
	open("a gif key", {
		update: { visual_key: "software/s1/u1/v1.gif" },
		r2: { "software/s1/u1/v1.gif": { body: PICTURE } },
	}),
	open("a key in capitals", {
		update: { visual_key: "software/s1/u1/V1.PNG" },
		r2: { "software/s1/u1/V1.PNG": { body: PICTURE } },
	}),
	open("a key outside the software prefix", {
		update: { visual_key: "studio/projects/r1/f1.png" },
		r2: { "studio/projects/r1/f1.png": { body: PICTURE } },
	}),
	open("the picture is missing from R2", { r2: {} }),
	// what is served
	open("a jpeg", {
		update: {
			visual_key: "software/s1/u1/v1.jpg",
			visual_media_type: "image/jpeg",
		},
		r2: { "software/s1/u1/v1.jpg": { body: PICTURE } },
	}),
	open("a webp", {
		update: {
			visual_key: "software/s1/u1/v1.webp",
			visual_media_type: "image/webp",
		},
		r2: { "software/s1/u1/v1.webp": { body: PICTURE } },
	}),
	open("a stored media type that does not match the bytes", {
		update: { visual_media_type: "image/webp" },
	}),
	open("a key but no media type", { update: { visual_media_type: null } }),
	open("a key with dashes and digits in the file name", {
		update: { visual_key: "software/s1/u1/a-1-b-2.png" },
		r2: { "software/s1/u1/a-1-b-2.png": { body: PICTURE } },
	}),
	open(
		"an update id with dashes",
		{
			update: { id: "u-1-a", visual_key: "software/s1/u-1-a/v1.png" },
			r2: { "software/s1/u-1-a/v1.png": { body: PICTURE } },
		},
		{ steps: [at("s1", "u-1-a")] },
	),
	open("an empty picture", { r2: { [KEY]: { body: "" } } }),
	// outages: this handler has no try/catch
	open(
		"the session query fails",
		{},
		{
			failures: [
				{ on: /SELECT email FROM audio_client_sessions/, message: "d1 down" },
			],
		},
	),
	open(
		"the project query fails",
		{},
		{
			failures: [
				{
					on: /FROM software_projects p JOIN owner_requests r/,
					message: "d1 down",
				},
			],
		},
	),
	open(
		"the update query fails",
		{},
		{
			failures: [
				{ on: /FROM software_project_updates WHERE id=\?/, message: "d1 down" },
			],
		},
	),
	open(
		"R2 get fails",
		{},
		{
			r2: { seed: { [KEY]: { body: PICTURE } }, fails: ["get"] },
		},
	),
	// races
	open(
		"the session is revoked between the project and the update queries",
		{},
		{
			interleave: [
				{
					on: /FROM software_project_updates WHERE id=\?/,
					label: "the client signed out",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE audio_client_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
						),
				},
			],
		},
	),
	open(
		"the update is pulled back to a draft between the queries",
		{},
		{
			interleave: [
				{
					on: /FROM software_project_updates WHERE id=\?/,
					label: "the owner pulled the update back to a draft",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE software_project_updates SET status='draft',shared_at=NULL",
						),
				},
			],
		},
	),
	// sequences
	open(
		"a client signed in through the real flow reads a picture",
		{},
		{
			music: {
				seed: mergeSeeds(softwareClient("s1", GRACE), {
					software_project_updates: [softwareUpdate("u1", "s1")],
				}),
			},
			steps: [get({ as: asClient(GRACE) })],
		},
	),
	open(
		"a real sign-in, a read, a sign-out, a read",
		{},
		{
			music: {
				seed: mergeSeeds(softwareClient("s1", GRACE), {
					software_project_updates: [softwareUpdate("u1", "s1")],
				}),
			},
			steps: [
				get({ as: asClient(GRACE) }),
				get({
					as: asClient(GRACE),
					handler: signOut,
					method: "POST",
					path: "/api/studio/sign-out",
					dump: { music: ["audio_client_sessions"] },
				}),
				get({ as: asClient(GRACE), advanceMs: 1000 }),
			],
		},
	),
	open(
		"another client's real session cannot read this client's picture",
		{},
		{
			music: {
				seed: mergeSeeds(
					softwareClient("s1", GRACE),
					softwareClient("s2", OTHER),
					{
						software_project_updates: [softwareUpdate("u1", "s1")],
					},
				),
			},
			steps: [get({ as: asClient(OTHER) })],
		},
	),
	open("two reads", {}, { steps: [get(), get({ advanceMs: 1000 })] }),
	open(
		"a read, then the project is revoked, then a read",
		{},
		{
			steps: [
				get(),
				get({
					advanceMs: 1000,
					before: {
						label: "the owner revoked the project",
						run: (world) => {
							world.music.exec(
								"UPDATE software_projects SET revoked_at='2026-11-13T12:00:00.500Z'",
							);
						},
					},
				}),
			],
		},
	),
];

defineCorpus("studio-software-visual", GET, cases);
