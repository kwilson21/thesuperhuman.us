// The mutants of verification/invoice-events.qnt, read by scripts/verify-quint.mjs and tests/scripts/quint-run.test.ts.

// module name -> the property its change must break
export const mutants = {
	audioOldRule: { property: "moneyNotLost" },
	softwareOldRule: { property: "moneyNotLost" },
	audioStaleGuard: { property: "moneyNotLost" },
	softwareStaleGuard: { property: "moneyNotLost" },
	audioPreFixLink: { property: "moneyNotLost" },
	softwareNoIdPin: { property: "idNeverOverwritten" },
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
	"audioNoIdPin",
	"softwareNoDupDetection",
	"softwareNoReadUnmatched",
];

// The same two models with fewer handler runs, for the manual Apalache search (scripts/verify-quint.mjs exhaustive).
export const exhaustive = ["audioExhaustive", "softwareExhaustive"];
