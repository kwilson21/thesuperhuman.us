import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	discardCode,
	NothingToDiscard,
} from "../../src/server/rules/signin-discard";

// The discard rule (docs/plans/2026-11-studio-signin-conversion.md, section 2), over the cases
// tests/lib/signin-code-rules.test.ts held `decideDiscard` to for a code the machine allows DISCARD on (an unused one). A
// used or missing code never reaches the rule: the machine refuses it (tests/server/machines-signin-code.test.ts), and the
// flow does nothing (NothingToDiscard). The database re-checks at write time that the code is still unused (C8).

const open = { requestId: "open", withdrawn: false };
const withdrawn = { requestId: "withdrawn", withdrawn: true };

const discarded = (projects: readonly (typeof open)[]) =>
	Effect.runSync(discardCode.decide(null, { projects }));

describe("discarding an undelivered code", () => {
	it("audits every project that is not closed, a withdrawn one included", () => {
		expect(discarded([withdrawn, open])).toEqual({
			auditRequestIds: ["withdrawn", "open"],
		});
	});

	it("audits nothing when the address has no project left", () => {
		expect(discarded([])).toEqual({ auditRequestIds: [] });
	});

	it("names the refusal the flow gives when the machine refuses DISCARD, with no sentence (no one is answered)", () => {
		const refusal = new NothingToDiscard();

		expect(refusal._tag).toBe("NothingToDiscard");
		expect(refusal.say).toBe("");
	});
});
