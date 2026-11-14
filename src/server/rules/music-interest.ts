// The interest rule: what a listener's "I would want this" opens. A listener says they want the song, merchandise or
// both for a release. The rule answers what to store: the listener's standing interest for the release (one per release
// and email, replaced by the latest) and one request for the owner to read per thing wanted, each with its summary and
// details. Ids and the time are inputs. Nothing here reads a store: a listener's earlier interest is replaced, not
// consulted, so no fact is read first and the save's only guard is the table's primary key (release and email), which
// makes a second submission replace the first.
import { alwaysWrites } from "../terms";
import type { InterestInput } from "../music-input";

/** One thing the owner has to read: what the listener wants. */
export type OwnerRequestToOpen = {
	readonly kind: "purchase" | "merchandise";
	readonly summary: string;
	/** The JSON stored with the request. */
	readonly detailsJson: string;
};

export type InterestWrite = {
	readonly releaseId: string;
	readonly email: string;
	readonly interest: InterestInput["interest"];
	/** The merchandise asked for, each kind once, as JSON. */
	readonly merchandiseJson: string;
	readonly suggestion: string;
	readonly cityRegion: string;
	readonly consentVersion: string;
	readonly requests: readonly OwnerRequestToOpen[];
};

/** The consent text the listener agreed to. A new text is a new version. */
export const CONSENT_VERSION = "availability-v1";

// Every submission is stored, so it is an `alwaysWrites` rule (no nothing-to-do term), and it refuses nothing: the edge has already
// refused what the form must not send.
export const recordInterest = alwaysWrites({
	name: "Record a listener's interest in a release",
	given: (request: InterestInput, _facts: Record<string, never>) => ({
		...request,
		merchandise: [...new Set(request.merchandise)],
	}),
	refusals: [],
	writes: (g): InterestWrite => {
		const requests: OwnerRequestToOpen[] = [];

		if (g.interest === "song" || g.interest === "both")
			requests.push({
				kind: "purchase",
				summary: `Purchase interest · ${g.releaseId}`,
				detailsJson: "{}",
			});

		if (g.interest === "merchandise" || g.interest === "both")
			requests.push({
				kind: "merchandise",
				summary: `Merchandise interest · ${g.releaseId}`,
				detailsJson: JSON.stringify({
					merchandise: g.merchandise,
					suggestion: g.suggestion,
				}),
			});

		return {
			releaseId: g.releaseId,
			email: g.email,
			interest: g.interest,
			merchandiseJson: JSON.stringify(g.merchandise),
			suggestion: g.suggestion,
			cityRegion: g.cityRegion,
			consentVersion: CONSENT_VERSION,
			requests,
		};
	},
	writesText:
		"the listener's interest, and a request for the owner for each thing wanted",
});
