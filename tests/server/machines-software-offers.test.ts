import { createEffectActor, send } from "@xstate/effect";
import * as Effect from "effect/Effect";
import { initialTransition } from "xstate";
import { describe, expect, it } from "vitest";
import {
	OFFER_EVENTS,
	OFFER_MOVES,
	OFFER_STATUSES,
	offerAllows,
	offerVersion,
} from "../../src/server/machines/offer-version";
import { next, sourcesOf } from "../../src/server/machines/next";
import { settled } from "../../src/server/machines/settled";
import {
	EMAIL_LANDING_TIMEOUT,
	hasLanded,
	type OfferEmails,
	REQUEST_STATUSES,
	RESTORED,
	softwareRequest,
} from "../../src/server/machines/software-request";
import {
	Mail,
	type MailMessage,
	MailRefused,
	MailUncertain,
} from "../../src/server/services";

// The two machines of the software offers area (docs/plans/2026-11-offers-conversion.md, section 1): the owner request's
// moves, with the two states that invoke the client email through the XState and Effect bridge, and one offer version's
// stored moves, whose `status IN (...)` lists the store will build from `OFFER_MOVES`.

describe("the owner request's moves", () => {
	const keeps = ["FIT", "DRAFT", "SEND", "REVOKE"];

	it("lets new and reviewed take every action; fit, draft, send and revoke keep the status", () => {
		for (const status of ["new", "reviewed"]) {
			for (const event of keeps)
				expect(next(softwareRequest, status, event)).toBe(status);
			expect(next(softwareRequest, status, "QUESTION")).toBe("asking");
			expect(next(softwareRequest, status, "DECLINE")).toBe("declining");
		}
	});

	it("lets resolved and withdrawn only revoke, to the same status", () => {
		for (const status of ["resolved", "withdrawn"]) {
			expect(next(softwareRequest, status, "REVOKE")).toBe(status);

			for (const event of ["FIT", "QUESTION", "DECLINE", "DRAFT", "SEND"])
				expect(next(softwareRequest, status, event)).toBeNull();
		}
	});

	it("takes no action while an email is in flight", () => {
		for (const status of ["asking", "declining"])
			for (const event of [...keeps, "QUESTION", "DECLINE"])
				expect(next(softwareRequest, status, event)).toBeNull();
	});

	it("lists the stored statuses each action is allowed from, never an invoking state", () => {
		expect(sourcesOf(softwareRequest, "REVOKE")).toEqual([...REQUEST_STATUSES]);

		for (const event of ["FIT", "QUESTION", "DECLINE", "DRAFT", "SEND"])
			expect(sourcesOf(softwareRequest, event)).toEqual(["new", "reviewed"]);
	});

	it("keeps the stored statuses of src/lib/owner-model.ts, and starts with no email tried", () => {
		expect(
			Object.keys(softwareRequest.config.states ?? {}).filter(
				(state) => state !== "asking" && state !== "declining",
			),
		).toEqual([...REQUEST_STATUSES]);
		expect(initialTransition(softwareRequest)[0].context).toEqual(RESTORED);
	});
});

describe("one offer version's moves", () => {
	it("starts a new version as a draft", () => {
		expect(initialTransition(offerVersion)[0].value).toBe("draft");
	});

	it("moves a draft by SAVE, SEND and WITHDRAW, a sent version by SUPERSEDE, REISSUE and WITHDRAW", () => {
		expect(next(offerVersion, "draft", "SAVE")).toBe("draft");
		expect(next(offerVersion, "draft", "SEND")).toBe("sent");
		expect(next(offerVersion, "draft", "WITHDRAW")).toBe("withdrawn");
		expect(next(offerVersion, "sent", "SUPERSEDE")).toBe("superseded");
		expect(next(offerVersion, "sent", "REISSUE")).toBe("sent");
		expect(next(offerVersion, "sent", "WITHDRAW")).toBe("withdrawn");
		expect(next(offerVersion, "draft", "REISSUE")).toBeNull();
		expect(next(offerVersion, "draft", "SUPERSEDE")).toBeNull();
		expect(next(offerVersion, "sent", "SAVE")).toBeNull();
		expect(next(offerVersion, "sent", "SEND")).toBeNull();
	});

	it("gives superseded and withdrawn no move", () => {
		for (const status of ["superseded", "withdrawn"] as const)
			for (const event of OFFER_EVENTS)
				expect(offerAllows(status, event)).toBe(false);
	});

	it("has the statuses of the column's CHECK", () => {
		expect(Object.keys(offerVersion.config.states ?? {})).toEqual([
			...OFFER_STATUSES,
		]);
	});

	// Each list is the one today's statements filter by (src/pages/api/owner/requests/[id]/software.ts at 6471ff2d): the
	// decline's withdraw `status IN ('sent','draft')` and F10's offer-left read `status IN ('draft','sent')`, the send's
	// supersede `status='sent'`, the draft update `status='draft'`, and the offer the send chooses: the open draft (G8 at
	// draft, which the mark-sent UPDATE gains as its filter) or, for a reissue, the sent version (G8 at sent).
	it("gives the store the status lists today's statements use, from the machine", () => {
		expect(sourcesOf(offerVersion, "WITHDRAW")).toEqual(["draft", "sent"]);
		expect(new Set(OFFER_MOVES.WITHDRAW.from)).toEqual(
			new Set(["sent", "draft"]),
		);
		expect(OFFER_MOVES).toEqual({
			SAVE: { from: ["draft"], to: "draft" },
			SEND: { from: ["draft"], to: "sent" },
			SUPERSEDE: { from: ["sent"], to: "superseded" },
			REISSUE: { from: ["sent"], to: "sent" },
			WITHDRAW: { from: ["draft", "sent"], to: "withdrawn" },
		});

		for (const event of OFFER_EVENTS)
			expect(OFFER_MOVES[event].from).toEqual(sourcesOf(offerVersion, event));
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The bridge: a question or a decline restores the machine at the stored status, sends its event with the two emails,
// and waits for the landing.

const message = (to: string, subject: string) => ({
	from: "kazon@example.test",
	reply_to: "owner@example.test",
	subject,
	text: "Hello\n\nKazon",
	to: [to],
});

const emails: OfferEmails = {
	client: message("client@example.test", "About your project brief"),
	copy: message("owner@example.test", "Copy: About your project brief"),
};

type Outcome = "sent" | "refused" | "uncertain";

/** The event that starts a decline's email, as the machine types it. */
type EmailEvent = { readonly type: "DECLINE"; readonly emails: OfferEmails };

const answer = (
	outcome: Outcome,
): Effect.Effect<void, MailRefused | MailUncertain> => {
	if (outcome === "refused") return Effect.fail(new MailRefused());

	if (outcome === "uncertain") return Effect.fail(new MailUncertain());

	return Effect.void;
};

/** A Mail that answers the client email, then the copy, as told, and records what it was asked to send. */
function fakeMail(client: Outcome, copy: Outcome = "sent") {
	const sent: string[] = [];

	return {
		sent,
		mail: {
			send: (email: MailMessage) =>
				Effect.suspend(() => {
					sent.push(email.subject);

					return answer(sent.length === 1 ? client : copy);
				}),
		},
	};
}

/**
 * Restores the machine at `status`, sends `event` (with the two emails unless `withEmails` is false), and waits for the
 * landing; gives where it landed.
 */
const land = (
	status: string,
	event: "QUESTION" | "DECLINE",
	mail: {
		send: (
			email: MailMessage,
		) => Effect.Effect<void, MailRefused | MailUncertain>;
	},
	withEmails = true,
) =>
	Effect.gen(function* () {
		const actor = yield* createEffectActor(softwareRequest, {
			snapshot: softwareRequest.getPersistedSnapshot(
				softwareRequest.resolveState({ value: status, context: RESTORED }),
			),
		});

		const bare = { type: event };

		if (withEmails)
			yield* send(
				actor,
				event === "QUESTION"
					? { type: "QUESTION", emails }
					: { type: "DECLINE", emails },
			);
		else {
			// SAFETY: the machine's events require the emails; this one leaves them out on purpose, to show that the work dies before it sends anything when an event arrives without them at run time.
			const missing = bare as EmailEvent;

			actor.send(missing);
		}

		const landed = yield* settled(actor, hasLanded, {
			timeout: EMAIL_LANDING_TIMEOUT,
		});

		return { status: landed.value, context: landed.context };
	}).pipe(Effect.scoped, Effect.provideService(Mail, mail));

describe("a decline's email through the bridge", () => {
	for (const origin of ["new", "reviewed"]) {
		it(`lands on resolved from ${origin} when the client email is accepted, then sends the copy`, async () => {
			const { sent, mail } = fakeMail("sent");

			expect(await Effect.runPromise(land(origin, "DECLINE", mail))).toEqual({
				status: "resolved",
				context: { origin, failure: null, copySent: true },
			});
			expect(sent).toEqual([
				"About your project brief",
				"Copy: About your project brief",
			]);
		});

		it(`lands back on ${origin} with the failure when the client email is refused or uncertain, and sends no copy`, async () => {
			for (const [outcome, failure] of [
				["refused", "MailRefused"],
				["uncertain", "MailUncertain"],
			] as const) {
				const { sent, mail } = fakeMail(outcome);

				expect(await Effect.runPromise(land(origin, "DECLINE", mail))).toEqual({
					status: origin,
					context: { origin, failure, copySent: false },
				});
				expect(sent).toEqual(["About your project brief"]);
			}
		});
	}

	it("lands on resolved with copySent false when only the copy fails", async () => {
		for (const copy of ["refused", "uncertain"] as const) {
			const { mail } = fakeMail("sent", copy);

			expect(
				await Effect.runPromise(land("reviewed", "DECLINE", mail)),
			).toEqual({
				status: "resolved",
				context: { origin: "reviewed", failure: null, copySent: false },
			});
		}
	});
});

describe("a question's email through the bridge", () => {
	for (const origin of ["new", "reviewed"]) {
		it(`lands back on ${origin} when the client email is accepted, with the copy's outcome`, async () => {
			const accepted = fakeMail("sent");

			expect(
				await Effect.runPromise(land(origin, "QUESTION", accepted.mail)),
			).toEqual({
				status: origin,
				context: { origin, failure: null, copySent: true },
			});

			const copyRefused = fakeMail("sent", "refused");

			expect(
				await Effect.runPromise(land(origin, "QUESTION", copyRefused.mail)),
			).toEqual({
				status: origin,
				context: { origin, failure: null, copySent: false },
			});
		});

		it(`lands back on ${origin} with the failure when the client email does not go out`, async () => {
			const { sent, mail } = fakeMail("uncertain");

			expect(await Effect.runPromise(land(origin, "QUESTION", mail))).toEqual({
				status: origin,
				context: { origin, failure: "MailUncertain", copySent: false },
			});
			expect(sent).toHaveLength(1);
		});
	}
});

describe("what the bridge never saves", () => {
	it("rejects with the original error when the email work dies, and lands nowhere", async () => {
		const bug = new Error("bug in the mail code");

		await expect(
			Effect.runPromise(
				land("new", "DECLINE", { send: () => Effect.die(bug) }),
			),
		).rejects.toBe(bug);
	});

	it("dies, and sends nothing, when the event carries no emails", async () => {
		const { sent, mail } = fakeMail("sent");

		await expect(
			Effect.runPromise(land("new", "DECLINE", mail, false)),
		).rejects.toThrow(
			"QUESTION or DECLINE reached the email without its emails.",
		);
		expect(sent).toEqual([]);
	});

	it("does not start the email when it restores into a state that invokes it", async () => {
		const { sent, mail } = fakeMail("sent");

		const status = await Effect.runPromise(
			Effect.gen(function* () {
				const actor = yield* createEffectActor(softwareRequest, {
					snapshot: softwareRequest.getPersistedSnapshot(
						softwareRequest.resolveState({
							value: "declining",
							context: { ...RESTORED, origin: "new" },
						}),
					),
				});

				yield* Effect.sleep("50 millis");

				return actor.getSnapshot().value;
			}).pipe(Effect.scoped, Effect.provideService(Mail, mail)),
		);

		expect(status).toBe("declining");
		expect(sent).toEqual([]);
	});
});
