import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	answerReview,
	type StoredFile,
} from "../../src/server/rules/audio-project-messages";

// The answer rule on the latest published review: when two reviews share the latest publication time, the answer may name
// either of them, because the write's own lookup may take any of the tied reviews.

const AT = new Date("2026-11-13T12:00:00.000Z");
const PUBLISHED = "2026-11-13T11:00:00.000Z";

const review = (id: string, published_at: string | null): StoredFile => ({
	id,
	version: "review",
	status: "published",
	published_at,
});

const answered = (reviewId: string, files: readonly StoredFile[]) =>
	Effect.runSync(
		Effect.match(
			answerReview.decide(
				{ decision: "approved", reviewId, text: "Approved.", at: AT },
				{
					project: {
						request_id: "song-1",
						stage: "review_ready",
						revoked_at: null,
					},
					files,
					decisions: [],
					updates: [],
					count: 0,
				},
			),
			{
				onFailure: (refusal) => ({ refused: refusal._tag }),
				onSuccess: (write) => ({ wrote: write.reviewId }),
			},
		),
	);

describe("the answer to the latest review", () => {
	it("takes the later of two reviews", () => {
		const files = [
			review("old", "2026-11-12T11:00:00.000Z"),
			review("new", PUBLISHED),
		];

		expect(answered("new", files)).toEqual({ wrote: "new" });
		expect(answered("old", files)).toEqual({ refused: "ReviewNotAnswerable" });
	});

	it("takes either of two reviews published at the same time, and none older", () => {
		const files = [
			review("old", "2026-11-12T11:00:00.000Z"),
			review("first", PUBLISHED),
			review("second", PUBLISHED),
		];

		expect(answered("first", files)).toEqual({ wrote: "first" });
		expect(answered("second", files)).toEqual({ wrote: "second" });
		expect(answered("old", files)).toEqual({ refused: "ReviewNotAnswerable" });
	});
});
