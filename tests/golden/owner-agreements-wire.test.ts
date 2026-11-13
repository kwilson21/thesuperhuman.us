import { POST } from "~/pages/api/owner/agreements";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";
import {
	act,
	AGREEMENTS,
	form,
	FORM_HEADERS,
	FORM_TYPE,
	ORIGIN,
	raw,
	SAME_ORIGIN,
} from "./areas/agreement-admin";

// The golden corpus for what every action of POST /api/owner/agreements shares: who may ask, the bindings, and the two wire
// formats (agreementRequest in src/lib/agreement-request.ts): bounded JSON, and a native urlencoded form post that answers a
// 303 redirect or an HTML page. The action-specific files cover each action; this one covers the guards and the parsing.
//
// Every response branch of the handler, agreementRequest, musicRequest, nativeAgreementResponse and nativeAgreementRoute, and
// its cases:
//
//   403 {ok:false}                      no owner: a visitor, a studio client cookie, with a JSON body, a form body, no database
//   503 {ok:false}                      no MUSIC_DB (answered after the owner check, before the body is read)
//   JSON wire
//     403 {ok:false,error:"Forbidden"}  Origin missing, another host, another scheme, another port
//     415 "JSON required"               text/plain, no content type, form content type in other case, multipart
//     400 "Missing request"             not reachable here (a request with no body still has a reader); recorded as "Invalid JSON"
//     400 "Invalid JSON"                empty body, truncated JSON, text, a BOM
//     413 "Request too large"           over 120000 bytes, and exactly the limit (accepted by the reader, then rejected by the schema)
//     400 "Check required fields and limits."   null, an array, a string, a number, no action, an unknown action, an action that is not
//                                       text, an action in another case, extra keys on a valid action
//   form wire
//     403 HTML page "Forbidden"         Origin missing or foreign (the JSON body of the 403 is turned into a page)
//     413 HTML "Request too large"      over 120000 bytes
//     400 HTML "Invalid fields"         values, manifest or documents that are not JSON
//     400 HTML "Check required fields and limits."   no action, unknown action, the legal_name branch (csrf_nonce and values), hold
//     charset on the form content type; keys repeated (the last wins); empty body; __proto__ as a key
//   every error of the JSON kind is shown as an escaped HTML page for a form post; ok answers with no text stay JSON or become 303

const CLEAN = { action: "access-cleanup", confirmed: true };

/** A JSON body of exactly `total` bytes (a benign action padded with an unused key). */
const sized = (total: number) => {
	const head = JSON.stringify({ ...CLEAN, pad: "" });

	return JSON.stringify({ ...CLEAN, pad: "p".repeat(total - head.length) });
};

/** A form body of exactly `total` bytes. */
const sizedForm = (total: number) => {
	const head = "action=access-cleanup&confirmed=true&pad=";

	return head + "p".repeat(total - head.length);
};

const asForm = (
	fields: { [name: string]: string },
	extra: Partial<Step> = {},
) => form(fields, extra);

const cases: Case[] = [
	// who and what
	{
		name: "a visitor with a JSON body",
		steps: [
			act({ action: "access-cleanup", confirmed: true }, { as: asVisitor() }),
		],
	},
	{
		name: "a visitor with a form body",
		steps: [
			form(
				{ action: "access-cleanup", confirmed: "true" },
				{ as: asVisitor() },
			),
		],
	},
	{
		name: "a studio client cookie",
		steps: [
			act(
				{ action: "access-cleanup", confirmed: true },
				{ as: asClientCookie("a".repeat(72)) },
			),
		],
	},
	{
		name: "a visitor with no database",
		music: { missing: true },
		steps: [
			act({ action: "access-cleanup", confirmed: true }, { as: asVisitor() }),
		],
	},
	{
		name: "the owner with no database, JSON",
		music: { missing: true },
		steps: [act({ action: "access-cleanup", confirmed: true })],
	},
	{
		name: "the owner with no database, form",
		music: { missing: true },
		steps: [form({ action: "access-cleanup", confirmed: "true" })],
	},
	{
		name: "no database is answered before the body is read",
		music: { missing: true },
		steps: [raw("{bad")],
	},
	{
		name: "a visitor is answered before the body is read",
		steps: [raw("{bad", { as: asVisitor() })],
	},

	// JSON wire
	{ name: "a JSON body with no Origin", steps: [act(CLEAN, { headers: {} })] },
	{
		name: "a JSON body from another host",
		steps: [act(CLEAN, { headers: { origin: "https://evil.example" } })],
	},
	{
		name: "a JSON body from the same host over http",
		steps: [act(CLEAN, { headers: { origin: "http://thesuperhuman.us" } })],
	},
	{
		name: "a JSON body from another port",
		steps: [
			act(CLEAN, { headers: { origin: "https://thesuperhuman.us:8443" } }),
		],
	},
	{
		name: "a JSON body with a charset on the content type",
		steps: [
			act(
				{ action: "access-cleanup", confirmed: true },
				{
					headers: {
						...SAME_ORIGIN,
						"content-type": "application/json; charset=utf-8",
					},
				},
			),
		],
	},
	{
		name: "text/plain",
		steps: [
			raw("{}", { headers: { ...SAME_ORIGIN, "content-type": "text/plain" } }),
		],
	},
	{ name: "no content type", steps: [raw("{}", { headers: SAME_ORIGIN })] },
	{
		name: "the form content type in upper case is not recognised as a form",
		steps: [
			raw("action=x", {
				headers: { origin: ORIGIN, "content-type": FORM_TYPE.toUpperCase() },
			}),
		],
	},
	{
		name: "multipart",
		steps: [
			raw("--x--", {
				headers: {
					...SAME_ORIGIN,
					"content-type": "multipart/form-data; boundary=x",
				},
			}),
		],
	},
	{ name: "an empty JSON body", steps: [raw("")] },
	{ name: "truncated JSON", steps: [raw('{"action":"retention-pre')] },
	{ name: "a text body", steps: [raw("hello")] },
	{
		name: "a JSON body with a byte order mark",
		steps: [raw('﻿{"action":"access-cleanup","confirmed":true}')],
	},
	{ name: "a JSON null", steps: [raw("null")] },
	{ name: "a JSON array", steps: [raw("[]")] },
	{ name: "a JSON string", steps: [raw('"retention-preview"')] },
	{ name: "a JSON number", steps: [raw("7")] },
	{ name: "an empty object", steps: [act({})] },
	{ name: "an unknown action", steps: [act({ action: "delete-everything" })] },
	{ name: "an action that is not text", steps: [act({ action: 5 })] },
	{
		name: "an action in upper case",
		steps: [act({ action: "RETENTION-PREVIEW" })],
	},
	{
		name: "an action with a trailing space",
		steps: [act({ action: "retention-preview " })],
	},
	{ name: "a body of exactly 120000 bytes", steps: [raw(sized(120000))] },
	{ name: "a body of 120001 bytes", steps: [raw(sized(120001))] },
	{
		name: "a prototype key in the JSON",
		steps: [
			raw('{"action":"access-cleanup","confirmed":true,"__proto__":{"x":1}}'),
		],
	},

	// form wire
	{
		name: "a form with no Origin",
		steps: [
			form(
				{ action: "access-cleanup", confirmed: "true" },
				{ headers: { "content-type": FORM_TYPE } },
			),
		],
	},
	{
		name: "a form from another host",
		steps: [
			form(
				{ action: "access-cleanup", confirmed: "true" },
				{
					headers: {
						origin: "https://evil.example",
						"content-type": FORM_TYPE,
					},
				},
			),
		],
	},
	{
		name: "a form with a charset",
		steps: [
			form(
				{ action: "access-cleanup", confirmed: "true" },
				{
					headers: {
						origin: ORIGIN,
						"content-type": `${FORM_TYPE}; charset=UTF-8`,
					},
				},
			),
		],
	},
	{ name: "a form with no action", steps: [form({ confirmed: "true" })] },
	{ name: "a form with an unknown action", steps: [form({ action: "nope" })] },
	{
		name: "an empty form body",
		steps: [act(undefined, { body: "", headers: FORM_HEADERS })],
	},
	{
		name: "a form of exactly 120000 bytes",
		steps: [act(undefined, { body: sizedForm(120000), headers: FORM_HEADERS })],
	},
	{
		name: "a form of 120001 bytes",
		steps: [act(undefined, { body: sizedForm(120001), headers: FORM_HEADERS })],
	},
	{
		name: "a form with a values field that is not JSON",
		steps: [asForm({ action: "config", values: "{nope" })],
	},
	{
		name: "a form with a manifest field that is not JSON",
		steps: [
			asForm({ action: "retention-apply", confirmed: "true", manifest: "[" }),
		],
	},
	{
		name: "a form with a documents field that is not JSON",
		steps: [
			asForm({ action: "access-cleanup", confirmed: "true", documents: "}" }),
		],
	},
	{
		name: "a form carrying the sign-in fields takes the legal_name branch",
		steps: [
			asForm({ legal_name: "Grace", csrf_nonce: "n", entity_type: "llc" }),
		],
	},
	{
		name: "a form with action hold takes the held branch and is not an action",
		steps: [asForm({ action: "hold", held: "on" })],
	},
	{
		name: "a form with a repeated key keeps the last",
		steps: [
			act(undefined, {
				body: "action=nope&action=access-cleanup&confirmed=on",
				headers: FORM_HEADERS,
			}),
		],
	},
	{
		name: "a form with a prototype key",
		steps: [
			asForm({ action: "access-cleanup", confirmed: "on", ["__proto__"]: "x" }),
		],
	},
	{
		name: "a form with the Turnstile field",
		steps: [
			asForm({
				action: "access-cleanup",
				confirmed: "true",
				"cf-turnstile-response": "tok",
			}),
		],
	},
	{
		name: "a form boolean spelled yes is not true",
		steps: [asForm({ action: "access-cleanup", confirmed: "yes" })],
	},
	{
		name: "a form boolean spelled on is true",
		steps: [asForm({ action: "access-cleanup", confirmed: "on" })],
	},
	{
		name: "a form boolean spelled TRUE is not true",
		steps: [asForm({ action: "access-cleanup", confirmed: "TRUE" })],
	},
	{
		name: "an error page escapes markup in the message",
		steps: [
			asForm({
				action: "preview",
				kind: "msa",
				text: "x &<\"' y",
				expectedCurrentVersion: "0",
			}),
		],
	},
	{
		name: "the form content type but a JSON body",
		steps: [
			act(undefined, {
				body: '{"action":"access-cleanup","confirmed":true}',
				headers: FORM_HEADERS,
			}),
		],
	},
	{
		name: "an owner other than the default",
		steps: [act(CLEAN, { as: asOwner("second@example.test") })],
	},
	{
		name: "the AGREEMENTS path with a query string",
		steps: [act(CLEAN, { path: `${AGREEMENTS}?x=1` })],
	},
];

defineCorpus("owner-agreements-wire", POST, cases);
