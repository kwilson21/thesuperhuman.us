import { describe, expect, it } from "vitest";
import {
	NOTICE_EVENTS,
	NOTICE_MOVES,
	NOTICE_STATUSES,
	noticeAllows,
	projectNotice,
} from "../../src/server/machines/project-notice";

// The notice machine (docs/plans/2026-11-audio-projects-conversion.md, section 1): the invitation and an update's notice
// share it, and the stores build their `status IN (...)` lists from `NOTICE_MOVES`.

describe("a notice's delivery", () => {
	it("is queued again from pending or failed, and from sending only when confirmed and stale", () => {
		expect(NOTICE_MOVES.QUEUE).toEqual(["pending", "failed"]);
		expect(NOTICE_MOVES.QUEUE_RETRYABLE).toEqual(["sending"]);
		expect(noticeAllows("sending", "QUEUE")).toBe(false);
		expect(noticeAllows("sending", "QUEUE", true)).toBe(true);
		expect(noticeAllows("sent", "QUEUE", true)).toBe(false);
	});

	it("is claimed from pending, and ends sent or failed from sending", () => {
		expect(NOTICE_MOVES.CLAIM).toEqual(["pending"]);
		expect(NOTICE_MOVES.SEND).toEqual(["sending"]);
		expect(NOTICE_MOVES.FAIL).toEqual(["sending"]);
	});

	it("has no move out of sent", () => {
		for (const event of NOTICE_EVENTS)
			expect(noticeAllows("sent", event, true)).toBe(false);
	});

	it("names exactly the statuses the columns' CHECK allows", () => {
		expect(Object.keys(projectNotice.config.states ?? {})).toEqual([
			...NOTICE_STATUSES,
		]);
	});
});
