// The Quint models and their mutants, read by scripts/verify-quint.mjs and tests/scripts/quint-run.test.ts. The first
// registry below is verification/invoice-events.qnt; `models` at the end lists every model the driver runs.

// module name -> the property its change must break
export const mutants = {
	audioOldRule: { property: "moneyNotLost" },
	softwareOldRule: { property: "moneyNotLost" },
	audioStaleGuard: { property: "moneyNotLost" },
	softwareStaleGuard: { property: "moneyNotLost" },
	audioPreFixLink: { property: "moneyNotLost" },
	softwareNoIdPin: { property: "idNeverOverwritten" },
	audioNoIdPin: { property: "idNeverOverwritten" },
	audioNoTimeGuard: { property: "noStaleOverwrite" },
	softwareNoTimeGuard: { property: "noStaleOverwrite" },
	audioOverwritePaid: { property: "paidAbsorbing" },
	softwareOverwritePaid: { property: "paidAbsorbing" },
	audioNoDupDetection: { property: "redeliveryInert" },
	audioRecoverNoDupGuard: { property: "redeliveryInert" },
	softwareNoRank: { property: "tieRule" },
	softwareRankGe: { property: "tieRule" },
	audioAudioLt: { property: "tieRule" },
	audioNeverUnmatched: { property: "differentIdUnmatched" },
	softwareNeverUnmatched: { property: "differentIdUnmatched" },
	softwareProcessedOnMismatch: { property: "oneOutcome" },
	audioStoreGuardTime: { property: "realStoredTime" },
	softwareStoreGuardTime: { property: "realStoredTime" },
};

// Changes that leave every property true, for the reason given in docs/verification.md ("Equivalent mutants").
export const equivalents = [
	"audioNoDecision",
	"softwareNoDupDetection",
	"softwareNoReadUnmatched",
];

// The same two models with fewer handler runs, for the manual Apalache search (scripts/verify-quint.mjs exhaustive).
export const exhaustive = ["audioExhaustive", "softwareExhaustive"];

// verification/discount-offers.qnt: an offer with a discount revised, sent, superseded, signed and invoiced
// (docs/plans/2026-11-discount-flow.md, "The model"). Module name -> the property its change must break.
export const discountMutants = {
	discountEditSent: { property: "sentTermsFrozen" },
	discountLatestTerms: { property: "invoicedMatchesSigned" },
	discountDepositFromUsual: { property: "installmentsSum" },
	discountNoDepositGuard: { property: "oneVersionInvoiced" },
	discountTodayDepositGuard: { property: "oneVersionInvoiced" },
	discountNoWriteStatusGuard: { property: "supersededInert" },
	discountNoSignGuards: { property: "supersededInert" },
	discountSendAfterSign: { property: "supersededInert" },
	discountStartCopiesNewest: { property: "invoicedMatchesSigned" },
	discountStartDropsDiscount: { property: "invoicedMatchesSigned" },
};

// verification/music-playback.qnt: one playthrough's playback events delivered by a retrying player to concurrent handlers
// (src/server/flows/music-event.ts). Module name -> the property its change must break.
export const musicMutants = {
	musicNoIdKey: { property: "oneRowPerId" },
	musicNoPlaceKey: { property: "oneRowPerPlace" },
	musicNoSequenceRule: { property: "contiguousFromOne" },
	musicNoSecondsRule: { property: "secondsNeverFall" },
	musicNoRetry: { property: "sameEventNeverConflicts" },
	musicSplitRead: { property: "sameEventNeverConflicts" },
};

// verification/brief-board.qnt: the living brief's board, where late and overlapping replies from the interpreting model
// meet the visitor's own changes (src/lib/brief-board.ts). Module name -> the property its change must break.
export const boardMutants = {
	boardSnapshotStatus: { property: "ownedUntouched" },
	boardSeenOnly: { property: "undoRespected" },
	boardWithdrawUnseen: { property: "undoRespected" },
	boardNoAvoid: { property: "rejectedStaysRejected" },
	boardSnapshotQuote: { property: "groundedOnApply" },
	boardOutlineQuote: { property: "outlineGrounded" },
	boardNoNumberGuard: { property: "newestWins" },
	boardApplyPaused: { property: "pausedHolds" },
};

// verification/offer-board.qnt: the offer board's Use and Undo, which change the board and the offer editor together, while
// the owner types and replies arrive late (src/scripts/offer-board.ts). Module name -> the property its change must break.
export const offerBoardMutants = {
	offerKeyByLength: { property: "undoMatchesStep" },
	offerRestoreAlways: { property: "ownerWordsKept" },
	offerKeepOnlyProposed: { property: "everyUseUndoable" },
	offerFeeIsUse: { property: "ownerWordsKept" },
	offerStaleUsedIn: { property: "useNeverOverwritesOther" },
	offerDetailIgnoresSince: { property: "undoRespected" },
	offerDetailOnOwned: { property: "ownedUntouched" },
	offerRetryOnFail: { property: "noAutoAfterFailure" },
	offerNameOnlyEmpty: { property: "ownerWordsKept" },
	offerNoRowRemoval: { property: "undoComplete" },
	offerRemoveLastRow: { property: "rowsBounded" },
	offerFourFieldsOnly: { property: "ownerWordsKept" },
	offerFeeAnyRow: { property: "feeOnItsOwnRow" },
	offerFeeNoStep: { property: "undoComplete" },
};

// verification/daily-allowance.qnt: the daily AI allowance both boards reserve against, under concurrent requests
// (src/server/brief-board-store.ts, src/server/offer-board-store.ts). Module name -> the property its change must break.
export const allowanceMutants = {
	allowanceNoGuard: { property: "limitsHold" },
	allowanceSnapshotGuard: { property: "limitsHold" },
	allowanceVisitorGuardOnly: { property: "limitsHold" },
	allowanceSplitBatch: { property: "limitsHold" },
	allowanceCleanToday: { property: "countsTrue" },
	allowanceNoRetry: { property: "retriesBeforeAnswer" },
	allowanceOffByOne: { property: "limitAnswersTrue" },
};

// verification/pricing-save.qnt: saving the owner's pricing reference from two forms and two tabs. `pricingTodayKv` is
// the code as it is today on KV (docs/verification.md, "The pricing-save model"). Module name -> the property its change
// must break.
export const pricingMutants = {
	pricingNoVersionCheck: { property: "noBlindOverwrite" },
	pricingSplitReadWrite: { property: "otherPartKept" },
	pricingStaleRead: { property: "noFalseConflict" },
	pricingTodayKv: { property: "otherPartKept" },
	pricingParallelSaves: { property: "noFalseConflict" },
	pricingRetryAfterLost: { property: "noFalseConflict" },
};

// Every model the driver runs: the file, the modules that must keep every property, the mutants, the equivalent
// mutants, the modules for the manual Apalache search, and how many random runs each check makes. The discount model's
// steps are slower to evaluate, so it makes fewer runs; every mutant of it is found well inside that number.
export const models = [
	{
		file: "verification/invoice-events.qnt",
		current: ["audio", "software"],
		mutants,
		equivalents,
		exhaustive,
		samples: "100000",
	},
	{
		file: "verification/discount-offers.qnt",
		current: ["discount"],
		mutants: discountMutants,
		equivalents: [],
		exhaustive: ["discount"],
		samples: "10000",
	},
	{
		file: "verification/music-playback.qnt",
		current: ["music"],
		mutants: musicMutants,
		equivalents: [],
		exhaustive: ["music"],
		samples: "20000",
	},
	{
		file: "verification/brief-board.qnt",
		current: ["board"],
		mutants: boardMutants,
		equivalents: [],
		exhaustive: ["board"],
		samples: "20000",
	},
	{
		file: "verification/offer-board.qnt",
		current: ["offerBoard"],
		mutants: offerBoardMutants,
		equivalents: [],
		exhaustive: ["offerBoard"],
		samples: "20000",
	},
	{
		file: "verification/daily-allowance.qnt",
		current: ["allowance"],
		mutants: allowanceMutants,
		equivalents: [],
		exhaustive: ["allowance"],
		samples: "20000",
	},
	{
		file: "verification/pricing-save.qnt",
		current: ["pricing"],
		mutants: pricingMutants,
		equivalents: [],
		exhaustive: ["pricing"],
		samples: "20000",
	},
];
