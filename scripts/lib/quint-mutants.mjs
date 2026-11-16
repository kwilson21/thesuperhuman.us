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
// clock, so that send and decline are the route's steps (docs/plans/2026-11-offers-conversion.md, section 7). Module name
// -> the property its change must break.
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
};

// verification/signin-codes.qnt: studio sign-in codes bound to the browser that asked, with requests whose responses can
// arrive in any order. Module name -> the property its change must break.
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
// queue, claim, send and write the outcome (docs/plans/2026-11-audio-projects-conversion.md, section 6). Module name -> the
// property its change must break.
export const audioProjectNoticesMutants = {
	projectNoticesClaimNoStatus: { property: "oneEmailInTotal" },
	projectNoticesClaimNoOpen: { property: "claimOnlyWhileOpen" },
	projectNoticesQueueAnyStatus: { property: "oneEmailInTotal" },
	projectNoticesUncertainSent: { property: "sentMeansMailed" },
	projectNoticesUncertainFailed: { property: "failedMeansNotMailed" },
	projectNoticesUpdateLookupNoOpen: { property: "closedUpdateNeverMails" },
	projectNoticesQueueNoCas: { property: "oneEmailInTotal" },
	projectNoticesQueueStatusOnly: { property: "oneEmailInTotal" },
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
// takes (20 unless the model says). The discount model's steps are slower to evaluate, so it makes fewer runs; every
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
		// link always has a sent offer, which the fix refuses. The live-link check as it was before F9's fix (counted only for
		// an accepted email): a failed email ends within one tick and every step that closes a link waits two, so the model
		// never reaches a link closed during a failed email (docs/verification.md, "The discount-offers model").
		equivalents: [
			"discountSecondBatchNoSendingGuard",
			"discountAcceptedOnlyCheck",
		],
		exhaustive: ["discount"],
		// A send and a decline are three steps each and the sending window takes two clock ticks, so the deepest mutant
		// (discountTodayDepositGuard: a deposit paid, a decline, a reopen, a new version sent and its deposit invoiced) needs
		// at least 17 steps, and the deepest witness of the pass run (neverStandardPaidAfterSentRevision, docs/verification.md)
		// about 25. At 50 steps, seed 0x1, the mutant is found in about 1,300 runs and the witness's state is reached in
		// about 320 since F10's fix (at 40 about 9,300 and at 30 not in 100,000, measured before it), so each mutant check
		// allows 20,000 and each run that must pass makes 10,000.
		steps: "50",
		samples: "20000",
		passSamples: "10000",
	},
	{
		file: "verification/signin-codes.qnt",
		current: ["signin"],
		mutants: signinMutants,
		equivalents: [],
		exhaustive: [],
		// Its rarest mutant takes about 6,000 random runs to find (the rest a few hundred), so each mutant check allows 12,000; the
		// run that must pass makes 8,000, which costs about 8 s of one core.
		samples: "12000",
		passSamples: "8000",
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
		current: ["projectNotices", "projectNoticesUpdate"],
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
	{
		file: "verification/link-previews.qnt",
		current: [
			"linkPreviewsCurrent",
			"previewReviewCurrent",
			"previewFinalizerCurrent",
			"validationAuthorityCurrent",
			"immutablePreviewCurrent",
		],
		mutants: {
			linkPreviewsMovingCheckout: { property: "renderedTreeMatches" },
			linkPreviewsForcePush: { property: "newerCommitPreserved" },
			previewReviewEarly: { property: "reviewBeforeValidation" },
			previewFinalizerForged: { property: "authenticatedReview" },
			previewFinalizerPrivate: { property: "privateApproved" },
			previewFinalizerMoved: { property: "exactHead" },
			validationAuthorityStale: { property: "authoritativeSuccess" },
			immutablePreviewMutable: { property: "immutableReviewBound" },
		},
		equivalents: [],
		exhaustive: [
			"linkPreviewsCurrent",
			"previewReviewCurrent",
			"previewFinalizerCurrent",
			"validationAuthorityCurrent",
			"immutablePreviewCurrent",
		],
		samples: "1000",
		steps: "8",
	},
];
