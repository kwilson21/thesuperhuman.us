import { vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	BOTH,
	CSRF,
	FORM,
	SOW_ID,
	clientSigned,
	countersignBody,
	executed,
	ownerForm,
	ownerHeaders,
	ownerJson,
	scene,
	quiet,
	type Scene,
} from "./areas/signing";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";

vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for what POST /api/owner/requests/[id]/agreement does before any action runs: the owner check, the
// bindings, the two wire formats (agreementRequest and nativeAgreementRoute in agreement-request.ts) and the action
// schema. The actions themselves are in the owner-request-agreement-<action> corpora. Names starting "form:" send an
// urlencoded form (answered with a 303, or with an HTML page for a refusal); the others send JSON.
//
//   403 {ok:false}                      a visitor, a client session, no owner
//   503 {ok:false}                      no MUSIC_DB, no id parameter, an empty one (the owner check comes first)
//   403 Forbidden                       Origin that is not the request's: JSON gets musicRequest's plain answer; a form gets
//                                       the answer with the agreement headers
//   415 JSON required                   JSON body with another content type
//   400 Invalid JSON / Missing request  malformed or absent JSON body; a form with no body ({ok:false}); a form whose
//                                       documents, values or manifest field is not JSON ("Invalid fields")
//   413 Request too large               over 16384 bytes, JSON or form
//   400 "Complete the required confirmations."   null, array, string, number bodies; no action or an unknown one; an
//                                       action's fields wrong (the config and setting form shapes of agreementRequest
//                                       reach the schema too, and fail it)
//   a form refusal is an HTML page with the message escaped, a 303 passes through, a success with no text is unchanged
//   200 / 303                           an accepted action (each action's own corpus holds the rest)

const post = (
	name: string,
	step: Step,
	sc: Scene = clientSigned(),
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(sc),
	...quiet,
	steps: [step],
	...extra,
});

const json = (
	name: string,
	body: Parameters<typeof ownerJson>[0],
	over: Partial<Step> = {},
	sc?: Scene,
	extra: Partial<Case> = {},
) => post(name, ownerJson(body, over), sc, extra);

const raw = (
	name: string,
	text: string,
	headers: { origin?: string | null; type?: string | null },
	sc?: Scene,
) =>
	post(
		name,
		ownerJson(undefined, { body: text, headers: ownerHeaders(headers) }),
		sc,
	);

const form = (
	name: string,
	fields: { [name: string]: string | undefined },
	over: Partial<Step> = {},
	sc?: Scene,
) => post(`form: ${name}`, ownerForm(fields, over), sc);

const formRaw = (
	name: string,
	text: string | undefined,
	over: Partial<Step> = {},
	sc?: Scene,
) => post(`form: ${name}`, ownerForm({}, { body: text, ...over }), sc);

const guards: Case[] = [
	json("a visitor", countersignBody(), { as: asVisitor() }),
	json("a signed-in client", countersignBody(), {
		as: asClientCookie("x".repeat(43)),
	}),
	json(
		"a visitor with a malformed body: the owner check comes first",
		undefined,
		{ as: asVisitor(), body: "{bad", headers: ownerHeaders() },
	),
	json(
		"a visitor with no database: the owner check comes first",
		countersignBody(),
		{ as: asVisitor() },
		undefined,
		{ music: { missing: true } },
	),
	json("no database", countersignBody(), {}, undefined, {
		music: { missing: true },
	}),
	post("form: no database", ownerForm({}, {}), undefined, {
		music: { missing: true },
	}),
	json("no id parameter", countersignBody(), { params: {} }),
	json("an empty id parameter", countersignBody(), { params: { id: "" } }),
	json("the owner with an empty email", countersignBody(), { as: asOwner("") }),
	post(
		"form: an id parameter with markup",
		ownerForm(
			{
				action: "countersign",
				documents: JSON.stringify(BOTH),
				typed_name: "x",
				consent: "true",
			},
			{ params: { id: '"><script>alert(1)</script>' } },
		),
	),
	post(
		"form: an id parameter with an ampersand and quotes",
		ownerForm(
			{
				action: "countersign",
				documents: "[]",
				typed_name: "x",
				consent: "true",
			},
			{ params: { id: `a&b"c'd` } },
		),
	),
];

const wire: Case[] = [
	json("an origin that is not the site's", countersignBody(), {
		headers: ownerHeaders({ origin: "https://evil.example" }),
	}),
	json("no origin header", countersignBody(), {
		headers: ownerHeaders({ origin: null }),
	}),
	raw("a text/plain content type", JSON.stringify(countersignBody()), {
		type: "text/plain",
	}),
	raw("no content type", JSON.stringify(countersignBody()), { type: null }),
	raw("a json content type with a charset", JSON.stringify(countersignBody()), {
		type: "application/json; charset=utf-8",
	}),
	raw(
		"a form content type sent to the JSON parser path",
		JSON.stringify(countersignBody()),
		{ type: "text/html" },
	),
	raw("malformed JSON", "{bad", {}),
	raw("an empty string body", "", {}),
	post("an absent body", ownerJson(undefined, { headers: ownerHeaders() })),
	raw(
		"a JSON body of 16 KiB plus one",
		JSON.stringify({ ...countersignBody(), pad: "x".repeat(17000) }),
		{},
	),
	raw("null", "null", {}),
	raw("an array", "[]", {}),
	raw("a string", '"countersign"', {}),
	raw("a number", "7", {}),
	raw("true", "true", {}),
	raw("an empty object", "{}", {}),
	json("no action", { documents: BOTH }),
	json("an unknown action", { action: "delete" }),
	json("an action in capitals", countersignBody({ action: "COUNTERSIGN" })),
	json("an action that is not text", countersignBody({ action: 5 })),
	json("the config action, which this route does not know", {
		action: "config",
		values: {},
	}),
	json("the setting action, which this route does not know", {
		action: "setting",
		enabled: true,
	}),
	json(
		"a prototype key",
		JSON.parse(
			'{"action":"hold","__proto__":{"held":true},"agreement_id":"' +
				SOW_ID +
				'"}',
		),
	),
];

const forms: Case[] = [
	form(
		"an origin that is not the site's",
		{ action: "hold", agreement_id: SOW_ID, held: "on" },
		{ headers: { origin: "https://evil.example", "content-type": FORM } },
	),
	form(
		"no origin header",
		{ action: "hold", agreement_id: SOW_ID, held: "on" },
		{ headers: { "content-type": FORM } },
	),
	formRaw("a body over 16 KiB", `action=hold&pad=${"x".repeat(17000)}`),
	formRaw("no body", undefined),
	formRaw("an empty body", ""),
	formRaw("documents that are not JSON", "action=countersign&documents=%7Bbad"),
	formRaw(
		"values that are not JSON",
		`action=hold&agreement_id=${SOW_ID}&values=%7Bbad`,
	),
	formRaw(
		"a manifest that is not JSON",
		`action=hold&agreement_id=${SOW_ID}&manifest=%7Bbad`,
	),
	formRaw(
		"values that are JSON and unused",
		`action=hold&agreement_id=${SOW_ID}&held=on&values=%7B%7D`,
	),
	formRaw(
		"a manifest that is JSON and unused",
		`action=hold&agreement_id=${SOW_ID}&held=on&manifest=%5B%5D`,
	),
	formRaw(
		"the config shape (no values): action and version become values",
		"action=config&expectedCurrentVersion=2&legal_name=X&registered_agent_confirmed=on",
	),
	formRaw(
		"the client details shape (legal_name and no action)",
		`legal_name=Acme&csrf_nonce=${CSRF}`,
	),
	formRaw("the setting action with no enabled field", "action=setting"),
	formRaw("the setting action with enabled on", "action=setting&enabled=on"),
	formRaw(
		"a turnstile field is copied to turnstileToken",
		`action=hold&agreement_id=${SOW_ID}&held=on&cf-turnstile-response=tok`,
	),
	formRaw(
		"a repeated field takes the last value",
		`action=hold&agreement_id=${SOW_ID}&held=false&held=on`,
	),
	formRaw(
		"a field name with markup",
		`action=hold&agreement_id=${SOW_ID}&held=on&%3Cb%3E=x`,
	),
	formRaw(
		"a content type with a charset",
		`action=hold&agreement_id=${SOW_ID}&held=on`,
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": `${FORM}; charset=utf-8`,
			},
		},
	),
	formRaw(
		"a multipart content type goes to the JSON parser",
		`action=hold&agreement_id=${SOW_ID}`,
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "multipart/form-data; boundary=x",
			},
		},
	),
	formRaw("no action", `agreement_id=${SOW_ID}&held=on`),
	formRaw("an unknown action", "action=delete"),
	formRaw(
		"encoded unicode and markup in a field",
		"action=abandon&reason=%3Cb%3E%C3%A9%3C%2Fb%3E&confirmed=on&documents=%5B%5D",
	),
	formRaw(
		"a plus sign and a percent sign in text",
		`action=record-alternate-copy&agreement_id=${SOW_ID}&role=client&method=a%2Bb+c%25&confirmed=on`,
	),
	post(
		"form: the same refusal as JSON and as a form",
		ownerForm({
			action: "abandon",
			documents: JSON.stringify(BOTH),
			reason: "x",
		}),
	),
];

const pages: Case[] = [
	form(
		"a refused abandon is an HTML page",
		{
			action: "abandon",
			documents: JSON.stringify(BOTH),
			reason: "x",
			confirmed: "on",
		},
		{},
		executed(),
	),
	form(
		"a refused countersign is an HTML page",
		{
			action: "countersign",
			documents: JSON.stringify(BOTH),
			typed_name: "x",
			consent: "on",
		},
		{},
		executed(),
	),
	form("an accepted hold is a 303", {
		action: "hold",
		agreement_id: SOW_ID,
		held: "on",
	}),
	form("an accepted abandon is a 303", {
		action: "abandon",
		documents: JSON.stringify(BOTH),
		reason: "x",
		confirmed: "on",
	}),
	form("an accepted countersign is a 303", {
		action: "countersign",
		documents: JSON.stringify(BOTH),
		typed_name: "Kazon Wilson",
		consent: "on",
	}),
];

const cases: Case[] = [...guards, ...wire, ...forms, ...pages];

defineCorpus("owner-request-agreement-wire", POST, cases);
