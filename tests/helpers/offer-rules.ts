import * as Effect from "effect/Effect";
import type { OfferTerms, SoftwareOffer } from "../../src/lib/software-offers";
import type { SoftwareRequest } from "../../src/server/rules/software-request";
import type { Refusal } from "../../src/server/terms";

// Helpers for the software offers rules' tests (tests/rules/offer-*.test.ts): a request and an offer as stored, what a
// rule answered in a story's words, and the order of a rule's refusals.

export const NOW = "2026-11-15T12:00:00.000Z";

/** Offer terms that read: one milestone, standard payments. */
export const offerTerms = {
	outcome: "Onboarding",
	summary: "A shared view.",
	milestones: [
		{
			name: "Tracker",
			deliverables: ["Status view"],
			acceptance: ["Add a client and identify their next action."],
			feeCents: 240000,
		},
	],
	clientInputs: "",
	exclusions: "",
	timing: "",
	paymentMode: "standard",
} satisfies OfferTerms;

/** One attachment as the details name it. */
export const attachment = {
	filename: "Requirements.pdf",
	version: "v2",
	date: "2026-10-01",
	sha256: "a".repeat(64),
	key: "agreements/attachments/123e4567-e89b-42d3-a456-426614174000.pdf",
	bytes: 1234,
};

/** Agreement details complete for `offerTerms`, with one attachment. */
export const agreementDetails = {
	planned_start: "2026-10-01",
	planned_end: "2026-10-20",
	environment: "Browser",
	operating_responsibilities: "Client operates",
	update_rhythm: "Weekly",
	milestones: [
		{
			start: "2026-10-01",
			target: "2026-10-20",
			handoff: "Source and notices",
		},
	],
	attachments: [attachment],
};

/** The contractor's details as the config stores them. */
export const contractorValues = {
	legal_name: "Example Contractor LLC",
	entity_jurisdiction: "Wyoming LLC",
	signer_name: "Example Owner",
	signer_title: "Representative",
	notice_email: "owner@example.com",
	business_address: "200 Example Business Street",
	registered_agent_confirmed: true,
};

/** A software request as `getOwnerRequest` reads it. */
export const softwareRequest = (
	over: Partial<SoftwareRequest> = {},
): SoftwareRequest => ({
	id: "r1",
	kind: "software",
	releaseId: null,
	serviceId: "workflow",
	campaignId: null,
	name: "Ada Lovelace",
	email: "ada@example.test",
	cityRegion: "",
	summary: "A brief",
	details: {},
	status: "new",
	privateNote: "",
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-15T10:00:00.000Z",
	resolvedAt: null,
	contactDeleteAfter: null,
	...over,
});

/** An offer version as `listSoftwareOffers` reads it. */
export const offer = (over: Partial<SoftwareOffer> = {}): SoftwareOffer => ({
	id: "o1",
	request_id: "r1",
	version: 1,
	status: "draft",
	terms_json: "{}",
	created_at: "2026-11-15T09:00:00.000Z",
	updated_at: "2026-11-15T09:30:00.000Z",
	sent_at: null,
	sent_by: null,
	agreement_details_json: null,
	msa_template_id: null,
	sow_template_id: null,
	contractor_snapshot_json: null,
	recipient_email_snapshot: null,
	reused_msa_id: null,
	...over,
});

/** What a rule that always writes answered: what it writes, or the name of its refusal. */
export type Answer<W> =
	| { readonly wrote: W }
	| { readonly refused: string; readonly refusal: Refusal };

export const run = <W, E extends Refusal>(
	decided: Effect.Effect<W, E>,
): Answer<W> =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, refusal }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

/** The refusal's name, or "writes". */
export const outcome = <W>(answer: Answer<W>) =>
	"refused" in answer ? answer.refused : "writes";

/** A refusal's name with the facts it carries (its own fields but its name and sentence), or "writes". */
export function refusalFacts<W>(answer: Answer<W>) {
	if (!("refused" in answer)) return { refused: "writes" };

	return {
		refused: answer.refused,
		...Object.fromEntries(
			Object.entries(answer.refusal).filter(
				([field]) => field !== "_tag" && field !== "say",
			),
		),
	};
}

/** What a rule wrote; fails the test with the refusal's name when it refused. */
export function wrote<W>(answer: Answer<W>): W {
	if ("refused" in answer)
		throw new Error(`The rule refused with ${answer.refused}`);

	return answer.wrote;
}

/**
 * The answers, one per step: the rule asked on `start`, then on `start` with each fix applied in turn. A rule whose
 * refusals come in the order the fixes are listed answers each refusal in that order, then writes.
 */
export function inOrder<S, W>(
	start: S,
	decide: (scenario: S) => Answer<W>,
	fixes: readonly ((scenario: S) => S)[],
): string[] {
	const answers = [outcome(decide(start))];
	let scenario = start;

	for (const fix of fixes) {
		scenario = fix(scenario);
		answers.push(outcome(decide(scenario)));
	}

	return answers;
}
