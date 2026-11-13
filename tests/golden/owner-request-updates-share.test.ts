import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/updates";
import { defineCorpus, type Case } from "./harness";
import {
	accepted,
	command,
	D1,
	D2,
	delivery,
	direction,
	EARLIER,
	handoff,
	input,
	invoice,
	post,
	scene,
	sharedDelivery,
	sql,
	U1,
	U2,
	U3,
	update,
} from "./areas/software-updates";

// The golden corpus for POST /api/owner/requests/[id]/updates, action "share": the owner shares an update with the client.
// Sharing checks the content, supersedes the earlier shared update of the same kind and milestone, moves the project to
// review for a review kind, and for a handoff records the milestone payment. The front door and schema are in
// owner-request-updates-gates.test.ts, drafts in owner-request-updates-draft.test.ts and the client email in
// owner-request-updates-notices.test.ts (every case here leaves email_client false).
//
// Branches (case names start with their topic):
//
//   200 {ok,id,updatedAt,projectUpdatedAt,shared:true}   "share": a progress note, a direction review, a delivery review,
//                                       a handoff; new or from a draft; each project state; the review kinds move the
//                                       project to ready_for_review (step direction or review) only for a milestone at or
//                                       after the current one; the project next_update_on follows the same rule
//   sharedRetry (before every other check)   "retry": the same share repeated with its updateId and confirmed returns the
//                                       stored row's times; any changed column, a superseded row, confirmed missing, no
//                                       updateId, a stored email flag or malformed stored JSON do not match
//   400 "Progress updates go on the current milestone."   "progress"
//   400 "Add a title and what changed, then confirm sharing."   "content": not confirmed, no title, no what_changed
//   400 "Name the version before sharing."   "version": direction and delivery reviews
//   400 "Finish each reference ..."     "links": empty label, blank label, http, credentials, not a URL
//   400 "Choose at least one agreed deliverable ..."   "delivery": none chosen
//   400 "Add evidence for every acceptance check ..."   "delivery": too few, too many, a blank
//   400 "Confirm full payment ..."      "handoff": not paid, no links, no next step, no limitations
//   400 "Describe the visual ..."       "visual"
//   409 draft identity                  "draft": updateId not the draft's
//   409 generic / stale / payment reminder   "guard": each batch guard (open project, complete, milestone deposit, prior
//                                       milestone payment, accepted delivery, payable invoice, updated_at, draft row),
//                                       "race" and "outage"
//   409 manualPaymentReminder           "handoff": a payable balance or milestone invoice blocks the payment record
//   supersede                           "supersede": same kind and milestone only; progress never supersedes
//   handoff payment                     "handoff": a milestone-paid audit and a payment row, once; repeated shares

const share = (update: JsonValue, over = {}) => command("share", update, over);

const run = (
	name: string,
	body: JsonValue,
	scenery: Parameters<typeof scene>[0] = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(scenery),
	steps: [post(body)],
	...extra,
});

const BATCH_NEW = /INSERT INTO software_project_updates\(/;

const BATCH_EDIT = /UPDATE software_project_updates SET kind=\?/;

const RERUN = (label: string, text: string, on: RegExp = BATCH_NEW) => ({
	on,
	label,
	run: sql(text),
});

/** Milestone 1 delivered and accepted, so a handoff for it may be shared. */
const ACCEPTED = {
	updates: [sharedDelivery(U1)],
	messages: [accepted(U1)],
};

const states = [
	"preparing",
	"building",
	"waiting_for_input",
	"ready_for_review",
	"complete",
] as const;

const stateCases = states.flatMap((state) =>
	(
		[
			["progress", input()],
			["delivery_review", delivery()],
		] as const
	).map(([kind, body]) =>
		run(`share: a ${kind} on a ${state} project`, share(body), {
			project: {
				state,
				waiting_for: state === "waiting_for_input" ? "Logo files" : "",
				next_update_on: "2026-11-20",
			},
		}),
	),
);

const LINK_ROW = (label: string, url: string) => ({ label, url });

const links = (name: string, row: { label: string; url: string }) =>
	run(`links: ${name}`, share(input({ links: [row] })));

const cases: Case[] = [
	// content
	run("share: a progress note", share(input())),
	run(
		"share: a progress note with a next date",
		share(input({ next_update_on: "2026-12-01" })),
		{ project: { next_update_on: "2026-11-20" } },
	),
	run(
		"share: a progress note with no next date clears the project's",
		share(input()),
		{ project: { next_update_on: "2026-11-20" } },
	),
	run(
		"share: a progress note with links and a preview",
		share(
			input({
				preview_url: "https://example.test/p",
				links: [LINK_ROW("Repo", "https://example.test/r")],
			}),
		),
	),
	run(
		"share: markup and unicode are stored as sent",
		share(
			input({
				title: "<b>Bold</b> & ☃",
				what_changed: "<script>alert(1)</script> \"q\" 'q'",
				visual_alt: "<i>x</i>",
			}),
		),
	),
	run(
		"progress: on a later milestone than the project's",
		share(input({ milestone_index: 1 })),
	),
	run(
		"progress: on an earlier milestone than the project's",
		share(input({ milestone_index: 0 })),
		{ project: { milestone_index: 1 } },
	),
	run("content: confirmed is false", share(input(), { confirmed: false })),
	run("content: confirmed is absent", {
		action: "share",
		expectedUpdatedAt: null,
		expectedProjectUpdatedAt: EARLIER,
		update: input(),
	}),
	run("content: the title is only spaces", share(input({ title: "   " }))),
	run(
		"content: what_changed is only spaces",
		share(input({ what_changed: "  " })),
	),
	run(
		"content: no title and no what_changed",
		share(input({ title: "", what_changed: "" })),
	),
	run(
		"version: a direction review without one",
		share(direction({ artifact_version: "" })),
	),
	run(
		"version: a delivery review without one",
		share(delivery({ artifact_version: "" })),
	),
	run(
		"version: a delivery review with a free-text version",
		share(delivery({ artifact_version: "Beta 3" })),
	),
	run(
		"version: a progress note needs none",
		share(input({ artifact_version: "" })),
	),
	links("an empty label", LINK_ROW("", "https://example.test/")),
	links("a blank label", LINK_ROW("   ", "https://example.test/")),
	links("an http link", LINK_ROW("Repo", "http://example.test/")),
	links(
		"a link with a user name",
		LINK_ROW("Repo", "https://me@example.test/"),
	),
	links(
		"a link with a password",
		LINK_ROW("Repo", "https://me:pw@example.test/"),
	),
	links("a link that is not a URL", LINK_ROW("Repo", "example.test/repo")),
	links("a javascript link", LINK_ROW("Repo", "javascript:alert(1)")),
	links("a good link", LINK_ROW("Repo", "https://example.test/ok")),
	links("a mailto link", LINK_ROW("Mail", "mailto:a@example.test")),
	// delivery and direction
	run("delivery: a complete delivery review", share(delivery())),
	run(
		"delivery: no deliverables chosen",
		share(delivery({ delivered_deliverables: [] })),
	),
	run(
		"delivery: too few evidence lines",
		share(delivery({ criteria: ["Ran it"] })),
	),
	run(
		"delivery: too many evidence lines",
		share(delivery({ criteria: ["a", "b", "c", "d"] })),
	),
	run(
		"delivery: a blank evidence line",
		share(delivery({ criteria: ["Ran it", "", "Docs"] })),
	),
	run(
		"delivery: a subset of the deliverables by title",
		share(delivery({ delivered_deliverables: ["Docs"] })),
	),
	run(
		"delivery: a delivery review with a review window of 12",
		share(delivery({ review_window_days: 12 })),
	),
	run(
		"delivery: the review window comes from the agreement",
		share(delivery({ review_window_days: 5 })),
		{
			offer: {
				agreement_details_json: JSON.stringify({ review_business_days: "45" }),
			},
		},
	),
	run("direction: a complete direction review", share(direction())),
	run(
		"direction: next date and window stored",
		share(direction({ next_update_on: "2026-12-15", review_window_days: 7 })),
	),
	run(
		"direction: on a later milestone needs the deposit",
		share(direction({ milestone_index: 1 })),
	),
	// project states
	...stateCases,
	// moving the project to review
	run(
		"review: delivery on the current milestone moves the project",
		share(delivery()),
		{ project: { state: "building", waiting_for: "x" } },
	),
	run(
		"review: delivery on an earlier milestone leaves the project alone",
		share(delivery({ milestone_index: 0 })),
		{
			project: {
				milestone_index: 1,
				state: "building",
				next_update_on: "2026-11-20",
			},
		},
	),
	run(
		"review: delivery on the next milestone with its deposit recorded",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			deposits: [
				{
					request_id: "r1",
					milestone_index: 1,
					paid_recorded_at: EARLIER,
					recorded_by: "owner@example.test",
				},
			],
		},
	),
	run(
		"review: delivery on the next milestone with a paid deposit invoice",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			invoices: [
				invoice("si1", { kind: "deposit", milestone_index: 1, status: "paid" }),
			],
		},
	),
	run(
		"review: the deposit invoice is paid but refunded",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			invoices: [
				invoice("si1", {
					kind: "deposit",
					milestone_index: 1,
					status: "paid",
					refunded_at: EARLIER,
				}),
			],
		},
	),
	run(
		"review: the deposit invoice is still open",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			invoices: [
				invoice("si1", { kind: "deposit", milestone_index: 1, status: "open" }),
			],
		},
	),
	run(
		"review: the deposit is for another milestone",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			deposits: [
				{
					request_id: "r1",
					milestone_index: 2,
					paid_recorded_at: EARLIER,
					recorded_by: "o",
				},
			],
		},
	),
	run(
		"review: no deposit for the next milestone",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
	),
	run(
		"review: an invoice-mode project needs the earlier payment",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{ project: { payment_mode: "invoice" } },
	),
	run(
		"review: an invoice-mode project with the earlier payment",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			project: { payment_mode: "invoice" },
			payments: [
				{
					request_id: "r1",
					milestone_index: 0,
					paid_recorded_at: EARLIER,
					recorded_by: "o",
				},
			],
		},
	),
	run(
		"review: invoice mode, milestone three with only one payment",
		share(
			delivery({
				milestone_index: 2,
				delivered_deliverables: [0],
				criteria: ["Accepted", "Signed off"],
			}),
		),
		{
			project: { payment_mode: "invoice" },
			payments: [
				{
					request_id: "r1",
					milestone_index: 0,
					paid_recorded_at: EARLIER,
					recorded_by: "o",
				},
			],
		},
	),
	run(
		"review: invoice mode, milestone three with both payments",
		share(
			delivery({
				milestone_index: 2,
				delivered_deliverables: [0],
				criteria: ["Accepted", "Signed off"],
			}),
		),
		{
			project: { payment_mode: "invoice" },
			payments: [0, 1].map((m) => ({
				request_id: "r1",
				milestone_index: m,
				paid_recorded_at: EARLIER,
				recorded_by: "o",
			})),
		},
	),
	run(
		"review: invoice mode needs no deposit for the same milestone",
		share(delivery()),
		{ project: { payment_mode: "invoice" } },
	),
	// supersede
	run(
		"supersede: a new delivery replaces the shared one",
		share(delivery({ title: "Delivery two" })),
		{ updates: [sharedDelivery(U1)] },
	),
	run("supersede: another milestone is kept", share(delivery()), {
		project: { milestone_index: 1 },
		updates: [sharedDelivery(U1, { milestone_index: 1 })],
	}),
	run("supersede: another kind is kept", share(direction()), {
		updates: [sharedDelivery(U1)],
	}),
	run("supersede: a progress note supersedes nothing", share(input()), {
		updates: [update(U1, "shared")],
	}),
	run(
		"supersede: an earlier superseded update is untouched",
		share(delivery()),
		{ updates: [sharedDelivery(U1, { status: "superseded" })] },
	),
	run("supersede: two shared of the kind both go", share(delivery()), {
		updates: [sharedDelivery(U1), sharedDelivery(U2, { title: "Other" })],
	}),
	// from a draft
	run(
		"draft: a draft is shared in place",
		share(input({ title: "From draft" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
	),
	run(
		"draft: a delivery draft is shared in place",
		share(delivery(), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft", { kind: "delivery_review" })] },
	),
	run(
		"draft: updateId equals the draft's",
		share(input(), { expectedUpdatedAt: EARLIER, updateId: D1 }),
		{ updates: [update(D1, "draft")] },
	),
	run(
		"draft: updateId is not the draft's",
		share(input(), { expectedUpdatedAt: EARLIER, updateId: D2 }),
		{ updates: [update(D1, "draft")] },
	),
	run(
		"draft: the draft has a picture and no description in the text",
		share(input(), { expectedUpdatedAt: EARLIER }),
		{
			updates: [
				update(D1, "draft", {
					visual_key: `software/r1/${D1}/a.png`,
					visual_media_type: "image/png",
				}),
			],
		},
	),
	run(
		"draft: the draft has a picture and the text describes it",
		share(input({ visual_alt: "A chart" }), { expectedUpdatedAt: EARLIER }),
		{
			updates: [
				update(D1, "draft", {
					visual_key: `software/r1/${D1}/a.png`,
					visual_media_type: "image/png",
				}),
			],
		},
	),
	run(
		"draft: a shared update's id given with no draft",
		share(input(), { updateId: U1 }),
		{ updates: [update(U1, "shared", { title: "Different" })] },
	),
	run("draft: a new id given with no draft", share(input(), { updateId: D2 })),
	run(
		"draft: a stale project time",
		share(input(), { expectedProjectUpdatedAt: "2026-11-13T10:00:00.000Z" }),
	),
	run(
		"draft: a stale draft time",
		share(input(), { expectedUpdatedAt: "2026-11-13T10:00:00.000Z" }),
		{ updates: [update(D1, "draft")] },
	),
	run("draft: a draft exists and none is expected", share(input()), {
		updates: [update(D1, "draft")],
	}),
	// retry
	run(
		"retry: the same share repeated with its id",
		share(input(), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: a different title does not match",
		share(input({ title: "Other" }), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: the same delivery with its id",
		share(delivery({ review_window_days: 5 }), { updateId: U1 }),
		{ updates: [sharedDelivery(U1)] },
	),
	run(
		"retry: a superseded row does not match",
		share(input(), { updateId: U1 }),
		{ updates: [update(U1, "superseded")] },
	),
	run(
		"retry: confirmed false does not retry",
		share(input(), { updateId: U1, confirmed: false }),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: a draft action does not retry",
		command("draft", input(), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: the stored email flag differs",
		share(input({ email_client: true }), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: stored criteria that are malformed",
		share(delivery({ review_window_days: 5 }), { updateId: U1 }),
		{ updates: [sharedDelivery(U1, { criteria_json: "{bad" })] },
	),
	run(
		"retry: stored links that are malformed",
		share(input({ links: [LINK_ROW("a", "https://example.test/")] }), {
			updateId: U1,
		}),
		{ updates: [update(U1, "shared", { links_json: "[not json" })] },
	),
	run(
		"retry: stored deliverables that are malformed",
		share(delivery({ review_window_days: 5 }), { updateId: U1 }),
		{ updates: [sharedDelivery(U1, { delivered_deliverables_json: "oops" })] },
	),
	run(
		"retry: stored JSON spaced differently",
		share(delivery({ review_window_days: 5 }), { updateId: U1 }),
		{
			updates: [
				sharedDelivery(U1, { delivered_deliverables_json: "[0, 1, 2]" }),
			],
		},
	),
	run(
		"retry: with a stale project time the retry still answers",
		share(input(), {
			updateId: U1,
			expectedProjectUpdatedAt: "2026-11-13T09:00:00.000Z",
		}),
		{ updates: [update(U1, "shared")] },
	),
	run(
		"retry: on a revoked project it is not reached",
		share(input(), { updateId: U1 }),
		{ project: { revoked_at: EARLIER }, updates: [update(U1, "shared")] },
	),
	run(
		"retry: on a complete project it is not reached",
		share(input(), { updateId: U1 }),
		{ project: { state: "complete" }, updates: [update(U1, "shared")] },
	),
	// handoff
	run("handoff: delivery accepted, handoff shared", share(handoff()), ACCEPTED),
	run("handoff: no accepted delivery", share(handoff())),
	run("handoff: a delivery that was not decided", share(handoff()), {
		updates: [sharedDelivery(U1)],
	}),
	run("handoff: changes were requested, not accepted", share(handoff()), {
		updates: [sharedDelivery(U1)],
		messages: [accepted(U1, { decision: "changes_requested" })],
	}),
	run("handoff: the acceptance is on a superseded delivery", share(handoff()), {
		updates: [sharedDelivery(U1, { status: "superseded" })],
		messages: [accepted(U1)],
	}),
	run(
		"handoff: the older shared delivery was accepted, a newer one was not",
		share(handoff()),
		{
			updates: [
				sharedDelivery(U1, { shared_at: "2026-11-13T09:00:00.000Z" }),
				sharedDelivery(U2, { shared_at: EARLIER }),
			],
			messages: [accepted(U1)],
		},
	),
	run("handoff: the newer shared delivery was accepted", share(handoff()), {
		updates: [
			sharedDelivery(U1, { shared_at: "2026-11-13T09:00:00.000Z" }),
			sharedDelivery(U2, { shared_at: EARLIER }),
		],
		messages: [accepted(U2)],
	}),
	run(
		"handoff: the accepted delivery is on another milestone",
		share(handoff()),
		{
			updates: [sharedDelivery(U1, { milestone_index: 1 })],
			messages: [accepted(U1)],
		},
	),
	run(
		"handoff: milestone two accepted and handed off",
		share(handoff({ milestone_index: 1 })),
		{
			project: { milestone_index: 1 },
			updates: [sharedDelivery(U1, { milestone_index: 1 })],
			messages: [accepted(U1)],
		},
	),
	run(
		"handoff: payment not confirmed",
		share(handoff({ paid_confirmed: false })),
		ACCEPTED,
	),
	run("handoff: no links", share(handoff({ links: [] })), ACCEPTED),
	run("handoff: no next step", share(handoff({ next_step: "" })), ACCEPTED),
	run(
		"handoff: no limitations",
		share(handoff({ checks_limitations: "" })),
		ACCEPTED,
	),
	run(
		"handoff: an unfinished link",
		share(handoff({ links: [LINK_ROW("", "https://example.test/")] })),
		ACCEPTED,
	),
	run(
		"handoff: the evidence type is forced",
		share(handoff({ evidence_type: "demonstration" })),
		ACCEPTED,
	),
	run("handoff: the payment was already recorded", share(handoff()), {
		...ACCEPTED,
		payments: [
			{
				request_id: "r1",
				milestone_index: 0,
				paid_recorded_at: "2026-11-01T00:00:00.000Z",
				recorded_by: "someone@example.test",
			},
		],
	}),
	run("handoff: an open balance invoice blocks the payment", share(handoff()), {
		...ACCEPTED,
		invoices: [invoice("si1", { kind: "balance" })],
	}),
	run(
		"handoff: an open milestone invoice blocks the payment",
		share(handoff()),
		{
			...ACCEPTED,
			invoices: [invoice("si1", { kind: "milestone", days_until_due: 30 })],
		},
	),
	run(
		"handoff: a failed balance invoice blocks the payment",
		share(handoff()),
		{ ...ACCEPTED, invoices: [invoice("si1", { status: "payment_failed" })] },
	),
	run("handoff: a paid balance invoice does not block", share(handoff()), {
		...ACCEPTED,
		invoices: [invoice("si1", { status: "paid" })],
	}),
	run("handoff: a void balance invoice does not block", share(handoff()), {
		...ACCEPTED,
		invoices: [invoice("si1", { status: "void" })],
	}),
	run("handoff: a deposit invoice does not block", share(handoff()), {
		...ACCEPTED,
		invoices: [invoice("si1", { kind: "deposit", days_until_due: 7 })],
	}),
	run(
		"handoff: an invoice for another milestone does not block",
		share(handoff()),
		{ ...ACCEPTED, invoices: [invoice("si1", { milestone_index: 1 })] },
	),
	run(
		"handoff: from a draft",
		share(handoff(), { expectedUpdatedAt: EARLIER }),
		{
			...ACCEPTED,
			updates: [...ACCEPTED.updates, update(D1, "draft", { kind: "handoff" })],
		},
	),
	run(
		"handoff: a second handoff supersedes the first",
		share(handoff({ title: "Handoff two" })),
		{
			...ACCEPTED,
			updates: [
				...ACCEPTED.updates,
				update(U3, "shared", {
					kind: "handoff",
					title: "Handoff one",
					evidence_type: "handoff",
				}),
			],
		},
	),
	run("handoff: the project is complete", share(handoff()), {
		...ACCEPTED,
		project: { state: "complete" },
	}),
	// races
	run(
		"race: the project changed",
		share(input()),
		{},
		{
			interleave: [
				RERUN(
					"another save moves the project",
					"UPDATE software_projects SET updated_at='2026-11-13T11:30:00.000Z'",
				),
			],
		},
	),
	run(
		"race: the project was revoked",
		share(delivery()),
		{},
		{
			interleave: [
				RERUN(
					"the access is revoked",
					"UPDATE software_projects SET revoked_at='2026-11-13T11:30:00.000Z'",
					/UPDATE software_project_updates SET status='superseded'/,
				),
			],
		},
	),
	run(
		"race: the project completed",
		share(input()),
		{},
		{
			interleave: [
				RERUN(
					"the project completes",
					"UPDATE software_projects SET state='complete'",
				),
			],
		},
	),
	run(
		"race: the request was withdrawn",
		share(input()),
		{},
		{
			interleave: [
				RERUN(
					"the request is withdrawn",
					"UPDATE owner_requests SET status='withdrawn'",
				),
			],
		},
	),
	run(
		"race: the deposit was removed",
		share(
			delivery({
				milestone_index: 1,
				delivered_deliverables: [0],
				criteria: ["Ships"],
			}),
		),
		{
			deposits: [
				{
					request_id: "r1",
					milestone_index: 1,
					paid_recorded_at: EARLIER,
					recorded_by: "o",
				},
			],
		},
		{
			interleave: [
				RERUN(
					"the deposit is removed",
					"DELETE FROM software_milestone_deposits",
					/UPDATE software_project_updates SET status='superseded'/,
				),
			],
		},
	),
	run("race: the acceptance was withdrawn", share(handoff()), ACCEPTED, {
		interleave: [
			RERUN(
				"the decision is removed",
				"DELETE FROM software_project_messages",
				/UPDATE software_project_updates SET status='superseded'/,
			),
		],
	}),
	run("race: a balance invoice was opened", share(handoff()), ACCEPTED, {
		interleave: [
			RERUN(
				"an invoice is opened",
				"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES ('si9','r1','o1',0,'balance',5000,15,'open','o','x','x')",
				/UPDATE software_project_updates SET status='superseded'/,
			),
		],
	}),
	run(
		"race: the same share landed first",
		share(input(), { updateId: D2 }),
		{},
		{
			interleave: [
				RERUN(
					"the same share lands elsewhere",
					`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,what_changed,email_client,shared_at,shared_by,created_by,created_at,updated_at) VALUES ('${D2}','r1','progress','shared',0,'First look','prototype','Built the first screen',0,'2026-11-13T11:59:00.000Z','o','o','2026-11-13T11:59:00.000Z','2026-11-13T11:59:00.000Z')`,
				),
			],
		},
	),
	run(
		"race: the draft was shared elsewhere",
		share(input({ title: "Mine" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			interleave: [
				RERUN(
					"the draft is shared elsewhere",
					"UPDATE software_project_updates SET status='shared',shared_at='2026-11-13T11:45:00.000Z'",
					BATCH_EDIT,
				),
			],
		},
	),
	run(
		"race: the draft was edited elsewhere",
		share(input({ title: "Mine" }), { expectedUpdatedAt: EARLIER }),
		{ updates: [update(D1, "draft")] },
		{
			interleave: [
				RERUN(
					"the draft is edited",
					"UPDATE software_project_updates SET updated_at='2026-11-13T11:45:00.000Z'",
					BATCH_EDIT,
				),
			],
		},
	),
	run(
		"race: the milestone payment was recorded elsewhere first",
		share(handoff()),
		ACCEPTED,
		{
			interleave: [
				RERUN(
					"the payment is recorded elsewhere",
					"INSERT INTO software_milestone_payments VALUES ('r1',0,'2026-11-13T11:50:00.000Z','x')",
					/UPDATE software_project_updates SET status='superseded'/,
				),
			],
		},
	),
	// outages
	run(
		"outage: the share batch fails",
		share(input()),
		{},
		{ failures: [{ on: BATCH_NEW, message: "D1 unavailable" }] },
	),
	run(
		"outage: the superseding batch fails",
		share(delivery()),
		{ updates: [sharedDelivery(U1)] },
		{
			failures: [
				{
					on: /UPDATE software_project_updates SET status='superseded'/,
					message: "D1 unavailable",
				},
			],
		},
	),
	run(
		"outage: the handoff batch fails and an invoice is payable",
		share(handoff()),
		{ ...ACCEPTED, invoices: [invoice("si1")] },
		{
			failures: [
				{ on: /INTO software_milestone_payments/, message: "D1 unavailable" },
			],
		},
	),
	run(
		"outage: the handoff batch fails with no invoice",
		share(handoff()),
		ACCEPTED,
		{
			failures: [
				{ on: /INTO software_milestone_payments/, message: "D1 unavailable" },
			],
		},
	),
	run(
		"outage: the handoff invoice lookup fails",
		share(handoff()),
		{ ...ACCEPTED, invoices: [invoice("si1")] },
		{
			failures: [
				{ on: /INTO software_milestone_payments/, message: "D1 unavailable" },
				{
					on: /FROM software_invoices WHERE request_id=\?/,
					message: "D1 unavailable",
				},
			],
		},
	),
	run(
		"outage: the retry lookup fails",
		share(input(), { updateId: U1 }),
		{ updates: [update(U1, "shared")] },
		{ failures: [{ on: /status='shared'/, message: "D1 unavailable" }] },
	),
	run(
		"outage: the draft lookup fails",
		share(input()),
		{},
		{
			failures: [
				{
					on: /WHERE request_id=\? AND status='draft'/,
					message: "D1 unavailable",
				},
			],
		},
	),
	run(
		"outage: the batch fails and the retry lookup after it fails",
		share(input(), { updateId: D2 }),
		{},
		{
			failures: [
				{ on: BATCH_NEW, message: "D1 unavailable" },
				{ on: /status='shared'/, nth: 2, message: "D1 unavailable" },
			],
		},
	),
	// sequences
	{
		name: "sequence: share, then repeat with the id it answered",
		...scene(),
		steps: [
			post(share(input())),
			post((prior) =>
				share(input(), { updateId: String(prior.answerJson(0).id) }),
			),
		],
	},
	{
		name: "sequence: share, then repeat the same request",
		...scene(),
		steps: [post(share(input())), post(share(input()))],
	},
	{
		name: "sequence: share twice with the new project time",
		...scene(),
		steps: [
			post(share(input({ title: "One" }))),
			post((prior) =>
				share(input({ title: "Two" }), {
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: a delivery, its supersede and a retry of the first",
		...scene(),
		steps: [
			post(share(delivery({ title: "One" }))),
			post((prior) =>
				share(delivery({ title: "Two" }), {
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
			post((prior) =>
				share(delivery({ title: "One" }), {
					updateId: String(prior.answerJson(0).id),
					expectedProjectUpdatedAt: String(
						prior.answerJson(1).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: draft, edit, share",
		...scene(),
		steps: [
			post(command("draft", input({ title: "One" }))),
			post((prior) =>
				command("draft", input({ title: "Two" }), {
					expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
			post((prior) =>
				share(input({ title: "Three" }), {
					expectedUpdatedAt: String(prior.answerJson(1).updatedAt),
					expectedProjectUpdatedAt: String(
						prior.answerJson(1).projectUpdatedAt,
					),
				}),
			),
			post((prior) =>
				command("draft", input({ title: "Four" }), {
					expectedProjectUpdatedAt: String(
						prior.answerJson(2).projectUpdatedAt,
					),
				}),
			),
		],
	},
	{
		name: "sequence: direction review, then delivery review, then handoff after acceptance",
		...scene(),
		steps: [
			post(share(direction())),
			post((prior) =>
				share(delivery(), {
					expectedProjectUpdatedAt: String(
						prior.answerJson(0).projectUpdatedAt,
					),
				}),
			),
			post(
				(prior) =>
					share(handoff(), {
						expectedProjectUpdatedAt: String(
							prior.answerJson(1).projectUpdatedAt,
						),
					}),
				{
					before: {
						label: "the client accepts the delivery",
						run: (world) =>
							world.music.exec(
								"INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) SELECT 'r1','client','grace@example.test','Accepted',id,'milestone_accepted','2026-11-13T12:00:00.000Z' FROM software_project_updates WHERE kind='delivery_review'",
							),
					},
				},
			),
			post((prior) =>
				share(handoff(), {
					expectedProjectUpdatedAt: String(
						prior.answerJson(2).projectUpdatedAt,
					),
				}),
			),
		],
	},
];

defineCorpus("owner-request-updates-share", POST, cases);
