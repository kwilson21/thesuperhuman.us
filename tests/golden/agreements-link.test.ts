import { POST } from "~/pages/api/agreements/link";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type Step,
} from "./harness";
import {
	agreementWorld,
	bothWires,
	follow,
	FORM_TYPE,
	formBody,
	formHeaders,
	GRACE,
	IP,
	LINK_TABLES,
	mail,
	ORIGIN,
	SAME_ORIGIN,
	TOKEN,
	withResend,
	withTurnstile,
	type Extra,
	type Make,
	type Opts,
} from "./areas/agreement-access";
import { allowanceRow } from "./areas/studio-access";

// The golden corpus for POST /api/agreements/link: a client asks for a link to open the signed agreements kept for their
// email (purpose "archive"). The answer is the same sentence whether or not the email has an executed agreement, so a
// visitor cannot learn who has one. The route answers in two wire formats: JSON for script requests, and for a native
// urlencoded form post a 303 redirect (success) or an HTML page that keeps the status code (every failure). Each case
// that can be sent both ways is recorded both ways, named "(json)" and "(form)".
//
// Every response branch of the handler, nativeAgreementRoute and agreementRequest (src/lib/agreement-request.ts),
// issueAgreementLink (src/lib/agreement-access.ts), verifyTurnstile, reserveStudioAllowance and sendAudioMessage, and the
// cases that reach it:
//
//   agreementRequest (before anything else is read)
//   403 Forbidden                       form: no Origin, another site (as an HTML page); JSON goes through musicRequest, below
//   413 Request too large               form body 4097 bytes (4096 is accepted)
//   400 Invalid fields                  form with a `documents` or `values` field that is not JSON
//   musicRequest (JSON only)
//   403 Forbidden, 415 JSON required, 400 Missing request, 413, 400 Invalid JSON (as in the studio corpora)
//   form mapping                        cf-turnstile-response becomes turnstileToken; a plain turnstileToken also works; the
//                                       other form fields keep their text; a form that is not the legal_name shape is returned as is
//   schema
//   400 "Complete the security check."  null, array, missing or non-text email, email over 320, missing/empty/over-long token
//   issueAgreementLink
//   404 {ok:false}                      request origin is not SITE_ORIGIN (another host, an invalid SITE_ORIGIN), host header differs
//   503 unavailable                     no MUSIC_DB, code key, Resend key, from address, Turnstile secret (and the empty string)
//   400 "Enter a valid email address."  after the schema: not an address, empty, spaces, markup, unicode
//   403 security check again            Turnstile success false, HTTP 500, network down, answer not JSON (after the address allowance, before the email's)
//   429 "wait a few minutes"            archive-link-ip at 20 uses (before the security check), archive-link-email at 3 uses (after it); 19 and 2 pass; windows five minutes old are pruned
//   429 "wait at least 30 seconds"      the cooldown row is under 30 seconds old; a repeat; the guard SELECT in the link batch
//                                       fails (a link issued under 30 seconds ago, or the batch throwing)
//   200 receipt, no mail                no executed agreement for the email (the cooldown is still taken and the allowances spent)
//   200 receipt, mail                   an executed agreement: link row, event row, email with the greeting from the signature
//   mail outcomes                       200 consumes the older unused links; 4xx (the link is marked used, the answer is still the
//                                       receipt); 5xx and network down are "uncertain" (older links consumed, answer the receipt)
//   503 catch                           every statement that is not the link batch throwing (allowances, cooldown, executed lookup,
//                                       name lookup, the final used_at update, which can happen after the email was sent)
//   303 /agreements?email=sent          form success (with the 200 receipt or after the email)
//   greeting                            the first word of the signature name, "there" with none, markup and unicode escaped in html
//                                       and left raw in the text part

const PATH = "/api/agreements/link";

const base = {
	as: asVisitor({ ip: IP }),
	path: PATH,
	dump: { music: LINK_TABLES },
};

const SEED = (extra: Opts = {}) =>
	agreementWorld({ agreements: "executed", session: null, ...extra });

const signature = (name: string) => ({
	software_agreement_signatures: [
		{
			id: "sig-1",
			agreement_id: "ag-msa",
			party: "client",
			typed_name: name,
			title: "Owner",
			consent_text: "consent",
			consent_version: "1",
			consent_at: "2026-11-13T11:00:00.000Z",
			signed_at: "2026-11-13T11:00:00.000Z",
			document_sha256: "0".repeat(64),
			verified_email: GRACE,
			verified_at: "2026-11-13T11:00:00.000Z",
			verification_method: "email",
			intent_text: "intent",
			document_list_json: "[]",
			receipt_id: "receipt-1",
			ip_address: "203.0.113.9",
			user_agent: "golden",
		},
	],
});

const ask = { email: GRACE, turnstileToken: "tok" };

const withSignature = (name: string): Pick<Case, "music" | "setup"> =>
	SEED({ extra: signature(name) });

const withAllowance = async (
	scope: string,
	subject: string,
	uses: number,
	windowStart?: string,
): Promise<Pick<Case, "music" | "setup">> => {
	const world = SEED({
		extra: {
			audio_client_allowances: [
				await allowanceRow(scope, subject, uses, windowStart),
			],
		},
	});

	return world;
};

const cooldown = (windowStart: string) =>
	allowanceRow("archive-link-cooldown", GRACE, 1, windowStart);

const one = (name: string, build: (make: Make) => Omit<Case, "name">): Case[] =>
	bothWires(name, base, (make) => build(make));

const standard = (
	name: string,
	over: Partial<Case> = {},
	fields: Parameters<Make>[0] = ask,
	extra: Extra = {},
): Case[] =>
	one(name, (make) => ({
		...SEED(),
		fetches: mail,
		steps: [make(fields, extra)],
		...over,
	}));

const missing = (name: string, omit: NonNullable<Case["omit"]>[number]) =>
	standard(name, { omit: [omit] });

const outage = (name: string, on: RegExp, extra: Partial<Case> = {}, nth = 1) =>
	standard(name, {
		failures: [{ on, nth, message: `${name} fails` }],
		...extra,
	});

const sequence = (
	name: string,
	steps: (make: Make) => Step[],
	over: Partial<Case> = {},
) =>
	one(name, (make) => ({
		...SEED(),
		fetches: mail,
		steps: steps(make),
		...over,
	}));

const FIRST = "2026-11-13T11:59:00.000Z";

const OLD_LINK = {
	software_agreement_links: [
		{
			id: "link-old",
			purpose: "archive",
			offer_id: null,
			link_hash: null,
			recipient_email: GRACE,
			token_hash: "token-hash-of-an-older-archive-link",
			issued_at: "2026-11-13T11:50:00.000Z",
			expires_at: "2026-11-13T12:50:00.000Z",
			used_at: null,
		},
	],
};

const cases: Case[] = [
	// the answer and the effects
	...standard("an executed agreement is mailed a link"),
	...standard("no executed agreement gets the same receipt and no mail", {
		...agreementWorld({ session: null }),
	}),
	...standard(
		"a signed but not executed agreement gets the receipt and no mail",
		{
			...agreementWorld({ agreements: "client_signed", session: null }),
		},
	),
	...standard(
		"an email in capitals with spaces is normalised to the executed client",
		{},
		{
			email: "  GRACE@Example.TEST  ",
			turnstileToken: "tok",
		},
	),
	...standard(
		"the greeting uses the first word of the signature name",
		withSignature("Grace Brewster Hopper"),
	),
	...standard(
		"a signature name with markup is raw in the text and escaped in the html part",
		withSignature(`<b>Zoe</b> & "Co" O'Neil`),
	),
	...standard("a signature name with unicode", withSignature("Zoë Ångström")),
	...standard(
		"a signature name of only spaces falls back to there",
		withSignature("   "),
	),
	...standard("an older unused archive link is consumed by the new send", {
		...SEED({ extra: OLD_LINK }),
	}),
	// the schema
	...standard("no email", {}, { turnstileToken: "tok" }),
	...standard(
		"an email that is not text",
		{},
		{ email: 5, turnstileToken: "tok" },
	),
	...standard(
		"an email of 321 characters",
		{},
		{
			email: `${"a".repeat(308)}@example.test`,
			turnstileToken: "tok",
		},
	),
	...standard("no security token", {}, { email: GRACE }),
	...standard(
		"an empty security token",
		{},
		{ email: GRACE, turnstileToken: "" },
	),
	...standard(
		"a security token of 2049 characters",
		{},
		{
			email: GRACE,
			turnstileToken: "t".repeat(2049),
		},
	),
	...standard(
		"a security token of 2048 characters",
		{},
		{
			email: GRACE,
			turnstileToken: "t".repeat(2048),
		},
	),
	...standard(
		"an email that is not an address",
		{},
		{ email: "not-an-email", turnstileToken: "tok" },
	),
	...standard("an empty email", {}, { email: "", turnstileToken: "tok" }),
	...standard(
		"an email of spaces",
		{},
		{ email: "   ", turnstileToken: "tok" },
	),
	...standard(
		"an email with markup characters",
		{},
		{
			email: "<b>grace</b>@example.test",
			turnstileToken: "tok",
		},
	),
	...standard(
		"an email with unicode characters",
		{},
		{
			email: "grâce@example.test",
			turnstileToken: "tok",
		},
	),
	...standard(
		"an email with a plus tag is a different email",
		{},
		{
			email: "grace+tag@example.test",
			turnstileToken: "tok",
		},
	),
	// bindings and secrets
	...one("no database binding", (make) => ({
		...SEED(),
		music: { missing: true },
		fetches: mail,
		steps: [make(ask)],
	})),
	...missing("no code key", "AUDIO_CLIENT_CODE_KEY"),
	...missing("no Resend key", "RESEND_API_KEY"),
	...missing("no from address", "CONTACT_FROM_EMAIL"),
	...missing("no Turnstile secret", "TURNSTILE_SECRET_KEY"),
	...standard("an empty Resend key", { env: { RESEND_API_KEY: "" } }),
	...standard("a code key under 32 characters", {
		env: { AUDIO_CLIENT_CODE_KEY: "short-key-of-31-characters-xxx" },
	}),
	// the site origin
	...one("a request to another host of the site", (make) => ({
		...SEED(),
		fetches: mail,
		origin: "https://audio.thesuperhuman.us",
		steps: [
			make(ask, {
				headers: { origin: "https://audio.thesuperhuman.us" },
				origin: "https://audio.thesuperhuman.us",
			}),
		],
	})),
	...standard("a host header that is not the site host", {}, ask, {
		headers: { ...SAME_ORIGIN, host: "evil.example" },
	}),
	...standard("SITE_ORIGIN is not a URL", {
		env: { SITE_ORIGIN: "not a url" },
	}),
	...standard("SITE_ORIGIN is unset so the default site origin applies", {
		omit: ["SITE_ORIGIN"],
	}),
	...standard("SITE_ORIGIN names another site", {
		env: { SITE_ORIGIN: "https://example.org" },
	}),
	// Turnstile
	...standard("the security check fails", {
		fetches: withTurnstile(json(200, { success: false })),
	}),
	...standard("the security check answers 500", {
		fetches: withTurnstile(json(500, { success: false })),
	}),
	...standard("the security check is unreachable", {
		fetches: withTurnstile(networkDown()),
	}),
	...standard("the security check answers text", {
		fetches: withTurnstile(text(200, "ok")),
	}),
	...standard("the security check answers success as text", {
		fetches: withTurnstile(json(200, { success: "true" })),
	}),
	// allowances
	...(await Promise.all([
		withAllowance("archive-link-ip", IP, 20),
		withAllowance("archive-link-ip", IP, 19),
		withAllowance("archive-link-email", GRACE, 3),
		withAllowance("archive-link-email", GRACE, 2),
		withAllowance("archive-link-ip", IP, 20, "2026-11-13T11:55:00.000Z"),
		withAllowance("archive-link-email", GRACE, 3, "2026-11-13T11:55:01.000Z"),
	]).then((worlds) =>
		[
			"the address is at twenty uses so the next is refused",
			"the address is at nineteen uses so the next passes",
			"the email is at three uses so the next is refused",
			"the email is at two uses so the next passes",
			"an address window exactly five minutes old is pruned",
			"an email window one second under five minutes is kept",
		].flatMap((name, index) => standard(name, worlds[index])),
	)),
	// the cooldown
	...(await cooldown(FIRST).then((row) =>
		standard("the cooldown is 60 seconds old so a link is sent", {
			...SEED({ extra: { audio_client_allowances: [row] } }),
		}),
	)),
	...(await cooldown("2026-11-13T11:59:45.000Z").then((row) =>
		standard("the cooldown is 15 seconds old so the request is refused", {
			...SEED({ extra: { audio_client_allowances: [row] } }),
		}),
	)),
	...(await cooldown("2026-11-13T11:59:30.000Z").then((row) =>
		standard("the cooldown is exactly 30 seconds old so a link is sent", {
			...SEED({ extra: { audio_client_allowances: [row] } }),
		}),
	)),
	...(await cooldown("2026-11-13T11:59:30.001Z").then((row) =>
		standard("the cooldown is 29.999 seconds old so the request is refused", {
			...SEED({ extra: { audio_client_allowances: [row] } }),
		}),
	)),
	...standard("a link issued 20 seconds ago blocks the batch guard", {
		...SEED({
			extra: {
				software_agreement_links: [
					{
						id: "link-recent",
						purpose: "archive",
						offer_id: null,
						link_hash: null,
						recipient_email: GRACE,
						token_hash: "token-hash-of-a-recent-archive-link",
						issued_at: "2026-11-13T11:59:40.000Z",
						expires_at: "2026-11-13T12:59:40.000Z",
						used_at: null,
					},
				],
			},
		}),
	}),
	...sequence(
		"two requests back to back are refused the second time",
		(make) => [make(ask), make(ask)],
	),
	...sequence(
		"a repeat after 31 seconds sends a second link and consumes the first",
		(make) => [make(ask), make(ask, { advanceMs: 31_000 })],
	),
	...sequence(
		"a fourth request for one email is refused by the email allowance",
		(make) => Array.from({ length: 4 }, () => make(ask, { advanceMs: 31_000 })),
	),
	...sequence(
		"twenty-one requests from one address are refused by the address allowance",
		(make) =>
			Array.from({ length: 21 }, (_, index) =>
				make(
					{ email: `person${index}@example.test`, turnstileToken: "tok" },
					{ dump: { music: ["audio_client_allowances"] } },
				),
			),
	),
	// the email outcomes
	...standard("Resend refuses with 422", {
		fetches: withResend(json(422, { message: "bad" })),
	}),
	...standard("Resend refuses with 429", {
		fetches: withResend(json(429, { message: "slow" })),
	}),
	...standard("Resend answers 500", {
		fetches: withResend(json(500, { message: "down" })),
	}),
	...standard("Resend answers 503 with text", {
		fetches: withResend(text(503, "unavailable")),
	}),
	...standard("Resend is unreachable", { fetches: withResend(networkDown()) }),
	...standard("Resend answers 200 with text that is not JSON", {
		fetches: withResend(text(200, "ok")),
	}),
	...standard("Resend refuses and an older link exists", {
		...SEED({ extra: OLD_LINK }),
		fetches: withResend(json(422, { message: "bad" })),
	}),
	...standard("Resend answers 500 and an older link exists", {
		...SEED({ extra: OLD_LINK }),
		fetches: withResend(json(500, { message: "down" })),
	}),
	// outages of each statement
	...outage(
		"the ip allowance batch fails",
		/audio_client_allowances\(key,window_start,uses\)/,
	),
	...outage(
		"the email allowance batch fails",
		/audio_client_allowances\(key,window_start,uses\)/,
		{},
		2,
	),
	...outage(
		"the cooldown insert fails",
		/ON CONFLICT\(key\) DO UPDATE SET window_start/,
	),
	...outage(
		"the executed agreement lookup fails",
		/software_agreement_clients c JOIN software_agreements a/,
	),
	...outage("the link batch fails", /INSERT INTO software_agreement_links/),
	...outage(
		"the name lookup fails after the link is stored",
		/sig\.typed_name AS name/,
	),
	...outage(
		"the used_at update after a sent email fails",
		/UPDATE software_agreement_links SET used_at=\? WHERE purpose/,
	),
	...outage(
		"the used_at update after a refused email fails",
		/UPDATE software_agreement_links SET used_at=\? WHERE id=\?/,
		{
			fetches: withResend(json(422, { message: "bad" })),
		},
	),
	// races
	...standard(
		"another request issues a link between the lookup and the batch",
		{
			...SEED(),
			interleave: [
				{
					on: /INSERT INTO software_agreement_links/,
					label: "another request issued a link just now",
					run: (sqlite) =>
						sqlite.exec(
							"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('link-race','archive',NULL,NULL,'grace@example.test','race-hash','2026-11-13T11:59:59.000Z','2026-11-13T12:59:59.000Z')",
						),
				},
			],
		},
	),
	...standard("the signature is removed just before the name lookup", {
		interleave: [
			{
				on: /sig\.typed_name AS name/,
				label: "the signature row is removed",
				run: (sqlite) =>
					sqlite.exec("DELETE FROM software_agreement_signatures"),
			},
		],
	}),
	// the emailed link, followed (src/pages/agreements/verify.astro calls completeAgreementLink)
	...sequence(
		"the emailed link is previewed and then consumed, which sets the archive cookie",
		(make) => [
			make(ask),
			follow("GET", { archive: true }),
			follow("POST", { archive: true }),
		],
	),
	...sequence("the emailed link works once", (make) => [
		make(ask),
		follow("POST", { archive: true }),
		follow("POST", { archive: true }),
		follow("GET", { archive: true }),
	]),
	...sequence("the emailed link expires after an hour", (make) => [
		make(ask),
		follow("GET", { archive: true }, { advanceMs: 3_600_001 }),
	]),
	...sequence("the emailed link still works at 59 minutes", (make) => [
		make(ask),
		follow("POST", { archive: true }, { advanceMs: 3_540_000 }),
	]),
	...sequence("a newer link makes the older one useless", (make) => [
		make(ask),
		make(ask, { advanceMs: 31_000 }),
		follow("POST", { archive: true, mail: 0 }),
		follow("POST", { archive: true, mail: 1 }),
	]),
	...sequence("a key that is not 43 characters", (make) => [
		make(ask),
		follow("GET", { archive: true, key: "short" }),
	]),
	...sequence("a key that matches no link", (make) => [
		make(ask),
		follow("GET", { key: "x".repeat(43) }),
	]),
	...sequence(
		"a link consumed over http sets the cookie without Secure",
		(make) => [
			make(ask, {
				origin: "http://localhost:4321",
				headers: { origin: "http://localhost:4321" },
			}),
			follow(
				"POST",
				{ archive: true },
				{
					origin: "http://localhost:4321",
					headers: { origin: "http://localhost:4321" },
				},
			),
		],
		{ env: { SITE_ORIGIN: "http://localhost:4321" } },
	),
	...sequence(
		"the consume batch is cut by a race that uses the link first",
		(make) => [make(ask), follow("POST", { archive: true })],
		{
			interleave: [
				{
					on: /UPDATE software_agreement_links SET used_at=\? WHERE token_hash=\?/,
					label: "another tab consumed the link",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE software_agreement_links SET used_at='2026-11-13T12:00:00.000Z'",
						),
				},
			],
		},
	),
	...sequence(
		"the consume batch fails",
		(make) => [make(ask), follow("POST", { archive: true })],
		{
			failures: [
				{
					on: /INSERT INTO software_agreement_sessions/,
					message: "the session insert fails",
				},
			],
		},
	),
	// the wire formats themselves
	{
		name: "JSON without an Origin header",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, json: ask }],
	},
	{
		name: "JSON from another site",
		...SEED(),
		fetches: mail,
		steps: [
			{ ...base, json: ask, headers: { origin: "https://evil.example" } },
		],
	},
	{
		name: "JSON from the http scheme",
		...SEED(),
		fetches: mail,
		steps: [
			{ ...base, json: ask, headers: { origin: "http://thesuperhuman.us" } },
		],
	},
	{
		name: "text/plain body",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, body: JSON.stringify(ask), headers: SAME_ORIGIN }],
	},
	{
		name: "JSON content type and no body",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			},
		],
	},
	{
		name: "JSON with a charset is accepted",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				json: ask,
				headers: {
					...SAME_ORIGIN,
					"content-type": "application/json; charset=utf-8",
				},
			},
		],
	},
	{
		name: "JSON body of 4096 bytes is accepted",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				json: {
					...ask,
					pad: "x".repeat(4096 - JSON.stringify({ ...ask, pad: "" }).length),
				},
				headers: SAME_ORIGIN,
			},
		],
	},
	{
		name: "JSON body of 4097 bytes",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				json: {
					...ask,
					pad: "x".repeat(4097 - JSON.stringify({ ...ask, pad: "" }).length),
				},
				headers: SAME_ORIGIN,
			},
		],
	},
	{
		name: "bad JSON",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: "{not json",
				headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			},
		],
	},
	{
		name: "a null body",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, json: null, headers: SAME_ORIGIN }],
	},
	{
		name: "an array body",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, json: [GRACE, "tok"], headers: SAME_ORIGIN }],
	},
	{
		name: "form without an Origin header",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ email: GRACE, "cf-turnstile-response": "tok" }),
				headers: { "content-type": FORM_TYPE },
			},
		],
	},
	{
		name: "form from another site",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ email: GRACE, "cf-turnstile-response": "tok" }),
				headers: { origin: "https://evil.example", "content-type": FORM_TYPE },
			},
		],
	},
	{
		name: "form with the content type in capitals and a charset",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ email: GRACE, "cf-turnstile-response": "tok" }),
				headers: {
					origin: ORIGIN,
					"content-type": `${FORM_TYPE}; charset=UTF-8`,
				},
			},
		],
	},
	{
		name: "form with the security token under its own name",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ email: GRACE, turnstileToken: "tok" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with an empty widget field falls back to turnstileToken",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({
					email: GRACE,
					"cf-turnstile-response": "",
					turnstileToken: "tok",
				}),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with a documents field that is not JSON",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ ...ask, documents: "not json" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with a values field that is JSON",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ ...ask, values: "{}" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with a legal_name field takes the draft shape and fails the schema",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ ...ask, legal_name: "X", csrf_nonce: "n" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form body of 4096 bytes is accepted",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({
					...ask,
					pad: "x".repeat(4096 - formBody({ ...ask, pad: "" }).length),
				}),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form body of 4097 bytes",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({
					...ask,
					pad: "x".repeat(4097 - formBody({ ...ask, pad: "" }).length),
				}),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with no body",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, headers: formHeaders() }],
	},
	{
		name: "a form with markup in the email field shows nothing from the field in its page",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({
					email: "<script>alert(1)</script>",
					"cf-turnstile-response": "tok",
				}),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "the owner asking is treated as a visitor",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, as: asOwner(), json: ask, headers: SAME_ORIGIN }],
	},
	{
		name: "an offer token in the query is ignored",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				path: `${PATH}?token=${TOKEN}`,
				json: ask,
				headers: SAME_ORIGIN,
			},
		],
	},
	{
		name: "no client address uses the shared 0.0.0.0 bucket",
		...SEED(),
		fetches: mail,
		steps: [{ ...base, as: asVisitor(), json: ask, headers: SAME_ORIGIN }],
	},
	{
		name: "an IPv6 client address",
		...SEED(),
		fetches: mail,
		steps: [
			{
				...base,
				as: asVisitor({ ip: "2001:db8::7" }),
				json: ask,
				headers: SAME_ORIGIN,
			},
		],
	},
];

defineCorpus("agreements-link", POST, cases);
