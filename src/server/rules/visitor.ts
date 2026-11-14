// The visitor rule: who played, as far as the playback table keeps it. A verified bot or a user agent that names a bot,
// crawler, spider, slurp or link preview is automated, and a location part is kept only when it is plain text of at most
// 80 characters. It decides from what the edge read of the request (src/server/music-input.ts `readVisitor`).
import * as Predicate from "effect/Predicate";
import { rule } from "../terms";

/** What the edge read of one request: Cloudflare's verdict on the client, the user agent, and the location it gave. */
export type Visitor = {
	readonly verifiedBot: boolean;
	readonly userAgent: string;
	readonly country: string | undefined;
	readonly region: string | undefined;
	readonly city: string | undefined;
};

/** What the playback table keeps of the visitor. */
export type PlaybackMetadata = {
	readonly trafficClass: "human" | "automated";
	readonly country: string;
	readonly region: string;
	readonly city: string;
};

const AUTOMATED_AGENT = /bot|crawler|spider|slurp|preview/i;

const CONTROL_CHARACTER = /[\u0000-\u001f]/;

const MAX_LOCATION_LENGTH = 80;

/** A location part is kept only when it is text of a sensible length with no control character. */
function locationPart(value: string | undefined) {
	return Predicate.isString(value) &&
		value.length <= MAX_LOCATION_LENGTH &&
		!CONTROL_CHARACTER.test(value)
		? value
		: "";
}

// Every playback has a visitor to record, so the rule names no nothing-to-do term and refuses nothing.
export const classifyVisitor = rule({
	name: "Classify a playback's visitor",
	given: (request: Visitor, _facts: Record<string, never>) => request,
	refusals: [],
	writes: (g): PlaybackMetadata => ({
		trafficClass:
			g.verifiedBot || AUTOMATED_AGENT.test(g.userAgent)
				? "automated"
				: "human",
		country: locationPart(g.country),
		region: locationPart(g.region),
		city: locationPart(g.city),
	}),
	writesText:
		"whether the visitor is a person or a bot, and the places that are plain text",
});
