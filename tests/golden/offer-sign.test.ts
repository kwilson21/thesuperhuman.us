import { vi } from "vitest";
import { POST } from "~/pages/api/offer/[token]/sign";
import {
	BOTH,
	CLIENT,
	CSRF,
	DRAFT,
	LATER,
	MSA_HASH,
	MSA_ID,
	OTHER_ID,
	OTHER_SESSION,
	OTHER_TOKEN,
	PAST,
	SESSION,
	SOW_HASH,
	SOW_ID,
	SOW_ONLY,
	cookie,
	doc,
	formFields,
	ownerHeaders,
	type Loose,
	notificationRows,
	resend,
	resendOk,
	scene,
	sessionRow,
	sha,
	signBody,
	signForm,
	signJson,
	valuesJson,
	FORM,
	type Scene,
} from "./areas/signing";
import {
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	text,
	type Case,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";

vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for POST /api/offer/[token]/sign: the verified client signs the MSA and SOW the owner sent. It is
// legal signing, so every guard, every state of the two documents, the two wire formats (JSON, and an urlencoded form
// that is answered with a 303 or an HTML page) and every outage are recorded.
//
// Every response branch of the handler, of agreementRequest and nativeAgreementRoute (agreement-request.ts), of
// getLinkedOffer, agreementSession, signingEnabled (agreement-access.ts) and of signAgreements, signatureInsert,
// sessionGuard, reusedMsaGuard (software-agreements.ts), and the cases that reach it. Names starting "form:" send the
// same request as an urlencoded form; the others send JSON.
//
//   handler guards
//   503 {ok:false}                        no MUSIC_DB                                       (no database)
//   403 {"ok":false,"error":"Forbidden"}  Origin is not the request's origin (form: with the agreement headers, as an
//                                         HTML page; JSON: musicRequest's plain answer without them)  (origin)
//   415 JSON required                     JSON body with another content type              (content type)
//   400 Invalid JSON / Missing request    malformed or absent JSON body; form without a body; form documents that are
//                                         not JSON ("Invalid fields", answered before the 401 check)  (body)
//   413 Request too large                 JSON over 16384 bytes, form over 16384 bytes
//   401 "Open a fresh email link"         signing off, no cookie, malformed, unknown, expired, revoked, wrong purpose,
//                                         wrong offer, replaced link, other recipient, offer withdrawn or superseded,
//                                         request withdrawn or resolved, link revoked, token unknown, malformed or absent
//                                         (the 401 is answered before the body is judged)   (session)
//   400 "Agree to sign electronically"    body null, array, string, number; csrf_nonce, documents or consent missing or
//                                         wrong, 0 or 3 documents, bad id or hash, consent not literally true  (input)
//   403 "Reload and try again."           csrf_nonce differs from the session's             (csrf)
//   200 {ok:true,receipt_id} / 303        signing succeeds; a form gets a 303 to /offer/<token>/sign  (signed)
//   409 "The reviewed agreement changed"  any error thrown by signAgreements              (refused)
//   rejected                              a database error outside the try: the offer or session lookup, the signing
//                                         setting. This is the route today; see the report.   (outage outside)
//
//   signAgreements
//   hash or id mismatch, one document, the wrong one, an extra one, all executed, an abandoned MSA
//   all client_signed: the same session gets the saved receipt back, another session or no signature row is refused
//   a draft that matches, differs, no longer resolves, or changes between the check and the batch
//   unsupported or unicode names (NFC folding of a decomposed name, accents, CJK, emoji, markup, 200 characters)
//   browser evidence limits (address over 100, agent over 2000, control characters, none)
//   a notice row when the address or notice email differs from the recorded client, none when equal
//   a reused MSA: signs only the SOW (the SOW-only intent text); the MSA terminated, missing or not executed
//   the batch guards under a race (session revoked, offer superseded, request withdrawn, link revoked, signing off,
//   a project created, a document changed or abandoned or signed first)
//   an outage at each statement, the batch, and the read after the batch (409 with the signatures committed)
//
//   deliverAgreementNotifications (after a signature, errors swallowed)
//   Resend: success; 4xx (failed); 5xx, network down, timeout (stay "sending"); no key or no sender (nothing sent)
//   a repeat of the same request, a repeat after an uncertain send, notifications already sent, a request resolved
//   in between

const bothDocs = BOTH;

type Fields = { [name: string]: JsonValue };

const step = (body: JsonValue, over: Partial<Step> = {}) =>
	signJson(body, over);

const sign = (
	name: string,
	sc: Scene,
	body: JsonValue = signBody(),
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	...scene(sc),
	fetches: resendOk,
	steps: [step(body, over)],
	...extra,
});

/** The same request as an urlencoded form. */
const formOf = (
	name: string,
	sc: Scene,
	body: Fields,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name: `form: ${name}`,
	...scene(sc),
	fetches: resendOk,
	steps: [signForm(formFields(body), over)],
	...extra,
});

/** A JSON case and its form twin. */
const both = (
	name: string,
	sc: Scene,
	body: Fields = signBody(),
	extra: Partial<Case> = {},
): Case[] => [sign(name, sc, body, extra), formOf(name, sc, body, extra)];

const headers = (
	over: {
		origin?: string | null;
		cookie?: string | null;
		type?: string | null;
	} = {},
) => {
	const out = ownerHeaders({ origin: over.origin, type: over.type });

	return {
		...out,
		...cookie(over.cookie === undefined ? SESSION : over.cookie),
	};
};

// ---------------------------------------------------------------------------------------------------------------------
// Guards: database, origin, content type, body
// ---------------------------------------------------------------------------------------------------------------------

const guards: Case[] = [
	{
		name: "no database",
		...scene(),
		music: { missing: true },
		steps: [step(signBody())],
	},
	{
		name: "form: no database",
		...scene(),
		music: { missing: true },
		steps: [signForm(formFields(signBody()))],
	},
	sign(
		"an origin that is not the site's",
		{},
		signBody(),
		{},
		{
			headers: headers({ origin: "https://evil.example" }),
		},
	),
	sign(
		"no origin header",
		{},
		signBody(),
		{},
		{
			headers: headers({ origin: null }),
		},
	),
	formOf(
		"an origin that is not the site's",
		{},
		signBody(),
		{},
		{
			headers: {
				origin: "https://evil.example",
				"content-type": FORM,
				...cookie(),
			},
		},
	),
	formOf(
		"no origin header",
		{},
		signBody(),
		{},
		{
			headers: { "content-type": FORM, ...cookie() },
		},
	),
	sign(
		"a text/plain content type",
		{},
		signBody(),
		{},
		{
			headers: headers({ type: "text/plain" }),
		},
	),
	{
		name: "no content type",
		...scene(),
		steps: [
			signJson(undefined, {
				body: JSON.stringify(signBody()),
				headers: headers({ type: null }),
			}),
		],
	},
	sign(
		"a json content type with a charset",
		{},
		signBody(),
		{},
		{
			headers: headers({ type: "application/json; charset=utf-8" }),
		},
	),
	sign(
		"a multipart content type",
		{},
		signBody(),
		{},
		{
			headers: headers({ type: "multipart/form-data; boundary=x" }),
		},
	),
	{
		name: "malformed JSON",
		...scene(),
		steps: [signJson(undefined, { body: "{bad", headers: headers() })],
	},
	{
		name: "an empty JSON body",
		...scene(),
		steps: [signJson(undefined, { headers: headers() })],
	},
	{
		name: "a JSON body over 16 KiB",
		...scene(),
		steps: [
			signJson(undefined, {
				body: JSON.stringify({ ...signBody(), pad: "x".repeat(17000) }),
				headers: headers(),
			}),
		],
	},
	{
		name: "a JSON body of exactly 16 KiB is read",
		...scene(),
		steps: [
			signJson(undefined, {
				headers: headers(),
				body: (() => {
					const base = JSON.stringify({ ...signBody(), pad: "" });

					return JSON.stringify({
						...signBody(),
						pad: "x".repeat(16384 - base.length),
					});
				})(),
			}),
		],
	},
	{
		name: "form: a body over 16 KiB",
		...scene(),
		steps: [signForm({ ...formFields(signBody()), pad: "x".repeat(17000) })],
	},
	{
		name: "form: no body",
		...scene(),
		steps: [signForm({}, { body: undefined })],
	},
	{
		name: "form: an empty body",
		...scene(),
		steps: [signForm({})],
	},
	formOf(
		"documents that are not JSON",
		{},
		{ ...signBody(), documents: "{bad" },
		{},
		{
			body: new URLSearchParams({
				csrf_nonce: CSRF,
				documents: "{bad",
				consent: "true",
			}).toString(),
		},
	),
	{
		name: "form: documents that are not JSON, with no session",
		...scene({ session: false }),
		steps: [
			signForm(
				{ csrf_nonce: CSRF, documents: "{bad", consent: "true" },
				{
					headers: { origin: "https://thesuperhuman.us", "content-type": FORM },
				},
			),
		],
	},
	{
		name: "form: a content type with a charset",
		...scene(),
		fetches: resendOk,
		steps: [
			signForm(formFields(signBody()), {
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": `${FORM}; charset=utf-8`,
					...cookie(),
				},
			}),
		],
	},
	{
		name: "form: a repeated field takes the last value",
		...scene(),
		fetches: resendOk,
		steps: [
			signForm(
				{},
				{
					body: `csrf_nonce=wrong&csrf_nonce=${CSRF}&documents=${encodeURIComponent(JSON.stringify(bothDocs))}&consent=on`,
				},
			),
		],
	},
	{
		name: "form: the turnstile field is carried but unused",
		...scene(),
		fetches: resendOk,
		steps: [
			signForm({ ...formFields(signBody()), "cf-turnstile-response": "tok" }),
		],
	},
	{
		name: "form: consent given as on",
		...scene(),
		fetches: resendOk,
		steps: [signForm({ ...formFields(signBody()), consent: "on" })],
	},
	{
		name: "form: consent given as yes is refused",
		...scene(),
		steps: [signForm({ ...formFields(signBody()), consent: "yes" })],
	},
	{
		name: "form: consent given as false",
		...scene(),
		steps: [signForm({ ...formFields(signBody()), consent: "false" })],
	},
	{
		name: "form: consent left out",
		...scene(),
		steps: [
			signForm({ csrf_nonce: CSRF, documents: JSON.stringify(bothDocs) }),
		],
	},
	{
		name: "form: documents given as an object",
		...scene(),
		steps: [signForm({ ...formFields(signBody()), documents: "{}" })],
	},
	{
		name: "form: markup in every field",
		...scene(),
		steps: [
			signForm({
				csrf_nonce: "<script>alert(1)</script>",
				documents: JSON.stringify([{ id: "<b>", hash: "&amp;" }]),
				consent: "true",
			}),
		],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------------------------------------------------

const auth: Case[] = [
	...both("no session cookie", { session: false }),
	sign(
		"a cookie of the wrong length",
		{},
		signBody(),
		{},
		{
			headers: headers({ cookie: "short" }),
		},
	),
	sign(
		"a cookie with a character outside the alphabet",
		{},
		signBody(),
		{},
		{
			headers: headers({ cookie: `${"s".repeat(42)}!` }),
		},
	),
	sign(
		"a cookie 44 characters long",
		{},
		signBody(),
		{},
		{
			headers: headers({ cookie: "s".repeat(44) }),
		},
	),
	sign(
		"an unknown session token",
		{},
		signBody(),
		{},
		{
			headers: headers({ cookie: OTHER_SESSION }),
		},
	),
	sign(
		"the agreement_session cookie among others",
		{},
		signBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json",
				cookie: `a=b; agreement_session=${SESSION}; c=d`,
			},
		},
	),
	sign(
		"the archive cookie instead of the agreement cookie",
		{},
		signBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json",
				cookie: `agreement_archive=${SESSION}`,
			},
		},
	),
	...both("an expired session", { session: { expires_at: PAST } }),
	...both("a revoked session", { session: { revoked_at: PAST } }),
	sign("a session of the archive purpose", {
		session: { purpose: "archive" },
	}),
	sign("a session for another offer", {
		session: { offer_id: "o9" },
		extra: {
			owner_requests: [rows.softwareRequest("r9", { email: "x@example.test" })],
			software_offers: [rows.softwareOffer("o9", "r9")],
		},
	}),
	sign("a session whose link was replaced", {
		session: { link_hash: sha(OTHER_TOKEN) },
	}),
	sign("a session of another recipient", {
		session: { recipient_email: "other@example.test" },
	}),
	...both("signing switched off", { signing: false }),
	sign(
		"signing off and an invalid body: the 401 comes first",
		{ signing: false },
		null,
	),
	sign(
		"no session and an invalid body: the 401 comes first",
		{ session: false },
		null,
	),
	sign("an offer that was withdrawn", { offer: { status: "withdrawn" } }),
	sign("an offer that was superseded", { offer: { status: "superseded" } }),
	sign("an offer still a draft", { offer: { status: "draft" } }),
	sign("a request that was withdrawn", { request: { status: "withdrawn" } }),
	sign("a request that was resolved", { request: { status: "resolved" } }),
	sign("a request with no email", { request: { email: "" } }),
	sign("a request of another kind", { request: { kind: "service" } }),
	sign("an offer link that was revoked", { link: { revoked_at: PAST } }),
	sign("an offer whose recipient snapshot differs from the session", {
		offer: { recipient_email_snapshot: "other@example.test" },
	}),
	{
		name: "an unknown offer token",
		...scene(),
		steps: [
			signJson(signBody(), {
				path: `/api/offer/${OTHER_TOKEN}/sign`,
				params: { token: OTHER_TOKEN },
			}),
		],
	},
	{
		name: "a malformed offer token",
		...scene(),
		steps: [
			signJson(signBody(), {
				path: "/api/offer/short/sign",
				params: { token: "short" },
			}),
		],
	},
	{
		name: "no offer token parameter",
		...scene(),
		steps: [signJson(signBody(), { params: {} })],
	},
	{
		name: "form: an offer token with markup",
		...scene(),
		steps: [
			signForm(formFields(signBody()), {
				path: "/api/offer/x/sign",
				params: { token: '"><script>alert(1)</script>' },
			}),
		],
	},
	{
		name: "form: an unknown offer token",
		...scene(),
		steps: [
			signForm(formFields(signBody()), {
				params: { token: OTHER_TOKEN },
			}),
		],
	},
	sign("the owner is not the client: owner cookie absent, owner signed in", {
		session: false,
	}),
	{
		name: "the owner's session does not sign for the client",
		...scene(),
		steps: [
			signJson(signBody(), {
				as: { kind: "owner", email: "owner@example.test" },
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json",
				},
			}),
		],
	},
	sign("a project already exists for the offer", {
		extra: {
			software_projects: [rows.softwareProject("r1", "o1")],
		},
	}),
];

// ---------------------------------------------------------------------------------------------------------------------
// The input fields
// ---------------------------------------------------------------------------------------------------------------------

const invalid: [string, JsonValue][] = [
	["a null body", null],
	["an array body", []],
	["a string body", "sign"],
	["a number body", 7],
	["an empty object", {}],
	["a missing csrf_nonce", { documents: bothDocs, consent: true }],
	["an empty csrf_nonce", signBody({ csrf_nonce: "" })],
	["a numeric csrf_nonce", signBody({ csrf_nonce: 5 })],
	["missing documents", { csrf_nonce: CSRF, consent: true }],
	["an empty documents list", signBody({ documents: [] })],
	[
		"three documents",
		signBody({ documents: [...bothDocs, { id: OTHER_ID, hash: SOW_HASH }] }),
	],
	["documents that are not a list", signBody({ documents: "x" })],
	[
		"a document id that is not a uuid",
		signBody({ documents: [{ id: "x", hash: SOW_HASH }] }),
	],
	[
		"a document hash in capitals",
		signBody({ documents: [{ id: SOW_ID, hash: SOW_HASH.toUpperCase() }] }),
	],
	[
		"a short document hash",
		signBody({ documents: [{ id: SOW_ID, hash: "abc" }] }),
	],
	["a document with no hash", signBody({ documents: [{ id: SOW_ID }] })],
	[
		"a numeric document hash",
		signBody({ documents: [{ id: SOW_ID, hash: 5 }] }),
	],
	["missing consent", { csrf_nonce: CSRF, documents: bothDocs }],
	["consent false", signBody({ consent: false })],
	["consent as the text true", signBody({ consent: "true" })],
	["consent as 1", signBody({ consent: 1 })],
	["consent null", signBody({ consent: null })],
];

const inputs: Case[] = invalid.flatMap(([name, body]) => [
	sign(name, {}, body),
]);

inputs.push(
	formOf("a missing csrf_nonce", {}, { documents: bothDocs, consent: true }),
	formOf("consent false", {}, signBody({ consent: false })),
	formOf("an empty documents list", {}, signBody({ documents: [] })),
	sign(
		"documents with extra fields are accepted and trimmed",
		{},
		signBody({
			documents: bothDocs.map((d) => ({ ...d, note: "<b>x</b>" })),
		}),
	),
	sign(
		"an extra top-level field is ignored",
		{},
		signBody({ extra: "<b>x</b>" }),
	),
	sign("a csrf nonce that differs", {}, signBody({ csrf_nonce: "other" })),
	sign(
		"a csrf nonce that differs only in case",
		{},
		signBody({ csrf_nonce: CSRF.toUpperCase() }),
	),
	sign(
		"a csrf nonce with a trailing space",
		{},
		signBody({ csrf_nonce: `${CSRF} ` }),
	),
	formOf("a csrf nonce that differs", {}, signBody({ csrf_nonce: "other" })),
	sign(
		"an invalid body and a wrong csrf nonce: the input error comes first",
		{},
		signBody({ csrf_nonce: "other", consent: false }),
	),
);

// ---------------------------------------------------------------------------------------------------------------------
// Signing: the states of the documents
// ---------------------------------------------------------------------------------------------------------------------

const hashed = (hash: string) => ({ row: { text_sha256: hash } });

const states: Case[] = [
	...both("sign both documents", {}),
	sign(
		"sign with the documents in the other order",
		{},
		signBody({ documents: [...bothDocs].reverse() }),
	),
	sign(
		"sign with the signing time a minute later",
		{},
		signBody(),
		{},
		{
			advanceMs: 60_000,
		},
	),
	sign(
		"sign when only a hash is wrong",
		{},
		signBody({
			documents: [{ id: MSA_ID, hash: SOW_HASH }, bothDocs[1]],
		}),
	),
	sign(
		"sign naming only the SOW while the MSA is pending",
		{},
		signBody({ documents: SOW_ONLY }),
	),
	sign("sign naming only the MSA", {}, signBody({ documents: [bothDocs[0]] })),
	sign(
		"sign naming an id that does not exist",
		{},
		signBody({
			documents: [bothDocs[0], { id: OTHER_ID, hash: SOW_HASH }],
		}),
	),
	sign(
		"sign naming a third document",
		{},
		signBody({
			documents: [...bothDocs, { id: OTHER_ID, hash: MSA_HASH }],
		}),
		{},
	),
	sign("sign with one stored hash that no longer matches the reviewed text", {
		sow: doc("review", hashed("f".repeat(64))),
	}),
	...both("both documents already executed", {
		msa: doc("executed"),
		sow: doc("executed"),
	}),
	sign("the SOW executed and the MSA still in review", {
		sow: doc("executed"),
	}),
	...both("a repeat after both are client_signed by the same session", {
		msa: doc("client_signed"),
		sow: doc("client_signed"),
	}),
	sign("both client_signed by another session", {
		msa: doc("client_signed", {
			client: { session_token_hash: sha(OTHER_SESSION) },
		}),
		sow: doc("client_signed", {
			client: { session_token_hash: sha(OTHER_SESSION) },
		}),
	}),
	sign("both client_signed with no signature row", {
		msa: doc("client_signed", { client: false }),
		sow: doc("client_signed", { client: false }),
	}),
	sign("one client_signed and the other still in review", {
		msa: doc("client_signed"),
		sow: doc("review"),
	}),
	sign("the SOW client_signed and the MSA in review", {
		sow: doc("client_signed"),
	}),
	sign(
		"an abandoned MSA with the SOW named alone signs the SOW",
		{
			msa: doc("abandoned"),
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign("an abandoned MSA with both named", {
		msa: doc("abandoned"),
	}),
	sign("the SOW abandoned", { sow: doc("abandoned") }),
	sign("no agreements at all", { msa: false, sow: false }),
	sign(
		"only a SOW exists and the SOW is named",
		{ msa: false },
		signBody({ documents: SOW_ONLY }),
	),
	sign("only a SOW exists and both are named", { msa: false }),
	sign("only an MSA exists", { sow: false }),
	sign("review documents reviewed by another session", {
		msa: doc("review", { row: { review_session_hash: sha(OTHER_SESSION) } }),
		sow: doc("review", { row: { review_session_hash: sha(OTHER_SESSION) } }),
	}),
	sign("only the SOW reviewed by another session", {
		sow: doc("review", { row: { review_session_hash: sha(OTHER_SESSION) } }),
	}),
	sign(
		"a second valid session of the same offer signs",
		{
			extra: {
				software_agreement_sessions: [
					sessionRow({
						token_hash: sha(OTHER_SESSION),
						csrf_nonce: "other-csrf",
					}),
				],
			},
		},
		signBody({ csrf_nonce: "other-csrf" }),
		{},
		{
			headers: headers({ cookie: OTHER_SESSION }),
		},
	),
	sign("signing with the verified time stored on the session", {
		session: { verified_at: "2026-11-13T09:30:00.000Z" },
	}),
	sign(
		"a reused MSA: the SOW alone is signed",
		{
			reused: doc("executed"),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	...both(
		"a reused MSA: the SOW alone is signed (twin)",
		{
			reused: doc("executed"),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign("a reused MSA but both documents named", {
		reused: doc("executed"),
		msa: false,
	}),
	sign(
		"a reused MSA that was terminated",
		{
			reused: doc("executed", { row: { terminated_at: "2026-11-01" } }),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign(
		"a reused MSA that is only client_signed",
		{
			reused: doc("client_signed"),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign(
		"a reused MSA that was abandoned",
		{
			reused: doc("abandoned"),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign(
		"a reused MSA that is executed and archived",
		{
			reused: doc("executed", { row: { archive_closed_at: PAST } }),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// Signing: what the stored values say (names, notices, browser evidence, drafts)
// ---------------------------------------------------------------------------------------------------------------------

const withClient = (client: Loose): Scene => ({
	msa: doc("review", { row: { values_json: valuesJson(client) } }),
	sow: doc("review", { row: { values_json: valuesJson(client) } }),
});

const named = (signer_name: string, signer_title = "Founder") =>
	withClient({ ...CLIENT, signer_name, signer_title });

const values: Case[] = [
	sign("a signer name with accents", named("José Ñuñez")),
	sign(
		"a signer name written decomposed is stored composed",
		named("José Nũnez"),
	),
	sign(
		"a signer name with a title in capitals and spaces",
		named("  GRACE   HOPPER  ", "  CEO  "),
	),
	sign("a signer name in Chinese is not supported", named("李小龙")),
	sign(
		"a signer name with an emoji is not supported",
		named("Grace 🙂 Hopper"),
	),
	sign("a signer name in Arabic is not supported", named("غريس هوبر")),
	sign("a signer name in Cyrillic", named("Грейс Хоппер")),
	sign("a signer name in Greek", named("Γκρέις Χόπερ")),
	sign(
		"a signer name with markup and an ampersand",
		named('Grace <b>"&"</b> Hopper'),
	),
	sign("a signer name of 200 characters", named("G".repeat(200))),
	sign("a signer name of 201 characters", named("G".repeat(201))),
	sign("an empty signer name", named("")),
	sign("a signer name of only spaces", named("   ")),
	sign("a signer name with a control character", named("Grace\u0007Hopper")),
	sign("a signer name with a line break", named("Grace\nHopper")),
	sign("a signer name with a zero-width space", named("Grace​Hopper")),
	sign(
		"a signer title with unicode",
		named("Grace Hopper", "Directrice générale"),
	),
	sign("a signer title the fonts cannot print", named("Grace Hopper", "总裁")),
	sign(
		"a signer name that differs only in case from the legal contact",
		named("GRACE HOPPER"),
	),
	sign("values with no client object", {
		msa: doc("review", {
			row: {
				values_json: JSON.stringify({
					contractor: { notice_email: "o@example.test" },
				}),
			},
		}),
		sow: doc("review", {
			row: {
				values_json: JSON.stringify({
					contractor: { notice_email: "o@example.test" },
				}),
			},
		}),
	}),
	sign("values with no contractor object", {
		msa: doc("review", {
			row: { values_json: JSON.stringify({ client: CLIENT }) },
		}),
		sow: doc("review", {
			row: { values_json: JSON.stringify({ client: CLIENT }) },
		}),
	}),
	sign(
		"values whose client misses a field",
		withClient({ ...CLIENT, legal_name: undefined }),
	),
	sign(
		"values whose client has an extra field",
		withClient({ ...CLIENT, extra: "x" }),
	),
	sign(
		"values whose client names a portfolio but denies it",
		withClient({ ...CLIENT, portfolio: "deny", naming: true }),
	),
	sign(
		"values whose client allows the portfolio and names",
		withClient({ ...CLIENT, portfolio: "allow", naming: true }),
	),
	sign(
		"a client notice email in capitals",
		withClient({ ...CLIENT, notice_email: "NOTICES@EXAMPLE.TEST" }),
	),
	sign("a client address that equals the recorded client: no notice row", {
		clientRow: {
			business_address: "1 Main St",
			notice_email: "notices@example.test",
		},
	}),
	sign("a client address that differs from the recorded client: a notice row", {
		clientRow: { business_address: "9 Other Rd" },
	}),
	sign("only the notice email differs from the recorded client", {
		clientRow: { notice_email: "old@example.test" },
	}),
	sign("an address that differs only in case", {
		clientRow: { business_address: "1 main st" },
	}),
	sign(
		"signing for the same client for a second offer's notice",
		{
			clientRow: { business_address: "9 Other Rd" },
			reused: doc("executed"),
			msa: false,
		},
		signBody({ documents: SOW_ONLY }),
	),
	sign("the SOW has a notice already for the same agreement", {
		clientRow: { business_address: "9 Other Rd" },
		extra: {
			software_agreement_notices: [
				{
					id: "notice-1",
					agreement_id: SOW_ID,
					client_id: "client-1",
					business_address: "old",
					notice_email: "old@example.test",
					recorded_at: PAST,
				},
			],
		},
	}),
];

// Browser evidence
const evidence: Case[] = [
	sign(
		"an address header of 100 characters",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "1".repeat(100),
				headers: { "user-agent": "golden-browser" },
			},
		},
	),
	sign(
		"an address header of 101 characters",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "1".repeat(101),
				headers: { "user-agent": "golden-browser" },
			},
		},
	),
	sign(
		"a user agent of 2000 characters",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9",
				headers: { "user-agent": "u".repeat(2000) },
			},
		},
	),
	sign(
		"a user agent of 2001 characters",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9",
				headers: { "user-agent": "u".repeat(2001) },
			},
		},
	),
	sign(
		"a user agent with a control character",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9",
				headers: { "user-agent": "a\u0001b" },
			},
		},
	),
	sign(
		"a user agent with a tab",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9",
				headers: { "user-agent": "a\tb" },
			},
		},
	),
	sign(
		"an address with a control character",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9\u007f",
				headers: { "user-agent": "golden-browser" },
			},
		},
	),
	sign(
		"no address and no user agent",
		{},
		signBody(),
		{},
		{
			as: { kind: "visitor", headers: {} },
		},
	),
	sign(
		"a user agent with markup",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "203.0.113.9",
				headers: { "user-agent": "<script>alert(1)</script> & co" },
			},
		},
	),
	sign(
		"an IPv6 address",
		{},
		signBody(),
		{},
		{
			as: {
				kind: "visitor",
				ip: "2001:db8::1",
				headers: { "user-agent": "golden-browser" },
			},
		},
	),
];

// Drafts
const drafts: Case[] = [
	sign("a saved draft that matches the reviewed details", { draft: {} }),
	...both("a saved draft that matches (twin)", { draft: {} }),
	sign("a saved draft that differs from the reviewed details", {
		draft: {
			values_json: JSON.stringify({ ...DRAFT, legal_name: "Another LLC" }),
		},
	}),
	sign("a saved draft that no longer resolves", {
		draft: { values_json: JSON.stringify({ legal_name: "x" }) },
	}),
	sign("a saved draft with an unknown field", {
		draft: { values_json: JSON.stringify({ ...DRAFT, extra: "x" }) },
	}),
	sign("a saved draft of another recipient is ignored", {
		draft: { recipient_email: "other@example.test" },
	}),
	sign("a saved draft that resolves with the account's email filling blanks", {
		draft: { values_json: JSON.stringify({ ...DRAFT, notice_email: "" }) },
	}),
	sign("a saved draft with an outside-the-US country", {
		draft: {
			values_json: JSON.stringify({
				...DRAFT,
				state: "Outside the US",
				country: "Virginia",
			}),
		},
	}),
	{
		name: "the draft changes between the check and the batch",
		...scene({ draft: {} }),
		fetches: resendOk,
		interleave: [
			{
				on: /INSERT INTO software_agreement_signatures/,
				label: "the client edits the draft",
				run: (sqlite) =>
					sqlite.exec(
						`UPDATE software_agreement_drafts SET values_json='{"legal_name":"Edited"}'`,
					),
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "the draft is deleted between the check and the batch",
		...scene({ draft: {} }),
		fetches: resendOk,
		interleave: [
			{
				on: /INSERT INTO software_agreement_signatures/,
				label: "the draft is deleted",
				run: (sqlite) => sqlite.exec("DELETE FROM software_agreement_drafts"),
			},
		],
		steps: [step(signBody())],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Races: another writer changes the row between the reads and the batch
// ---------------------------------------------------------------------------------------------------------------------

const BATCH = /INSERT INTO software_agreement_signatures/;

const race = (
	name: string,
	sql: string,
	sc: Scene = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(sc),
	fetches: resendOk,
	interleave: [{ on: BATCH, label: name, run: (sqlite) => sqlite.exec(sql) }],
	steps: [step(signBody())],
	...extra,
});

const races: Case[] = [
	race(
		"the session is revoked before the batch",
		`UPDATE software_agreement_sessions SET revoked_at='${PAST}'`,
	),
	race(
		"the session expires before the batch",
		`UPDATE software_agreement_sessions SET expires_at='${PAST}'`,
	),
	race(
		"the session is deleted before the batch",
		"DELETE FROM software_agreement_sessions",
	),
	race(
		"the offer is superseded before the batch",
		"UPDATE software_offers SET status='superseded'",
	),
	race(
		"the offer is withdrawn before the batch",
		"UPDATE software_offers SET status='withdrawn'",
	),
	race(
		"the request is withdrawn before the batch",
		"UPDATE owner_requests SET status='withdrawn'",
	),
	race(
		"the request is resolved before the batch",
		"UPDATE owner_requests SET status='resolved'",
	),
	race(
		"the offer link is revoked before the batch",
		`UPDATE software_offer_links SET revoked_at='${PAST}'`,
	),
	race(
		"signing is switched off before the batch",
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	race(
		"the recipient snapshot changes before the batch",
		"UPDATE software_offers SET recipient_email_snapshot='other@example.test'",
	),
	race(
		"a project is created for the offer before the batch",
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','x','x','x','x','x','x')",
	),
	race(
		"the MSA is abandoned before the batch",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='msa'",
	),
	race(
		"the SOW is abandoned before the batch",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='sow'",
	),
	race(
		"the MSA is signed by another request first",
		"UPDATE software_agreements SET status='client_signed' WHERE kind='msa'",
	),
	race(
		"the SOW is client_signed first",
		"UPDATE software_agreements SET status='client_signed' WHERE kind='sow'",
	),
	race(
		"both documents are executed first",
		"UPDATE software_agreements SET status='executed'",
	),
	race(
		"the text hash of the SOW changes before the batch",
		`UPDATE software_agreements SET text_sha256='${"e".repeat(64)}' WHERE kind='sow'`,
	),
	race(
		"the review session of the MSA changes before the batch",
		"UPDATE software_agreements SET review_session_hash='other' WHERE kind='msa'",
	),
	race(
		"a signature row for the MSA appears before the batch",
		`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES('s-x','${MSA_ID}','client','x','x','x','v','t','t','h','e','t','m','i','[]','r','','')`,
	),
	race(
		"the agreements are deleted before the batch",
		"DELETE FROM software_agreements",
	),
	race(
		"the reused MSA is terminated before the batch",
		"UPDATE software_agreements SET terminated_at='2026-11-13' WHERE kind='msa'",
		{ reused: doc("executed"), msa: false },
		{ steps: [step(signBody({ documents: SOW_ONLY }))] },
	),
	race(
		"the reused MSA is abandoned before the batch",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='msa'",
		{ reused: doc("executed"), msa: false },
		{ steps: [step(signBody({ documents: SOW_ONLY }))] },
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// Outages: a statement or the batch throws
// ---------------------------------------------------------------------------------------------------------------------

const fail = (
	name: string,
	on: RegExp,
	sc: Scene = {},
	extra: Partial<Case> = {},
): Case => ({
	name,
	...scene(sc),
	fetches: resendOk,
	failures: [{ on, message: "d1 unavailable" }],
	steps: [step(signBody())],
	...extra,
});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id\s+JOIN owner_requests/,
	),
	fail(
		"outage: the session lookup",
		/SELECT \* FROM software_agreement_sessions/,
	),
	fail(
		"outage: the live offer check of the session",
		/AND o.recipient_email_snapshot=\?$/,
	),
	fail("outage: the signing setting", /SELECT software_signing_enabled/),
	fail(
		"outage: the first read of the agreements",
		/FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
	),
	fail(
		"outage: the saved receipt lookup",
		/SELECT receipt_id,session_token_hash/,
		{ msa: doc("client_signed"), sow: doc("client_signed") },
	),
	fail(
		"outage: the draft lookup",
		/SELECT values_json FROM software_agreement_drafts/,
	),
	fail("outage: the signing batch", BATCH),
	fail(
		"outage: the second read of the agreements, after the signatures committed",
		/FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
		{},
		{
			failures: [
				{
					on: /FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
					nth: 2,
					message: "d1 unavailable",
				},
			],
			steps: [step(signBody()), step(signBody())],
		},
	),
	{
		name: "outage: the notification read of the agreement",
		...scene(),
		fetches: resendOk,
		failures: [
			{
				on: /SELECT request_id,\(SELECT receipt_id/,
				message: "d1 unavailable",
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "outage: the claim of the signature receipt",
		...scene(),
		fetches: resendOk,
		failures: [
			{
				on: /UPDATE software_agreement_notifications SET status='sending'/,
				message: "d1 unavailable",
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "outage: the claim of the countersign notice",
		...scene(),
		fetches: resendOk,
		failures: [
			{
				on: /UPDATE software_agreement_notifications SET status='sending'/,
				nth: 2,
				message: "d1 unavailable",
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "outage: recording that the receipt was sent",
		...scene(),
		fetches: resendOk,
		failures: [
			{
				on: /UPDATE software_agreement_notifications SET status=\?/,
				message: "d1 unavailable",
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "outage: the signing batch, then the same request again",
		...scene(),
		fetches: resendOk,
		failures: [{ on: BATCH, message: "d1 unavailable" }],
		steps: [step(signBody()), step(signBody())],
	},
	{
		name: "form: outage: the signing batch",
		...scene(),
		fetches: resendOk,
		failures: [{ on: BATCH, message: "d1 unavailable" }],
		steps: [signForm(formFields(signBody()))],
	},
	{
		name: "form: outage: the offer lookup",
		...scene(),
		failures: [
			{
				on: /FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id\s+JOIN owner_requests/,
				message: "d1 unavailable",
			},
		],
		steps: [signForm(formFields(signBody()))],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Notifications after a signature
// ---------------------------------------------------------------------------------------------------------------------

const notify = (
	name: string,
	fetches: Case["fetches"],
	extra: Partial<Case> = {},
	sc: Scene = {},
): Case => ({
	name,
	...scene(sc),
	fetches,
	steps: [step(signBody())],
	...extra,
});

const notifications: Case[] = [
	notify("both notices are accepted", resendOk),
	notify(
		"the receipt is refused with a 4xx and the notice accepted",
		resend(json(422, { message: "bad" }), json(200, { id: "x" })),
	),
	notify(
		"the receipt hits a 5xx and the notice is accepted",
		resend(json(503, { message: "down" }), json(200, { id: "x" })),
	),
	notify("both notices hit a 500", resend(json(500, {}))),
	notify(
		"both notices are refused with a 401",
		resend(json(401, { message: "key" })),
	),
	notify(
		"both notices are rate limited",
		resend(json(429, { message: "slow" })),
	),
	notify(
		"the network is down for both",
		byHost({ resend: networkDown("socket hang up") }),
	),
	notify(
		"the first notice is accepted and the network fails for the second",
		resend(json(200, { id: "x" }), networkDown("reset")),
	),
	notify("a non-JSON 200 answer", resend(text(200, "ok"))),
	notify("a 204 answer", resend(text(204, ""))),
	notify("a 302 answer", resend(text(302, ""))),
	notify("no Resend key", resendOk, { omit: ["RESEND_API_KEY"] }),
	notify("no sender address", resendOk, { omit: ["CONTACT_FROM_EMAIL"] }),
	notify("no fetch scripted at all", undefined),
	{
		...notify("the same request twice (a double click)", resendOk),
		steps: [step(signBody()), step(signBody())],
	},
	{
		...notify(
			"the same request twice after an uncertain send",
			resend(json(503, {})),
			{},
		),
		steps: [step(signBody()), step(signBody())],
	},
	{
		...notify(
			"the same request twice after a refused send",
			resend(json(422, {})),
			{},
		),
		steps: [step(signBody()), step(signBody())],
	},
	{
		...notify("the same request twice, the form after the JSON", resendOk),
		steps: [step(signBody()), signForm(formFields(signBody()))],
	},
	{
		...notify("the same request three times", resendOk),
		steps: [step(signBody()), step(signBody()), step(signBody())],
	},
	notify(
		"the notifications were already sent when the repeat arrives",
		resendOk,
		{},
		{
			msa: doc("client_signed"),
			sow: doc("client_signed"),
			notifications: notificationRows("sent", { sent_at: PAST }),
		},
	),
	notify(
		"a repeat while a notification is still sending",
		resendOk,
		{},
		{
			msa: doc("client_signed"),
			sow: doc("client_signed"),
			notifications: notificationRows("sending", {
				attempted_at: PAST,
				attempt_id: "a",
			}),
		},
	),
	notify(
		"a repeat with failed notifications",
		resendOk,
		{},
		{
			msa: doc("client_signed"),
			sow: doc("client_signed"),
			notifications: notificationRows("failed", {
				attempted_at: PAST,
				attempt_id: "a",
			}),
		},
	),
	notify(
		"a repeat with pending notifications",
		resendOk,
		{},
		{
			msa: doc("client_signed"),
			sow: doc("client_signed"),
		},
	),
	notify(
		"a repeat with no notification rows",
		resendOk,
		{},
		{
			msa: doc("client_signed"),
			sow: doc("client_signed"),
			notifications: false,
		},
	),
	{
		name: "a project starts between the signature and the notices",
		...scene(),
		fetches: resendOk,
		interleave: [
			{
				on: /SELECT request_id,\(SELECT receipt_id/,
				label: "a project is created",
				run: (sqlite) =>
					sqlite.exec(
						"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','x','x','x','x','x','x')",
					),
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "the request is resolved between the signature and the notices",
		...scene(),
		fetches: resendOk,
		interleave: [
			{
				on: /SELECT request_id,\(SELECT receipt_id/,
				label: "the request is resolved",
				run: (sqlite) =>
					sqlite.exec("UPDATE owner_requests SET status='resolved'"),
			},
		],
		steps: [step(signBody())],
	},
	{
		name: "the SOW is abandoned between the signature and the notices",
		...scene(),
		fetches: resendOk,
		interleave: [
			{
				on: /SELECT request_id,\(SELECT receipt_id/,
				label: "the owner abandons",
				run: (sqlite) =>
					sqlite.exec("UPDATE software_agreements SET status='abandoned'"),
			},
		],
		steps: [step(signBody())],
	},
	notify(
		"a reused MSA with both notices accepted",
		resendOk,
		{
			steps: [step(signBody({ documents: SOW_ONLY }))],
		},
		{ reused: doc("executed"), msa: false },
	),
	{
		name: "form: both notices are accepted",
		...scene(),
		fetches: resendOk,
		steps: [signForm(formFields(signBody()))],
	},
	{
		name: "form: the notices fail and the signature still redirects",
		...scene(),
		fetches: byHost({ resend: networkDown() }),
		steps: [signForm(formFields(signBody()))],
	},
	{
		name: "form: the same request twice",
		...scene(),
		fetches: resendOk,
		steps: [signForm(formFields(signBody())), signForm(formFields(signBody()))],
	},
	{
		name: "form: the signature is refused after a hash change",
		...scene(),
		steps: [
			signForm(
				formFields(
					signBody({
						documents: [{ id: MSA_ID, hash: SOW_HASH }, bothDocs[1]],
					}),
				),
			),
		],
	},
	{
		name: "form: the signature is refused for another session's documents",
		...scene({
			msa: doc("client_signed", {
				client: { session_token_hash: sha(OTHER_SESSION) },
			}),
			sow: doc("client_signed", {
				client: { session_token_hash: sha(OTHER_SESSION) },
			}),
		}),
		steps: [signForm(formFields(signBody()))],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------------------------------------------------

const sequences: Case[] = [
	{
		name: "sign, then the session is revoked, then sign again",
		...scene(),
		fetches: resendOk,
		steps: [
			step(signBody()),
			step(signBody(), {
				before: {
					label: "the session is revoked",
					run: (world) =>
						world.music.exec(
							`UPDATE software_agreement_sessions SET revoked_at='${LATER}'`,
						),
				},
			}),
		],
	},
	{
		name: "sign, then the owner abandons, then the client signs again",
		...scene(),
		fetches: resendOk,
		steps: [
			step(signBody()),
			step(signBody(), {
				before: {
					label: "the owner abandons the offer",
					run: (world) =>
						world.music.exec(
							"UPDATE software_agreements SET status='abandoned'; UPDATE software_offers SET status='superseded'",
						),
				},
			}),
		],
	},
	{
		name: "sign, then the owner countersigns, then the client repeats",
		...scene(),
		fetches: resendOk,
		steps: [
			step(signBody()),
			step(signBody(), {
				before: {
					label: "the owner countersigns",
					run: (world) =>
						world.music.exec(
							"UPDATE software_agreements SET status='executed'",
						),
				},
			}),
		],
	},
	{
		name: "sign twice with the clock a day apart",
		...scene(),
		fetches: resendOk,
		steps: [step(signBody()), step(signBody(), { advanceMs: 86_400_000 })],
	},
	{
		name: "sign twice with the session expiring in between",
		...scene({ session: { expires_at: "2026-11-13T12:30:00.000Z" } }),
		fetches: resendOk,
		steps: [step(signBody()), step(signBody(), { advanceMs: 3_600_000 })],
	},
	{
		name: "an invalid request, then a valid one",
		...scene(),
		fetches: resendOk,
		steps: [step(signBody({ consent: false })), step(signBody())],
	},
	{
		name: "a wrong csrf nonce, then the right one, then a repeat",
		...scene(),
		fetches: resendOk,
		steps: [
			step(signBody({ csrf_nonce: "other" })),
			step(signBody()),
			step(signBody()),
		],
	},
	{
		name: "the client signs only the SOW first and the MSA is then refused",
		...scene({ msa: doc("review"), sow: doc("review") }),
		fetches: resendOk,
		steps: [step(signBody({ documents: SOW_ONLY })), step(signBody())],
	},
	{
		name: "a reused-MSA offer signs and the repeat is the same receipt",
		...scene({ reused: doc("executed"), msa: false }),
		fetches: resendOk,
		steps: [
			step(signBody({ documents: SOW_ONLY })),
			step(signBody({ documents: SOW_ONLY })),
		],
	},
];

const cases: Case[] = [
	...guards,
	...auth,
	...inputs,
	...states,
	...values,
	...evidence,
	...drafts,
	...races,
	...outages,
	...notifications,
	...sequences,
];

defineCorpus("offer-sign", POST, cases);
