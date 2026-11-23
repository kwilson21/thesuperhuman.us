// One pricing request at a time for /owner/pricing (verification/pricing-save.qnt, mutants parallel-saves and
// retry-after-lost). The forms' saves (src/scripts/owner-pricing.ts) and the market refresh's buttons
// (src/scripts/owner-pricing-refresh.ts) write the same record, so a press while any of them is on its way waits, and
// after an answer was lost every one of them asks for a reload: the version the page holds may be old.

let sending = false;
let lost = false;

/** Why a press must wait: a request is on its way, or an answer was lost and the page needs a reload. Null to send. */
export function pageWait(): "busy" | "reload" | null {
	if (lost) return "reload";

	if (sending) return "busy";

	return null;
}

/** Claims the page for one request. False, claiming nothing, when a press must wait. */
export function claimPage() {
	if (pageWait() !== null) return false;
	sending = true;

	return true;
}

/** Marks a request's answer lost: it may have been written, so every later press asks for a reload. */
export function markLost() {
	lost = true;
}

/** Releases the page once a request ends, however it ended. */
export function releasePage() {
	sending = false;
}
