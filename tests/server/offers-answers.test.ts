import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateOfferTerms } from "../../src/lib/software-offers";
import {
	clientEmailed,
	clientEmailFailed,
	commandRefused,
	draftSaved,
	fitReviewed,
	linkRevoked,
	liveCheckFailed,
	mailNotConfigured,
	notOwner,
	type OfferRefusal,
	offerSent,
	REFUSED_BATCH_ANSWERS,
	offersDatabaseMissing,
	offersDefect,
	refusedAnswer,
	storageMissing,
	storeFailed,
	storeFailedAfterDraft,
	storeFailedAfterEmail,
} from "../../src/server/offers-answers";
import { AlreadyResolved } from "../../src/server/rules/offer-decline";
import {
	DepositOpen,
	DepositOpenOnDecline,
	DepositPaidEarlier,
	DepositPaidOnSentOffer,
} from "../../src/server/rules/offer-deposit";
import { chooseDraft, DraftChanged } from "../../src/server/rules/offer-draft";
import {
	MsaUnavailable,
	pinDetails,
	TemplatesMissing,
} from "../../src/server/rules/offer-pin";
import * as refusedBatch from "../../src/server/rules/offer-refused-batch";
import {
	afterRefusedDraft,
	afterRefusedResolve,
	afterRefusedSendOrDecline,
	EmailSentButChanged,
	type RefusedBatchReads,
} from "../../src/server/rules/offer-refused-batch";
import { LinkChanged } from "../../src/server/rules/offer-revoke";
import {
	chooseOffer,
	LinkClosedAfterFailedEmail,
	LinkClosedWhileSending,
	LinkNotBuilt,
	NoOfferToSend,
	type SendAnswer,
} from "../../src/server/rules/offer-send";
import {
	OfferStillSending,
	ProjectStarted,
	RequestChanged,
	RequestClosed,
	RequestNotFound,
	RequestResolved,
} from "../../src/server/rules/software-request";
import type { Refusal } from "../../src/server/terms";
import { NOW, offer, offerTerms, run } from "../helpers/offer-rules";
import {
	asRecorded,
	consoleLines,
	recordedAnswer,
	type SoftwareArea,
} from "../helpers/offers-golden";

// The offers route's answers (src/server/offers-answers.ts) against what the old route answered: for each refusal, each
// success, each email failure and each fixed answer, a case of the golden corpus whose recorded status, headers and body
// bytes the answer must equal, and for a failure that is logged, the console line it recorded.

afterEach(() => {
	vi.restoreAllMocks();
});

/** The refusal a rule's answer failed with; a rule that wrote fails the test. */
function refusalOf<W>(decided: Effect.Effect<W, Refusal>) {
	const answer = run(decided);

	if (!("refused" in answer)) throw new Error("The rule wrote.");

	return answer.refusal;
}

/** The refusal, which the test knows the route answers by its tag. */
const answered = (refusal: Refusal) => {
	// SAFETY: each refusal a test passes here is one of OfferRefusal's members; the test fails at the comparison if not.
	return refusedAnswer(refusal as OfferRefusal);
};

type Expectation = readonly [
	what: string,
	answer: () => Response,
	area: SoftwareArea,
	recorded: string,
];

const SAME_AS_RECORDED: readonly Expectation[] = [
	// before the program
	["not the owner", notOwner, "fit", "a visitor"],
	["no database", offersDatabaseMissing, "fit", "no database binding"],
	[
		"a command that does not read",
		commandRefused,
		"fit",
		"a JSON body of just under 80 KiB with a note that is too long",
	],
	// refusals
	[
		"RequestNotFound",
		() => refusedAnswer(new RequestNotFound()),
		"fit",
		"an unknown request id",
	],
	[
		"ProjectStarted",
		() => refusedAnswer(new ProjectStarted()),
		"question",
		"a request with a started project",
	],
	[
		"RequestClosed",
		() => refusedAnswer(new RequestClosed()),
		"fit",
		"a withdrawn request",
	],
	[
		"RequestResolved",
		() => refusedAnswer(new RequestResolved()),
		"fit",
		"a resolved request",
	],
	[
		"AlreadyResolved",
		() => refusedAnswer(new AlreadyResolved()),
		"decline",
		"a resolved request",
	],
	[
		"RequestChanged",
		() => refusedAnswer(new RequestChanged()),
		"fit",
		"a stale expectedRequestUpdatedAt",
	],
	[
		"OfferStillSending",
		() => refusedAnswer(new OfferStillSending()),
		"decline",
		"an offer sent 10 seconds ago",
	],
	[
		"DepositOpenOnDecline",
		() => refusedAnswer(new DepositOpenOnDecline()),
		"decline",
		"a resolved request with an open deposit invoice is blocked by the deposit first",
	],
	[
		"DepositOpen",
		() => refusedAnswer(new DepositOpen()),
		"offer-send",
		"a draft sent over an offer whose deposit invoice is creating",
	],
	[
		"DepositPaidOnSentOffer",
		() => refusedAnswer(new DepositPaidOnSentOffer()),
		"offer-send",
		"a draft sent over an offer whose deposit invoice is paid",
	],
	[
		"DepositPaidEarlier",
		() => refusedAnswer(new DepositPaidEarlier()),
		"offer-send",
		"a paid deposit of a withdrawn offer blocks",
	],
	[
		"EmailSentButChanged",
		() => refusedAnswer(new EmailSentButChanged()),
		"question",
		"the request changes while the email is sent",
	],
	[
		"LinkChanged",
		() => refusedAnswer(new LinkChanged()),
		"revoke",
		"a link that is already revoked",
	],
	[
		"TermsInvalid, as the draft rule refuses terms that are not there",
		() =>
			answered(
				refusalOf(
					chooseDraft.decide(
						{
							terms: validateOfferTerms(undefined),
							expectedUpdatedAt: null,
							now: NOW,
						},
						{ offers: [] },
					),
				),
			),
		"offer-draft",
		"no terms at all",
	],
	[
		"DraftChanged with no open draft",
		() => refusedAnswer(new DraftChanged({ updatedAt: null })),
		"offer-draft",
		"a first draft that expects a time",
	],
	[
		"DraftChanged with the open draft's time",
		() =>
			refusedAnswer(
				new DraftChanged({ updatedAt: "2026-11-13T11:00:00.000Z" }),
			),
		"offer-draft",
		"an update that expects a stale time",
	],
	[
		"NoOfferToSend",
		() => refusedAnswer(new NoOfferToSend()),
		"offer-send",
		"no offer at all",
	],
	[
		"StoredTermsInvalid, as the send rule refuses a stored fee below $1",
		() => {
			const terms = {
				...offerTerms,
				milestones: [{ ...offerTerms.milestones[0], feeCents: 50 }],
			};

			return answered(
				refusalOf(
					chooseOffer.decide(
						{
							version: 1,
							expectedUpdatedAt: "2026-11-15T09:30:00.000Z",
							now: NOW,
						},
						{
							offers: [offer({ terms_json: JSON.stringify(terms) })],
							sending: false,
						},
					),
				),
			);
		},
		"offer-send",
		"stored terms with a fee below $1",
	],
	[
		"DetailsIncomplete with a reader's errors, as the pin rule refuses details that are null",
		() =>
			answered(
				refusalOf(pinDetails.decide({ terms: offerTerms }, { stored: null })),
			),
		"offer-signing",
		"details that are null",
	],
	[
		"DetailsIncomplete with no errors",
		() =>
			answered(
				refusalOf(
					pinDetails.decide({ terms: offerTerms }, { stored: "{not json" }),
				),
			),
		"offer-signing",
		"a reused MSA whose signed copy is not in R2",
	],
	[
		"TemplatesMissing",
		() => refusedAnswer(new TemplatesMissing()),
		"offer-signing",
		"no contractor details",
	],
	[
		"MsaUnavailable",
		() => refusedAnswer(new MsaUnavailable()),
		"offer-signing",
		"a reused MSA that does not exist",
	],
	[
		"LinkNotBuilt",
		() => refusedAnswer(new LinkNotBuilt()),
		"offer-send",
		"SITE_ORIGIN that is not a URL",
	],
	[
		"LinkClosedWhileSending",
		() => refusedAnswer(new LinkClosedWhileSending()),
		"offer-send",
		"the link is revoked while the email is sent",
	],
	[
		"LinkClosedAfterFailedEmail",
		() => refusedAnswer(new LinkClosedAfterFailedEmail()),
		"offer-send",
		"the link is revoked while an email that fails is sent",
	],
	// successes
	[
		"fit",
		() => fitReviewed("2026-11-13T12:00:00.000Z"),
		"fit",
		"a new request",
	],
	[
		"a question with its copy",
		() => clientEmailed(true),
		"question",
		"question: the client and the copy both sent",
	],
	[
		"a question without its copy",
		() => clientEmailed(false),
		"question",
		"question: Resend refuses the owner copy (422)",
	],
	["revoke", linkRevoked, "revoke", "a reviewed request"],
	[
		"a draft",
		() =>
			draftSaved({
				version: 1,
				updatedAt: "2026-11-13T12:00:00.000Z",
				attachmentCleanupPending: false,
			}),
		"offer-draft",
		"an attachment with its metadata row",
	],
	[
		"a draft with its cleanup pending",
		() =>
			draftSaved({
				version: 1,
				updatedAt: "2026-11-13T12:00:00.000Z",
				attachmentCleanupPending: true,
			}),
		"offer-draft",
		"a removed attachment with no R2 binding",
	],
	// the client email of a question or a decline
	[
		"a question whose email was refused",
		() => clientEmailFailed("question", "MailRefused"),
		"question",
		"question: Resend refuses the client email (422)",
	],
	[
		"a question whose email is not known to have gone",
		() => clientEmailFailed("question", "MailUncertain"),
		"question",
		"question: Resend fails with 503 on the client email",
	],
	[
		"a decline whose email was refused",
		() => clientEmailFailed("decline", "MailRefused"),
		"decline",
		"decline: Resend refuses the client email (422)",
	],
	[
		"a decline whose email is not known to have gone",
		() => clientEmailFailed("decline", "MailUncertain"),
		"decline",
		"decline: Resend fails with 503 on the client email",
	],
	// fixed answers that are not logged
	[
		"no mail settings",
		() => Effect.runSync(mailNotConfigured()),
		"question",
		"no Resend key",
	],
	[
		"no R2 binding",
		() => Effect.runSync(storageMissing()),
		"offer-signing",
		"a reused MSA with no R2 binding",
	],
	["a defect", offersDefect.answer, "offer-signing", "the template read fails"],
];

describe("the offers route's answers", () => {
	it.each(SAME_AS_RECORDED)(
		"answer %s as the old route did",
		async (_what, answer, area, recorded) => {
			expect(await asRecorded(answer())).toEqual(
				recordedAnswer(area, recorded),
			);
		},
	);

	it.each([
		["accepted", "a reviewed request"],
		["refused", "send: Resend refuses the client email (422)"],
	] as const)(
		"answer a send whose email was %s, with uncertain only when it failed",
		async (_what, recorded) => {
			const sent: SendAnswer = JSON.parse(
				recordedAnswer("offer-send", recorded).body,
			);

			expect(await asRecorded(offerSent(sent))).toEqual(
				recordedAnswer("offer-send", recorded),
			);
		},
	);
});

describe("the fixed answers to a failure", () => {
	const logged = async (
		answer: Effect.Effect<Response>,
		area: SoftwareArea,
		recorded: string,
	) => {
		const lines = vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await Effect.runPromise(answer);

		expect(await asRecorded(response)).toEqual(recordedAnswer(area, recorded));
		expect(lines.mock.calls).toEqual(consoleLines(area, recorded));
		lines.mockRestore();
	};

	it("log a failed store once and answer 500, as before any outside effect", async () => {
		let failure: unknown;

		try {
			JSON.parse("{not json");
		} catch (error) {
			failure = error;
		}

		await logged(
			storeFailed(failure),
			"fit",
			"a request whose stored details are not JSON",
		);
		await logged(
			storeFailed(new Error("r2 get failed")),
			"offer-signing",
			"an attachment whose R2 read throws",
		);
	});

	it("say what happened when the store fails after the email, the draft or the send", async () => {
		const down = new Error("D1 is down");

		await logged(
			storeFailedAfterEmail(down),
			"question",
			"the recording batch fails",
		);
		await logged(
			storeFailedAfterDraft(down),
			"offer-draft",
			"a failed R2 delete and the metadata put back also fails",
		);
		await logged(
			liveCheckFailed(true)(down),
			"offer-send",
			"the check after the email fails",
		);
		await logged(
			liveCheckFailed(false)(down),
			"offer-send",
			"the check after the email fails when the email failed too",
		);
	});
});

describe("the refusals the reads after a refused batch answer", () => {
	it("name, for each action, a rule of the refused-batch rules", () => {
		const rules = Object.values(REFUSED_BATCH_ANSWERS).flatMap((byAction) =>
			Object.values(byAction),
		);

		for (const rule of rules)
			expect(refusedBatch[rule].decide, rule).toBeTypeOf("function");
	});

	/** The refusal a refused-batch rule ends in, once every fact it asks for is read. */
	const ended = (
		rule: {
			readonly decide: (
				request: null,
				facts: RefusedBatchReads,
			) => Effect.Effect<unknown, Refusal>;
		},
		facts: RefusedBatchReads,
	) => answered(refusalOf(rule.decide(null, facts)));

	it.each([
		[
			"a draft's attachment with no row (AttachmentNotUsable)",
			() => ended(afterRefusedDraft, { projectStarted: false, offers: [] }),
			"offer-draft",
			"an attachment with no metadata row",
		],
		[
			"a draft's reused MSA that does not exist (MsaNotFound)",
			() => ended(afterRefusedDraft, { projectStarted: false, offers: [] }),
			"offer-draft",
			"an MSA reuse confirmed with an MSA that does not exist",
		],
		[
			"a draft whose open draft another tab saved first",
			() =>
				ended(afterRefusedDraft, {
					projectStarted: false,
					offers: [
						offer({ status: "draft", updated_at: "2026-11-13T11:45:00.000Z" }),
					],
				}),
			"offer-draft",
			"the draft changes before the batch updates it",
		],
		[
			"a send stopped by a signed agreement (AgreementSigned)",
			() =>
				ended(afterRefusedSendOrDecline, {
					sending: false,
					projectStarted: false,
				}),
			"offer-send",
			"a signed agreement stops the send",
		],
		[
			"a send of stored terms that are not JSON (StoredTermsUnreadable)",
			() =>
				ended(afterRefusedSendOrDecline, {
					sending: false,
					projectStarted: false,
				}),
			"offer-send",
			"stored terms that are not JSON",
		],
		[
			"a reissue while the link is live (LinkNotRevoked)",
			() =>
				ended(afterRefusedSendOrDecline, {
					sending: false,
					projectStarted: false,
				}),
			"offer-send",
			"a sent offer whose link is live is not reissued",
		],
		[
			"a decline with an audio project (AudioProjectExists)",
			() =>
				ended(afterRefusedSendOrDecline, {
					sending: false,
					projectStarted: false,
				}),
			"decline",
			"an audio project for the request blocks the decline",
		],
		[
			"a decline that finds a draft left after its email (OfferLeftAfterEmail)",
			() =>
				ended(afterRefusedResolve, { projectStarted: false, sending: false }),
			"decline",
			"a draft is saved while the email is sent",
		],
		[
			"a decline that finds a sent offer's link still sending after its email (OfferLeftAfterEmail)",
			() =>
				ended(afterRefusedResolve, { projectStarted: false, sending: true }),
			"decline",
			"a draft is saved and sent while the email is sent, its link made a moment ago",
		],
	] as const)(
		"answer %s through those reads, as the old route did",
		async (_what, answer, area, recorded) => {
			expect(await asRecorded(answer())).toEqual(
				recordedAnswer(area, recorded),
			);
		},
	);
});
