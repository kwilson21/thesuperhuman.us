import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// One project file's stored moves (`audio_project_files.status`), as docs/plans/2026-11-audio-projects-conversion.md,
// section 1 ("A file") draws them. An upload completing writes the row at `uploaded` (the machine's initial state). PUBLISH
// needs the booking paid (and, for a final, the balance), and SUPERSEDE is a published review replaced when any file is
// published; both are facts the rules read. REVOKE ends an uploaded file with no note, or a published one with a note.
// Revoked has no moves. The stores build each statement's `status IN (...)` list from this machine (`FILE_MOVES`).

/** The stored statuses, in the order of the column's CHECK. */
export const FILE_STATUSES = ["uploaded", "published", "revoked"] as const;

export type FileStatus = (typeof FILE_STATUSES)[number];

/** The stored moves of a file. */
export const FILE_EVENTS = ["PUBLISH", "REVOKE", "SUPERSEDE"] as const;

export type FileEvent = (typeof FILE_EVENTS)[number];

export const projectFile = setup({}).createMachine({
	id: "projectFile",
	initial: "uploaded",
	states: {
		uploaded: {
			on: {
				PUBLISH: { target: "published" },
				REVOKE: { target: "revoked" },
			},
		},
		published: {
			on: {
				REVOKE: { target: "revoked" },
				SUPERSEDE: { target: "revoked" },
			},
		},
		revoked: { type: "final" },
	},
});

/** Whether a file in this status may take the move. */
export const fileAllows = (status: FileStatus, event: FileEvent) =>
	next(projectFile, status, event) !== null;

/** The statuses an event is allowed from, read from the machine once: what the store's `status IN (...)` lists use. */
export const FILE_MOVES = {
	PUBLISH: sourcesOf(projectFile, "PUBLISH").flatMap((source) =>
		FILE_STATUSES.filter((status) => status === source),
	),
	REVOKE: sourcesOf(projectFile, "REVOKE").flatMap((source) =>
		FILE_STATUSES.filter((status) => status === source),
	),
	SUPERSEDE: sourcesOf(projectFile, "SUPERSEDE").flatMap((source) =>
		FILE_STATUSES.filter((status) => status === source),
	),
} satisfies { readonly [E in FileEvent]: readonly FileStatus[] };
