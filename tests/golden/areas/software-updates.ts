// Shared builders for the golden corpora of the owner software-update routes: POST /api/owner/requests/[id]/updates
// (the owner saves a draft or shares a project update) and the visual route under it. A scene seeds software request
// "r1", its sent offer "o1" and a started project; a case adds the updates, messages, payments and invoices it needs.
// Times sit on the frozen clock's day (2026-11-13T12:00:00.000Z). Every step carries the Origin header musicRequest checks.
import type { JsonValue } from "../../helpers/json";
import type { OfferTerms } from "~/lib/software-offers";
import {
	asOwner,
	rows,
	type Case,
	type Lazy,
	type Seed,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const FUTURE = "2026-11-13T13:00:00.000Z";
export const SITE = "https://thesuperhuman.us";
export const BASE = "/api/owner/requests/r1/updates";

/** Update ids in the UUID shape the route's schema wants. */
export const uid = (n: number) =>
	`d0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const D1 = uid(1);
export const D2 = uid(2);
export const U1 = uid(11);
export const U2 = uid(12);
export const U3 = uid(13);

export const TABLES = [
	"software_project_updates",
	"software_projects",
	"software_project_audit",
	"software_milestone_payments",
];

/** Three milestones with 3, 1 and 2 deliverables and 3, 1 and 2 acceptance checks. */
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
			{
				name: "Third",
				deliverables: ["Handover", "Training"],
				acceptance: ["Accepted", "Signed off"],
				feeCents: 50_000,
			},
		],
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode: "standard",
		...over,
	});

type Fields = { [key: string]: JsonValue };

/** One update as the owner's page sends it: a progress note on milestone 1 with nothing optional. */
export const input = (over: Fields = {}) => ({
	kind: "progress",
	milestone_index: 0,
	title: "First look",
	artifact_version: "",
	evidence_type: "prototype",
	visual_alt: "",
	preview_url: "",
	what_changed: "Built the first screen",
	checks_limitations: "",
	next_step: "",
	client_request: "",
	next_update_on: "",
	email_client: false,
	criteria: [],
	delivered_deliverables: [],
	links: [],
	review_window_days: 5,
	paid_confirmed: false,
	...over,
});

/** A full delivery review on milestone 1, complete enough to share. */
export const delivery = (over: Fields = {}) =>
	input({
		kind: "delivery_review",
		title: "Delivery one",
		artifact_version: "Delivery v1",
		what_changed: "Everything for milestone one",
		delivered_deliverables: [0, 1, 2],
		criteria: ["Ran it", "Tests pass", "Docs written"],
		...over,
	});

/** A direction review on milestone 1, complete enough to share. */
export const direction = (over: Fields = {}) =>
	input({
		kind: "direction_review",
		title: "Direction one",
		artifact_version: "Direction v1",
		evidence_type: "concept",
		what_changed: "Two sketches to choose from",
		...over,
	});

/** A handoff on milestone 1, complete enough to share. */
export const handoff = (over: Fields = {}) =>
	input({
		kind: "handoff",
		title: "Handoff one",
		what_changed: "Everything is delivered",
		checks_limitations: "Runs on the agreed host only",
		next_step: "Thirty days of fixes",
		paid_confirmed: true,
		links: [{ label: "Repository", url: "https://example.test/repo" }],
		...over,
	});

/** The command the page sends. `expectedUpdatedAt` is the draft's updated_at, or null when there is no draft. */
export const command = (
	action: "draft" | "share",
	update: JsonValue | undefined,
	over: Fields = {},
): JsonValue => ({
	action,
	expectedUpdatedAt: null,
	expectedProjectUpdatedAt: EARLIER,
	confirmed: action === "share",
	update: update ?? null,
	...over,
});

/** A step that posts a body (as JSON) to the update route of "r1". */
export const post = (
	body: Lazy<JsonValue> | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	path: BASE,
	params: { id: "r1" },
	json: body,
	headers: { origin: SITE },
	dump: { music: TABLES },
	...extra,
});

/** A step with a raw text body, for input that is not JSON. */
export const raw = (body: string, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: BASE,
	params: { id: "r1" },
	body,
	headers: { origin: SITE, "content-type": "application/json" },
	dump: { music: TABLES },
	...extra,
});

/** A software_project_updates row. A draft that matches `input()` unless a column is given. */
export const update = (
	id: string,
	status: "draft" | "shared" | "superseded",
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: "r1",
	kind: "progress",
	status,
	milestone_index: 0,
	title: "First look",
	artifact_version: "",
	evidence_type: "prototype",
	what_changed: "Built the first screen",
	email_client: 0,
	shared_at: status === "draft" ? null : EARLIER,
	shared_by: status === "draft" ? null : "owner@example.test",
	created_by: "owner@example.test",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

/** A shared delivery review that matches `delivery()` once its client decision is recorded. */
export const sharedDelivery = (id: string, over: SeedRow = {}): SeedRow =>
	update(id, "shared", {
		kind: "delivery_review",
		title: "Delivery one",
		artifact_version: "Delivery v1",
		what_changed: "Everything for milestone one",
		criteria_json: JSON.stringify(["Ran it", "Tests pass", "Docs written"]),
		delivered_deliverables_json: "[0,1,2]",
		review_window_days: 5,
		...over,
	});

/** The client accepted the milestone on this update. */
export const accepted = (updateId: string, over: SeedRow = {}): SeedRow => ({
	request_id: "r1",
	actor: "client",
	actor_id: "grace@example.test",
	body: "Accepted",
	update_id: updateId,
	decision: "milestone_accepted",
	created_at: EARLIER,
	...over,
});

type Scene = {
	/** Columns of the software_projects row. */
	readonly project?: SeedRow;
	/** Columns of the owner request. */
	readonly request?: SeedRow;
	/** Columns of the sent offer. */
	readonly offer?: SeedRow;
	readonly updates?: readonly SeedRow[];
	readonly messages?: readonly SeedRow[];
	readonly payments?: readonly SeedRow[];
	readonly invoices?: readonly SeedRow[];
	readonly deposits?: readonly SeedRow[];
	readonly extra?: Seed;
};

/** The seed of a started project "r1" (building, milestone 1, standard payments) and what a case puts on it. */
export const scene = (o: Scene = {}): Pick<Case, "music"> => ({
	music: {
		seed: {
			owner_requests: [
				rows.softwareRequest("r1", { status: "reviewed", ...o.request }),
			],
			software_offers: [
				rows.softwareOffer("o1", "r1", { terms_json: terms(), ...o.offer }),
			],
			software_projects: [
				rows.softwareProject("r1", "o1", {
					terms_json: terms(),
					state: "building",
					step: "build",
					...o.project,
				}),
			],
			software_project_updates: [...(o.updates ?? [])],
			software_project_messages: [...(o.messages ?? [])],
			software_milestone_payments: [...(o.payments ?? [])],
			software_invoices: [...(o.invoices ?? [])],
			software_milestone_deposits: [...(o.deposits ?? [])],
			...o.extra,
		},
	},
});

/** A software invoice of "r1" and "o1" that is still payable. */
export const invoice = (id: string, over: SeedRow = {}): SeedRow =>
	rows.softwareInvoice(id, "r1", "o1", {
		kind: "balance",
		status: "open",
		days_until_due: 15,
		...over,
	});

/** Raw SQL for an `interleave` or a `setup` of a case. */
export const sql =
	(statement: string) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(statement);

/** Raw SQL for the `setup` of a case, off the record. */
export const seedSql = (statement: string) => (world: World) =>
	world.music.exec(statement);
