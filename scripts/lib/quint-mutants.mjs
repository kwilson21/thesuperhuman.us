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
// (docs/plans/2026-11-discount-flow.md, "The model"), with the offer link, the 20-second sending window, the emails and a
// clock, so that send and decline are the route's steps (docs/plans/2026-11-offers-conversion.md, section 7), and the
// signing link, its session, the signing setting, review, sign, countersign and abandon as reads and batches
// (docs/plans/2026-11-signing-conversion.md, section 7). Module name -> the property its change must break.
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
	discountTodaySecondBatch: { property: "declinedHasNoOffer" },
	discountNoLiveCheck: { property: "sendLinkLive" },
	discountFirstBatchKeepsLink: { property: "declinedHasNoOffer" },
	// The live-link check before F9's fix, an equivalent mutant until the signing extension: an abandon revokes the link
	// with no sending window, so the model now closes a link during a failed send. It is killed only because the model
	// lets the client use a link that only the failed email carried (docs/verification.md).
	discountAcceptedOnlyCheck: { property: "sendLinkLive" },
	discountReviewNoGuards: { property: "reviewOfSentOffer" },
	discountSignGuardsAtRead: { property: "supersededInert" },
	discountRedeemNoLiveGuard: { property: "noSessionForDeadOffer" },
	discountAbandonNoStatusGuard: { property: "executedStays" },
	discountCountersignNoGuards: { property: "executedOnlyWhenSigned" },
	discountAbandonDepositAtRead: { property: "abandonedHasNoDeposit" },
	// The review batch without A3 (and so without the one-live-SOW index, which the model's condition stands for too).
	discountReviewNoSignedGuard: { property: "signedStaysSigned" },
};

// verification/signin-codes.qnt: studio sign-in codes bound to the browser that asked, with requests whose responses can
// arrive in any order, and the sessions an accepted code makes. Module name -> the property its change must break.
export const signinMutants = {
	signinSingleRow: { property: "clientNeverLockedOut" },
	signinEvictOldest: { property: "clientNeverLockedOut" },
	signinCookieNotRequired: { property: "cookieRequired" },
	signinAddressAttempts: { property: "othersUntouched" },
	signinReplaceLive: { property: "othersUntouched" },
	signinNoAttemptCap: { property: "attemptsBounded" },
	signinNoAllowance: { property: "emailsBounded" },
	signinIgnoreExpiry: { property: "deadCodeNeverSignsIn" },
	signinReuseUsed: { property: "deadCodeNeverSignsIn" },
	signinNoRowCap: { property: "liveRowsBounded" },
	signinFreshCookie: { property: "cookieOpensEmailedCode" },
	signinChargeAnyVersion: { property: "chargeOnlyTheCodeRead" },
	signinNoOpenGuard: { property: "noAuditForClosedProject" },
	signinAcceptNoOpenGuard: { property: "noAuditForClosedProject" },
	signinNoCapGuard: { property: "liveRowsBounded" },
	signinNoReplace: { property: "outcomeIndependentOfAddress" },
	signinSweepUnguarded: { property: "liveCodeNeverSwept" },
	signinDeleteByCookie: { property: "noCrossAddressEffect" },
	signinEntryByCookie: { property: "noCrossAddressEffect" },
	signinWriteNoUsedGuard: { property: "oneSessionPerCode" },
	signinAcceptUncounted: { property: "attemptsBounded" },
	signinSessionUnmatched: { property: "sessionOnlyFromAcceptedCode" },
	signinSignOutUnguarded: { property: "revokedStaysRevoked" },
	signinNoSessionInsert: { property: "everyAcceptMakesSession" },
	signinSessionCodeExpiry: { property: "sessionOpensOnlyWhileActive" },
	signinSessionWriteTime: { property: "sessionOpensOnlyWhileActive" },
	signinOpenIgnoresExpiry: { property: "sessionOpensOnlyWhileActive" },
	signinOpenIgnoresRevoked: { property: "sessionOpensOnlyWhileActive" },
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
	boardApplyOnScreen: { property: "onScreenStable" },
	boardLeaveNoAdd: { property: "leaveKeepsReply" },
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

// verification/software-inquiry.qnt: one software brief submitted twice at once (src/server/flows/software-inquiry.ts). Module
// name -> the property its change must break.
export const inquiryMutants = {
	inquiryNoIndex: { property: "oneBriefPerId" },
	inquiryNoRetry: { property: "loserNeverFailed" },
	inquiryLoserGivesBack: { property: "loserKeepsAllowance" },
	inquiryRetryGivesBack: { property: "keptForStored" },
	inquiryNeverCounts: { property: "keptForStored" },
	inquiryAnyAddress: { property: "strangerNeverSeesBrief" },
	inquiryCopyForAll: { property: "oneCopyPerId" },
};

// verification/suggestion-budget.qnt: the daily suggestion budget reserved by concurrent requests
// (src/server/brief-suggest-store.ts `reserve`). Module name -> the property its change must break.
export const budgetMutants = {
	budgetUnguardedVisitor: { property: "visitorWithinCap" },
	budgetUnguardedSite: { property: "siteWithinCap" },
	budgetReadThenWrite: { property: "countsAreReservations" },
	budgetIgnoreRefusal: { property: "modelOnlyForReserved" },
};

// verification/publication-journal.qnt: one project's journal when several deliveries of envelopes reach the Worker at once
// (src/server/flows/publication-commit.ts). Module name -> the property its change must break.
export const publicationMutants = {
	publicationNoRevisionKey: { property: "oneRowPerRevision" },
	publicationAnyRevision: { property: "contiguousFromOne" },
	publicationNoWithdrawnRule: { property: "entryNeverResurrected" },
	publicationNoNewEntryRule: { property: "onePublishPerEntry" },
	publicationNoTargetRule: { property: "correctionHasTarget" },
	publicationNoRetry: { property: "retryNeverConflicts" },
	publicationSplitRead: { property: "retryNeverConflicts" },
};

// verification/agreement-link.qnt: the archive link's issue (cooldown, executed lookup, the guarded batch) and its single
// redeem before expiry (src/server/flows/agreement-link.ts, src/lib/agreement-access.ts completeAgreementLink). Module name
// -> the property its change must break.
export const agreementLinkMutants = {
	agreementLinkNoGuard: { property: "oneIssuePerWindow" },
	agreementLinkSplitGuard: { property: "oneIssuePerWindow" },
	agreementLinkNoLookup: { property: "issuedOnlyWithAgreement" },
	agreementLinkRedeemNoGuard: { property: "redeemedOnce" },
	agreementLinkRedeemNoExpiry: { property: "redeemedUnexpired" },
	agreementLinkNoCas: { property: "oneCooldownPerWindow" },
	agreementLinkRetryNewCool: { property: "lostCooldownNeverTakes" },
	agreementLinkRetryNewAt: { property: "lostGuardNeverStores" },
};

// verification/audio-project-messages.qnt: a client's messages and review decisions on one audio project, to several requests
// at once and the owner's moves in between (docs/plans/2026-11-audio-projects-conversion.md, section 6). Module name -> the
// property its change must break.
export const audioProjectMessagesMutants = {
	projectMessagesNoCount: { property: "clientRateBounded" },
	projectMessagesNoDecision: { property: "oneDecisionPerReview" },
	projectMessagesNoReview: { property: "decisionNamesLatestReview" },
	projectMessagesRuleNoRounds: { property: "changesWithinRounds" },
	projectMessagesNoAccess: { property: "writtenForOpenAccess" },
	projectMessagesNoStage: { property: "answeredInReviewStage" },
	projectMessagesStopSplit: { property: "stopClosesAccess" },
	projectMessagesSendNoStage: { property: "plainMessageBeforeCompletion" },
	projectMessagesNoWithdrawn: { property: "noMessageAfterWithdrawal" },
};

// verification/audio-project-files.qnt: an audio project's uploads, publishes, revokes and completion, while access closes, the
// request is withdrawn or a payment is voided (docs/plans/2026-11-audio-projects-conversion.md, section 6). Module name -> the
// property its change must break.
export const audioProjectFilesMutants = {
	projectFilesStartNoAccess: { property: "uploadsOnlyForOpenProject" },
	projectFilesInsertNoAccess: { property: "filesOnlyForOpenProject" },
	projectFilesInsertNoState: { property: "fileHasObject" },
	projectFilesAbortNoCas: { property: "fileHasObject" },
	projectFilesPublishNoAccess: { property: "publishedOnlyWhenPaidAndOpen" },
	projectFilesPublishNoPayment: { property: "publishedOnlyWhenPaidAndOpen" },
	projectFilesPublishNoStage: { property: "stageCoherent" },
	projectFilesNoSupersede: { property: "oneLiveReview" },
	projectFilesRevokeStaleReset: { property: "readyStagesHaveFiles" },
	projectFilesCompleteNoStage: { property: "readyStagesHaveFiles" },
	projectFilesCompleteNoPayment: { property: "completedOnlyWhenPaid" },
	projectFilesPublishStaleSupersede: { property: "oneLiveReview" },
	projectFilesResetNoLink: { property: "stageCoherent" },
	projectFilesFinalNoSupersede: { property: "finalStageHasNoLiveReview" },
	projectFilesRevokeNoFirstStatus: { property: "revokeKeepsFirstRead" },
	projectFilesCompleteNoRequestStatus: {
		property: "completedOnlyWhenReviewed",
	},
	projectFilesCompleteNoUpdatedAt: { property: "completeSawEveryUpdate" },
	projectFilesPartNoStateGuard: { property: "noPartAfterDiscard" },
};

// verification/audio-project-notices.qnt: one email notice of an audio project (the studio invitation or an update notice):
// queue, claim, send and write the outcome (docs/plans/2026-11-audio-projects-conversion.md, section 6); and a signed copy
// or a signing notice of the agreements area, reset by A20 (docs/plans/2026-11-signing-conversion.md, section 7). Module
// name -> the property its change must break.
export const audioProjectNoticesMutants = {
	projectNoticesClaimNoStatus: { property: "oneEmailInTotal" },
	projectNoticesClaimNoOpen: { property: "claimOnlyWhileOpen" },
	projectNoticesQueueAnyStatus: { property: "oneEmailInTotal" },
	projectNoticesUncertainSent: { property: "sentMeansMailed" },
	projectNoticesUncertainFailed: { property: "failedMeansNotMailed" },
	projectNoticesUpdateLookupNoOpen: { property: "closedUpdateNeverMails" },
	projectNoticesQueueNoCas: { property: "oneEmailInTotal" },
	projectNoticesQueueStatusOnly: { property: "oneEmailInTotal" },
	projectNoticesCopyClaimNoState: { property: "copyOnlyWhenExecuted" },
	projectNoticesNoticeClaimNoState: { property: "noticeOnlyBeforeCountersign" },
	projectNoticesNoObsolete: { property: "noSendingAfterCountersign" },
};

// verification/brief-copy.qnt: the claim of the client's copy of a software brief by owner clicks and the public form's own copy
// (src/server/flows/brief-copy.ts). Module name -> the property its change must break.
export const briefCopyMutants = {
	briefCopyNoCas: { property: "claimsEligible" },
	briefCopyCasSkipsOpen: { property: "closedNeverClaimed" },
	briefCopyCasSkipsAttempt: { property: "uncertainHeld" },
	briefCopyCasSkipsAddress: { property: "claimsEligible" },
	briefCopyNoHold: { property: "uncertainHeld" },
	briefCopyNoConfirm: { property: "uncertainHeld" },
	briefCopyResendSent: { property: "sentNeverResent" },
	briefCopyPublicAgain: { property: "publicOnlyFirst" },
	briefCopyIgnoreClosed: { property: "closedNeverClaimed" },
	briefCopyNoClaim: { property: "everySendClaimed" },
	briefCopyFinalUnguarded: { property: "finalOnlyOwn" },
};

// Every model the driver runs: the file, the modules that must keep every property, the mutants, the equivalent
// mutants, the modules for the manual Apalache search, how many random runs each check makes, and how many steps each run
// takes (20 unless the model says; `passSteps` and `passSamples` set them apart for the runs that must pass). The discount model's steps are slower to evaluate, so it makes fewer runs; every
// mutant of it is found well inside that number.
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
		// The code, with F10's fix (the decline's second batch refuses while an offer is draft or sent).
		current: ["discount"],
		mutants: discountMutants,
		// The decline's second batch without its sending guard (G5): since F10's fix it refuses nothing more, because a live
		// link always has a sent offer, which the fix refuses (docs/verification.md, "The discount-offers model").
		equivalents: ["discountSecondBatchNoSendingGuard"],
		exhaustive: ["discount"],
		// A send and a decline are three steps each and the sending window takes two clock ticks, so the deepest mutant of
		// the offers extension (discountTodayDepositGuard: a deposit paid, a decline, a reopen, a new version sent and its
		// deposit invoiced) needs at least 17 steps. At 50 steps, seed 0x1, it is found in about 1,600 runs since the signing
		// extension (about 1,300 before), the signing mutants in at most about 950 (discountAbandonDepositAtRead) and the
		// rarest, discountAcceptedOnlyCheck, in about 9,700, so each mutant check allows 20,000 and each run that must pass
		// makes 10,000. The pass run's deepest witness (neverStandardPaidAfterSentRevision) needed about 25 steps and was
		// reached at 50 in about 320 runs; a website start now needs a signing and a countersign (at least 33 steps), and
		// it is reached only at 80 steps (about 710 runs; not in 20,000 at 60 or 70), so the runs that must pass take 80
		// steps and the mutant checks, every one found within their budget at 50, keep 50.
		steps: "50",
		passSteps: "80",
		samples: "20000",
		passSamples: "10000",
	},
	{
		file: "verification/signin-codes.qnt",
		// The code from no code, and from the starting point "spent" (the client's code with one attempt left), where an accept
		// that needs its own counted attempt is reached (docs/verification.md, "The sign-in codes model").
		current: ["signin", "signinSpent"],
		mutants: signinMutants,
		// The accept without its own `used_at IS NULL`: the counted attempt in the same batch requires it, and the accept
		// requires that attempt (`changes()=1`).
		equivalents: ["signinAcceptNoUsed"],
		exhaustive: [],
		// Its rarest mutant (signinOpenIgnoresExpiry) takes about 17,600 random runs to find with the fixed seed (the rest at
		// most about 5,200), so each mutant check allows 30,000. Each run that must pass makes 20,000, past that rarest race,
		// which costs about 33 s of one core.
		samples: "30000",
		passSamples: "20000",
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
	{
		file: "verification/software-inquiry.qnt",
		current: ["inquiry"],
		mutants: inquiryMutants,
		equivalents: [],
		exhaustive: [],
		samples: "20000",
	},
	{
		file: "verification/suggestion-budget.qnt",
		current: ["budget"],
		mutants: budgetMutants,
		equivalents: [],
		exhaustive: [],
		samples: "20000",
		// The run that must pass makes every sample (about 2 s per 6,000); each mutant is found within a few hundred.
		passSamples: "8000",
	},
	{
		file: "verification/publication-journal.qnt",
		current: ["publication"],
		mutants: publicationMutants,
		equivalents: [],
		exhaustive: ["publication"],
		samples: "20000",
	},
	{
		file: "verification/agreement-link.qnt",
		current: ["agreementLink"],
		mutants: agreementLinkMutants,
		equivalents: [],
		exhaustive: ["agreementLink"],
		samples: "20000",
	},
	{
		file: "verification/audio-project-messages.qnt",
		current: ["projectMessages"],
		mutants: audioProjectMessagesMutants,
		equivalents: ["projectMessagesWriteNoRounds", "projectMessagesRuleNoCount"],
		exhaustive: [],
		samples: "20000",
		passSamples: "8000",
	},
	{
		file: "verification/audio-project-files.qnt",
		current: [
			"projectFiles",
			"projectFilesFinalAndReview",
			"projectFilesFinalPlus",
		],
		mutants: audioProjectFilesMutants,
		equivalents: ["projectFilesCompleteNoFile"],
		exhaustive: [],
		// InsertNoState, AbortNoCas and PartNoStateGuard start only from fresh (the upload protocol alone).
		// The mutants whose race needs particular starting points (PublishNoStage from finalAndReview, PublishStaleSupersede and
		// RevokeNoFirstStatus from twoReviews, CompleteNoStage from final and finalPlus) begin from the one or two starting points
		// their race needs and no others, and are found within a few thousand random runs. Three runs must pass, each of 8,000 runs:
		// projectFiles takes every starting point; projectFilesFinalAndReview takes only finalAndReview, where a review publish
		// whose stage guard is false in a race is reached (the first run reaches it only between 8,000 and 12,000 runs); and
		// projectFilesFinalPlus takes only finalPlus, where a final publish whose stage guard is false in a race is reached
		// (a fault that lets the final branch also admit a completed project passes the first two runs).
		samples: "20000",
		passSamples: "8000",
	},
	{
		file: "verification/audio-project-notices.qnt",
		// The invitation, an update notice, a signed copy and a signing notice: each kind's claim, outcome and reset differ.
		current: [
			"projectNotices",
			"projectNoticesUpdate",
			"projectNoticesCopy",
			"projectNoticesSigning",
		],
		mutants: audioProjectNoticesMutants,
		equivalents: [],
		exhaustive: [],
		samples: "20000",
		passSamples: "8000",
	},
	{
		file: "verification/brief-copy.qnt",
		current: ["briefCopy"],
		mutants: briefCopyMutants,
		equivalents: [],
		exhaustive: [],
		samples: "100000",
	},
];
