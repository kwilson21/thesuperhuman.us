import { describe, expect, it } from "vitest";
import {
	audioProject,
	KEEPING_STAGES,
	PROJECT_EVENTS,
	PROJECT_MOVES,
	PROJECT_STAGES,
	stageAllows,
} from "../../src/server/machines/audio-project";
import {
	FILE_EVENTS,
	FILE_MOVES,
	FILE_STATUSES,
	fileAllows,
	projectFile,
} from "../../src/server/machines/project-file";
import { next, sourcesOf } from "../../src/server/machines/next";

// The two machines of the audio projects area (docs/plans/2026-11-audio-projects-conversion.md, section 1): a project's
// stage and a file's status. The stores build their `IN (...)` lists from `PROJECT_MOVES` and `FILE_MOVES`.

describe("a project's stage", () => {
	it("starts at files_under_review and walks accept, start, publish, complete", () => {
		expect(next(audioProject, "files_under_review", "ACCEPT")).toBe("accepted");
		expect(next(audioProject, "accepted", "START_WORK")).toBe("in_progress");
		expect(next(audioProject, "in_progress", "PUBLISH_REVIEW")).toBe(
			"review_ready",
		);
		expect(next(audioProject, "review_ready", "BEGIN_REVISION")).toBe(
			"revision_in_progress",
		);
		expect(next(audioProject, "revision_in_progress", "PUBLISH_REVIEW")).toBe(
			"review_ready",
		);
		expect(next(audioProject, "review_ready", "PUBLISH_FINAL")).toBe(
			"final_files_ready",
		);
		expect(next(audioProject, "final_files_ready", "COMPLETE")).toBe(
			"complete",
		);
	});

	it("lets a final replace the review at any working stage, and a review never follow a final", () => {
		expect(PROJECT_MOVES.PUBLISH_FINAL.from).toEqual([
			"in_progress",
			"review_ready",
			"revision_in_progress",
			"final_files_ready",
		]);
		expect(PROJECT_MOVES.PUBLISH_REVIEW.from).toEqual([
			"in_progress",
			"review_ready",
			"revision_in_progress",
		]);
	});

	it("resets to in_progress when the only published file of a version is revoked", () => {
		expect(PROJECT_MOVES.REVOKE_REVIEW).toEqual({
			from: ["review_ready"],
			to: "in_progress",
		});
		expect(PROJECT_MOVES.REVOKE_FINAL).toEqual({
			from: ["final_files_ready", "complete"],
			to: "in_progress",
		});
	});

	it("refuses a move from a stage that does not take it", () => {
		expect(stageAllows("files_under_review", "PUBLISH_REVIEW")).toBe(false);
		expect(stageAllows("accepted", "COMPLETE")).toBe(false);
		expect(stageAllows("complete", "PUBLISH_FINAL")).toBe(false);
	});

	it("lets a note in every stage but files_under_review and complete, and a date move in every stage but complete", () => {
		expect(KEEPING_STAGES.PROGRESS).toEqual([
			"accepted",
			"in_progress",
			"review_ready",
			"revision_in_progress",
			"final_files_ready",
		]);
		expect(KEEPING_STAGES.REVISE_DATE).toEqual([
			"files_under_review",
			"accepted",
			"in_progress",
			"review_ready",
			"revision_in_progress",
			"final_files_ready",
		]);

		for (const stage of KEEPING_STAGES.PROGRESS)
			expect(next(audioProject, stage, "PROGRESS")).toBe(stage);
	});

	it("reads each move's list from the machine, and each move sets one stage", () => {
		for (const event of PROJECT_EVENTS.filter(
			(name) => name !== "PROGRESS" && name !== "REVISE_DATE",
		)) {
			expect(PROJECT_MOVES[event].from).toEqual(sourcesOf(audioProject, event));

			for (const stage of PROJECT_MOVES[event].from)
				expect(next(audioProject, stage, event)).toBe(PROJECT_MOVES[event].to);
		}
	});

	it("names exactly the stages the column's CHECK allows", () => {
		expect(Object.keys(audioProject.config.states ?? {})).toEqual([
			...PROJECT_STAGES,
		]);
	});
});

describe("a file's status", () => {
	it("publishes an uploaded file, and revokes an uploaded or a published one", () => {
		expect(FILE_MOVES.PUBLISH).toEqual(["uploaded"]);
		expect(FILE_MOVES.REVOKE).toEqual(["uploaded", "published"]);
		expect(FILE_MOVES.SUPERSEDE).toEqual(["published"]);
	});

	it("has no move out of revoked", () => {
		for (const event of FILE_EVENTS)
			expect(fileAllows("revoked", event)).toBe(false);
	});

	it("names exactly the statuses the column's CHECK allows", () => {
		expect(Object.keys(projectFile.config.states ?? {})).toEqual([
			...FILE_STATUSES,
		]);
	});
});
