import { POST } from "~/pages/api/software/brief/suggest";
import {
	createSuggestionPass,
	suggestionPassCookie,
	suggestionVisitorHash,
} from "~/lib/brief-suggestion-pass";
import {
	aiNever,
	aiThrows,
	aiValue,
	asVisitor,
	defineCorpus,
	START,
	type Case,
	type Dump,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";
import { IP, ORIGIN, rawVisit, visit } from "./areas/public";

// The golden corpus for POST /api/software/brief/suggest: while a visitor types a brief answer, the page asks Workers AI
// for the next few words. Every answer is 200 with { suggestion } (an empty one when anything is off), except that a
// visitor with no pass is told { suggestion: "", passRequired: true }. The cases are on a frozen clock, so a pass can be
// minted here with the route's own helper and a budget row seeded under the visitor's own hash.
//
// Every response branch and effect path, and the cases that reach them:
//
//   empty answer (200 { suggestion: "" }, no outside effect)
//     gates              no AI binding, no MUSIC_DB, no per-visitor or no site rate limit, no Turnstile secret, switch not
//                        "true" (absent, "false"), no cf-connecting-ip
//     body               wrong Origin, wrong content type, no body, text that is not JSON, over 16000 bytes, null, array,
//                        every schema field missing, wrong type, too long or unknown (strict, at both levels), a question
//                        that is not one of the six, the straight apostrophe accepted, fewer than three words, a JSON form
//                        over 2000 characters
//     rate limit         per-visitor refuses, site refuses
//     budget             site already at 10000, visitor at 300, the site row filling after the visitor row, the reads or
//                        writes throw, the rate-limit binding throws
//     model              answers with a newline, a quote, a control character, over 100 characters, nothing, only
//                        whitespace, no response string, null, throws
//   200 { suggestion: " words" }  the model's reply trimmed, cut to six words, a leading space only when the text does not
//                        end in whitespace; every question; every earlier path; straight apostrophes
//   200 { suggestion: "", passRequired: true }   no cookie, malformed, expired, too far in the future, another address,
//                        another secret, a forged signature, the right cookie among others, a cookie whose name only
//                        starts with the pass name
//   effects            budget rows reserved (visitor then site); the first row of the day starts a cleanup of old days in
//                        the background (runs, throws, no context); the call to the model with its exact prompt
//   local previews     localhost, 127.0.0.1 and [::1] each get an empty answer before any rate limit, budget or model call
//   model timeout      the model never answers, the route's own 1200 ms timer wins (empty answer, budget already reserved)
//   sequences          three suggestions in a row, the visitor reaching 300 mid-sequence, a day change between requests

const PATH = "/api/software/brief/suggest";
const SECRET = "ts_test_secret";
const T0 = Date.parse(START);
const DAY = 86_400_000;
const LIFETIME = 30 * 60 * 1000;

const PASS = await createSuggestionPass(SECRET, IP, T0);
const HASH = await suggestionVisitorHash(SECRET, IP, T0);
const OTHER_IP = "203.0.113.8";
const OTHER_HASH = await suggestionVisitorHash(SECRET, OTHER_IP, T0);

const good = {
	question: "What happens today?",
	text: "We copy rows by hand",
	earlier: { path: "workflow", today: "We copy rows by hand" },
};

const FINAL: Dump = { music: ["brief_suggestion_budget"] };
const TODAY = "2026-11-13";

const asked = (
	cookie: string | undefined = PASS,
): { [name: string]: string } =>
	cookie === undefined ? {} : { cookie: `${suggestionPassCookie}=${cookie}` };

const ask = (body: JsonValue | undefined, over: Partial<Step> = {}): Step =>
	visit(PATH, body, { headers: asked(), ...over });

const ok = {
	BRIEF_SUGGEST_RATE_LIMIT: [true],
	BRIEF_SUGGEST_SITE_LIMIT: [true],
};

const single = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	steps: [ask(body, over)],
	ai: [aiValue({ response: "and send them" })],
	rateLimits: ok,
	env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
	final: FINAL,
	...extra,
});

const answer = (name: string, response: JsonValue, text = good.text): Case =>
	single(name, { ...good, text }, { ai: [aiValue({ response })] });

const budget = (rows: { scope: string; count: number; day?: string }[]) => ({
	music: {
		seed: {
			brief_suggestion_budget: rows.map((row) => ({
				day: row.day ?? TODAY,
				scope: row.scope,
				count: row.count,
			})),
		},
	},
});

const withEarlier = (earlier: JsonValue, text = good.text) => ({
	...good,
	text,
	earlier,
});

const mint = async (secret: string, ip: string, at: number): Promise<string> =>
	createSuggestionPass(secret, ip, at);

const expired = await mint(SECRET, IP, T0 - LIFETIME - 1);
const future = await mint(SECRET, IP, T0 + 60_000);
const otherAddress = await mint(SECRET, OTHER_IP, T0);
const otherSecret = await mint("another_secret", IP, T0);
const yesterday = await mint(SECRET, IP, T0 - DAY);
const forged = `${PASS.slice(0, -1)}${PASS.endsWith("0") ? "1" : "0"}`;
const [expires, hash] = PASS.split(".");

const cases: Case[] = [
	// --- 200, a suggestion
	single("a suggestion for the first question", good),
	single("the model's reply is cut to six words", good, {
		ai: [aiValue({ response: "one two three four five six seven eight" })],
	}),
	answer("a reply with padding is trimmed", "  and send them  "),
	answer(
		"a reply when the text ends in a space has no leading space",
		"and send them",
		"We copy rows by hand ",
	),
	answer(
		"a reply when the text ends in a line break has no leading space",
		"and send them",
		"We copy rows by hand\n",
	),
	answer("a reply of a single word", "email"),
	answer("a reply of exactly 100 characters", "x".repeat(100)),
	answer("a reply that is a number as text", "42"),
	answer("a reply with punctuation and unicode", "à l’équipe, vite!"),
	answer("a reply with markup characters", "<b>bold</b> & more"),
	single("the idea question", {
		question: "What’s the idea?",
		text: "A tool for the tides",
		earlier: { path: "idea", idea: "A tool for the tides" },
	}),
	single("a straight apostrophe in the question is accepted", {
		question: "What's the idea?",
		text: "A tool for the tides",
		earlier: { path: "idea", idea: "A tool for the tides" },
	}),
	single("the first result question", {
		question: "Have a first result in mind?",
		text: "One click export of the rows",
		earlier: { path: "workflow", today: "We copy rows" },
	}),
	single("the first version question", {
		question: "Have a first version in mind?",
		text: "Add an order to the list",
		earlier: { path: "webapp", appGoal: "Track orders" },
	}),
	single("the website question", {
		question: "What’s the website for?",
		text: "Selling bread to the town",
		earlier: { path: "website", purpose: "Bread" },
	}),
	single("the website question with a straight apostrophe", {
		question: "What's the website for?",
		text: "Selling bread to the town",
		earlier: { path: "website" },
	}),
	single("the app question", {
		question: "What should the app let people do?",
		text: "Let people book a slot",
		earlier: { path: "webapp" },
	}),
	single("earlier has every optional field", {
		...good,
		earlier: {
			path: "workflow",
			today: "t",
			idea: "i",
			purpose: "p",
			appGoal: "a",
		},
	}),
	single("text with unicode and markup", {
		...good,
		text: "Nous <b>copions</b> les données à la main",
	}),
	single("exactly three words", { ...good, text: "one two three" }),
	single("words separated by tabs and line breaks", {
		...good,
		text: "one\ttwo\nthree",
	}),
	single("a text of 2000 characters that fits the combined limit", {
		question: "What happens today?",
		text: `${"w ".repeat(900)}end`,
		earlier: { path: "workflow" },
	}),

	// --- gates, each an empty answer with no outside effect
	single("no AI binding", good, { ai: undefined }),
	single("no database binding", good, { music: { missing: true } }),
	single("no per-visitor rate limit", good, {
		rateLimits: { BRIEF_SUGGEST_SITE_LIMIT: [true] },
	}),
	single("no site rate limit", good, {
		rateLimits: { BRIEF_SUGGEST_RATE_LIMIT: [true] },
	}),
	single("no Turnstile secret", good, { omit: ["TURNSTILE_SECRET_KEY"] }),
	single("the switch is absent", good, {
		omit: ["SOFTWARE_SUGGESTIONS_ENABLED"],
	}),
	single("the switch is false", good, {
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "false" },
	}),
	single("the switch is TRUE in capitals", good, {
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "TRUE" },
	}),
	{
		name: "no cf-connecting-ip header",
		steps: [ask(good, { as: asVisitor() })],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},

	// --- body
	{
		name: "no Origin header",
		steps: [
			rawVisit(PATH, JSON.stringify(good), {
				"content-type": "application/json",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "an Origin that is another site",
		steps: [
			rawVisit(PATH, JSON.stringify(good), {
				origin: "https://evil.example.com",
				"content-type": "application/json",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "a text/plain content type",
		steps: [
			rawVisit(PATH, JSON.stringify(good), {
				origin: ORIGIN,
				"content-type": "text/plain",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "text that is not JSON",
		steps: [
			rawVisit(PATH, "{not json", {
				origin: ORIGIN,
				"content-type": "application/json",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "a body over 16000 bytes",
		steps: [
			rawVisit(PATH, JSON.stringify({ ...good, text: "x ".repeat(9000) }), {
				origin: ORIGIN,
				"content-type": "application/json",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "no body at all",
		steps: [
			rawVisit(PATH, undefined, {
				origin: ORIGIN,
				"content-type": "application/json",
				...asked(),
			}),
		],
		ai: [aiValue({ response: "and send them" })],
		rateLimits: ok,
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	single("a null body", null),
	single("an array body", []),
	single("an empty object body", {}),
	single("question missing", { text: good.text, earlier: good.earlier }),
	single("question not text", { ...good, question: 5 }),
	single("question unknown", { ...good, question: "What is your budget?" }),
	single("question 101 characters", { ...good, question: "q".repeat(101) }),
	single("question in other capitals", {
		...good,
		question: "WHAT HAPPENS TODAY?",
	}),
	single("text missing", { question: good.question, earlier: good.earlier }),
	single("text not text", { ...good, text: 5 }),
	single("text 2001 characters", { ...good, text: "w ".repeat(1000) + "x" }),
	single("text of two words", { ...good, text: "two words" }),
	single("text of only spaces", {
		...good,
		text: "   ",
	}),
	single("text with an empty string", { ...good, text: "" }),
	single("earlier missing", { question: good.question, text: good.text }),
	single("earlier not an object", { ...good, earlier: "workflow" }),
	single("earlier with an unknown path", withEarlier({ path: "mobile" })),
	single("earlier with no path", withEarlier({ today: "x" })),
	single(
		"earlier with an extra key",
		withEarlier({ path: "workflow", extra: 1 }),
	),
	single(
		"earlier today 2001 characters",
		withEarlier({ path: "workflow", today: "t".repeat(2001) }),
	),
	single(
		"earlier idea 1001 characters",
		withEarlier({ path: "idea", idea: "i".repeat(1001) }),
	),
	single(
		"earlier purpose 2001 characters",
		withEarlier({ path: "website", purpose: "p".repeat(2001) }),
	),
	single(
		"earlier appGoal 1001 characters",
		withEarlier({ path: "webapp", appGoal: "a".repeat(1001) }),
	),
	single("earlier today not text", withEarlier({ path: "workflow", today: 5 })),
	single("an extra key at the top level", { ...good, extra: true }),
	single("the combined JSON is over 2000 characters", {
		...good,
		text: `${"w ".repeat(500)}end`,
		earlier: { path: "workflow", today: "t".repeat(1100) },
	}),
	single("the combined JSON is exactly 2000 characters", {
		question: "What happens today?",
		text: "a b c",
		earlier: { path: "workflow", today: "t".repeat(2000 - 98) },
	}),

	// --- the pass
	single("no pass cookie", good, {}, { headers: {} }),
	single(
		"a pass cookie that is empty",
		good,
		{},
		{
			headers: { cookie: `${suggestionPassCookie}=` },
		},
	),
	single(
		"a pass cookie that is malformed",
		good,
		{},
		{
			headers: { cookie: `${suggestionPassCookie}=not-a-pass` },
		},
	),
	single(
		"a pass cookie with uppercase hex",
		good,
		{},
		{
			headers: { cookie: `${suggestionPassCookie}=${PASS.toUpperCase()}` },
		},
	),
	single("an expired pass", good, {}, { headers: asked(expired) }),
	single(
		"a pass that expires too far ahead",
		good,
		{},
		{ headers: asked(future) },
	),
	single(
		"a pass made for another address",
		good,
		{},
		{ headers: asked(otherAddress) },
	),
	single(
		"a pass made with another secret",
		good,
		{},
		{ headers: asked(otherSecret) },
	),
	single("a pass made yesterday", good, {}, { headers: asked(yesterday) }),
	single(
		"a pass with a forged signature",
		good,
		{},
		{ headers: asked(forged) },
	),
	single(
		"a pass with a changed expiry",
		good,
		{},
		{
			headers: asked(`${Number(expires) + 1}.${hash}.${PASS.split(".")[2]}`),
		},
	),
	single(
		"a pass among other cookies",
		good,
		{},
		{
			headers: { cookie: `a=b; ${suggestionPassCookie}=${PASS}; c=d` },
		},
	),
	single(
		"a pass cookie after another with the same prefix",
		good,
		{},
		{
			headers: {
				cookie: `${suggestionPassCookie}-old=zzz; ${suggestionPassCookie}=${PASS}`,
			},
		},
	),
	single(
		"only a cookie whose name starts with the pass name",
		good,
		{},
		{
			headers: { cookie: `${suggestionPassCookie}-old=${PASS}` },
		},
	),
	single(
		"two pass cookies, the first one invalid",
		good,
		{},
		{
			headers: {
				cookie: `${suggestionPassCookie}=bad; ${suggestionPassCookie}=${PASS}`,
			},
		},
	),
	single(
		"the pass is checked before the body is, so a bad body still needs a pass",
		{ bad: true },
		{},
		{
			headers: {},
		},
	),
	single(
		"a pass from the other address on that address",
		good,
		{},
		{
			as: asVisitor({ ip: OTHER_IP }),
			headers: asked(otherAddress),
		},
	),

	// --- rate limits and budget
	single("the per-visitor limit refuses", good, {
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [false],
			BRIEF_SUGGEST_SITE_LIMIT: [true],
		},
	}),
	single("the site limit refuses", good, {
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true],
			BRIEF_SUGGEST_SITE_LIMIT: [false],
		},
	}),
	single("both limits refuse", good, {
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [false],
			BRIEF_SUGGEST_SITE_LIMIT: [false],
		},
	}),
	single(
		"the site is at its daily budget",
		good,
		budget([{ scope: "site", count: 10_000 }]),
	),
	single(
		"the site is one under its daily budget",
		good,
		budget([{ scope: "site", count: 9999 }]),
	),
	single(
		"the visitor is at their daily budget",
		good,
		budget([{ scope: HASH, count: 300 }]),
	),
	single(
		"the visitor is one under their daily budget",
		good,
		budget([{ scope: HASH, count: 299 }]),
	),
	single(
		"only yesterday's rows are full",
		good,
		budget([
			{ scope: "site", count: 10_000, day: "2026-11-12" },
			{ scope: HASH, count: 300, day: "2026-11-12" },
		]),
	),
	single(
		"another visitor is at their budget",
		good,
		budget([{ scope: OTHER_HASH, count: 300 }]),
	),
	single(
		"the first suggestion of the day clears old days",
		good,
		budget([
			{ scope: "site", count: 5, day: "2026-11-10" },
			{ scope: HASH, count: 5, day: "2026-11-10" },
			{ scope: "site", count: 7, day: "2026-11-12" },
		]),
	),
	single(
		"the first suggestion of the day clears old days, with no context",
		good,
		{
			...budget([{ scope: "site", count: 5, day: "2026-11-10" }]),
			noContext: true,
		},
	),
	single(
		"not the first suggestion of the day, so nothing is cleared",
		good,
		budget([
			{ scope: "site", count: 1 },
			{ scope: "site", count: 5, day: "2026-11-10" },
		]),
	),
	single("the cleanup of old days throws", good, {
		...budget([{ scope: "site", count: 5, day: "2026-11-10" }]),
		failures: [
			{ on: /DELETE FROM brief_suggestion_budget/, message: "d1 down" },
		],
	}),
	single("reading the site budget throws", good, {
		failures: [
			{ on: /SELECT count FROM brief_suggestion_budget/, message: "d1 down" },
		],
	}),
	single("reserving the visitor budget throws", good, {
		failures: [
			{ on: /INSERT INTO brief_suggestion_budget/, message: "d1 down" },
		],
	}),
	single("reserving the site budget throws", good, {
		failures: [
			{ on: /INSERT INTO brief_suggestion_budget/, message: "d1 down", nth: 2 },
		],
	}),
	single("the site budget fills after the visitor's was reserved", good, {
		interleave: [
			{
				on: /INSERT INTO brief_suggestion_budget/,
				nth: 2,
				label: "other visitors fill the site budget",
				run: (sqlite) =>
					sqlite.exec(
						`INSERT INTO brief_suggestion_budget (day,scope,count) VALUES ('${TODAY}','site',10000)`,
					),
			},
		],
	}),
	single("a rate limit that is not scripted throws", good, {
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [],
			BRIEF_SUGGEST_SITE_LIMIT: [true],
		},
	}),

	// --- the model
	single("the model throws", good, { ai: [aiThrows("model down")] }),
	answer("the model answers with a line break", "and\nsend"),
	answer("the model answers with a carriage return", "and\rsend"),
	answer("the model answers with a double quote", `and "send" them`),
	answer("the model answers with a single quote", "and 'send' them"),
	answer("the model answers with a control character", "and\u0001send"),
	answer("the model answers with a tab", "and\tsend"),
	answer("the model answers with 101 characters", "x".repeat(101)),
	answer("the model answers with nothing", ""),
	answer("the model answers with only spaces", "    "),
	answer("the model answers with a number", 5),
	answer("the model answers with null", null),
	single(
		"the model answers with an object that has no response",
		{ ...good },
		{
			ai: [aiValue({ text: "and send them" })],
		},
	),
	single("the model answers with null itself", good, { ai: [aiValue(null)] }),
	single("the model answers with a string itself", good, {
		ai: [aiValue("and send them")],
	}),
	answer(
		"the model answers with a reply of more than six words and tabs",
		"a b c d e f g h",
	),

	// --- sequences
	{
		name: "three suggestions in a row from one visitor",
		steps: [ask(good), ask(good), ask(good)],
		ai: [
			aiValue({ response: "one" }),
			aiValue({ response: "two" }),
			aiValue({ response: "three" }),
		],
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true, true, true],
			BRIEF_SUGGEST_SITE_LIMIT: [true, true, true],
		},
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "the visitor reaches their budget during the sequence",
		...budget([{ scope: HASH, count: 298 }]),
		steps: [ask(good), ask(good), ask(good)],
		ai: [aiValue({ response: "one" }), aiValue({ response: "two" })],
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true, true, true],
			BRIEF_SUGGEST_SITE_LIMIT: [true, true, true],
		},
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "two visitors share the site budget",
		...budget([{ scope: "site", count: 9998 }]),
		steps: [
			ask(good),
			ask(good, {
				as: asVisitor({ ip: OTHER_IP }),
				headers: asked(otherAddress),
			}),
			ask(good),
		],
		ai: [aiValue({ response: "one" }), aiValue({ response: "two" })],
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true, true, true],
			BRIEF_SUGGEST_SITE_LIMIT: [true, true, true],
		},
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "the next day the old rows are cleared and the budget starts again",
		...budget([
			{ scope: HASH, count: 300 },
			{ scope: "site", count: 20 },
		]),
		steps: [
			ask(good),
			ask(good, {
				advanceMs: DAY,
				headers: asked(await mint(SECRET, IP, T0 + DAY)),
			}),
		],
		ai: [aiValue({ response: "one" })],
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true, true],
			BRIEF_SUGGEST_SITE_LIMIT: [true, true],
		},
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},
	{
		name: "the same text asked twice gets two model calls",
		steps: [ask(good), ask(good)],
		ai: [aiValue({ response: "and send" }), aiValue({ response: "and send" })],
		rateLimits: {
			BRIEF_SUGGEST_RATE_LIMIT: [true, true],
			BRIEF_SUGGEST_SITE_LIMIT: [true, true],
		},
		env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" },
		final: FINAL,
	},

	// --- local previews never reach the model, the rate limits or the budget
	...[
		"http://localhost:4321",
		"http://127.0.0.1:4321",
		"http://[::1]:4321",
	].map((origin) =>
		single(
			`a request to ${origin.replace("http://", "").replace(":4321", "")} is answered empty before anything is used`,
			good,
			{},
			{ origin },
		),
	),

	// --- the model never answers, so the 1200 ms timer wins
	single(
		"the model never answers and the timeout gives an empty suggestion",
		good,
		{
			ai: [aiNever()],
		},
	),
];

defineCorpus("software-brief-suggest", POST, cases);
