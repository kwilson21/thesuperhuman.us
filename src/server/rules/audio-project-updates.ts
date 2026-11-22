// What an owner's update of a project decides, one rule per action, from the facts the flow read in one batch: the project's
// stage, due dates, `updated_at` and access, the request's status, the payments and the versions of the published files
// (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 4). Every action first needs a project that exists, is open,
// whose request is not withdrawn and that is not complete, a note of 1 to 1,000 characters and a named owner; a due date
// must be a real date not before today (project time). Each decision is re-checked at write time by the write's own
// conditions (U1 to U16: the stage the machine lists, the `updated_at` read, the project open, the request's status, the
// payments, and for `begin_revision` and `complete` a published review or final, which the corpus races), so a request that lost
// a race answers 409 at once and is not retried. The access also closes in the owner status area through the trigger
// audio_project_close_declined_request (migration 0015).
import * as Data from "effect/Data";
import { projectToday, validProjectDate } from "../../lib/project-dates";
import { KEEPING_STAGES, PROJECT_MOVES } from "../machines/audio-project";
import { alwaysWrites, term, unless } from "../terms";
import { proved } from "./software-request";

/** The project cannot take that update right now. 409. */
export class ProjectCannotTakeUpdate extends Data.TaggedError(
	"ProjectCannotTakeUpdate",
) {
	readonly say = "This project cannot take that update right now.";
}

/** The project and its request as an owner's update reads them. */
export type StoredOwnerState = {
	readonly stage: string;
	readonly current_due_at: string | null;
	readonly original_due_at: string | null;
	readonly updated_at: string;
	readonly revoked_at: string | null;
	readonly request_status: string;
	readonly email: string;
	readonly booking_status: string | null;
	readonly balance_status: string | null;
};

type Facts = {
	readonly state: StoredOwnerState | null;
	readonly published: readonly { readonly version: "review" | "final" }[];
};

type Request = {
	readonly actor: string;
	readonly body: string;
	readonly dueDate: string | null;
	readonly now: Date;
};

type Given = Facts & Request;

const refuse = () => new ProjectCannotTakeUpdate();

const given = (request: Request, facts: Facts): Given => ({
	...request,
	...facts,
});

/** What every update needs before its own conditions. */
const common = [
	unless(
		term(
			"the project exists, its access is open, the request is not withdrawn and the project is not complete",
			(g: Given) =>
				g.state !== null &&
				g.state.revoked_at === null &&
				g.state.request_status !== "withdrawn" &&
				g.state.stage !== "complete",
		),
		refuse,
	),
	unless(
		term(
			"the note is 1 to 1,000 characters and the owner is named",
			(g: Given) =>
				g.body.trim() !== "" &&
				g.body.trim().length <= 1000 &&
				g.actor.trim() !== "",
		),
		refuse,
	),
	unless(
		term(
			"a due date is a real date not before today",
			(g: Given) =>
				g.dueDate === null ||
				(validProjectDate(g.dueDate) && g.dueDate >= projectToday(g.now)),
		),
		refuse,
	),
];

/** What a stage-moving or note update writes: who, what, when, and the `updated_at` the write compares. */
const written = (g: Given) => ({
	actor: g.actor,
	body: g.body.trim(),
	at: g.now.toISOString(),
	updatedAt: proved(g.state).updated_at,
});

const stageOk = (stages: readonly string[]) => (g: Given) =>
	g.state !== null && stages.includes(g.state.stage);

/** A progress note: any stage but files_under_review and complete. */
export const progressNote = alwaysWrites({
	name: "add a progress note",
	given,
	refusals: [
		...common,
		unless(
			term("the stage takes a note", stageOk(KEEPING_STAGES.PROGRESS)),
			refuse,
		),
	],
	writes: written,
	writesText: "the note, its author and time",
});

/** Accepting the project: files under review and the request reviewed. */
export const acceptProject = alwaysWrites({
	name: "accept the project",
	given,
	refusals: [
		...common,
		unless(
			term("the project is under review", stageOk(PROJECT_MOVES.ACCEPT.from)),
			refuse,
		),
		unless(
			term(
				"the request is reviewed",
				(g: Given) => g.state?.request_status === "reviewed",
			),
			refuse,
		),
	],
	writes: (g) => ({ ...written(g), dueDate: proved(g.dueDate) }),
	writesText: "the note, the due date and the stage's move",
});

/** Starting work: accepted and the booking paid. */
export const startWork = alwaysWrites({
	name: "start work on the project",
	given,
	refusals: [
		...common,
		unless(
			term("the project is accepted", stageOk(PROJECT_MOVES.START_WORK.from)),
			refuse,
		),
		unless(
			term(
				"the booking is paid",
				(g: Given) => g.state?.booking_status === "paid",
			),
			refuse,
		),
	],
	writes: written,
	writesText: "the note and the stage's move",
});

/** Beginning a revision: the review is ready, a review is published and the booking is paid. */
export const beginRevision = alwaysWrites({
	name: "begin a revision",
	given,
	refusals: [
		...common,
		unless(
			term("the review is ready", stageOk(PROJECT_MOVES.BEGIN_REVISION.from)),
			refuse,
		),
		unless(
			term(
				"the booking is paid",
				(g: Given) => g.state?.booking_status === "paid",
			),
			refuse,
		),
		unless(
			term("a review is published", (g: Given) =>
				g.published.some((file) => file.version === "review"),
			),
			refuse,
		),
	],
	writes: written,
	writesText: "the note and the stage's move",
});

/** Completing the project: the final is ready, both payments are paid, the request is reviewed or resolved and a final is published. */
export const completeProject = alwaysWrites({
	name: "complete the project",
	given,
	refusals: [
		...common,
		unless(
			term("the final is ready", stageOk(PROJECT_MOVES.COMPLETE.from)),
			refuse,
		),
		unless(
			term(
				"the booking and the balance are paid",
				(g: Given) =>
					g.state?.booking_status === "paid" &&
					g.state.balance_status === "paid",
			),
			refuse,
		),
		unless(
			term(
				"the request is reviewed or resolved",
				(g: Given) =>
					g.state?.request_status === "reviewed" ||
					g.state?.request_status === "resolved",
			),
			refuse,
		),
		unless(
			term("a final is published", (g: Given) =>
				g.published.some((file) => file.version === "final"),
			),
			refuse,
		),
	],
	writes: written,
	writesText: "the note and the stage's move",
});

/** Moving the due date later: the project has one, and the new one is after it. */
export const reviseDueDate = alwaysWrites({
	name: "move the due date",
	given: (request: Request & { readonly reason: string }, facts: Facts) => ({
		...given(request, facts),
		reason: request.reason,
	}),
	refusals: [
		...common,
		unless(
			term("the stage takes a date move", stageOk(KEEPING_STAGES.REVISE_DATE)),
			refuse,
		),
		unless(
			term(
				"the project has a due date and the new one is later",
				(g: Given) =>
					g.state !== null &&
					g.state.current_due_at !== null &&
					g.dueDate !== null &&
					g.dueDate > g.state.current_due_at,
			),
			refuse,
		),
	],
	writes: (g) => ({
		...written(g),
		dueDate: proved(g.dueDate),
		currentDueAt: proved(proved(g.state).current_due_at),
		reason: g.reason,
	}),
	writesText: "the note, the new due date, the one it replaces and the reason",
});
