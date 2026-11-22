import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// An audio project's stage (`audio_projects.stage`), as docs/plans/2026-11-audio-projects-conversion.md, section 1 ("The
// project") draws it. Access is a separate fact (`revoked_at`) and is not a state here. The trigger
// `audio_project_after_service_request` creates the project at `files_under_review` (intake). The stores build each
// statement's `stage IN (...)` list from this machine (`PROJECT_MOVES`), and tests hold each list to it.
//
// ACCEPT, START_WORK, BEGIN_REVISION and COMPLETE are the owner's updates that move the stage; PROGRESS is a note and
// REVISE_DATE a date move, which leave it (PROGRESS applies in every stage but files_under_review and complete, REVISE_DATE
// in every stage but complete; that the project has a due date to move is a fact the rule reads); PUBLISH_REVIEW and PUBLISH_FINAL are a file
// being published (a review replaces the live review, a final also replaces it); REVOKE_REVIEW and REVOKE_FINAL are the
// stage reset after the only published file of a version is revoked. A file can be uploaded in the stages it can be
// published in, so an upload reads the publish moves' lists.

/** The stored stages, in the order of the column's CHECK (migrations/music/0005_audio_projects.sql). */
export const PROJECT_STAGES = [
	"files_under_review",
	"accepted",
	"in_progress",
	"review_ready",
	"revision_in_progress",
	"final_files_ready",
	"complete",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** The stored moves of a project's stage. */
export const PROJECT_EVENTS = [
	"ACCEPT",
	"START_WORK",
	"PROGRESS",
	"REVISE_DATE",
	"BEGIN_REVISION",
	"COMPLETE",
	"PUBLISH_REVIEW",
	"PUBLISH_FINAL",
	"REVOKE_REVIEW",
	"REVOKE_FINAL",
] as const;

export type ProjectEvent = (typeof PROJECT_EVENTS)[number];

export const audioProject = setup({}).createMachine({
	id: "audioProject",
	initial: "files_under_review",
	states: {
		files_under_review: {
			on: {
				ACCEPT: { target: "accepted" },
				REVISE_DATE: { target: "files_under_review" },
			},
		},
		accepted: {
			on: {
				START_WORK: { target: "in_progress" },
				PROGRESS: { target: "accepted" },
				REVISE_DATE: { target: "accepted" },
			},
		},
		in_progress: {
			on: {
				PROGRESS: { target: "in_progress" },
				REVISE_DATE: { target: "in_progress" },
				PUBLISH_REVIEW: { target: "review_ready" },
				PUBLISH_FINAL: { target: "final_files_ready" },
			},
		},
		review_ready: {
			on: {
				PROGRESS: { target: "review_ready" },
				REVISE_DATE: { target: "review_ready" },
				PUBLISH_REVIEW: { target: "review_ready" },
				PUBLISH_FINAL: { target: "final_files_ready" },
				BEGIN_REVISION: { target: "revision_in_progress" },
				REVOKE_REVIEW: { target: "in_progress" },
			},
		},
		revision_in_progress: {
			on: {
				PROGRESS: { target: "revision_in_progress" },
				REVISE_DATE: { target: "revision_in_progress" },
				PUBLISH_REVIEW: { target: "review_ready" },
				PUBLISH_FINAL: { target: "final_files_ready" },
			},
		},
		final_files_ready: {
			on: {
				PROGRESS: { target: "final_files_ready" },
				REVISE_DATE: { target: "final_files_ready" },
				PUBLISH_FINAL: { target: "final_files_ready" },
				COMPLETE: { target: "complete" },
				REVOKE_FINAL: { target: "in_progress" },
			},
		},
		complete: { on: { REVOKE_FINAL: { target: "in_progress" } } },
	},
});

/** Whether a project at this stage may take the move. */
export const stageAllows = (stage: ProjectStage, event: ProjectEvent) =>
	next(audioProject, stage, event) !== null;

/** One move as a statement writes it: the stages it is allowed from and the stage it sets. */
export type ProjectMove = {
	readonly from: readonly ProjectStage[];
	readonly to: ProjectStage;
};

/** The stages an event is allowed from, in the column's order. */
function stagesOf(event: ProjectEvent): readonly ProjectStage[] {
	return sourcesOf(audioProject, event).flatMap((source) =>
		PROJECT_STAGES.filter((stage) => stage === source),
	);
}

/** The move of an event, read from the machine: the stages it is allowed from and the one stage it sets from each. */
function moveOf(event: ProjectEvent): ProjectMove {
	const from = stagesOf(event);

	const targets = new Set(
		from.map((stage) => next(audioProject, stage, event)),
	);

	const to = PROJECT_STAGES.find((stage) => targets.has(stage));

	if (targets.size !== 1 || to === undefined)
		throw new Error(
			`The move ${event} of machine "audioProject" does not set one stage: ${JSON.stringify([...targets])}`,
		);

	return { from, to };
}

/** The events that set a stage: the others keep the stage the project is in. */
type MovingEvent = Exclude<ProjectEvent, "PROGRESS" | "REVISE_DATE">;

/** The move of each stage-setting event, read from the machine once: what the store's `stage IN (...)` lists and its writes use. */
export const PROJECT_MOVES = {
	ACCEPT: moveOf("ACCEPT"),
	START_WORK: moveOf("START_WORK"),
	BEGIN_REVISION: moveOf("BEGIN_REVISION"),
	COMPLETE: moveOf("COMPLETE"),
	PUBLISH_REVIEW: moveOf("PUBLISH_REVIEW"),
	PUBLISH_FINAL: moveOf("PUBLISH_FINAL"),
	REVOKE_REVIEW: moveOf("REVOKE_REVIEW"),
	REVOKE_FINAL: moveOf("REVOKE_FINAL"),
} satisfies { readonly [E in MovingEvent]: ProjectMove };

/** The stages a note and a date move are allowed in, read from the machine once. */
export const KEEPING_STAGES = {
	PROGRESS: stagesOf("PROGRESS"),
	REVISE_DATE: stagesOf("REVISE_DATE"),
};
