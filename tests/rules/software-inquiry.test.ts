import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { OwnerRequest } from "../../src/lib/owner-model";
import {
	answerStoredBrief,
	storeBrief,
} from "../../src/server/rules/software-inquiry";
import { answerOf, nothingToDo, refuse, write } from "../helpers/rule-answers";

// The two decisions on a software brief, as what a visitor is told: whether a brief is stored, and what a brief already stored
// under the same submission id means for this visitor.

const stored: OwnerRequest = {
	id: "request-1",
	kind: "software",
	releaseId: null,
	serviceId: "workflow",
	campaignId: null,
	name: "Alex",
	email: "alex@example.com",
	cityRegion: "",
	summary: "First line",
	details: { path: "workflow" },
	status: "new",
	privateNote: "",
	createdAt: "2026-09-19T12:00:00.000Z",
	updatedAt: "2026-09-19T12:00:00.000Z",
	resolvedAt: null,
	contactDeleteAfter: null,
};

describe("storing a brief", () => {
	it("stores a brief when nothing is stored under its id and the address is within its limit", () => {
		expect(
			answerOf(storeBrief.decide({ requestAllowed: true }, { stored: null })),
		).toEqual(write(true));
	});

	it("refuses a brief from an address over its request limit", () => {
		expect(
			answerOf(storeBrief.decide({ requestAllowed: false }, { stored: null })),
		).toEqual(refuse("TooManyRequests", ""));
	});

	it("has nothing to store when a brief is already stored under the id, even over the limit", () => {
		expect(
			answerOf(storeBrief.decide({ requestAllowed: false }, { stored })),
		).toEqual(nothingToDo());
	});
});

describe("answering a stored brief", () => {
	const answer = (email: string) =>
		Effect.runSync(
			Effect.match(answerStoredBrief.decide({ email }, { stored }), {
				onFailure: (refusal) => refuse(refusal._tag, refusal.say),
				onSuccess: (request) => request.id,
			}),
		);

	it("answers the visitor who sent it with the stored brief", () => {
		expect(answer("alex@example.com")).toBe("request-1");
	});

	it("matches the address without regard to case", () => {
		expect(answer("ALEX@Example.com")).toBe("request-1");
	});

	it("refuses another address a brief stored under the id", () => {
		expect(answer("someone@else.test")).toEqual(
			refuse("SubmissionIdTaken", ""),
		);
	});
});
