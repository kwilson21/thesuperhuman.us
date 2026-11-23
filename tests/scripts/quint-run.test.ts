import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	classifyRun,
	propertiesOf,
	propertiesWithoutMutant,
} from "../../scripts/lib/quint-run.mjs";
import {
	allowanceMutants,
	agreementLinkMutants,
	audioProjectFilesMutants,
	audioProjectMessagesMutants,
	audioProjectNoticesMutants,
	boardMutants,
	briefCopyMutants,
	budgetMutants,
	discountMutants,
	offerBoardMutants,
	pricingMutants,
	inquiryMutants,
	musicMutants,
	publicationMutants,
	equivalents,
	exhaustive,
	models,
	mutants,
	signinMutants,
} from "../../scripts/lib/quint-mutants.mjs";

// Outputs captured from `quint run` 0.33.1.
const passed = `[ok] No violation found (48ms at 1042 traces/second).
Trace length statistics: max=6, min=6, average=6.00
You may increase --max-samples and --max-steps.
Use --verbosity to produce more (or less) output.
Use --seed=0x105e --backend=rust to reproduce.
`;

const violated = `An example execution:

[State 0]
{ row: { at: 0, id: 0, rec: 0, status: "creating" } }

[violation] Found an issue (36ms at 306 traces/second).
Use --verbosity=3 to show executions.
Use --seed=0x6b3 --backend=rust to reproduce.
error: Invariant violated
`;

const evaluatorNoise = `Fetching Rust evaluator v0.7.1...
  Extracting /home/runner/.quint/rust-evaluator-v0.7.1/quint_evaluator-x86_64-unknown-linux-gnu.tar.gz...
  [ok] Rust evaluator installed at: /home/runner/.quint/rust-evaluator-v0.7.1/quint_evaluator
`;

describe("classifyRun", () => {
	it("passes on exit 0 and the no-violation line", () => {
		expect(classifyRun({ status: 0, stdout: passed, stderr: "" }).kind).toBe(
			"pass",
		);
	});

	it("passes when the evaluator was fetched first and the run then found no violation", () => {
		expect(
			classifyRun({ status: 0, stdout: evaluatorNoise + passed, stderr: "" })
				.kind,
		).toBe("pass");
	});

	it("does not pass on the evaluator-install line alone, with any exit status", () => {
		for (const status of [0, 1, null])
			expect(
				classifyRun({ status, stdout: evaluatorNoise, stderr: "" }).kind,
			).toBe("error");
	});

	it("does not pass when the run exits non-zero even if an ok line is printed", () => {
		expect(
			classifyRun({ status: 1, stdout: evaluatorNoise + passed, stderr: "" })
				.kind,
		).not.toBe("pass");
	});

	it("does not pass when a violation line is present, even with exit 0", () => {
		expect(
			classifyRun({ status: 0, stdout: passed + violated, stderr: "" }).kind,
		).not.toBe("pass");
	});

	it("reports a violation on a non-zero exit with the violation and invariant lines", () => {
		expect(classifyRun({ status: 1, stdout: violated, stderr: "" }).kind).toBe(
			"violation",
		);
		expect(classifyRun({ status: 1, stdout: "", stderr: violated }).kind).toBe(
			"violation",
		);
	});

	it("does not report a violation for a parse error, a missing file or a crash", () => {
		const parse = "error: [QNT000] Couldn't unify str and oper\n";
		const missing = "error: file verification/nope.qnt does not exist\n";

		const crash =
			"RangeError: Maximum call stack size exceeded\n    at run (cli.js:1:1)\n";

		for (const output of [parse, missing, crash])
			for (const status of [1, 134, null])
				expect(classifyRun({ status, stdout: "", stderr: output }).kind).toBe(
					"error",
				);
	});

	it("does not report a violation from a violation line without the invariant line or a failing exit", () => {
		const half = "[violation] Found an issue (1ms)\n";

		expect(classifyRun({ status: 1, stdout: half, stderr: "" }).kind).toBe(
			"error",
		);
		expect(classifyRun({ status: 0, stdout: violated, stderr: "" }).kind).toBe(
			"error",
		);
	});

	it("reads output that Quint coloured for a terminal", () => {
		const coloured = "\u001b[32m[ok]\u001b[0m No violation found (3ms)\n";

		expect(classifyRun({ status: 0, stdout: coloured, stderr: "" }).kind).toBe(
			"pass",
		);
	});
});

describe("the mutants of verification/invoice-events.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/invoice-events.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(9);
		expect(propertiesWithoutMutant(properties, mutants)).toEqual([]);
	});

	it("a mutant whose property is not listed is reported", () => {
		expect(
			propertiesWithoutMutant(["a", "b"], { audioX: { property: "a" } }),
		).toEqual(["b"]);
	});

	it("every mutant and equivalent names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import invoiceEvents/gm),
		].map((match) => match[1]);

		const listed = [
			...Object.keys(mutants),
			...equivalents,
			...exhaustive,
			"audio",
			"software",
		];

		expect([...modules].sort()).toEqual([...listed].sort());
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(mutants))
			expect(properties).toContain(property);
	});
});

describe("the mutants of verification/discount-offers.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/discount-offers.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(13);
		expect(propertiesWithoutMutant(properties, discountMutants)).toEqual([]);
	});

	it("every mutant and equivalent names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import discountOffers/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[
				...Object.keys(discountMutants),
				...models[1].equivalents,
				"discount",
			].sort(),
		);
	});

	it("checks the code, with F10's and F9's fixes, keeping every property, with one equivalent mutant", () => {
		expect(models[1].current).toEqual(["discount"]);
		expect(models[1].exhaustive).toEqual(["discount"]);
		expect(models[1].equivalents).toEqual([
			"discountSecondBatchNoSendingGuard",
		]);
		expect(Object.keys(discountMutants)).not.toContain(
			"discountSecondBatchNoSendingGuard",
		);
		// The second batch as it was before the fix stays a mutant, so CI reproduces F10 on every run.
		expect(discountMutants.discountTodaySecondBatch).toEqual({
			property: "declinedHasNoOffer",
		});
		// The live-link check before F9's fix: equivalent until the signing extension, whose abandon closes a link with
		// no sending window.
		expect(discountMutants.discountAcceptedOnlyCheck).toEqual({
			property: "sendLinkLive",
		});
	});

	it("checks the signing extension: each new property has its own mutant, and the sign batch's guards are needed at write time", () => {
		expect(discountMutants.discountReviewNoGuards).toEqual({
			property: "reviewOfSentOffer",
		});
		expect(discountMutants.discountRedeemNoLiveGuard).toEqual({
			property: "noSessionForDeadOffer",
		});
		expect(discountMutants.discountAbandonNoStatusGuard).toEqual({
			property: "executedStays",
		});
		expect(discountMutants.discountCountersignNoGuards).toEqual({
			property: "executedOnlyWhenSigned",
		});
		expect(discountMutants.discountAbandonDepositAtRead).toEqual({
			property: "abandonedHasNoDeposit",
		});
		expect(discountMutants.discountReviewNoSignedGuard).toEqual({
			property: "signedStaysSigned",
		});

		for (const mutant of [
			"discountNoSignGuards",
			"discountSignGuardsAtRead",
		] as const)
			expect(discountMutants[mutant]).toEqual({ property: "supersededInert" });
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			discountMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the mutants of verification/signin-codes.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/signin-codes.qnt", import.meta.url),
		"utf8",
	);

	const signin = models.find(
		(entry) => entry.file === "verification/signin-codes.qnt",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(18);
		expect(propertiesWithoutMutant(properties, signinMutants)).toEqual([]);

		for (const { property } of Object.values<{ property: string }>(
			signinMutants,
		))
			expect(properties).toContain(property);
	});

	it("every mutant, equivalent and pass run names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import signinCodes/gm),
		].map((match) => match[1]);

		expect(signin?.current).toEqual(["signin", "signinSpent"]);
		expect(signin?.equivalents).toEqual(["signinAcceptNoUsed"]);
		expect([...modules].sort()).toEqual(
			[
				...Object.keys(signinMutants),
				...(signin?.equivalents ?? []),
				...(signin?.current ?? []),
			].sort(),
		);
	});

	it("checks the sessions: each new property has its own mutant", () => {
		expect(signinMutants.signinWriteNoUsedGuard).toEqual({
			property: "oneSessionPerCode",
		});
		expect(signinMutants.signinAcceptUncounted).toEqual({
			property: "attemptsBounded",
		});
		expect(signinMutants.signinSessionUnmatched).toEqual({
			property: "sessionOnlyFromAcceptedCode",
		});
		expect(signinMutants.signinSignOutUnguarded).toEqual({
			property: "revokedStaysRevoked",
		});
		expect(signinMutants.signinNoSessionInsert).toEqual({
			property: "everyAcceptMakesSession",
		});

		for (const mutant of [
			"signinSessionCodeExpiry",
			"signinSessionWriteTime",
			"signinOpenIgnoresExpiry",
			"signinOpenIgnoresRevoked",
		] as const)
			expect(signinMutants[mutant]).toEqual({
				property: "sessionOpensOnlyWhileActive",
			});
	});
});

describe("the mutants of verification/music-playback.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/music-playback.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(5);
		expect(propertiesWithoutMutant(properties, musicMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import musicPlayback/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(musicMutants), "music"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			musicMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the brief board model's mutant registry", () => {
	const model = readFileSync(
		new URL("../../verification/brief-board.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(7);
		expect(propertiesWithoutMutant(properties, boardMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import briefBoard/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(boardMutants), "board"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			boardMutants,
		))
			expect(properties).toContain(property);
	});
});

// The three models added with the offer board: each property in allProperties has a mutant that breaks it, and every
// mutant names a module of the model.
describe.each([
	["offer-board", "offerBoardModel", "offerBoard", offerBoardMutants, 10],
	["daily-allowance", "dailyAllowanceModel", "allowance", allowanceMutants, 4],
	["pricing-save", "pricingSaveModel", "pricing", pricingMutants, 3],
])(
	"the %s model's mutant registry",
	(file, base, current, registry, propertyCount) => {
		const model = readFileSync(
			new URL(`../../verification/${file}.qnt`, import.meta.url),
			"utf8",
		);

		it("every property in allProperties has a mutant that must break it", () => {
			const properties: string[] = propertiesOf(model);

			expect(properties).toHaveLength(propertyCount);
			expect(propertiesWithoutMutant(properties, registry)).toEqual([]);
		});

		it("every mutant names a module in the model, and every module is listed", () => {
			const modules = [
				...model.matchAll(
					new RegExp(`^module (\\w+) \\{ import ${base}`, "gm"),
				),
			].map((match) => match[1]);

			expect([...modules].sort()).toEqual(
				[...Object.keys(registry), current].sort(),
			);
		});

		it("every mutant property is one of allProperties", () => {
			const properties: string[] = propertiesOf(model);

			for (const { property } of Object.values<{ property: string }>(registry))
				expect(properties).toContain(property);
		});
	},
);

describe("the mutants of verification/software-inquiry.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/software-inquiry.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(6);
		expect(propertiesWithoutMutant(properties, inquiryMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import softwareInquiry/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(inquiryMutants), "inquiry"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			inquiryMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the mutants of verification/suggestion-budget.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/suggestion-budget.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(4);
		expect(propertiesWithoutMutant(properties, budgetMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import suggestionBudget/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(budgetMutants), "budget"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			budgetMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the mutants of verification/publication-journal.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/publication-journal.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(6);
		expect(propertiesWithoutMutant(properties, publicationMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import publicationJournal/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(publicationMutants), "publication"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			publicationMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the agreement link model", () => {
	const model = readFileSync(
		new URL("../../verification/agreement-link.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(7);
		expect(propertiesWithoutMutant(properties, agreementLinkMutants)).toEqual(
			[],
		);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import agreementLinkProtocol/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(agreementLinkMutants), "agreementLink"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			agreementLinkMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the audio project messages model", () => {
	const model = readFileSync(
		new URL("../../verification/audio-project-messages.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(9);
		expect(
			propertiesWithoutMutant(properties, audioProjectMessagesMutants),
		).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(
				/^module (\w+) \{ import audioProjectMessages\(MUTANT/gm,
			),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[
				...Object.keys(audioProjectMessagesMutants),
				"projectMessages",
				"projectMessagesWriteNoRounds",
				"projectMessagesRuleNoCount",
			].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			audioProjectMessagesMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the audio project files model", () => {
	const model = readFileSync(
		new URL("../../verification/audio-project-files.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(13);
		expect(
			propertiesWithoutMutant(properties, audioProjectFilesMutants),
		).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import audioProjectFiles\(MUTANT/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[
				...Object.keys(audioProjectFilesMutants),
				"projectFiles",
				"projectFilesCompleteNoFile",
				"projectFilesFinalAndReview",
				"projectFilesFinalPlus",
			].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			audioProjectFilesMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the audio project notices model", () => {
	const model = readFileSync(
		new URL("../../verification/audio-project-notices.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(8);
		expect(
			propertiesWithoutMutant(properties, audioProjectNoticesMutants),
		).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(
				/^module (\w+) \{ import audioProjectNotices\(MUTANT/gm,
			),
		].map((match) => match[1]);

		expect(models[14].current).toEqual([
			"projectNotices",
			"projectNoticesUpdate",
			"projectNoticesCopy",
			"projectNoticesSigning",
		]);
		expect([...modules].sort()).toEqual(
			[
				...Object.keys(audioProjectNoticesMutants),
				...models[14].current,
			].sort(),
		);
	});

	it("checks the agreements' kinds: a copy and a signing notice each have their claim's mutant", () => {
		expect(audioProjectNoticesMutants.projectNoticesCopyClaimNoState).toEqual({
			property: "copyOnlyWhenExecuted",
		});
		expect(audioProjectNoticesMutants.projectNoticesNoticeClaimNoState).toEqual(
			{ property: "noticeOnlyBeforeCountersign" },
		);
		// A21: a countersign or an abandon fails a signing notice that is sending.
		expect(audioProjectNoticesMutants.projectNoticesNoObsolete).toEqual({
			property: "noSendingAfterCountersign",
		});
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			audioProjectNoticesMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the brief copy model", () => {
	const model = readFileSync(
		new URL("../../verification/brief-copy.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties).toHaveLength(7);
		expect(propertiesWithoutMutant(properties, briefCopyMutants)).toEqual([]);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import briefCopyClaim/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(briefCopyMutants), "briefCopy"].sort(),
		);
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(
			briefCopyMutants,
		))
			expect(properties).toContain(property);
	});
});

describe("the models the driver runs", () => {
	it("lists the sixteen models, each with its own registry", () => {
		expect(models.map((model: { file: string }) => model.file)).toEqual([
			"verification/invoice-events.qnt",
			"verification/discount-offers.qnt",
			"verification/signin-codes.qnt",
			"verification/music-playback.qnt",
			"verification/brief-board.qnt",
			"verification/offer-board.qnt",
			"verification/daily-allowance.qnt",
			"verification/pricing-save.qnt",
			"verification/software-inquiry.qnt",
			"verification/suggestion-budget.qnt",
			"verification/publication-journal.qnt",
			"verification/agreement-link.qnt",
			"verification/audio-project-messages.qnt",
			"verification/audio-project-files.qnt",
			"verification/audio-project-notices.qnt",
			"verification/brief-copy.qnt",
		]);
		expect(models[0].mutants).toBe(mutants);
		expect(models[1].mutants).toBe(discountMutants);
		expect(models[2].mutants).toBe(signinMutants);
		expect(models[3].mutants).toBe(musicMutants);
		expect(models[4].mutants).toBe(boardMutants);
		expect(models[5].mutants).toBe(offerBoardMutants);
		expect(models[6].mutants).toBe(allowanceMutants);
		expect(models[7].mutants).toBe(pricingMutants);
		expect(models[8].mutants).toBe(inquiryMutants);
		expect(models[9].mutants).toBe(budgetMutants);
		expect(models[10].mutants).toBe(publicationMutants);
		expect(models[11].mutants).toBe(agreementLinkMutants);
		expect(models[12].mutants).toBe(audioProjectMessagesMutants);
		expect(models[13].mutants).toBe(audioProjectFilesMutants);
		expect(models[14].mutants).toBe(audioProjectNoticesMutants);
		expect(models[15].mutants).toBe(briefCopyMutants);
	});

	it("runs each model at 20 steps unless it sets a positive whole number of its own", () => {
		models.forEach((model: { steps?: string; passSteps?: string }) => {
			expect(model.steps ?? "20").toMatch(/^[1-9]\d*$/);
			expect(model.passSteps ?? model.steps ?? "20").toMatch(/^[1-9]\d*$/);
		});

		// The discount model's send and decline are three steps each, so its deepest mutant needs about 17 and is found at
		// 50; its deepest witness, a website start after a revision, needs at least 33 and is reached at 80.
		expect(models[1].steps).toBe("50");
		expect(models[1].passSteps).toBe("80");
	});
});
