import { POST } from "~/pages/api/offer/[token]/draft";
import { POST as link } from "~/pages/api/offer/[token]/link";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	json,
	byHost,
	type Case,
	type Step,
} from "./harness";
import {
	agreementWorld,
	cookie,
	wireKit,
	CSRF,
	csrfRead,
	DRAFT_TABLES,
	follow,
	FORM_TYPE,
	formBody,
	formHeaders,
	GRACE,
	IP,
	ORIGIN,
	OTHER_SESSION,
	OTHER_TOKEN,
	readCsrf,
	SAME_ORIGIN,
	secondOffer,
	SESSION,
	sessionCookieOf,
	startedProject,
	TOKEN,
	values,
	type Opts,
} from "./areas/agreement-access";

// The golden corpus for POST /api/offer/[token]/draft: a client with a verified session saves the details they have typed
// so far, so the signing page can be reopened later. The route answers only in JSON, whatever was sent (it is not wrapped
// by nativeAgreementRoute, so a native form post gets JSON errors and no redirect). It reads three wire formats, and every
// case that can be sent each way is recorded each way:
//   (json)         {"csrf_nonce": "...", "values": {...}} as application/json
//   (form values)  a urlencoded form with csrf_nonce and a `values` field holding JSON text
//   (form fields)  a urlencoded form with csrf_nonce and one field per detail (agreementRequest wraps them as values when
//                  legal_name is non-empty and there is no action or values field; with an empty legal_name the fields are not
//                  wrapped and values is missing)
//
// Every response branch of the handler, agreementRequest / musicRequest (src/lib/agreement-request.ts, music-request.ts),
// agreementSession and signingEnabled (src/lib/agreement-access.ts), getLinkedOffer (software-offers.ts), draftSchema,
// draftFieldErrors (src/lib/agreement-draft-fields.ts) and saveAgreementDraft (src/lib/agreement-draft.ts), and the cases that reach it:
//
//   request                              403 Forbidden (no Origin, other site, http scheme), 415 JSON required, 400 Missing request,
//                                        413 above 16384 bytes, 400 Invalid JSON, 400 Invalid fields (form with a values field that is not JSON)
//   401 "Open a fresh email link ..."    no database; token of the wrong shape or unknown; revoked offer link; offer not "sent"; request
//                                        withdrawn, resolved or without email; no cookie, a malformed cookie, a cookie that matches no session,
//                                        an archive session, an expired or revoked session, a session of another offer, a session whose link
//                                        or recipient no longer matches the offer; signing switched off
//   403 "Reload and try again."          csrf_nonce missing, wrong, not text, empty, another session's
//   400 "Check the highlighted details." values missing, null, a list, text, a number, an unknown field (strict), a field that is not text, a
//                                        field over its limit (200 name fields, 100 state and country, 1000 address, 320 email fields), a control
//                                        character or lone surrogate, a portfolio_choice outside private/anonymous/named/"" (errors map per field)
//   200 {ok:true}                        a full draft, an empty object (every field defaults to ""), trimmed and NFC-normalised text, markup and
//                                        unicode saved exactly, a state or business type outside the lists (drafts do not check the lists)
//   409 "could not be saved"             the batch fails: a started project, a signed or executed agreement, a session revoked or expired between
//                                        the read and the write, a revoked offer link, a withdrawn request, signing switched off, an offer
//                                        superseded, a batch outage
//   rejected (the handler throws)        a JSON null body (the csrf_nonce read on null, known today), a statement outside the batch throwing
//   sequences                            save and save again (the draft row is replaced), save then revoke then save, the whole sign-in flow
//                                        (request a link, follow it, read the nonce, save)

const PATH = `/api/offer/${TOKEN}/draft`;

const { scenario, withValues, TWO } = wireKit(PATH, DRAFT_TABLES);

const longer = (field: string, max: number) => [
	...scenario(`${field} of ${max} characters is saved`, {
		input: withValues({ [field]: "x".repeat(max) }),
	}),
	...scenario(`${field} of ${max + 1} characters is refused`, {
		input: withValues({ [field]: "x".repeat(max + 1) }),
	}),
];

const outage = (name: string, on: RegExp, nth = 1) =>
	scenario(name, {
		over: { failures: [{ on, nth, message: `${name} fails` }] },
	});

const LIVE_LOOKUP =
	/SELECT 1 FROM software_offers o JOIN software_offer_links l/;

const DRAFT_INSERT = /INSERT INTO software_agreement_drafts/;

const race = (name: string, sql: string, opts: Opts = {}) =>
	scenario(name, {
		opts,
		over: {
			interleave: [
				{ on: DRAFT_INSERT, label: name, run: (sqlite) => sqlite.exec(sql) },
			],
		},
	});

const STARTED = "2026-11-13T11:59:59.000Z";

const cases: Case[] = [
	// the answer and the effects
	...scenario("a full draft is saved"),
	...scenario("an empty values object saves every field as empty", {
		input: { csrf_nonce: CSRF, values: {} },
		wires: TWO,
	}),
	...scenario("a draft is saved with the other portfolio choices", {
		input: withValues({ portfolio_choice: "private" }),
	}),
	...scenario("an anonymous portfolio choice", {
		input: withValues({ portfolio_choice: "anonymous" }),
	}),
	...scenario("an empty portfolio choice", {
		input: withValues({ portfolio_choice: "" }),
	}),
	...scenario("a portfolio choice outside the list", {
		input: withValues({ portfolio_choice: "everyone" }),
	}),
	...scenario("a portfolio choice in capitals", {
		input: withValues({ portfolio_choice: "PRIVATE" }),
	}),
	// who is asking
	...scenario("no session cookie", { headers: { cookie: "" } }),
	...scenario("a cookie of the wrong shape", { headers: cookie("short") }),
	...scenario("a cookie of 44 characters", { headers: cookie(`${SESSION}A`) }),
	...scenario("a cookie that matches no session", {
		headers: cookie(OTHER_SESSION),
	}),
	...scenario("the cookie among others is found", {
		headers: { cookie: `a=b; agreement_session=${SESSION}; c=d` },
	}),
	...scenario("a cookie name with a prefix is not the session", {
		headers: { cookie: `xagreement_session=${SESSION}` },
	}),
	...scenario("the archive cookie name does not open an agreement session", {
		headers: { cookie: `agreement_archive=${SESSION}` },
	}),
	...scenario("an archive session cannot save a draft", {
		opts: { session: { purpose: "archive", offer_id: null, link_hash: null } },
	}),
	...scenario("an expired session", {
		opts: { session: { expires_at: "2026-11-13T11:59:59.999Z" } },
	}),
	...scenario("a session that expires at this instant", {
		opts: { session: { expires_at: "2026-11-13T12:00:00.000Z" } },
	}),
	...scenario("a revoked session", {
		opts: { session: { revoked_at: "2026-11-13T11:45:00.000Z" } },
	}),
	...scenario("a session of another offer", {
		opts: {
			session: { offer_id: "o-r2" },
			extra: secondOffer(),
		},
	}),
	...scenario("a session whose link is not the offer's link any more", {
		opts: { session: { link_hash: "an-older-offer-link-hash" } },
	}),
	...scenario("a session for another recipient than the offer", {
		opts: { session: { recipient_email: "other@example.test" } },
	}),
	...scenario("the offer recipient changed after the session began", {
		opts: { offer: { recipient_email_snapshot: "new@example.test" } },
	}),
	...scenario(
		"the owner asking is treated as a visitor and has no agreement session",
		{
			headers: { cookie: "" },
			over: {},
			wires: TWO,
		},
	).map((c) => ({
		...c,
		steps: c.steps.map((step) => ({ ...step, as: asOwner() })),
	})),
	// the offer
	...scenario("signing is off", { opts: { signing: false } }),
	...scenario("the offer link was revoked", {
		opts: { offerLink: { revoked_at: "2026-11-13T11:30:00.000Z" } },
	}),
	...scenario("there is no offer link row", { opts: { offerLink: null } }),
	...scenario("the offer was superseded", {
		opts: { offer: { status: "superseded" } },
	}),
	...scenario("the offer was withdrawn", {
		opts: { offer: { status: "withdrawn" } },
	}),
	...scenario("the request was withdrawn", {
		opts: { request: { status: "withdrawn" } },
	}),
	...scenario("the request was resolved", {
		opts: { request: { status: "resolved" } },
	}),
	...scenario("the request has no email", { opts: { request: { email: "" } } }),
	...scenario("a token of the wrong shape", { params: { token: "short" } }),
	...scenario("a token that matches no offer", {
		params: { token: OTHER_TOKEN },
	}),
	...scenario("a token with markup characters", {
		params: { token: `"><script>alert(1)</script>` },
	}),
	...scenario("no database binding", { over: { music: { missing: true } } }),
	...scenario("a project exists so signing has ended", {
		opts: { extra: startedProject() },
	}),
	// agreements already saved
	...scenario("an agreement under review does not stop a draft", {
		opts: { agreements: "review" },
	}),
	...scenario("a client-signed agreement stops a draft", {
		opts: { agreements: "client_signed" },
	}),
	...scenario("an executed agreement stops a draft", {
		opts: { agreements: "executed" },
	}),
	...scenario("an abandoned agreement does not stop a draft", {
		opts: { agreements: "abandoned" },
	}),
	// the csrf nonce
	...scenario("no csrf nonce", { input: { values: values() } }),
	...scenario("a wrong csrf nonce", {
		input: { csrf_nonce: "wrong", values: values() },
	}),
	...scenario("an empty csrf nonce", {
		input: { csrf_nonce: "", values: values() },
	}),
	...scenario("a csrf nonce in capitals", {
		input: { csrf_nonce: CSRF.toUpperCase(), values: values() },
	}),
	...scenario("a csrf nonce with a trailing space", {
		input: { csrf_nonce: `${CSRF} `, values: values() },
	}),
	...scenario("a csrf nonce that is a number", {
		input: { csrf_nonce: 5, values: values() },
		wires: TWO,
	}),
	...scenario("a csrf nonce that is a list", {
		input: { csrf_nonce: [CSRF], values: values() },
		wires: TWO,
	}),
	...scenario("a csrf nonce that is null", {
		input: { csrf_nonce: null, values: values() },
		wires: TWO,
	}),
	...scenario("the csrf nonce is checked before the values", {
		input: { csrf_nonce: "wrong", values: "not an object" },
		wires: TWO,
	}),
	// the values
	...scenario("no values", { input: { csrf_nonce: CSRF } }),
	...scenario("values that are null", {
		input: { csrf_nonce: CSRF, values: null },
		wires: TWO,
	}),
	...scenario("values that are a list", {
		input: { csrf_nonce: CSRF, values: [] },
		wires: TWO,
	}),
	...scenario("values that are text", {
		input: { csrf_nonce: CSRF, values: "legal_name" },
		wires: TWO,
	}),
	...scenario("values that are a number", {
		input: { csrf_nonce: CSRF, values: 5 },
		wires: TWO,
	}),
	...scenario("an unknown field", { input: withValues({ nickname: "x" }) }),
	...scenario("a field named like the widget", {
		input: withValues({ "cf-turnstile-response": "tok" }),
	}),
	...scenario("a field that is a number", {
		input: { csrf_nonce: CSRF, values: { ...values(), legal_name: 5 } },
		wires: TWO,
	}),
	...scenario("a field that is null", {
		input: { csrf_nonce: CSRF, values: { ...values(), signer_name: null } },
		wires: TWO,
	}),
	...scenario("a field that is a list", {
		input: { csrf_nonce: CSRF, values: { ...values(), state: ["Virginia"] } },
		wires: TWO,
	}),
	...scenario("a field that is an object", {
		input: { csrf_nonce: CSRF, values: { ...values(), country: { a: 1 } } },
		wires: TWO,
	}),
	...scenario("a field that is true", {
		input: { csrf_nonce: CSRF, values: { ...values(), signer_title: true } },
		wires: TWO,
	}),
	...scenario("several fields refused at once", {
		input: withValues({
			legal_name: "x".repeat(201),
			business_address: "\u0007",
			portfolio_choice: "nope",
			nickname: "x",
		}),
	}),
	...scenario("a refusal with no field path names legal_name", {
		input: withValues({ unknown_one: "x" }),
		wires: TWO,
	}),
	// the limits
	...longer("legal_name", 200),
	...longer("entity_type", 200),
	...longer("state", 100),
	...longer("country", 100),
	...longer("business_address", 1000),
	...longer("signer_name", 200),
	...longer("signer_title", 200),
	...longer("reviewer_name", 200),
	...longer("reviewer_email", 320),
	...longer("approver_name", 200),
	...longer("approver_email", 320),
	...longer("notice_email", 320),
	// text handling
	...scenario("surrounding spaces are trimmed", {
		input: withValues({ legal_name: "   Hopper Systems LLC \t " }),
	}),
	...scenario("text of only spaces becomes empty", {
		input: withValues({ legal_name: "     " }),
	}),
	...scenario("a decomposed accent is normalised to NFC", {
		input: withValues({ signer_name: "Renée" }),
	}),
	...scenario("a length limit counts after trimming", {
		input: withValues({ legal_name: ` ${"x".repeat(200)} ` }),
	}),
	...scenario("markup, ampersands and quotes are saved as typed", {
		input: withValues({
			legal_name: `<script>alert("x")</script> & 'Co' </td>`,
			business_address: `1 <b>Main</b> St &amp; "Suite" 'B'`,
		}),
	}),
	...scenario("unicode, emoji and right-to-left text are saved as typed", {
		input: withValues({
			legal_name: "Ünïcode Ångström 株式会社 😀 مرحبا",
			signer_title: "Dr. Zoë ​Admin",
		}),
	}),
	...scenario("a newline and a tab in the address are allowed", {
		input: withValues({
			business_address: "1 Main St\nSuite 2\tRoom 3\r\nRoanoke",
		}),
	}),
	...scenario("a bell character is refused", {
		input: withValues({ legal_name: "A\u0007B" }),
	}),
	...scenario("a null character is refused", {
		input: withValues({ business_address: "A\u0000B" }),
	}),
	...scenario("a delete character is refused", {
		input: withValues({ signer_name: "A\u007fB" }),
	}),
	...scenario("a lone surrogate is refused", {
		input: withValues({ signer_title: "A\ud800B" }),
		wires: TWO,
	}),
	...scenario("a business type and state outside the lists are saved", {
		input: withValues({
			entity_type: "Wizard guild",
			state: "Narnia",
			country: "Mars",
		}),
	}),
	...scenario("an email field is not checked as an email", {
		input: withValues({
			reviewer_email: "not an email",
			notice_email: "<b>x</b>",
		}),
	}),
	// the wire formats
	{
		name: "a JSON null body (the handler throws today)",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				json: null,
				headers: { ...SAME_ORIGIN, ...cookie() },
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	{
		name: "a JSON null body with no session is answered before the null is read",
		...agreementWorld({ session: null }),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				json: null,
				headers: SAME_ORIGIN,
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	...[
		["a JSON list body", []],
		["a JSON text body", "csrf"],
		["a JSON number body", 5],
		["a JSON true body", true],
		["a JSON empty object body", {}],
	].map(([name, body]) => ({
		name: String(name),
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				json: body,
				headers: { ...SAME_ORIGIN, ...cookie() },
				dump: { music: DRAFT_TABLES },
			} satisfies Step,
		],
	})),
	...(["json", "form"] as const).flatMap((wire) => {
		const headers = (extra: { [name: string]: string }) =>
			wire === "json"
				? { "content-type": "application/json", ...cookie(), ...extra }
				: { "content-type": FORM_TYPE, ...cookie(), ...extra };

		const body = (pad = 0) =>
			wire === "json"
				? JSON.stringify({
						csrf_nonce: CSRF,
						values: values({ business_address: "x".repeat(pad) }),
					})
				: formBody({
						csrf_nonce: CSRF,
						...values({ business_address: "x".repeat(pad) }),
					});

		const sized = (target: number) => {
			const probe = body(0).length;

			return body(target - probe);
		};

		const step = (extra: Partial<Step>): Step => ({
			as: asVisitor({ ip: IP }),
			path: PATH,
			params: { token: TOKEN },
			dump: { music: DRAFT_TABLES },
			...extra,
		});

		return [
			{
				name: `no Origin header (${wire})`,
				...agreementWorld(),
				steps: [step({ body: body(), headers: headers({}) })],
			},
			{
				name: `an Origin from another site (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: body(),
						headers: headers({ origin: "https://evil.example" }),
					}),
				],
			},
			{
				name: `an Origin with the http scheme (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: body(),
						headers: headers({ origin: "http://thesuperhuman.us" }),
					}),
				],
			},
			{
				name: `an Origin with another port (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: body(),
						headers: headers({ origin: "https://thesuperhuman.us:8443" }),
					}),
				],
			},
			{
				name: `a body of exactly 16384 bytes (${wire})`,
				...agreementWorld(),
				steps: [
					step({ body: sized(16384), headers: headers({ origin: ORIGIN }) }),
				],
			},
			{
				name: `a body of 16385 bytes (${wire})`,
				...agreementWorld(),
				steps: [
					step({ body: sized(16385), headers: headers({ origin: ORIGIN }) }),
				],
			},
			{
				name: `an empty body (${wire})`,
				...agreementWorld(),
				steps: [step({ body: "", headers: headers({ origin: ORIGIN }) })],
			},
			{
				name: `no body at all (${wire})`,
				...agreementWorld(),
				steps: [step({ headers: headers({ origin: ORIGIN }) })],
			},
		] satisfies Case[];
	}),
	{
		name: "a text/plain body",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: JSON.stringify({ csrf_nonce: CSRF, values: values() }),
				headers: { ...SAME_ORIGIN, ...cookie() },
			},
		],
	},
	{
		name: "JSON with a charset is accepted",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				json: { csrf_nonce: CSRF, values: values() },
				headers: {
					...SAME_ORIGIN,
					...cookie(),
					"content-type": "application/json; charset=utf-8",
				},
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	{
		name: "bad JSON",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: "{not json",
				headers: {
					...SAME_ORIGIN,
					...cookie(),
					"content-type": "application/json",
				},
			},
		],
	},
	{
		name: "a form with a values field that is not JSON",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, values: "not json" }),
				headers: { ...formHeaders(), ...cookie() },
			},
		],
	},
	{
		name: "a form with an action field is not wrapped as values",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, action: "save", ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	{
		name: "a form with a consent field turns it into a boolean",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, consent: "on", ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	{
		name: "a form post is answered with JSON and no redirect",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: DRAFT_TABLES },
			},
		],
	},
	// outages: statements outside the batch are not caught
	...outage(
		"the offer lookup fails",
		/FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id\s+JOIN owner_requests/,
	),
	...outage(
		"the session lookup fails",
		/SELECT \* FROM software_agreement_sessions WHERE token_hash/,
	),
	...outage("the live check of the session fails", LIVE_LOOKUP),
	...outage(
		"the signing switch lookup fails",
		/FROM software_signing_settings/,
	),
	...outage("the draft batch fails", DRAFT_INSERT),
	// races between the read and the write
	...race(
		"the session is revoked between the read and the write",
		"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
	),
	...race(
		"the session expires between the read and the write",
		"UPDATE software_agreement_sessions SET expires_at='2026-11-13T11:59:00.000Z'",
	),
	...race(
		"the session is deleted between the read and the write",
		"DELETE FROM software_agreement_sessions",
	),
	...race(
		"the offer link is revoked between the read and the write",
		`UPDATE software_offer_links SET revoked_at='${STARTED}'`,
	),
	...race(
		"the offer link is replaced between the read and the write",
		`UPDATE software_offer_links SET token_hash='${"f".repeat(64)}'`,
	),
	...race(
		"the request is withdrawn between the read and the write",
		"UPDATE owner_requests SET status='withdrawn'",
	),
	...race(
		"the request is resolved between the read and the write",
		"UPDATE owner_requests SET status='resolved'",
	),
	...race(
		"the offer is superseded between the read and the write",
		"UPDATE software_offers SET status='superseded'",
	),
	...race(
		"the offer is withdrawn between the read and the write",
		"UPDATE software_offers SET status='withdrawn'",
	),
	...race(
		"signing is switched off between the read and the write",
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	...race(
		"the recipient changes between the read and the write",
		"UPDATE software_offers SET recipient_email_snapshot='new@example.test'",
	),
	...race(
		"the owner starts the project between the read and the write",
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')",
	),
	...race(
		"the agreement is signed between the read and the write",
		"UPDATE software_agreements SET status='client_signed'",
		{ agreements: "review" },
	),
	...race(
		"the agreement is executed between the read and the write",
		"UPDATE software_agreements SET status='executed'",
		{ agreements: "review" },
	),
	...race(
		"another tab saves a draft between the read and the write",
		`INSERT INTO software_agreement_drafts VALUES('o-r1','${GRACE}','{"legal_name":"Other tab"}','${STARTED}')`,
	),
	// sequences
	...scenario("a draft is saved, saved again unchanged, then changed", {
		steps: (send) => [
			send(),
			send(),
			send(withValues({ legal_name: "Hopper Industries Inc" }), {
				advanceMs: 60_000,
			}),
		],
	}),
	...scenario("a saved draft is replaced by an empty one", {
		steps: (send) => [send(), send({ csrf_nonce: CSRF, values: {} })],
	}),
	...scenario("a good save after a refused one keeps the earlier draft", {
		opts: {
			extra: {
				software_agreement_drafts: [
					{
						offer_id: "o-r1",
						recipient_email: GRACE,
						values_json: JSON.stringify(
							values({ legal_name: "Earlier draft" }),
						),
						updated_at: STARTED,
					},
				],
			},
		},
		steps: (send) => [
			send(withValues({ portfolio_choice: "nope" })),
			send(withValues({ legal_name: "Later draft" })),
		],
	}),
	...scenario("a save after the session was revoked", {
		steps: (send) => [
			send(),
			send(undefined, {
				before: {
					label: "the session is revoked",
					run: (world) =>
						world.music.exec(
							"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T12:00:00.000Z'",
						),
				},
			}),
		],
	}),
	...scenario("a save one second before the session expires and one after", {
		opts: { session: { expires_at: "2026-11-13T12:00:30.000Z" } },
		steps: (send) => [send(), send(undefined, { advanceMs: 31_000 })],
	}),
	...scenario("a save after signing began on another tab", {
		opts: { agreements: "review" },
		steps: (send) => [
			send(),
			send(undefined, {
				before: {
					label: "the agreement is client-signed",
					run: (world) =>
						world.music.exec(
							"UPDATE software_agreements SET status='client_signed'",
						),
				},
			}),
		],
	}),
	...scenario("a draft is kept per recipient", {
		opts: {
			extra: {
				software_agreement_drafts: [
					{
						offer_id: "o-r1",
						recipient_email: "someone.else@example.test",
						values_json: JSON.stringify(
							values({ legal_name: "Someone else's draft" }),
						),
						updated_at: STARTED,
					},
				],
			},
		},
	}),
	// the whole sign-in flow with a real session
	...scenario(
		"a link is requested, followed, and a draft is saved with the new session",
		{
			opts: { session: null },
			over: {
				fetches: byHost({
					turnstile: json(200, { success: true }),
					resend: json(200, { id: "em_1" }),
				}),
			},
			steps: (send) => [
				{
					handler: link,
					as: asVisitor({ ip: IP }),
					path: `/api/offer/${TOKEN}/link`,
					params: { token: TOKEN },
					json: { turnstileToken: "tok" },
					headers: SAME_ORIGIN,
				},
				follow("POST"),
				send(() => ({ csrf_nonce: csrfRead(), values: values() }), {
					before: readCsrf,
					headers: (prior) => ({
						cookie: `agreement_session=${sessionCookieOf(prior, 1)}`,
					}),
				}),
				send(
					() => ({
						csrf_nonce: csrfRead(),
						values: values({ legal_name: "Second save" }),
					}),
					{
						headers: (prior) => ({
							cookie: `agreement_session=${sessionCookieOf(prior, 1)}`,
						}),
					},
				),
			],
		},
	),
	...scenario(
		"a draft saved with a session from an older link after a newer link was issued",
		{
			opts: { session: null },
			over: {
				fetches: byHost({
					turnstile: json(200, { success: true }),
					resend: json(200, { id: "em_1" }),
				}),
			},
			steps: (send) => [
				{
					handler: link,
					as: asVisitor({ ip: IP }),
					path: `/api/offer/${TOKEN}/link`,
					params: { token: TOKEN },
					json: { turnstileToken: "tok" },
					headers: SAME_ORIGIN,
				},
				follow("POST"),
				{
					handler: link,
					as: asVisitor({ ip: IP }),
					path: `/api/offer/${TOKEN}/link`,
					params: { token: TOKEN },
					json: { turnstileToken: "tok" },
					headers: SAME_ORIGIN,
					advanceMs: 31_000,
				},
				send(() => ({ csrf_nonce: csrfRead(), values: values() }), {
					before: readCsrf,
					headers: (prior) => ({
						cookie: `agreement_session=${sessionCookieOf(prior, 1)}`,
					}),
				}),
			],
		},
	),
];

defineCorpus("offer-draft", POST, cases);
