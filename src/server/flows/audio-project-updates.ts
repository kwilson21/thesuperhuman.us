// The owner's updates of a project: a progress note, accepting the project, starting work, beginning a revision, completing
// it and moving the due date, and the retry of an update's email (docs/plans/2026-11-audio-projects-conversion.md, sections 3 and 4). A
// save reads the project's state, the request, the payments and the published files in ONE batch, judges the action's rule
// (the owner is named after that read, as before) and writes with a batch that keeps today's compare-and-set conditions; a
// write whose guard no longer holds is `ProjectCannotTakeUpdate` and is not retried, because the owner's page shows the stale
// state. The clock is read once, at the start, as the save always did. The client's notice is started in the background once the
// update is saved. The routes build every answer.
import * as Effect from "effect/Effect";
import type { SavedUpdateCommand } from "../audio-project-input";
import {
	acceptProject as acceptProjectWrite,
	addProgressNote,
	beginRevision as beginRevisionWrite,
	completeProject as completeProjectWrite,
	readOwnerUpdateFacts,
	reviseDate,
	startWork as startWorkWrite,
} from "../audio-project-store";
import {
	acceptProject,
	beginRevision,
	completeProject,
	ProjectCannotTakeUpdate,
	progressNote,
	reviseDueDate,
	startWork,
} from "../rules/audio-project-updates";
import {
	deliverInBackground,
	deliverUpdateNotice,
	queueProjectUpdateNotice,
} from "./audio-project-notices";

type Request = Parameters<typeof progressNote.decide>[0];

type Facts = Parameters<typeof progressNote.decide>[1];

/** The action's rule, then its write: the update as stored, or null when the write's guard no longer held. */
function writeUpdate(
	requestId: string,
	command: SavedUpdateCommand,
	request: Request,
	facts: Facts,
) {
	switch (command.action) {
		case "progress":
			return progressNote
				.decide(request, facts)
				.pipe(Effect.flatMap((write) => addProgressNote(requestId, write)));
		case "accept":
			return acceptProject
				.decide(request, facts)
				.pipe(Effect.flatMap((write) => acceptProjectWrite(requestId, write)));
		case "start_work":
			return startWork
				.decide(request, facts)
				.pipe(Effect.flatMap((write) => startWorkWrite(requestId, write)));
		case "begin_revision":
			return beginRevision
				.decide(request, facts)
				.pipe(Effect.flatMap((write) => beginRevisionWrite(requestId, write)));
		case "complete":
			return completeProject
				.decide(request, facts)
				.pipe(
					Effect.flatMap((write) => completeProjectWrite(requestId, write)),
				);
		case "revise_date":
			return reviseDueDate
				.decide({ ...request, reason: command.reason }, facts)
				.pipe(Effect.flatMap((write) => reviseDate(requestId, write)));
	}
}

/** The owner saves an update. The update as stored. */
export const saveProjectUpdate = (input: {
	readonly requestId: string;
	readonly ownerEmail: string;
	readonly command: SavedUpdateCommand;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const { requestId, command } = input;
		const facts = yield* readOwnerUpdateFacts(requestId);

		const request = {
			actor: input.ownerEmail,
			body: command.body,
			dueDate: "dueDate" in command ? command.dueDate : null,
			now,
		};

		const saved = yield* writeUpdate(requestId, command, request, facts);

		if (saved === null)
			return yield* Effect.fail(new ProjectCannotTakeUpdate());

		yield* deliverInBackground(
			deliverUpdateNotice({ updateId: saved.id, now: input.now }),
			"Studio update email state is uncertain.",
		);

		return saved;
	});

/** The owner sends an update's email again. */
export const retryProjectUpdateEmail = (input: {
	readonly requestId: string;
	readonly updateId: number;
	readonly confirmedNotSent: boolean;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		yield* queueProjectUpdateNotice(input);

		yield* deliverInBackground(
			deliverUpdateNotice({ updateId: input.updateId, now: input.now }),
			"Studio update email state is uncertain.",
		);
	});
