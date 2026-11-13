import { POST } from "~/pages/api/software/brief/pass";
import {
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";
import { ORIGIN, outside, rawVisit, visit } from "./areas/public";

// The golden corpus for POST /api/software/brief/pass: the brief page trades a Turnstile token for a 30 minute pass
// cookie that the suggest route then requires. Every answer is 200 { ok } with cache-control no-store; ok is true only
// together with a set-cookie. The clock is frozen, so the cookie value is the same on every run.
//
// Every response branch and effect path, and the cases that reach them:
//
//   200 { ok: false }, no outside effect
//     gates          no Turnstile secret, switch absent, "false" or in capitals, no cf-connecting-ip
//     body           wrong or missing Origin, wrong content type, no body, text that is not JSON, over 4096 bytes, null,
//                    array, token missing, empty, not text, 2049 characters, extra key (strict)
//   200 { ok: false }, after the Turnstile call
//                    Turnstile says no, answers 5xx, cannot be reached, answers unreadable text, success as text
//   200 { ok: true } with set-cookie "__Secure-brief-suggestion-pass=<expiry>.<visitor hash>.<signature>; Path=/api/software/brief;
//                    HttpOnly; Secure; SameSite=Strict; Max-Age=1800"
//                    an IPv4 and an IPv6 address, another secret, a token with unicode, a token of 2048 characters
//   effects        the Turnstile call: secret, token and the visitor address (remoteip), 5 s abort signal
//   sequences      asked twice (the same cookie again), two addresses (two cookies), a refused token then a good one,
//                  a day later (a new cookie)

const PATH = "/api/software/brief/pass";
const DAY = 86_400_000;
const good = { token: "token-1" };

const on = { env: { SOFTWARE_SUGGESTIONS_ENABLED: "true" } };
const passes = outside(json(200, { success: true }));

const ask = (body: JsonValue | undefined, over: Partial<Step> = {}): Step =>
	visit(PATH, body, over);

const single = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	steps: [ask(body, over)],
	fetches: passes,
	...on,
	...extra,
});

const raw = (
	name: string,
	body: string | undefined,
	headers: { [name: string]: string },
): Case => ({
	name,
	steps: [rawVisit(PATH, body, headers)],
	fetches: passes,
	...on,
});

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };

const cases: Case[] = [
	// --- 200 with a cookie
	single("a good token", good),
	single(
		"a good token from an IPv6 address",
		good,
		{},
		{
			as: asVisitor({ ip: "2001:db8::1" }),
		},
	),
	single("a good token with unicode", { token: "ключ-🎵" }),
	single("a token of 2048 characters", { token: "t".repeat(2048) }),
	single("a token with padding is sent as it is", { token: "  token-1  " }),
	single("another secret gives another cookie", good, {
		env: {
			SOFTWARE_SUGGESTIONS_ENABLED: "true",
			TURNSTILE_SECRET_KEY: "another_secret",
		},
	}),

	// --- gates
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
	single("no cf-connecting-ip header", good, {}, { as: asVisitor() }),

	// --- body
	raw("no Origin header", JSON.stringify(good), {
		"content-type": "application/json",
	}),
	raw("an Origin that is another site", JSON.stringify(good), {
		origin: "https://evil.example.com",
		"content-type": "application/json",
	}),
	raw("a text/plain content type", JSON.stringify(good), {
		origin: ORIGIN,
		"content-type": "text/plain",
	}),
	raw("a form content type", "token=abc", {
		origin: ORIGIN,
		"content-type": "application/x-www-form-urlencoded",
	}),
	raw("a JSON content type with a charset", JSON.stringify(good), {
		origin: ORIGIN,
		"content-type": "application/json; charset=utf-8",
	}),
	raw("no body at all", undefined, jsonHeaders),
	raw("text that is not JSON", "{not json", jsonHeaders),
	raw("an empty body", "", jsonHeaders),
	raw(
		"a body over 4096 bytes",
		JSON.stringify({ token: "x".repeat(5000) }),
		jsonHeaders,
	),
	single("a null body", null),
	single("an array body", []),
	single("a string body", "token"),
	single("an empty object body", {}),
	single("token missing", { other: 1 }),
	single("token empty", { token: "" }),
	single("token not text", { token: 5 }),
	single("token an array", { token: ["a"] }),
	single("token 2049 characters", { token: "t".repeat(2049) }),
	single("an extra key beside the token", { ...good, extra: true }),

	// --- Turnstile
	single("Turnstile says no", good, {
		fetches: outside(json(200, { success: false })),
	}),
	single("Turnstile answers success as text", good, {
		fetches: outside(json(200, { success: "true" })),
	}),
	single("Turnstile answers something without success", good, {
		fetches: outside(json(200, { other: 1 })),
	}),
	single("Turnstile answers an error status", good, {
		fetches: outside(json(500, { success: true })),
	}),
	single("Turnstile answers 403", good, {
		fetches: outside(json(403, { success: true })),
	}),
	single("Turnstile answers unreadable text", good, {
		fetches: outside(text(200, "<html>")),
	}),
	single("Turnstile cannot be reached", good, {
		fetches: outside(networkDown()),
	}),

	// --- sequences
	{
		name: "asked twice by the same address",
		steps: [ask(good), ask(good)],
		fetches: passes,
		...on,
	},
	{
		name: "two addresses get two cookies",
		steps: [ask(good), ask(good, { as: asVisitor({ ip: "203.0.113.8" }) })],
		fetches: passes,
		...on,
	},
	{
		name: "a refused token, then a good one",
		steps: [ask(good), ask(good)],
		fetches: byHost({
			turnstile: [json(200, { success: false }), json(200, { success: true })],
		}),
		...on,
	},
	{
		name: "a day later the cookie changes",
		steps: [ask(good), ask(good, { advanceMs: DAY })],
		fetches: passes,
		...on,
	},
	{
		name: "a minute later the expiry moves",
		steps: [ask(good), ask(good, { advanceMs: 60_000 })],
		fetches: passes,
		...on,
	},
	{
		name: "a good token after a bad body from the same address",
		steps: [ask({ token: "" }), ask(good)],
		fetches: passes,
		...on,
	},
];

defineCorpus("software-brief-pass", POST, cases);
