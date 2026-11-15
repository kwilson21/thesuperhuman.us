import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import type { SoftwareOffer } from "../../src/lib/software-offers";
import { DraftChanged } from "../../src/server/rules/offer-draft";
import {
	afterRefusedDraft,
	afterRefusedFit,
	afterRefusedQuestion,
	afterRefusedQuestionRecord,
	afterRefusedResolve,
	afterRefusedRevoke,
	afterRefusedSendOrDecline,
	type RefusedBatchRead,
	type RefusedBatchReads,
} from "../../src/server/rules/offer-refused-batch";
import type { Refusal } from "../../src/server/terms";
import { offer } from "../helpers/offer-rules";

// The answer to a refused batch, held to a literal copy of the route's lookups (the `catch` of software.ts, and its
// `changedAfterEmail` for the batches after a client email, at 6471ff2d): for every combination of what the reads find,
// the same refusal, from the same reads in the same order, and no read the route would not have made.

type Facts = {
	readonly linkLive: boolean;
	readonly sending: boolean;
	readonly projectStarted: boolean;
	readonly offers: readonly SoftwareOffer[];
};

type Answered = {
	readonly reads: readonly RefusedBatchRead[];
	readonly answer: string;
	readonly updatedAt?: string | null;
};

/** The route's lookups after a refused batch of `action` (its `catch`). */
function routeCatch(action: string, facts: Facts): Answered {
	const reads: RefusedBatchRead[] = [];

	if (action === "revoke") {
		reads.push("linkLive");

		if (!facts.linkLive) return { reads, answer: "LinkChanged" };
	}

	if (["send", "revoke", "decline"].includes(action)) {
		reads.push("sending");

		if (facts.sending) return { reads, answer: "OfferStillSending" };
	}

	if (["draft", "send", "question", "decline"].includes(action)) {
		reads.push("projectStarted");

		if (facts.projectStarted) return { reads, answer: "ProjectStarted" };
	}

	if (action === "draft") {
		reads.push("offers");

		return {
			reads,
			answer: "DraftChanged",
			updatedAt:
				facts.offers.find((value) => value.status === "draft")?.updated_at ??
				null,
		};
	}

	return { reads, answer: "RequestChanged" };
}

/** The route's lookups after a refused batch once the client email went out (`changedAfterEmail`). */
function routeAfterEmail(action: string, facts: Facts): Answered {
	const reads: RefusedBatchRead[] = ["projectStarted"];

	if (facts.projectStarted) return { reads, answer: "ProjectStarted" };

	if (action === "decline") {
		reads.push("sending");

		if (facts.sending) return { reads, answer: "OfferStillSending" };
	}

	return { reads, answer: "EmailSentButChanged" };
}

type AfterRule = {
	readonly decide: (
		request: null,
		facts: RefusedBatchReads,
	) => Effect.Effect<RefusedBatchRead, Refusal>;
};

/** Asks the rule, reads the fact it names, and asks again, until it refuses. */
function drive(rule: AfterRule, facts: Facts): Answered {
	const reads: RefusedBatchRead[] = [];
	const known: { -readonly [K in RefusedBatchRead]?: Facts[K] } = {};

	for (let asked = 0; asked < 5; asked += 1) {
		const answer = Effect.runSync(Effect.result(rule.decide(null, known)));

		if (Result.isFailure(answer)) {
			const refusal = answer.failure;

			return {
				reads,
				answer: refusal._tag,
				...(refusal instanceof DraftChanged && {
					updatedAt: refusal.updatedAt,
				}),
			};
		}

		const read = answer.success;

		reads.push(read);
		Object.assign(known, { [read]: facts[read] });
	}

	throw new Error("The rule kept asking for reads.");
}

const offerSets: readonly (readonly SoftwareOffer[])[] = [
	[],
	[offer({ status: "draft", updated_at: "2026-11-15T09:30:00.000Z" })],
	[
		offer({ status: "sent" }),
		offer({ id: "o2", version: 2, status: "withdrawn" }),
	],
];

const everyFacts: Facts[] = [false, true].flatMap((linkLive) =>
	[false, true].flatMap((sending) =>
		[false, true].flatMap((projectStarted) =>
			offerSets.map((offers) => ({
				linkLive,
				sending,
				projectStarted,
				offers,
			})),
		),
	),
);

describe("the answer to a refused batch", () => {
	const cases: [string, AfterRule][] = [
		["fit", afterRefusedFit],
		["question", afterRefusedQuestion],
		["decline", afterRefusedSendOrDecline],
		["send", afterRefusedSendOrDecline],
		["revoke", afterRefusedRevoke],
		["draft", afterRefusedDraft],
	];

	for (const [action, rule] of cases)
		it(`answers a refused ${action} batch as the route did, from the same reads in the same order`, () => {
			for (const facts of everyFacts)
				expect(drive(rule, facts), JSON.stringify(facts)).toEqual(
					routeCatch(action, facts),
				);
		});

	for (const [action, rule] of [
		["question", afterRefusedQuestionRecord],
		["decline", afterRefusedResolve],
	] as const)
		it(`answers a refused ${action} batch after the client email as the route did`, () => {
			for (const facts of everyFacts)
				expect(drive(rule, facts), JSON.stringify(facts)).toEqual(
					routeAfterEmail(action, facts),
				);
		});

	it("refuses a fit at once, reading nothing", () => {
		expect(drive(afterRefusedFit, everyFacts[0])).toEqual({
			reads: [],
			answer: "RequestChanged",
		});
	});
});
