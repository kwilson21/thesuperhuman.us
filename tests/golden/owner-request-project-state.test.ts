import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/project";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import {
	ALL_TABLES,
	BASE,
	EARLIER,
	NOW,
	acceptedHandoff,
	decision,
	invoice,
	owner,
	running,
	stateBody,
	update,
} from "./areas/software-projects";

// The golden corpus for the "state" and "complete" actions of POST /api/owner/requests/[id]/project: the owner moves a
// running software project between states, milestones and steps, or completes it after the final handoff. Stateful.
//
// Every response branch of those two paths and the cases that reach each:
//
//   guards shared with the other project files (403, 404 portal, 503, musicRequest 403/415/400/413, 400 schema) are
//   recorded in owner-request-project-start; here: a visitor, a signed-in client, the portal flag, no database, and the
//   schema of the state and complete bodies (each field wrong, too long, out of range)
//   404 {ok:false}                no project for the id (state and complete)
//   400 "Choose a milestone"      milestone index past the offer, waiting_for_input with a blank or whitespace-only
//                                 waiting_for
//   409 "This project is complete."  a state change (not a complete) on a project with completed_at, whatever its state
//   409 "previous milestones must be paid"  invoice mode, moving to a later milestone without every earlier payment
//   200 {ok:true}                 every move from each of the five states to each of the five (a complete only where the
//                                 final delivery was accepted and handed off), forward and backward milestone moves, each
//                                 step, a blank next date, a future updated_at, an updated_at equal to now
//   409 generic "could not be saved"  stale expectedUpdatedAt (state and complete), a project completed already, a
//                                 completed_at set with another state, revoked access, content deleted, a withdrawn
//                                 request, a blank email, forward milestone moves with no deposit (standard) or no earlier
//                                 payment lost to a race (invoice), no accepted final delivery, no handoff, a handoff older
//                                 than the acceptance, an acceptance that is not the latest delivery, an unparseable
//                                 updated_at (the date maths throws), the batch throws, the project lookup throws once
//   handler rejects               the project lookup throws twice (the retry in the catch throws too)
//   complete                      3 offers shapes (1, 2 and 3 milestones), accepted by a decision, direction_confirmed and
//                                 changes_requested decisions that do not count, handoff draft or superseded or earlier
//
// Multi-step: a full life from preparing to complete, a replay of the same body, a stale date after another step, a
// state change after the project completes.

const TABLES = [...ALL_TABLES, "software_project_updates"];

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { dump: { music: TABLES }, ...extra });

const T = (seconds: number) =>
	new Date(Date.parse(NOW) + seconds * 1000).toISOString();

const project = (
	over: SeedRow = {},
	opts: Parameters<typeof running>[0] = {},
) => running({ ...opts, project: { ...opts.project, ...over } });

const done = { state: "complete", completed_at: EARLIER };

const go = (
	name: string,
	body: JsonValue | undefined,
	seed: Seed = running(),
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({ name, music: { seed }, steps: [act(body, step)], ...extra });

const STATES = [
	"preparing",
	"building",
	"waiting_for_input",
	"ready_for_review",
	"complete",
] as const;

const moves: Case[] = STATES.flatMap((from) =>
	STATES.map((to) =>
		go(
			`move from ${from} to ${to}`,
			stateBody({
				state: to,
				waiting_for: to === "waiting_for_input" ? "The logo files" : "",
				step: to === "complete" ? "handoff" : "review",
			}),
			running({
				project: from === "complete" ? done : { state: from },
				extra: acceptedHandoff(1),
			}),
		),
	),
);

const ACCEPT_MS = (m: number, extra: { [t: string]: SeedRow[] } = {}) => ({
	...acceptedHandoff(m),
	...extra,
});

const completeBody = { action: "complete", confirmed: true };

const cases: Case[] = [
	// who and where
	go(
		"a visitor changes a state",
		stateBody(),
		running(),
		{},
		{ as: asVisitor() },
	),
	{
		name: "a signed-in client changes a state",
		music: { seed: running() },
		steps: [act(stateBody(), { as: asClient("grace@example.test") })],
	},
	go("a visitor completes", completeBody, running(), {}, { as: asVisitor() }),
	go("the portal flag is false for a state change", stateBody(), running(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	{
		name: "no database binding for a state change",
		music: { missing: true },
		steps: [act(stateBody())],
	},
	go("no project for a state change", stateBody(), {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go("no project for a complete", completeBody, {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go(
		"an unknown request id for a state change",
		stateBody(),
		running(),
		{},
		{ path: `${BASE}/nope/project`, params: { id: "nope" } },
	),
	// schema
	go("a state that is not one of the five", stateBody({ state: "paused" })),
	go("a missing state", stateBody({ state: undefined })),
	go(
		"waiting_for over 200 characters",
		stateBody({ waiting_for: "w".repeat(201) }),
	),
	go(
		"waiting_for of exactly 200 characters",
		stateBody({ state: "waiting_for_input", waiting_for: "w".repeat(200) }),
	),
	go(
		"waiting_for 200 characters plus spaces",
		stateBody({
			state: "waiting_for_input",
			waiting_for: ` ${"w".repeat(200)} `,
		}),
	),
	go("waiting_for not text", stateBody({ waiting_for: 5 })),
	go("waiting_for missing", stateBody({ waiting_for: undefined })),
	go("a milestone index of 3", stateBody({ milestone_index: 3 })),
	go("a negative milestone index", stateBody({ milestone_index: -1 })),
	go("a fractional milestone index", stateBody({ milestone_index: 0.5 })),
	go("a text milestone index", stateBody({ milestone_index: "0" })),
	go("a missing milestone index", stateBody({ milestone_index: undefined })),
	go("a step that is not one of the four", stateBody({ step: "ship" })),
	go("a missing step", stateBody({ step: undefined })),
	go(
		"a next date that is impossible",
		stateBody({ next_update_on: "2026-02-30" }),
	),
	go(
		"a next date in the wrong format",
		stateBody({ next_update_on: "tomorrow" }),
	),
	go("a missing next date", stateBody({ next_update_on: undefined })),
	go(
		"an expectedUpdatedAt that is not text",
		stateBody({ expectedUpdatedAt: 5 }),
	),
	go(
		"a missing expectedUpdatedAt",
		stateBody({ expectedUpdatedAt: undefined }),
	),
	go("complete without confirmation", { action: "complete" }),
	go("complete with confirmed false", { action: "complete", confirmed: false }),
	go("complete with confirmed as text", {
		action: "complete",
		confirmed: "true",
	}),
	// the five-by-five moves
	...moves,
	// waiting for input
	go(
		"waiting for input with a blank reason",
		stateBody({ state: "waiting_for_input", waiting_for: "" }),
	),
	go(
		"waiting for input with a whitespace-only reason",
		stateBody({ state: "waiting_for_input", waiting_for: "   \t " }),
	),
	go(
		"waiting for input with a reason that is trimmed",
		stateBody({
			state: "waiting_for_input",
			waiting_for: '  The <logo> & "colors" ☃  ',
		}),
	),
	go(
		"a reason kept while the state is building",
		stateBody({ state: "building", waiting_for: "Stale reason" }),
	),
	// milestone and step moves
	go("the same milestone and step again", stateBody({ step: "direction" })),
	...(["direction", "build", "review", "handoff"] as const).map((step) =>
		go(`the ${step} step`, stateBody({ step })),
	),
	go("a blank next date is stored as null", stateBody({ next_update_on: "" })),
	go(
		"a next date in the past is accepted",
		stateBody({ next_update_on: "2020-01-01" }),
	),
	go("a milestone past the offer", stateBody({ milestone_index: 2 })),
	go(
		"a milestone past a one-milestone offer",
		stateBody({ milestone_index: 1 }),
		running({ fees: [100_000] }),
	),
	go(
		"a forward move in standard mode with no deposit",
		stateBody({ milestone_index: 1 }),
	),
	go(
		"a forward move in standard mode with a deposit recorded",
		stateBody({ milestone_index: 1 }),
		running({
			extra: {
				software_milestone_deposits: [
					{
						request_id: "r1",
						milestone_index: 1,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a forward move in standard mode with a paid deposit invoice",
		stateBody({ milestone_index: 1 }),
		running({
			extra: {
				software_invoices: [invoice("i1", "paid", { milestone_index: 1 })],
			},
		}),
	),
	go(
		"a forward move with a refunded deposit invoice",
		stateBody({ milestone_index: 1 }),
		running({
			extra: {
				software_invoices: [
					invoice("i1", "paid", { milestone_index: 1, refunded_at: EARLIER }),
				],
			},
		}),
	),
	go(
		"a forward move with only an open deposit invoice",
		stateBody({ milestone_index: 1 }),
		running({
			extra: {
				software_invoices: [invoice("i1", "open", { milestone_index: 1 })],
			},
		}),
	),
	go(
		"a forward move with the deposit of another milestone",
		stateBody({ milestone_index: 1 }),
		running({
			fees: [1e5, 2e5, 3e5],
			extra: {
				software_milestone_deposits: [
					{
						request_id: "r1",
						milestone_index: 2,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a jump over a milestone with only the last deposit",
		stateBody({ milestone_index: 2 }),
		running({
			fees: [1e5, 2e5, 3e5],
			extra: {
				software_milestone_deposits: [
					{
						request_id: "r1",
						milestone_index: 2,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a backward move",
		stateBody({ milestone_index: 0 }),
		project({ milestone_index: 1 }),
	),
	go(
		"staying on a later milestone needs no deposit",
		stateBody({ milestone_index: 1 }),
		project({ milestone_index: 1 }),
	),
	go(
		"a forward move in invoice mode with no payment",
		stateBody({ milestone_index: 1 }),
		running({ mode: "invoice" }),
	),
	go(
		"a forward move in invoice mode with the first milestone paid",
		stateBody({ milestone_index: 1 }),
		running({
			mode: "invoice",
			extra: {
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 0,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a jump to milestone 3 in invoice mode with only the first paid",
		stateBody({ milestone_index: 2 }),
		running({
			mode: "invoice",
			fees: [1e5, 2e5, 3e5],
			extra: {
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 0,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a jump to milestone 3 in invoice mode with both paid",
		stateBody({ milestone_index: 2 }),
		running({
			mode: "invoice",
			fees: [1e5, 2e5, 3e5],
			extra: {
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 0,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
					{
						request_id: "r1",
						milestone_index: 1,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a move to milestone 3 in invoice mode with the wrong two paid",
		stateBody({ milestone_index: 2 }),
		running({
			mode: "invoice",
			fees: [1e5, 2e5, 3e5],
			extra: {
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 1,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
					{
						request_id: "r1",
						milestone_index: 2,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
	),
	go(
		"a backward move in invoice mode needs no payment",
		stateBody({ milestone_index: 0 }),
		project({ milestone_index: 1 }, { mode: "invoice" }),
	),
	go(
		"a forward move in invoice mode loses its payment to a race",
		stateBody({ milestone_index: 1 }),
		running({
			mode: "invoice",
			extra: {
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 0,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
		{
			interleave: [
				{
					on: /UPDATE software_projects SET state=\?/,
					label: "the payment is removed",
					run: (sqlite) =>
						sqlite.exec("DELETE FROM software_milestone_payments"),
				},
			],
		},
	),
	go(
		"a forward move in standard mode loses its deposit to a race",
		stateBody({ milestone_index: 1 }),
		running({
			extra: {
				software_milestone_deposits: [
					{
						request_id: "r1",
						milestone_index: 1,
						paid_recorded_at: EARLIER,
						recorded_by: "o",
					},
				],
			},
		}),
		{
			interleave: [
				{
					on: /UPDATE software_projects SET state=\?/,
					label: "the deposit is removed",
					run: (sqlite) =>
						sqlite.exec("DELETE FROM software_milestone_deposits"),
				},
			],
		},
	),
	// the project row
	go(
		"a stale expectedUpdatedAt",
		stateBody({ expectedUpdatedAt: "2026-11-13T10:00:00.000Z" }),
	),
	go(
		"an updated_at in the future",
		stateBody({ expectedUpdatedAt: "2026-11-13T13:00:00.000Z" }),
		project({ updated_at: "2026-11-13T13:00:00.000Z" }),
	),
	go(
		"an updated_at equal to now",
		stateBody({ expectedUpdatedAt: NOW }),
		project({ updated_at: NOW }),
	),
	go(
		"an updated_at that is not a date",
		stateBody({ expectedUpdatedAt: "garbage" }),
		project({ updated_at: "garbage" }),
	),
	go(
		"an updated_at without a zone",
		stateBody({ expectedUpdatedAt: "2026-11-13 11:00:00" }),
		project({ updated_at: "2026-11-13 11:00:00" }),
	),
	go(
		"an invoice-mode move with an updated_at that is not a date",
		stateBody({ expectedUpdatedAt: "garbage", milestone_index: 1 }),
		project({ updated_at: "garbage" }, { mode: "invoice" }),
	),
	go(
		"a project with a completed_at and another state",
		stateBody({ state: "building" }),
		project({ completed_at: EARLIER }),
	),
	go(
		"a project in state complete with no completed_at",
		stateBody({ state: "building" }),
		project({ state: "complete" }),
	),
	go("a revoked project", stateBody(), project({ revoked_at: EARLIER })),
	go(
		"a project whose content was deleted",
		stateBody(),
		project({ content_deleted_at: EARLIER }),
	),
	go(
		"a withdrawn request",
		stateBody(),
		running({ request: { status: "withdrawn" } }),
	),
	go(
		"a resolved request",
		stateBody(),
		running({ request: { status: "resolved" } }),
	),
	go(
		"a request with a blank email",
		stateBody(),
		running({ request: { email: "" } }),
	),
	go(
		"a mixed-case owner email",
		stateBody(),
		running(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	// outages and races
	go("the project lookup throws once", stateBody(), running(), {
		failures: [
			{
				on: /SELECT \* FROM software_projects WHERE request_id=\?/,
				message: "d1 down",
			},
		],
	}),
	go("the project lookup throws twice", stateBody(), running(), {
		failures: [
			{
				on: /SELECT \* FROM software_projects WHERE request_id=\?/,
				message: "d1 down",
			},
			{
				on: /SELECT \* FROM software_projects WHERE request_id=\?/,
				nth: 2,
				message: "d1 down",
			},
		],
	}),
	go("the state batch throws", stateBody(), running(), {
		failures: [
			{ on: /UPDATE software_projects SET state=\?/, message: "d1 down" },
		],
	}),
	go(
		"the invoice-mode pre-check throws",
		stateBody({ milestone_index: 1 }),
		running({ mode: "invoice" }),
		{
			failures: [
				{
					on: /SELECT count\(\*\) AS n FROM software_milestone_payments/,
					message: "d1 down",
				},
			],
		},
	),
	go(
		"another writer changes the project before the batch",
		stateBody(),
		running(),
		{
			interleave: [
				{
					on: /UPDATE software_projects SET state=\?/,
					label: "another change",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_projects SET waiting_for='x',updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	go("access is revoked before the batch", stateBody(), running(), {
		interleave: [
			{
				on: /UPDATE software_projects SET state=\?/,
				label: "access is revoked",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
			},
		],
	}),
	go("the request is withdrawn before the batch", stateBody(), running(), {
		interleave: [
			{
				on: /UPDATE software_projects SET state=\?/,
				label: "the request is withdrawn",
				run: (sqlite) =>
					sqlite.exec("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	// complete
	go(
		"complete with the final delivery accepted and handed off",
		completeBody,
		running({ extra: acceptedHandoff(1) }),
	),
	go("complete with nothing delivered", completeBody),
	go(
		"complete with an acceptance and no handoff",
		completeBody,
		running({
			extra: {
				software_project_updates: [update("d1", { milestone_index: 1 })],
				software_project_messages: [decision("d1", "milestone_accepted")],
			},
		}),
	),
	go(
		"complete with a handoff and no acceptance",
		completeBody,
		running({
			extra: {
				software_project_updates: [
					update("h1", { kind: "handoff", milestone_index: 1 }),
				],
			},
		}),
	),
	go(
		"complete with a handoff that is a draft",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						status: "draft",
						shared_at: null,
					}),
				],
			}),
		}),
	),
	go(
		"complete with a handoff that is superseded",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						status: "superseded",
						shared_at: T(0),
					}),
				],
			}),
		}),
	),
	go(
		"complete with a handoff shared before the acceptance",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:05:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete with a handoff shared at the same moment as the acceptance",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:10:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete with the acceptance on the first milestone only",
		completeBody,
		running({ extra: acceptedHandoff(0) }),
	),
	go(
		"complete with the handoff on the wrong milestone",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("h1", {
						kind: "handoff",
						milestone_index: 0,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete with changes requested instead of an acceptance",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_messages: [
					decision("d1", "changes_requested", {
						created_at: "2026-11-13T11:10:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete with a direction confirmation instead of an acceptance",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", {
						kind: "direction_review",
						milestone_index: 1,
						artifact_version: "Direction v1",
					}),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
				software_project_messages: [
					decision("d1", "direction_confirmed", {
						created_at: "2026-11-13T11:10:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete when a newer delivery review has no acceptance",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("d2", {
						milestone_index: 1,
						artifact_version: "Delivery v2",
						shared_at: "2026-11-13T11:20:00.000Z",
					}),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete when the newer delivery review is the accepted one",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1 }),
					update("d2", {
						milestone_index: 1,
						artifact_version: "Delivery v2",
						shared_at: "2026-11-13T11:20:00.000Z",
					}),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
				software_project_messages: [
					decision("d2", "milestone_accepted", {
						created_at: "2026-11-13T11:25:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete on a one-milestone offer",
		completeBody,
		running({ fees: [100_000], extra: acceptedHandoff(0) }),
	),
	go(
		"complete on a three-milestone offer with the last accepted",
		completeBody,
		running({ fees: [1e5, 2e5, 3e5], extra: acceptedHandoff(2) }),
	),
	go(
		"complete on a three-milestone offer with the middle accepted",
		completeBody,
		running({ fees: [1e5, 2e5, 3e5], extra: acceptedHandoff(1) }),
	),
	go(
		"complete again on a completed project",
		completeBody,
		running({ project: done, extra: acceptedHandoff(1) }),
	),
	go(
		"complete is not guarded by the project's updated_at",
		completeBody,
		running({ extra: acceptedHandoff(1) }),
		{
			interleave: [
				{
					on: /UPDATE software_projects SET state='complete'/,
					label: "another change",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	go(
		"complete on a revoked project",
		completeBody,
		running({ project: { revoked_at: EARLIER }, extra: acceptedHandoff(1) }),
	),
	go(
		"complete on a withdrawn request",
		completeBody,
		running({ request: { status: "withdrawn" }, extra: acceptedHandoff(1) }),
	),
	go(
		"complete on a resolved request",
		completeBody,
		running({ request: { status: "resolved" }, extra: acceptedHandoff(1) }),
	),
	go(
		"complete on a project in each earlier state: preparing",
		completeBody,
		running({ project: { state: "preparing" }, extra: acceptedHandoff(1) }),
	),
	go(
		"complete in invoice mode",
		completeBody,
		running({ mode: "invoice", extra: acceptedHandoff(1) }),
	),
	go(
		"complete on a project whose content was deleted",
		completeBody,
		running({
			project: { content_deleted_at: EARLIER },
			extra: acceptedHandoff(1),
		}),
	),
	go(
		"complete on a request with a blank email",
		completeBody,
		running({ request: { email: "" }, extra: acceptedHandoff(1) }),
	),
	go(
		"complete when the accepted delivery review is a draft",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", {
						milestone_index: 1,
						status: "draft",
						shared_at: null,
					}),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete when the accepted delivery review is superseded",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_updates: [
					update("d1", { milestone_index: 1, status: "superseded" }),
					update("h1", {
						kind: "handoff",
						milestone_index: 1,
						shared_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete when the acceptance message came from the owner",
		completeBody,
		running({
			extra: ACCEPT_MS(1, {
				software_project_messages: [
					decision("d1", "milestone_accepted", {
						actor: "owner",
						actor_id: "owner@example.test",
						created_at: "2026-11-13T11:10:00.000Z",
					}),
				],
			}),
		}),
	),
	go(
		"complete when a progress update is the only shared item",
		completeBody,
		running({
			extra: {
				software_project_updates: [
					update("p1", { kind: "progress", milestone_index: 1 }),
				],
			},
		}),
	),
	go(
		"complete clears the waiting reason and the next date",
		completeBody,
		running({
			project: {
				state: "waiting_for_input",
				waiting_for: "Logo",
				next_update_on: "2026-11-20",
			},
			extra: acceptedHandoff(1),
		}),
	),
	go(
		"complete as a mixed-case owner email",
		completeBody,
		running({ extra: acceptedHandoff(1) }),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	go(
		"complete when the batch throws",
		completeBody,
		running({ extra: acceptedHandoff(1) }),
		{
			failures: [
				{
					on: /UPDATE software_projects SET state='complete'/,
					message: "d1 down",
				},
			],
		},
	),
	go(
		"a state complete with a stale expectedUpdatedAt",
		stateBody({
			state: "complete",
			expectedUpdatedAt: "2026-11-13T10:00:00.000Z",
		}),
		running({ extra: acceptedHandoff(1) }),
	),
	go(
		"a state complete ignores the milestone and waiting fields",
		stateBody({
			state: "complete",
			milestone_index: 2,
			waiting_for: "ignored",
		}),
		running({ extra: acceptedHandoff(1) }),
	),
	go(
		"a state complete on a project with no accepted delivery",
		stateBody({ state: "complete" }),
	),
	// sequences
	{
		name: "a whole life from preparing to complete",
		music: {
			seed: running({
				project: { state: "preparing" },
				extra: {
					...acceptedHandoff(1),
					software_milestone_deposits: [
						{
							request_id: "r1",
							milestone_index: 1,
							paid_recorded_at: EARLIER,
							recorded_by: "o",
						},
					],
				},
			}),
		},
		steps: [
			act(
				stateBody({
					state: "building",
					step: "direction",
					expectedUpdatedAt: EARLIER,
				}),
			),
			act(
				stateBody({
					state: "waiting_for_input",
					waiting_for: "The logo",
					step: "build",
					expectedUpdatedAt: NOW,
				}),
				{ advanceMs: 60_000 },
			),
			act(
				stateBody({
					state: "ready_for_review",
					step: "review",
					milestone_index: 1,
					expectedUpdatedAt: T(60),
				}),
				{ advanceMs: 60_000 },
			),
			act(
				stateBody({
					state: "complete",
					step: "handoff",
					milestone_index: 1,
					expectedUpdatedAt: T(120),
				}),
				{ advanceMs: 60_000 },
			),
			act(stateBody({ state: "complete", expectedUpdatedAt: T(180) }), {
				advanceMs: 60_000,
			}),
			act(stateBody({ state: "building", expectedUpdatedAt: T(180) }), {
				advanceMs: 60_000,
			}),
			act(completeBody, { advanceMs: 60_000 }),
		],
	},
	{
		name: "the same state change sent twice",
		music: { seed: running() },
		steps: [act(stateBody()), act(stateBody(), { advanceMs: 60_000 })],
	},
	{
		name: "a stale date after another step, then the fresh date",
		music: { seed: running() },
		steps: [
			act(stateBody({ state: "preparing" })),
			act(stateBody({ state: "building" }), { advanceMs: 60_000 }),
			act(stateBody({ state: "building", expectedUpdatedAt: NOW }), {
				advanceMs: 60_000,
			}),
		],
	},
	{
		name: "two changes in the same millisecond move updated_at by one millisecond",
		music: { seed: running() },
		steps: [
			act(stateBody({ state: "preparing", expectedUpdatedAt: EARLIER })),
			act(stateBody({ state: "building", expectedUpdatedAt: NOW })),
			act(
				stateBody({
					state: "preparing",
					expectedUpdatedAt: "2026-11-13T12:00:00.001Z",
				}),
			),
		],
	},
	{
		name: "a state change after access is revoked",
		music: { seed: running() },
		steps: [
			act({ action: "revoke", confirmed: true }),
			act(stateBody({ expectedUpdatedAt: NOW }), { advanceMs: 1000 }),
		],
	},
	{
		name: "complete, then complete again, then complete after a reopen attempt",
		music: { seed: running({ extra: acceptedHandoff(1) }) },
		steps: [
			act(completeBody),
			act(completeBody, { advanceMs: 1000 }),
			act(stateBody({ state: "building", expectedUpdatedAt: NOW }), {
				advanceMs: 1000,
			}),
		],
	},
];

defineCorpus("owner-request-project-state", POST, cases);
