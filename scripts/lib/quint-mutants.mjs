// The mutants of verification/invoice-events.qnt, read by scripts/verify-quint.mjs and tests/scripts/quint-run.test.ts.

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

// verification/signin-codes.qnt: the pass run, and each mutant with the property its change must break.
export const signinCurrent = ["signin"];

export const signinMutants = {
	signinSingleRow: { property: "clientNeverLockedOut" },
	signinEvictOldest: { property: "clientNeverLockedOut" },
	signinSweepLive: { property: "clientNeverLockedOut" },
	signinCookieNotRequired: { property: "cookieRequired" },
	signinAddressAttempts: { property: "othersUntouched" },
	signinReplaceLive: { property: "othersUntouched" },
	signinNoAttemptCap: { property: "attemptsBounded" },
	signinNoAllowance: { property: "emailsBounded" },
	signinIgnoreExpiry: { property: "deadCodeNeverSignsIn" },
	signinReuseUsed: { property: "deadCodeNeverSignsIn" },
	signinNoRowCap: { property: "liveRowsBounded" },
	signinFreshCookie: { property: "cookieOpensEmailedCode" },
};
