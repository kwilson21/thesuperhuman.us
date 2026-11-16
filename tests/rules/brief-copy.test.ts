import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type {
	OwnerRequest,
	OwnerRequestStatus,
	RequestDetails,
} from "../../src/lib/owner-model";
import {
	firstCopy,
	resendCopy,
	unclaimedFailure,
} from "../../src/server/rules/brief-copy";
import { answerOf, nothingToDo, refuse, write } from "../helpers/rule-answers";
import type { Refusal } from "../../src/server/terms";

// The decisions on the client's copy of a software brief, as what the owner and the form are told: whether the copy may be
// claimed, by the public form's first send and by the owner's resend, and whether a failed claim is recorded.

const NOW = "2026-11-13T12:00:00.000Z";

const OPEN: readonly OwnerRequestStatus[] = ["new", "reviewed"];

const CLOSED: readonly OwnerRequestStatus[] = ["resolved", "withdrawn"];

const SAYS = "This brief copy cannot be sent again here.";

const request = (
	details: RequestDetails = {},
	over: Partial<OwnerRequest> = {},
): OwnerRequest => ({
	id: "r1",
	kind: "software",
	releaseId: null,
	serviceId: null,
	campaignId: null,
	name: "Grace Hopper",
	email: "grace@example.test",
	cityRegion: "",
	summary: "Build a tool",
	details,
	status: "new",
	privateNote: "",
	createdAt: "2026-11-13T11:00:00.000Z",
	updatedAt: "2026-11-13T11:00:00.000Z",
	resolvedAt: null,
	contactDeleteAfter: null,
	...over,
});

const found = (details?: RequestDetails, over?: Partial<OwnerRequest>) => ({
	request: request(details, over),
	detailsJson: JSON.stringify(details ?? {}),
});

const ask = (confirmedNotSent = false) => ({ at: NOW, confirmedNotSent });

/** A rule that always has something to write answers the write itself, or a refusal. */
const resend = (decided: Effect.Effect<unknown, Refusal>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => refuse(refusal._tag, refusal.say),
			onSuccess: (save) => write(save),
		}),
	);

describe("the owner's resend", () => {
	it("claims a copy with no status, and writes what the claim needs", () => {
		const facts = found({ path: "webapp" });

		expect(resend(resendCopy.decide(ask(), { found: facts }))).toEqual(
			write({
				at: NOW,
				request: facts.request,
				detailsJson: facts.detailsJson,
			}),
		);
	});

	it.each([
		["a null status", { clientCopyStatus: null }],
		["a failed status", { clientCopyStatus: "failed" }],
	])("claims a copy with %s", (_name, details) => {
		expect(
			resend(resendCopy.decide(ask(), { found: found(details) })).kind,
		).toBe("write");
	});

	it.each(OPEN)("claims a copy of a request that is %s", (status) => {
		expect(
			resend(resendCopy.decide(ask(), { found: found({}, { status }) })).kind,
		).toBe("write");
	});

	it("refuses when no request is stored", () => {
		expect(resend(resendCopy.decide(ask(), { found: null }))).toEqual(
			refuse("NoSuchSoftwareRequest", "There is no such software request."),
		);
	});

	it("refuses a request that is not a software request", () => {
		expect(
			resend(
				resendCopy.decide(ask(), { found: found({}, { kind: "service" }) }),
			),
		).toEqual(
			refuse("NoSuchSoftwareRequest", "There is no such software request."),
		);
	});

	it.each([
		["an array", "[]"],
		["a number", "3"],
		["text", '"x"'],
		["null", "null"],
	])(
		"refuses a software request whose stored details are %s",
		(_name, text) => {
			const details: RequestDetails = JSON.parse(text);
			const stored = request(details);

			expect(
				resend(
					resendCopy.decide(ask(), {
						found: { request: stored, detailsJson: text },
					}),
				),
			).toEqual(
				refuse(
					"BriefCopyDetailsNotObject",
					"Stored details are not a JSON object.",
				),
			);
		},
	);

	it("judges the kind before the details", () => {
		const details: RequestDetails = JSON.parse("[]");
		const stored = request(details, { kind: "service" });

		expect(
			resend(
				resendCopy.decide(ask(), {
					found: { request: stored, detailsJson: "[]" },
				}),
			),
		).toEqual(
			refuse("NoSuchSoftwareRequest", "There is no such software request."),
		);
	});

	it.each(CLOSED)("refuses a request that is %s", (status) => {
		expect(
			resend(resendCopy.decide(ask(), { found: found({}, { status }) })),
		).toEqual(refuse("BriefCopyRequestClosed", SAYS));
	});

	it("refuses a request with no address", () => {
		expect(
			resend(resendCopy.decide(ask(), { found: found({}, { email: "" }) })),
		).toEqual(refuse("BriefCopyNoAddress", SAYS));
	});

	it.each([
		["sent", { clientCopyStatus: "sent" }],
		["a status nobody writes", { clientCopyStatus: "sending" }],
		["a status that is not text", { clientCopyStatus: 1 }],
		["uncertain, not confirmed", uncertain("2026-11-13T11:58:00.000Z")],
	])("refuses a copy that is %s", (_name, details) => {
		expect(resend(resendCopy.decide(ask(), { found: found(details) }))).toEqual(
			refuse("BriefCopyNotDue", SAYS),
		);
	});

	describe("an uncertain copy, confirmed", () => {
		it.each([
			["two minutes ago", "2026-11-13T11:58:00.000Z", true],
			["61 seconds ago", "2026-11-13T11:58:59.000Z", true],
			["exactly 60 seconds ago", "2026-11-13T11:59:00.000Z", true],
			["59 seconds ago", "2026-11-13T11:59:01.000Z", false],
			["30 seconds ago", "2026-11-13T11:59:30.000Z", false],
			["in the future", "2026-11-13T12:00:30.000Z", false],
		])("attempted %s", (_name, attemptedAt, claimed) => {
			expect(
				resend(
					resendCopy.decide(ask(true), {
						found: found(uncertain(attemptedAt)),
					}),
				).kind,
			).toBe(claimed ? "write" : "refuse");
		});

		it("is held when it has no attempt time", () => {
			expect(
				resend(
					resendCopy.decide(ask(true), {
						found: found({ clientCopyStatus: "uncertain" }),
					}),
				),
			).toEqual(refuse("BriefCopyNotDue", SAYS));
		});

		it("is held when the attempt time is not text", () => {
			expect(
				resend(
					resendCopy.decide(ask(true), {
						found: found({
							clientCopyStatus: "uncertain",
							clientCopyAttemptedAt: 5,
						}),
					}),
				),
			).toEqual(refuse("BriefCopyNotDue", SAYS));
		});
	});

	it("does not need confirmation for a failed copy, and a confirmation changes nothing for it", () => {
		for (const confirmed of [true, false])
			expect(
				resend(
					resendCopy.decide(ask(confirmed), {
						found: found({ clientCopyStatus: "failed" }),
					}),
				).kind,
			).toBe("write");
	});
});

function uncertain(clientCopyAttemptedAt: string): RequestDetails {
	return { clientCopyStatus: "uncertain", clientCopyAttemptedAt };
}

describe("the public form's first copy", () => {
	it("claims a copy that has no status", () => {
		const facts = found({ path: "webapp" });

		expect(answerOf(firstCopy.decide({ at: NOW }, { found: facts }))).toEqual(
			write({
				at: NOW,
				request: facts.request,
				detailsJson: facts.detailsJson,
			}),
		);
	});

	it.each([
		["nothing stored", null],
		[
			"a request that is not a software request",
			found({}, { kind: "service" }),
		],
		["a resolved request", found({}, { status: "resolved" })],
		["a withdrawn request", found({}, { status: "withdrawn" })],
		["a request with no address", found({}, { email: "" })],
		["a sent copy", found({ clientCopyStatus: "sent" })],
		["a failed copy", found({ clientCopyStatus: "failed" })],
		["an uncertain copy", found(uncertain("2026-11-13T10:00:00.000Z"))],
	])("has nothing to claim for %s", (_name, facts) => {
		expect(answerOf(firstCopy.decide({ at: NOW }, { found: facts }))).toEqual(
			nothingToDo(),
		);
	});
});

describe("recording a failed claim", () => {
	it("records the failure over a copy that has no status, guarded by what was read", () => {
		const facts = found({ path: "webapp" });

		expect(
			answerOf(
				unclaimedFailure.decide({ id: "r1", read: true }, { found: facts }),
			),
		).toEqual(write({ id: "r1", expected: facts.detailsJson }));
	});

	it("records the failure over a copy with no status when the request could not be read", () => {
		expect(
			answerOf(
				unclaimedFailure.decide({ id: "r1", read: false }, { found: null }),
			),
		).toEqual(write({ id: "r1", expected: null }));
	});

	it.each([
		["a status", found({ clientCopyStatus: "failed" })],
		["no stored request", null],
	])("has nothing to record when there is %s", (_name, facts) => {
		expect(
			answerOf(
				unclaimedFailure.decide({ id: "r1", read: true }, { found: facts }),
			),
		).toEqual(nothingToDo());
	});
});
