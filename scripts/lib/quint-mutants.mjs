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
];
