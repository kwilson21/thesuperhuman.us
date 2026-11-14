// The decisions of a brief suggestion request, each a named rule. Nothing here reads a store or calls out: the flow reads the
// facts (the stored count, the limiters' answers, whether the pass is valid) and asks a rule what to do. A refusal says
// nothing to the visitor, so each one is answered the way the route has always answered it (an empty suggestion, or the
// pass prompt); the refusal's name is what tells the cases apart in the flow.
import { alwaysWrites, term, unless } from "../terms";

/** A refusal with no sentence: the route answers with an empty suggestion. */
const quietly = (tag: string) => ({ _tag: tag, say: "" });

/** How many stored suggestions a site may take in one UTC day. */
export const SITE_DAILY_CAP = 10000;

/** How many suggestions one visitor may take in one UTC day. */
export const VISITOR_DAILY_CAP = 300;

const wordCount = (text: string) => text.trim().split(/\s+/).length;

export type SuggestionRequest = {
	readonly text: string;
	/** The question, the text and the earlier answers as one JSON string: the model's prompt. */
	readonly content: string;
	readonly ip: string | null;
};

/** A request that may ask for a suggestion: three words or more, a prompt of at most 2000 characters, and a known address. */
export const askForSuggestion = alwaysWrites({
	name: "Accept a suggestion request",
	given: (request: SuggestionRequest, _facts: Record<string, never>) => request,
	refusals: [
		unless(
			term(
				"the text has at least three words",
				(given: SuggestionRequest) => wordCount(given.text) >= 3,
			),
			() => quietly("TooFewWords"),
		),
		unless(
			term(
				"the prompt is at most 2000 characters",
				(given: SuggestionRequest) => given.content.length <= 2000,
			),
			() => quietly("PromptTooLong"),
		),
		unless(
			term("the address is known", (given: SuggestionRequest) =>
				Boolean(given.ip),
			),
			() => quietly("NoAddress"),
		),
	],
	writes: (given: SuggestionRequest) => ({
		ip: given.ip ?? "",
		content: given.content,
	}),
	writesText: "the request, to be checked against the pass and the budget",
});

/** The visitor's pass: a signed, unexpired cookie for this address. Without one the route asks for a pass. */
export const requirePass = alwaysWrites({
	name: "Require a valid suggestion pass",
	given: (
		request: { readonly valid: boolean },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the pass is valid",
				(given: { readonly valid: boolean }) => given.valid,
			),
			() => quietly("PassRequired"),
		),
	],
	writes: () => true,
	writesText: "the request may go on",
});

/** Both minute limits must allow the request. The site's count is read only after the visitor's allowed it. */
export const withinMinuteLimits = alwaysWrites({
	name: "Within the minute limits",
	given: (
		request: { readonly visitor: boolean; readonly site: boolean },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the visitor is within the minute limit",
				(given: { readonly visitor: boolean }) => given.visitor,
			),
			() => quietly("VisitorMinuteLimit"),
		),
		unless(
			term(
				"the site is within the minute limit",
				(given: { readonly site: boolean }) => given.site,
			),
			() => quietly("SiteMinuteLimit"),
		),
	],
	writes: () => true,
	writesText: "the request may reserve budget",
});

/** The site may still take suggestions today: its stored count is under the daily cap (or nothing is stored yet). */
export const withinSiteBudget = alwaysWrites({
	name: "Within the site's daily budget",
	given: (
		request: { readonly siteCount: number | null },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the site count is under the daily cap",
				(given: { readonly siteCount: number | null }) =>
					given.siteCount === null || given.siteCount < SITE_DAILY_CAP,
			),
			() => quietly("SiteDailyCap"),
		),
	],
	writes: () => true,
	writesText: "the request may reserve budget",
});

/**
 * The model's reply becomes the suggestion when it is a plain line: some text, no line break, quote or control character,
 * and at most 100 characters. The suggestion is cut to six words, with a leading space unless the text ends in one.
 */
export const suggestionFromReply = alwaysWrites({
	name: "Turn the model's reply into a suggestion",
	given: (
		request: { readonly reply: string; readonly text: string },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the reply has text",
				(given: { readonly reply: string }) => given.reply.length > 0,
			),
			() => quietly("NoReply"),
		),
		unless(
			term(
				"the reply is one plain line of at most 100 characters",
				(given: { readonly reply: string }) =>
					!/[\r\n"\x00-\x1f]/.test(given.reply) && given.reply.length <= 100,
			),
			() => quietly("UnusableReply"),
		),
	],
	writes: (given: { readonly reply: string; readonly text: string }) => {
		const words = given.reply.split(/\s+/).slice(0, 6).join(" ");

		return `${/\s$/.test(given.text) ? "" : " "}${words}`;
	},
	writesText: "the words to show after the visitor's text",
});
