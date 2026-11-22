// Discarding an undelivered sign-in code: after a code was issued, Resend refused its email (a confirmed rejection; a
// timeout or a provider error keeps the code, since the email may still arrive), and the code is removed in the
// background, after the response, so it cannot be used. Decided from the code's `used_at` and the address's projects,
// read in one batch. The code machine (src/server/machines/signin-code.ts) is asked first, from the state
// `discardStateOf` derives from `used_at` alone: DISCARD is allowed from `live` (and so from `locked` and `expired`, which
// that read does not tell apart from it), and refused from `used` and `none` with NothingToDiscard, exported here, which
// the flow answers by doing nothing. So this rule refuses nothing (docs/plans/2026-11-studio-signin-conversion.md,
// sections 1 and 2). Writes, in one batch: the guard, an audit `code-delivery-failed` for every project that is not
// closed (a withdrawn one included), and the code's row deleted. Re-checked at write time by C8 (the code is still the
// unused one that was read; the guard raises and nothing is written when it was used or removed since, which the flow
// swallows, as today) and C7 (the audit only for a project still open when the batch runs). Nothing here reads a clock:
// the time, read after the email, is an input.
import * as Data from "effect/Data";
import { alwaysWrites } from "../terms";
import { auditIdsOf, type SigninProject } from "./signin-issue";

/**
 * The machine refused DISCARD: the code was used, or is gone. The flow does nothing more, and no one is answered: the
 * discard runs after the response, so this has no sentence.
 */
export class NothingToDiscard extends Data.TaggedError("NothingToDiscard") {
	readonly say = "";
}

/** What the discard's batch stores beyond the code's own key: the audit's projects. */
export type DiscardWrite = {
	readonly auditRequestIds: readonly string[];
};

export const discardCode = alwaysWrites({
	name: "discard a sign-in code whose email was refused",
	given: (
		_request: null,
		facts: { readonly projects: readonly SigninProject[] },
	) => facts,
	refusals: [],
	writes: (given): DiscardWrite => ({
		auditRequestIds: auditIdsOf(given.projects),
	}),
	writesText:
		"the audit code-delivery-failed for every project not closed and the code's row deleted, in one batch behind C8",
});
