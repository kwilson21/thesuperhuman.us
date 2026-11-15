import { describe, expect, it } from "vitest";
import { OFFER_MOVES } from "../../src/server/machines/offer-version";
import {
	declineDeposits,
	declineFront,
	declineNotSending,
	declineRequest,
	resolveDeclined,
} from "../../src/server/rules/offer-decline";
import { draftFront } from "../../src/server/rules/offer-draft";
import { reviewFit } from "../../src/server/rules/offer-fit";
import { askQuestion } from "../../src/server/rules/offer-question";
import { type LinkRow, revokeLink } from "../../src/server/rules/offer-revoke";
import { sendFront } from "../../src/server/rules/offer-send";
import {
	findSoftwareRequest,
	offerEmails,
	retireSigning,
	type SoftwareRequest,
	writeTime,
} from "../../src/server/rules/software-request";
import type { DepositInvoice } from "../../src/lib/software-deposit-block";
import {
	inOrder,
	NOW,
	outcome,
	run,
	softwareRequest,
	wrote,
} from "../helpers/offer-rules";

// The rules of the request-level actions of POST /api/owner/requests/[id]/software (docs/plans/2026-11-offers-conversion.md,
// section 2): the front every action shares, fit, question, revoke and decline. Each refusal comes in the order the route
// has always answered; the front is held to a literal copy of the route's own front checks.

const STATUSES = ["new", "reviewed", "resolved", "withdrawn"] as const;

describe("finding the request", () => {
	it("refuses no request, and a request of another kind, as not found", () => {
		expect(
			outcome(run(findSoftwareRequest.decide(null, { request: null }))),
		).toBe("RequestNotFound");

		for (const kind of ["purchase", "merchandise", "service"] as const)
			expect(
				outcome(
					run(
						findSoftwareRequest.decide(null, {
							request: { ...softwareRequest(), kind },
						}),
					),
				),
			).toBe("RequestNotFound");
	});

	it("writes the software request it found", () => {
		const request = softwareRequest();

		expect(wrote(run(findSoftwareRequest.decide(null, { request })))).toBe(
			request,
		);
	});
});

/** The route's front checks, copied from software.ts at 6471ff2d, for the oracle. */
function routeFront(
	action: string,
	request: SoftwareRequest,
	projectStarted: boolean,
): string {
	if (
		["draft", "send", "question", "decline"].includes(action) &&
		projectStarted
	)
		return "ProjectStarted";

	if ((request.status === "withdrawn" && action !== "revoke") || !request.email)
		return "RequestClosed";

	if (
		request.status === "resolved" &&
		["draft", "send", "fit", "question"].includes(action)
	)
		return "RequestResolved";

	return "writes";
}

describe("the front every action shares", () => {
	const link: LinkRow = {
		created_at: "2026-11-15T09:00:00.000Z",
		revoked_at: null,
	};

	/** Each action's first answer, as its rule (or first stage) gives it. */
	type Front = (request: SoftwareRequest, projectStarted: boolean) => string;

	const fronts = {
		fit: (request) =>
			outcome(
				run(
					reviewFit.decide(
						{ label: "potential-fit", note: "", now: NOW, actor: "owner" },
						{ request },
					),
				),
			),
		question: (request, projectStarted) =>
			outcome(
				run(
					askQuestion.decide(
						{ text: "Why?", now: NOW, actor: "owner" },
						{ request, projectStarted },
					),
				),
			),
		decline: (request, projectStarted) =>
			outcome(run(declineFront.decide(null, { request, projectStarted }))),
		draft: (request, projectStarted) =>
			outcome(run(draftFront.decide(null, { request, projectStarted }))),
		send: (request, projectStarted) =>
			outcome(run(sendFront.decide(null, { request, projectStarted }))),
		revoke: (request) =>
			outcome(
				run(
					revokeLink.decide(
						{
							expectedLinkCreatedAt: link.created_at,
							now: NOW,
							since: "2026-11-15T11:59:40.000Z",
							actor: "owner",
						},
						{ request, link },
					),
				),
			),
	} satisfies Record<string, Front>;

	it("answers as the route's front for every action, status, email and project", () => {
		for (const [action, front] of Object.entries(fronts))
			for (const status of STATUSES)
				for (const email of ["ada@example.test", ""])
					for (const projectStarted of [false, true]) {
						const request = softwareRequest({ status, email });

						// Fit and revoke never read the project, so their rules never see one.
						const read = ["fit", "revoke"].includes(action)
							? false
							: projectStarted;

						expect(
							front(request, read),
							`${action} ${status} ${email || "no email"} ${projectStarted}`,
						).toBe(routeFront(action, request, read));
					}
	});
});

describe("the write time", () => {
	it("is the time read, or one millisecond after a version read that is not earlier", () => {
		expect(writeTime(NOW, null)).toBe(NOW);
		expect(writeTime(NOW, "2026-11-15T11:59:59.999Z")).toBe(NOW);
		expect(writeTime(NOW, NOW)).toBe("2026-11-15T12:00:00.001Z");
		expect(writeTime(NOW, "2026-11-15T12:00:05.000Z")).toBe(
			"2026-11-15T12:00:05.001Z",
		);
		expect(writeTime(NOW, "not a time")).toBe(NOW);
	});
});

describe("retiring signing and the two emails", () => {
	it("keeps an abandoned review 90 days", () => {
		expect(retireSigning(NOW)).toEqual({
			at: NOW,
			retainUntil: "2027-02-13T12:00:00.000Z",
		});
	});

	it("sends the client the email and the owner a copy of it", () => {
		expect(
			offerEmails(
				{ from: "kazon@example.test", owner: "owner@example.test" },
				"ada@example.test",
				{ subject: "About your project brief", text: "No\n\nKazon" },
			),
		).toEqual({
			client: {
				from: "kazon@example.test",
				reply_to: "owner@example.test",
				subject: "About your project brief",
				text: "No\n\nKazon",
				to: ["ada@example.test"],
			},
			copy: {
				from: "kazon@example.test",
				reply_to: "owner@example.test",
				subject: "Copy: About your project brief",
				text: "No\n\nKazon",
				to: ["owner@example.test"],
			},
		});
	});
});

describe("fit", () => {
	const fit = (request: SoftwareRequest, expectedRequestUpdatedAt?: string) =>
		run(
			reviewFit.decide(
				{
					label: "needs-clarification",
					note: "Ask about volume",
					expectedRequestUpdatedAt,
					now: NOW,
					actor: "owner@example.test",
				},
				{ request },
			),
		);

	it("refuses closed, then resolved, then a page that saw another updated_at", () => {
		expect(
			inOrder<SoftwareRequest, unknown>(
				softwareRequest({ status: "withdrawn", email: "" }),
				(request) => fit(request, "2026-11-01T00:00:00.000Z"),
				[
					(request) => ({
						...request,
						status: "resolved",
						email: "ada@example.test",
					}),
					(request) => ({ ...request, status: "reviewed" }),
					(request) => ({ ...request, updatedAt: "2026-11-01T00:00:00.000Z" }),
				],
			),
		).toEqual(["RequestClosed", "RequestResolved", "RequestChanged", "writes"]);
	});

	it("writes the review at the write time, with the request as read for G1", () => {
		const request = softwareRequest({ updatedAt: NOW });

		expect(wrote(fit(request))).toEqual({
			request: {
				id: "r1",
				updatedAt: NOW,
				status: "new",
				email: "ada@example.test",
			},
			label: "needs-clarification",
			note: "Ask about volume",
			at: "2026-11-15T12:00:00.001Z",
			actor: "owner@example.test",
			audit: "fit-reviewed",
		});
	});

	it("does not refuse for a started project, which it never reads", () => {
		expect(outcome(fit(softwareRequest()))).toBe("writes");
	});
});

describe("question", () => {
	const ask = (request: SoftwareRequest, projectStarted: boolean) =>
		run(
			askQuestion.decide(
				{ text: "What volume?", now: NOW, actor: "owner@example.test" },
				{ request, projectStarted },
			),
		);

	it("refuses a started project, then closed, then resolved", () => {
		expect(
			inOrder<{ request: SoftwareRequest; projectStarted: boolean }, unknown>(
				{
					request: softwareRequest({ status: "withdrawn", email: "" }),
					projectStarted: true,
				},
				(s) => ask(s.request, s.projectStarted),
				[
					(s) => ({ ...s, projectStarted: false }),
					(s) => ({
						...s,
						request: { ...s.request, status: "resolved", email: "a@b.co" },
					}),
					(s) => ({ ...s, request: { ...s.request, status: "reviewed" } }),
				],
			),
		).toEqual(["ProjectStarted", "RequestClosed", "RequestResolved", "writes"]);
	});

	it("writes the reservation's time and the client's question, signed", () => {
		expect(wrote(ask(softwareRequest(), false))).toMatchObject({
			at: NOW,
			to: "ada@example.test",
			email: {
				subject: "A question about your project brief",
				text: "What volume?\n\nKazon",
			},
			audit: "question-sent",
		});
	});
});

describe("revoke", () => {
	const since = "2026-11-15T11:59:40.000Z";

	const revoke = (s: {
		request: SoftwareRequest;
		link: LinkRow | null;
		expected: string;
	}) =>
		run(
			revokeLink.decide(
				{
					expectedLinkCreatedAt: s.expected,
					now: NOW,
					since,
					actor: "owner@example.test",
				},
				{ request: s.request, link: s.link },
			),
		);

	it("refuses no email, then a link that is not the page's live link, then one still sending", () => {
		expect(
			inOrder<
				{ request: SoftwareRequest; link: LinkRow | null; expected: string },
				unknown
			>(
				{
					request: softwareRequest({ status: "withdrawn", email: "" }),
					link: null,
					expected: "2026-11-15T11:59:50.000Z",
				},
				revoke,
				[
					(s) => ({ ...s, request: { ...s.request, email: "a@b.co" } }),
					(s) => ({
						...s,
						link: { created_at: s.expected, revoked_at: null },
					}),
					(s) => ({
						...s,
						expected: since,
						link: { created_at: since, revoked_at: null },
					}),
				],
			),
		).toEqual(["RequestClosed", "LinkChanged", "OfferStillSending", "writes"]);
	});

	it("is allowed from every status, and refuses a revoked link and another link as changed", () => {
		const link = { created_at: since, revoked_at: null };

		for (const status of STATUSES)
			expect(
				outcome(
					revoke({
						request: softwareRequest({ status }),
						link,
						expected: since,
					}),
				),
			).toBe("writes");

		expect(
			outcome(
				revoke({
					request: softwareRequest(),
					link: { ...link, revoked_at: NOW },
					expected: since,
				}),
			),
		).toBe("LinkChanged");
		expect(
			outcome(
				revoke({
					request: softwareRequest(),
					link,
					expected: "2026-11-15T10:00:00.000Z",
				}),
			),
		).toBe("LinkChanged");
	});

	it("writes at the time as read, with the page's link and signing retired", () => {
		expect(
			wrote(
				revoke({
					request: softwareRequest({ updatedAt: "2026-11-15T12:00:09.000Z" }),
					link: { created_at: since, revoked_at: null },
					expected: since,
				}),
			),
		).toMatchObject({
			at: NOW,
			linkCreatedAt: since,
			signing: retireSigning(NOW),
			audit: { action: "offer-link-revoked", note: "" },
		});
	});
});

describe("decline", () => {
	const deposit = (status: string): DepositInvoice => ({
		milestoneIndex: 0,
		kind: "deposit",
		status,
		refunded: false,
		offerStatus: "sent",
	});

	type Scenario = {
		request: SoftwareRequest;
		projectStarted: boolean;
		invoices: DepositInvoice[];
		sending: boolean;
		signedAgreement: boolean;
		audioProject: boolean;
	};

	/** The stages in the flow's order, each asked only when the one before it let the decline go on. */
	const decline = (s: Scenario) => {
		const stages = [
			() => run(declineFront.decide(null, s)),
			() => run(declineDeposits.decide(null, s)),
			() => run(declineNotSending.decide(null, s)),
			() =>
				run(
					declineRequest.decide(
						{ text: "Not a fit", now: NOW, actor: "owner@example.test" },
						s,
					),
				),
		];

		for (const stage of stages) {
			const answer = stage();

			if ("refused" in answer) return answer;
		}

		return stages[3]();
	};

	it("refuses in the route's order: project, closed, open deposit, resolved, sending, signed, audio project", () => {
		expect(
			inOrder<Scenario, unknown>(
				{
					request: softwareRequest({ status: "resolved", email: "" }),
					projectStarted: true,
					invoices: [deposit("open")],
					sending: true,
					signedAgreement: true,
					audioProject: true,
				},
				decline,
				[
					(s) => ({ ...s, projectStarted: false }),
					(s) => ({ ...s, request: { ...s.request, email: "a@b.co" } }),
					(s) => ({ ...s, invoices: [deposit("paid")] }),
					(s) => ({ ...s, request: { ...s.request, status: "reviewed" } }),
					(s) => ({ ...s, sending: false }),
					(s) => ({ ...s, signedAgreement: false }),
					(s) => ({ ...s, audioProject: false }),
				],
			),
		).toEqual([
			"ProjectStarted",
			"RequestClosed",
			"DepositOpenOnDecline",
			"AlreadyResolved",
			"OfferStillSending",
			"AgreementSigned",
			"AudioProjectExists",
			"writes",
		]);
	});

	it("does not refuse a withdrawn request's decline as resolved, but as closed", () => {
		expect(
			outcome(
				run(
					declineFront.decide(null, {
						request: softwareRequest({ status: "withdrawn" }),
						projectStarted: false,
					}),
				),
			),
		).toBe("RequestClosed");
	});

	it("withdraws the draft and sent offers, by the machine, and emails the client", () => {
		const request = softwareRequest({ updatedAt: NOW });

		const write = wrote(
			run(
				declineRequest.decide(
					{ text: "Not a fit", now: NOW, actor: "owner@example.test" },
					{ request, signedAgreement: false, audioProject: false },
				),
			),
		);

		expect(write).toMatchObject({
			at: "2026-11-15T12:00:00.001Z",
			withdraw: { from: ["draft", "sent"], to: "withdrawn" },
			signing: retireSigning("2026-11-15T12:00:00.001Z"),
			audit: {
				action: "offer-link-revoked",
				note: "Offer withdrawn and link closed to decline the request",
			},
			to: "ada@example.test",
			email: {
				subject: "About your project brief",
				text: "Not a fit\n\nKazon",
			},
		});
		expect(write.withdraw).toBe(OFFER_MOVES.WITHDRAW);
	});

	it("resolves after the email only when no offer is left, guarded by the updated_at the first batch wrote", () => {
		const write = wrote(
			run(
				declineRequest.decide(
					{ text: "No", now: NOW, actor: "owner@example.test" },
					{
						request: softwareRequest(),
						signedAgreement: false,
						audioProject: false,
					},
				),
			),
		);

		expect(
			outcome(
				run(
					resolveDeclined.decide(
						{ write, landed: "resolved" },
						{ offerLeft: true },
					),
				),
			),
		).toBe("OfferLeftAfterEmail");
		expect(
			wrote(
				run(
					resolveDeclined.decide(
						{ write, landed: "resolved" },
						{ offerLeft: false },
					),
				),
			),
		).toEqual({
			request: { ...write.request, updatedAt: NOW },
			at: NOW,
			actor: "owner@example.test",
			status: "resolved",
			noOfferIn: ["draft", "sent"],
			audit: "declined",
		});
	});
});
