// Shared seed builders and steps for the golden corpora of the owner's software-project routes (project.ts, brief-copy.ts
// and messages.ts under /api/owner/requests/[id]). Times sit on the frozen clock's day (2026-11-13T12:00:00.000Z, which
// is 07:00 on 2026-11-13 in New York).
import type { JsonObject, JsonValue } from "../../helpers/json";
import {
	asOwner,
	byHost,
	json,
	rows,
	type Responder,
	type SeedRow,
	type Step,
} from "../harness";

export const EARLIER = "2026-11-13T11:00:00.000Z";
export const NOW = "2026-11-13T12:00:00.000Z";
export const ORIGIN = "https://thesuperhuman.us";
export const BASE = "/api/owner/requests";
export const GRACE = "grace@example.test";
export const OWNER = "owner@example.test";

/** A good Resend answer. */
export const resendOk: Responder = byHost({
	resend: json(200, { id: "em_golden" }),
});

/** Valid offer terms with one milestone per fee. */
export const offerTerms = (
	paymentMode: "standard" | "invoice" = "standard",
	fees: number[] = [100_000, 200_000],
) =>
	JSON.stringify({
		outcome: "A scheduling tool",
		summary: "Builds a tool that schedules rehearsals.",
		milestones: fees.map((feeCents, index) => ({
			name: `Milestone ${index + 1}`,
			deliverables: [`Deliverable ${index + 1}`],
			acceptance: ["It works"],
			feeCents,
		})),
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode,
	});

/** The agreement details a sent offer pins (only the fields the start action reads). */
export const details = (over: { [name: string]: string } = {}) =>
	JSON.stringify({
		po_requirement: "not_required",
		planned_start: "2026-11-01",
		...over,
	});

/** A software request "r1" with one sent offer "o1" and nothing started. */
export const startable = (
	over: {
		request?: SeedRow;
		offer?: SeedRow;
		mode?: "standard" | "invoice";
		fees?: number[];
		extra?: { [table: string]: SeedRow[] };
	} = {},
) => ({
	owner_requests: [
		rows.softwareRequest("r1", { status: "new", ...over.request }),
	],
	software_offers: [
		rows.softwareOffer("o1", "r1", {
			terms_json: offerTerms(over.mode ?? "standard", over.fees),
			agreement_details_json: details(),
			...over.offer,
		}),
	],
	...over.extra,
});

/** A software request "r1" whose project is already running. */
export const running = (
	over: {
		request?: SeedRow;
		project?: SeedRow;
		mode?: "standard" | "invoice";
		fees?: number[];
		extra?: { [table: string]: SeedRow[] };
	} = {},
) => ({
	owner_requests: [
		rows.softwareRequest("r1", { status: "reviewed", ...over.request }),
	],
	software_offers: [
		rows.softwareOffer("o1", "r1", {
			terms_json: offerTerms(over.mode ?? "standard", over.fees),
		}),
	],
	software_projects: [
		rows.softwareProject("r1", "o1", {
			terms_json: offerTerms(over.mode ?? "standard", over.fees),
			payment_mode: over.mode ?? "standard",
			state: "building",
			...over.project,
		}),
	],
	...over.extra,
});

/** A project-owner step: the owner's JSON POST with a same-origin header. `over` changes any member. */
export function owner(
	body: JsonValue | undefined,
	over: Partial<Step> & { route?: string } = {},
): Step {
	const { route = "project", headers, ...rest } = over;

	return {
		as: asOwner(),
		path: `${BASE}/r1/${route}`,
		params: { id: "r1" },
		headers: {
			origin: ORIGIN,
			"content-type": "application/json",
			...headers,
		},
		json: body,
		...rest,
	};
}

/** A shared update (a delivery review by default) on milestone 0. */
export const update = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	request_id: "r1",
	kind: "delivery_review",
	status: "shared",
	milestone_index: 0,
	title: `Update ${id}`,
	artifact_version: "Delivery v1",
	evidence_type: "prototype",
	shared_at: EARLIER,
	shared_by: OWNER,
	created_by: OWNER,
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

/** A client's decision message on an update. */
export const decision = (
	updateId: string,
	kind: "milestone_accepted" | "direction_confirmed" | "changes_requested",
	over: SeedRow = {},
): SeedRow => ({
	request_id: "r1",
	actor: "client",
	actor_id: "client-hash",
	body: "Accepted Delivery v1 for milestone 1.",
	update_id: updateId,
	decision: kind,
	created_at: EARLIER,
	...over,
});

/** The rows an executed SOW needs for the website signing path: the agreement, its PDF, and both delivered copies. */
export const executedSow = (over: SeedRow = {}) => ({
	...rows.agreementBase(),
	software_agreements: [
		rows.agreement("a1", "r1", "o1", {
			kind: "sow",
			status: "executed",
			executed_at: "2026-11-12T15:00:00.000Z",
			...over,
		}),
	],
	software_agreement_artifacts: [
		{ agreement_id: "a1", status: "ready", ready_at: EARLIER },
	],
	software_agreement_deliveries: [
		{
			agreement_id: "a1",
			recipient_role: "client",
			email: GRACE,
			status: "sent",
			sent_at: EARLIER,
		},
		{
			agreement_id: "a1",
			recipient_role: "contractor",
			email: OWNER,
			status: "sent",
			sent_at: EARLIER,
		},
	],
});

export const PROJECT_TABLES = [
	"owner_requests",
	"owner_request_audit",
	"software_projects",
	"software_project_audit",
];

export const MONEY_TABLES = [
	"software_projects",
	"software_project_audit",
	"software_milestone_deposits",
	"software_milestone_payments",
	"software_invoices",
];

/** The body of a start action that is valid for an outside-site signature. A member set to undefined is left out. */
export const startBody = (over: JsonObject = {}): JsonObject => ({
	action: "start",
	offer_id: "o1",
	offer_version: 1,
	expectedRequestUpdatedAt: EARLIER,
	signature_source: "external",
	external_signed_on: "2026-11-10",
	external_parties: "Grace Hopper LLC and The Superhuman Group LLC",
	external_copy_reference: "Shared drive: SOW-1.pdf",
	external_kept_copy: true,
	inputs_ready: true,
	signatures: true,
	payment: true,
	next_update_on: "2026-11-20",
	...over,
});

/** The body of a state action. A member set to undefined is left out. */
export const stateBody = (over: JsonObject = {}): JsonObject => ({
	action: "state",
	state: "building",
	waiting_for: "",
	milestone_index: 0,
	step: "build",
	next_update_on: "2026-11-20",
	expectedUpdatedAt: EARLIER,
	...over,
});

/** The owner's tables a project case usually dumps. */
export const ALL_TABLES = [
	...PROJECT_TABLES,
	"software_milestone_deposits",
	"software_milestone_payments",
];

/**
 * A deposit or balance invoice row for "r1" and "o1". The kind follows the milestone unless named.
 */
export const invoice = (
	id: string,
	status: string,
	over: SeedRow = {},
): SeedRow => rows.softwareInvoice(id, "r1", "o1", { status, ...over });

/** The shared accepted delivery and handoff that let a project complete: milestone `m` accepted, then its handoff. */
export const acceptedHandoff = (m = 1) => ({
	software_project_updates: [
		update("d1", { milestone_index: m, shared_at: EARLIER }),
		update("h1", {
			kind: "handoff",
			milestone_index: m,
			artifact_version: "Handoff v1",
			shared_at: "2026-11-13T11:30:00.000Z",
		}),
	],
	software_project_messages: [
		decision("d1", "milestone_accepted", {
			created_at: "2026-11-13T11:10:00.000Z",
		}),
	],
});
