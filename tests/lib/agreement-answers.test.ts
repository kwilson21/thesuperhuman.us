import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	archiveVerifyFailed,
	attachmentUploadFailed,
	attachmentUploadUnavailable,
	type FailureAnswer,
	ownerAgreementsFailed,
	ownerAgreementsUnavailable,
	ownerAttachmentFailed,
	ownerAttachmentUnavailable,
	ownerCopyFailed,
	ownerCopyUnavailable,
	ownerRequestAgreementFailed,
	ownerRequestAgreementUnavailable,
	redeemExpired,
	retentionUnavailable,
	signingDraftFailed,
	signingDraftUnavailable,
	signingLinkFailed,
	signingLinkUnavailable,
	signingReviewDocumentUnavailable,
	signingReviewFailed,
	signingReviewUnavailable,
	signingSignFailed,
	signingSignUnavailable,
	signingVerifyFailed,
} from "../../src/lib/agreement-access";
import { loggedAnswer } from "../../src/server/answers";
import { runRoute } from "../../src/server/run";
import { asRecorded, type RecordedAnswer } from "../helpers/offers-golden";

// The fixed answers of the signing and agreement routes (src/lib/agreement-access.ts) against what today's routes
// answered: each one's status, headers and body bytes equal a golden case's recorded answer, and each failure answer's
// label is the one that case's console line was logged under. Run as `runRoute` runs a defect, and as a route answers a
// named store failure (`loggedAnswer`), each logs that same line once and answers the same bytes.

afterEach(() => {
	vi.restoreAllMocks();
});

type RecordedCase = {
	readonly name: string;
	readonly steps: readonly { readonly answer: RecordedAnswer }[];
	readonly effects: readonly {
		readonly kind: string;
		readonly step?: number;
		readonly args?: readonly string[];
	}[];
};

const corpora = new Map<string, readonly RecordedCase[]>();

/** Every recorded case of a golden corpus. */
function readCorpus(corpus: string): readonly RecordedCase[] {
	// SAFETY: the fixture files are written only by the golden harness (tests/golden/harness/fixtures.ts), as a JSON array of recorded cases with their steps and effects.
	return JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(`../golden/fixtures/${corpus}.json.gz`, import.meta.url),
			),
		).toString("utf8"),
	) as RecordedCase[];
}

/** A recorded golden case; a name the corpus does not have fails the test. */
function recordedCase(corpus: string, name: string): RecordedCase {
	const cases = corpora.get(corpus) ?? readCorpus(corpus);

	corpora.set(corpus, cases);

	const found = cases.find((recorded) => recorded.name === name);

	if (!found) throw new Error(`No ${corpus} case named "${name}".`);

	return found;
}

/** Where an answer was recorded: the corpus, the case and its step. */
type Recorded = readonly [corpus: string, name: string, step?: number];

const answerOf = ([corpus, name, step = 0]: Recorded) => {
	const answer = recordedCase(corpus, name).steps[step]?.answer;

	if (!answer)
		throw new Error(`The ${corpus} case "${name}" has no step ${step}.`);

	return answer;
};

/** The first argument of each console line a recorded case's step logged. */
const consoleLines = ([corpus, name, step = 0]: Recorded) =>
	recordedCase(corpus, name).effects.flatMap((effect) =>
		effect.kind === "console" && effect.step === step && effect.args
			? [effect.args[0]]
			: [],
	);

const UNAVAILABLE: readonly (readonly [
	what: string,
	answer: () => Response,
	recorded: readonly Recorded[],
])[] = [
	[
		"the signing link",
		signingLinkUnavailable,
		[["offer-link", "no database binding (json)"]],
	],
	[
		"a verify page's redeem",
		redeemExpired,
		[
			["offer-link", "the emailed link expires after an hour (json)", 1],
			["agreements-link", "a key that is not 43 characters (json)", 1],
		],
	],
	[
		"the signing draft",
		signingDraftUnavailable,
		[["offer-draft", "no database binding (json)"]],
	],
	[
		"the review's POST",
		signingReviewUnavailable,
		[["offer-review", "no database binding (json)"]],
	],
	[
		"the review's GET",
		signingReviewDocumentUnavailable,
		[["offer-review", "no database binding"]],
	],
	["the signature", signingSignUnavailable, [["offer-sign", "no database"]]],
	[
		"the owner's agreements",
		ownerAgreementsUnavailable,
		[["owner-agreements-wire", "the owner with no database, JSON"]],
	],
	[
		"the owner's retention",
		retentionUnavailable,
		[
			[
				"owner-agreements-retention-preview",
				"no retention binding id is configured",
			],
		],
	],
	[
		"the owner's request agreement",
		ownerRequestAgreementUnavailable,
		[
			["owner-request-agreement-wire", "no database"],
			["owner-request-agreement-retry-artifact", "no storage bucket"],
		],
	],
	[
		"the attachment upload",
		attachmentUploadUnavailable,
		[["owner-agreement-attachments-put", "no database is bound"]],
	],
	[
		"the owner's attachment",
		ownerAttachmentUnavailable,
		[["owner-agreement-attachments-get", "no database is bound"]],
	],
	[
		"the owner's signed copy",
		ownerCopyUnavailable,
		[["owner-agreement-file", "no database is bound"]],
	],
];

const FAILED: readonly (readonly [
	what: string,
	failed: FailureAnswer,
	answered: Recorded,
	logged: Recorded,
])[] = [
	[
		"the signing link",
		signingLinkFailed,
		["offer-link", "the link batch fails (json)"],
		["offer-link", "the link batch fails (json)"],
	],
	[
		"the signing link's verify page",
		signingVerifyFailed,
		["offer-link", "the consume batch fails (json)", 1],
		["offer-verify-page", "outage: the link read on a GET: the page throws", 1],
	],
	[
		"the archive link's verify page",
		archiveVerifyFailed,
		["agreements-link", "the consume batch fails (json)", 1],
		[
			"agreements-verify-page",
			"outage: the link read on a GET: the page throws",
			1,
		],
	],
	[
		"the signing draft",
		signingDraftFailed,
		["offer-draft", "the offer lookup fails (json)"],
		["offer-draft", "the offer lookup fails (json)"],
	],
	[
		"the review",
		signingReviewFailed,
		[
			"offer-review",
			"the offer terms are not JSON (the parser message is not returned) (json)",
		],
		[
			"offer-review",
			"the offer terms are not JSON (the parser message is not returned) (json)",
		],
	],
	[
		"the signature",
		signingSignFailed,
		["offer-sign", "outage: the offer lookup"],
		["offer-sign", "outage: the offer lookup"],
	],
	[
		"the owner's agreements",
		ownerAgreementsFailed,
		["owner-agreements-access", "the sessions delete fails"],
		["owner-agreements-access", "the sessions delete fails"],
	],
	[
		"the owner's request agreement",
		ownerRequestAgreementFailed,
		["owner-request-agreement-hold", "outage: the offer lookup"],
		["owner-request-agreement-hold", "outage: the offer lookup"],
	],
	[
		"the attachment upload",
		attachmentUploadFailed,
		["owner-agreement-attachments-put", "the signing setting cannot be read"],
		["owner-agreement-attachments-put", "the signing setting cannot be read"],
	],
	[
		"the owner's attachment",
		ownerAttachmentFailed,
		["owner-agreement-attachments-get", "the stored object is missing"],
		["owner-agreement-attachments-get", "the stored object is missing"],
	],
	[
		"the owner's signed copy",
		ownerCopyFailed,
		["owner-agreement-file", "the stored object is missing"],
		["owner-agreement-file", "the stored object is missing"],
	],
];

describe("a missing binding", () => {
	it.each(UNAVAILABLE)(
		"%s answers what today's route answered",
		async (_what, answer, recorded) => {
			for (const where of recorded)
				expect(await asRecorded(answer())).toEqual(answerOf(where));
		},
	);
});

describe("a store failure or a defect", () => {
	it.each(FAILED)(
		"%s answers what today's route answered, logged under today's label",
		async (_what, failed, answered, logged) => {
			expect(await asRecorded(failed.answer())).toEqual(answerOf(answered));
			expect(consoleLines(logged)).toContain(
				`${failed.route} failed unexpectedly:`,
			);
		},
	);

	it.each(FAILED)(
		"%s is answered and logged once by runRoute's defect answer and by loggedAnswer",
		async (_what, failed, answered) => {
			const lines = vi.spyOn(console, "error").mockImplementation(() => {});

			const defect = await runRoute(
				Context.empty(),
				Effect.die(new Error("injected")),
				failed,
			);

			const named = await Effect.runPromise(
				loggedAnswer(failed.route, failed.answer)(new Error("injected")),
			);

			expect(await asRecorded(defect)).toEqual(answerOf(answered));
			expect(await asRecorded(named)).toEqual(answerOf(answered));
			expect(lines.mock.calls.map((call) => call[0])).toEqual([
				`${failed.route} failed unexpectedly:`,
				`${failed.route} failed unexpectedly:`,
			]);
		},
	);
});
