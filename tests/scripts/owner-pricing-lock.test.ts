// The page-wide lock on /owner/pricing (src/scripts/owner-pricing-lock.ts): the pricing forms and the market refresh's
// buttons send one request at a time between them, and after a lost answer neither sends again before a reload
// (verification/pricing-save.qnt, mutants parallel-saves and retry-after-lost).
import { describe, expect, it } from "vitest";
import {
	claimPage,
	markLost,
	pageWait,
	releasePage,
} from "~/scripts/owner-pricing-lock";

describe("the pricing page's lock", () => {
	it("lets one request through at a time, then asks for a reload after a lost answer", () => {
		expect(pageWait()).toBeNull();
		expect(claimPage()).toBe(true);

		// A save from a form is on its way: Use these figures must wait, and so must another save.
		expect(pageWait()).toBe("busy");
		expect(claimPage()).toBe(false);

		releasePage();
		expect(claimPage()).toBe(true);

		// Its answer was lost: nothing sends again until the page is reloaded.
		markLost();
		releasePage();
		expect(pageWait()).toBe("reload");
		expect(claimPage()).toBe(false);
	});
});
