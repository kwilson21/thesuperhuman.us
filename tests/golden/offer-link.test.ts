import { POST } from "~/pages/api/offer/[token]/link";
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
	cookie,
	follow,
	FORM_TYPE,
	formBody,
	formHeaders,
	GRACE,
	IP,
	LINK_TABLES,
	mail,
	ORIGIN,
	OTHER_SESSION,
	OTHER_TOKEN,
	SAME_ORIGIN,
	secondOffer,
	startedProject,
	terms,
	TOKEN,
	withResend,
	withTurnstile,
	type Make,
	type Opts,
} from "./areas/agreement-access";
import { allowanceRow } from "./areas/studio-access";

// The golden corpus for POST /api/offer/[token]/link: a client asks for an emailed link that opens the signing page of
// one offer (purpose "agreement"). The recipient is the email the owner stored on the offer, never the one in the body.
// The route answers in two wire formats: JSON for script requests, and for a native urlencoded form post a 303 redirect to
// /offer/<token>/sign?email=sent (success) or an HTML page that keeps the status code (every failure; its "return to the
// agreement page" link is /offer/<token>/sign, with the token from the URL escaped). Each case that can be sent both
// ways is recorded both ways, named "(json)" and "(form)".
//
// Branches (the handler, agreementRequest and nativeAgreementRoute in src/lib/agreement-request.ts, issueAgreementLink,
// liveSigningGuard, completeAgreementLink in src/lib/agreement-access.ts, getLinkedOffer in src/lib/software-offers.ts):
//
//   agreementRequest / musicRequest     403 Forbidden, 415 JSON required, 400 Missing request / Invalid JSON, 413 over 4096 bytes,
//                                       400 Invalid fields (form with a bad documents field), the cf-turnstile-response mapping
//   schema
//   400 "Complete the security check."  null, array, no turnstileToken, empty, not text, over 2048 characters (an email in the body is dropped)
//   issueAgreementLink
//   404 {ok:false}                      request origin or host is not SITE_ORIGIN
//   503 unavailable                     no MUSIC_DB, code key, Resend key, from address, Turnstile secret
//   404 "Website signing is off."       software_signing_enabled is 0 (checked before the offer is read)
//   404 "unavailable for signing"       bad token shape, unknown token, revoked offer link, offer draft, superseded or withdrawn, request
//                                       withdrawn, resolved or without an email, offer with no recipient snapshot or no MSA template
//   400 "Enter a valid email address."  no token in the params (the route then takes the archive path and the body has no email)
//   403 security check again            Turnstile fails (before any allowance is charged)
//   429 "wait a few minutes"            agreement-link-ip at 20, agreement-link-email at 3
//   429 "wait at least 30 seconds"      a link issued under 30 seconds ago; liveSigningGuard fails inside the link batch (a started
//                                       project, a revoked offer link, a withdrawn request, signing switched off); the batch throwing
//   200 receipt                         the message names the full email when the request carries a live session for this offer, and a
//                                       masked one (g•••@example.test) otherwise
//   mail outcomes                       200 and the 5xx/network "uncertain" cases keep the link and consume older ones; a 4xx deletes the
//                                       link, its sessions and un-charges both allowances, and answers 502 "didn't go through"
//   503 catch                           every statement outside the link batch throwing, an offer whose terms are not JSON (after the link
//                                       row is stored and before any mail), the 4xx clean-up batch throwing
//   303 /offer/<token>/sign?email=sent form success
//   email content                       greeting from the request name (first word, "there" when empty), outcome from the offer terms,
//                                       markup and unicode escaped in the html part and raw in the text part
//   the emailed link followed           GET preview, POST consume (303 and the agreement_session cookie), used once, an hour, another
//                                       offer's token, a newer link, liveSigningGuard failing at consume time

const PATH = `/api/offer/${TOKEN}/link`;

const base = {
	as: asVisitor({ ip: IP }),
	path: PATH,
	params: { token: TOKEN },
	dump: { music: LINK_TABLES },
};

const world = (extra: Opts = {}) => agreementWorld({ session: null, ...extra });

const ask = { turnstileToken: "tok" };

const one = (
	name: string,
	build: (make: Make) => Omit<Case, "name">,
	override: Partial<typeof base> = {},
): Case[] => bothWires(name, { ...base, ...override }, (make) => build(make));

const standard = (
	name: string,
	over: Partial<Case> = {},
	fields: Parameters<Make>[0] = ask,
	extra: Partial<Step> = {},
	override: Partial<typeof base> = {},
): Case[] =>
	one(
		name,
		(make) => ({
			...world(),
			fetches: mail,
			steps: [make(fields, extra)],
			...over,
		}),
		override,
	);

const state = (name: string, opts: Opts, over: Partial<Case> = {}) =>
	standard(name, { ...world(opts), ...over });

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
		...world(),
		fetches: mail,
		steps: steps(make),
		...over,
	}));

const race = (
	name: string,
	on: RegExp,
	sql: string,
	over: Partial<Case> = {},
) =>
	standard(name, {
		interleave: [{ on, label: name, run: (sqlite) => sqlite.exec(sql) }],
		...over,
	});

const LINK_INSERT = /INSERT INTO software_agreement_links/;

const cases: Case[] = [
	// the answer and the effects
	...standard("the offer recipient is sent a link"),
	...standard(
		"the body email is ignored; the offer snapshot decides",
		{},
		{
			email: "someone.else@example.test",
			turnstileToken: "tok",
		},
	),
	...state("a client with a live session is told the full email", {
		session: {},
	}).map(withCookie),
	...state("a session of another offer gives the masked email", {
		session: { offer_id: "o-r1", recipient_email: "other@example.test" },
	}).map(withCookie),
	...state("an expired session gives the masked email", {
		session: { expires_at: "2026-11-13T11:59:59.000Z" },
	}).map(withCookie),
	...state("a revoked session gives the masked email", {
		session: { revoked_at: "2026-11-13T11:45:00.000Z" },
	}).map(withCookie),
	...state("a session for a different token gives the masked email", {
		session: { link_hash: "another-link-hash" },
	}).map(withCookie),
	...state("a one-letter email local part is masked to its first letter", {
		offer: { recipient_email_snapshot: "g@example.test" },
		request: { email: "g@example.test" },
	}),
	...state(
		"an older unused agreement link of the offer is consumed by the new send",
		{
			extra: {
				software_agreement_links: [
					{
						id: "link-old",
						purpose: "agreement",
						offer_id: "o-r1",
						link_hash: "hash-of-the-offer-link",
						recipient_email: GRACE,
						token_hash: "token-hash-of-an-older-agreement-link",
						issued_at: "2026-11-13T11:50:00.000Z",
						expires_at: "2026-11-13T12:50:00.000Z",
						used_at: null,
					},
				],
			},
		},
	),
	// the offer must be signable
	...state("signing is off", { signing: false }),
	...state("the offer link was revoked", {
		offerLink: { revoked_at: "2026-11-13T11:30:00.000Z" },
	}),
	...state("there is no offer link row", { offerLink: null }),
	...state("the offer was superseded", { offer: { status: "superseded" } }),
	...state("the offer is still a draft", { offer: { status: "draft" } }),
	...state("the offer was withdrawn", { offer: { status: "withdrawn" } }),
	...state("the request was withdrawn", { request: { status: "withdrawn" } }),
	...state("the request was resolved", { request: { status: "resolved" } }),
	...state("the request has no email", { request: { email: "" } }),
	...state("the offer has no recipient snapshot", {
		offer: { recipient_email_snapshot: null },
	}),
	...state("the offer has an empty recipient snapshot", {
		offer: { recipient_email_snapshot: "" },
	}),
	...state("the offer has no MSA template", {
		offer: { msa_template_id: null },
	}),
	...state("a recipient snapshot that is not an email address", {
		offer: { recipient_email_snapshot: "not an email" },
	}),
	...state("the request is of another kind", { request: { kind: "service" } }),
	...state(
		"signing already started: a project exists",
		{},
		{
			...world({ extra: startedProject() }),
		},
	),
	// the token in the URL
	...standard(
		"a token that is too short",
		{},
		ask,
		{},
		{ params: { token: "short" } },
	),
	...standard(
		"a token of 44 characters",
		{},
		ask,
		{},
		{ params: { token: `${TOKEN}A` } },
	),
	...standard(
		"a token with characters outside the alphabet",
		{},
		ask,
		{},
		{
			params: { token: `${TOKEN.slice(0, 40)}+/=` },
		},
	),
	...standard(
		"a token that matches no offer",
		{},
		ask,
		{},
		{ params: { token: OTHER_TOKEN } },
	),
	...standard(
		"a token with markup in it shows only its escaped form in the page",
		{},
		ask,
		{},
		{
			params: { token: `"><img src=x onerror=alert(1)>&'` },
		},
	),
	...standard(
		"a token with unicode in it",
		{},
		ask,
		{},
		{ params: { token: "tokén-ünïcode" } },
	),
	...standard(
		"no token in the params takes the archive path and has no email",
		{},
		ask,
		{},
		{
			params: {},
		},
	),
	// the schema
	...standard("no security token", {}, {}),
	...standard("an empty security token", {}, { turnstileToken: "" }),
	...standard("a security token that is not text", {}, { turnstileToken: 7 }),
	...standard(
		"a security token of 2049 characters",
		{},
		{ turnstileToken: "t".repeat(2049) },
	),
	...standard(
		"a security token of 2048 characters",
		{},
		{ turnstileToken: "t".repeat(2048) },
	),
	// bindings and secrets
	...one("no database binding", (make) => ({
		...world(),
		music: { missing: true },
		fetches: mail,
		steps: [make(ask)],
	})),
	...missing("no code key", "AUDIO_CLIENT_CODE_KEY"),
	...missing("no Resend key", "RESEND_API_KEY"),
	...missing("no from address", "CONTACT_FROM_EMAIL"),
	...missing("no Turnstile secret", "TURNSTILE_SECRET_KEY"),
	...standard("a code key under 32 characters", {
		env: { AUDIO_CLIENT_CODE_KEY: "short-key-of-31-characters-xxx" },
	}),
	// the site origin
	...one("a request to another host of the site", (make) => ({
		...world(),
		fetches: mail,
		origin: "https://audio.thesuperhuman.us",
		steps: [
			make(ask, {
				origin: "https://audio.thesuperhuman.us",
				headers: { origin: "https://audio.thesuperhuman.us" },
			}),
		],
	})),
	...standard("a host header that is not the site host", {}, ask, {
		headers: { host: "evil.example" },
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
		fetches: withTurnstile(json(500, {})),
	}),
	...standard("the security check is unreachable", {
		fetches: withTurnstile(networkDown()),
	}),
	...standard("the security check answers text", {
		fetches: withTurnstile(text(200, "ok")),
	}),
	// allowances (scope agreement-link-*)
	...(await Promise.all([
		allowanceRow("agreement-link-ip", IP, 20),
		allowanceRow("agreement-link-ip", IP, 19),
		allowanceRow("agreement-link-email", GRACE, 3),
		allowanceRow("agreement-link-email", GRACE, 2),
		allowanceRow("archive-link-email", GRACE, 3),
		allowanceRow("agreement-link-ip", IP, 20, "2026-11-13T11:55:00.000Z"),
	]).then((allowances) =>
		[
			"the address is at twenty uses so the next is refused",
			"the address is at nineteen uses so the next passes",
			"the email is at three uses so the next is refused",
			"the email is at two uses so the next passes",
			"the archive allowance of the email does not count here",
			"an address window exactly five minutes old is pruned",
		].flatMap((name, index) =>
			standard(name, {
				...world({ extra: { audio_client_allowances: [allowances[index]] } }),
			}),
		),
	)),
	// the 30 second guard in the link batch
	...state("a link issued 20 seconds ago blocks the batch", {
		extra: {
			software_agreement_links: [
				{
					id: "link-recent",
					purpose: "agreement",
					offer_id: "o-r1",
					link_hash: "hash-of-the-offer-link",
					recipient_email: GRACE,
					token_hash: "token-hash-of-a-recent-agreement-link",
					issued_at: "2026-11-13T11:59:40.000Z",
					expires_at: "2026-11-13T12:59:40.000Z",
					used_at: null,
				},
			],
		},
	}),
	...state("a link issued exactly 30 seconds ago does not block the batch", {
		extra: {
			software_agreement_links: [
				{
					id: "link-recent",
					purpose: "agreement",
					offer_id: "o-r1",
					link_hash: "hash-of-the-offer-link",
					recipient_email: GRACE,
					token_hash: "token-hash-of-a-recent-agreement-link",
					issued_at: "2026-11-13T11:59:30.000Z",
					expires_at: "2026-11-13T12:59:30.000Z",
					used_at: null,
				},
			],
		},
	}),
	...state(
		"an archive link issued 5 seconds ago does not block an agreement link",
		{
			extra: {
				software_agreement_links: [
					{
						id: "link-archive",
						purpose: "archive",
						offer_id: null,
						link_hash: null,
						recipient_email: GRACE,
						token_hash: "token-hash-of-an-archive-link",
						issued_at: "2026-11-13T11:59:55.000Z",
						expires_at: "2026-11-13T12:59:55.000Z",
						used_at: null,
					},
				],
			},
		},
	),
	...sequence(
		"two requests back to back are refused the second time",
		(make) => [make(ask), make(ask)],
	),
	...sequence(
		"a repeat after 31 seconds sends a second link and consumes the first",
		(make) => [make(ask), make(ask, { advanceMs: 31_000 })],
	),
	...sequence(
		"a fourth request for one offer is refused by the email allowance",
		(make) => Array.from({ length: 4 }, () => make(ask, { advanceMs: 31_000 })),
	),
	// the email content
	...standard(
		"the greeting and the intro use the request name and the offer outcome",
	),
	...state("a request name with markup", {
		request: { name: `<i>Gra</i>ce & "Co"` },
	}),
	...state("an empty request name falls back to there", {
		request: { name: "" },
	}),
	...state("a request name of spaces falls back to there", {
		request: { name: "   " },
	}),
	...state("a request name with unicode", {
		request: { name: "Zoë Ångström" },
	}),
	...state("an offer outcome with markup, quotes and unicode", {
		offer: {
			terms_json: JSON.stringify({
				...terms,
				outcome: `<b>Tool</b> & "Ünï" 'x'`,
			}),
		},
	}),
	...state(
		"an offer whose terms are not JSON stores the link and fails before the email",
		{
			offer: { terms_json: "not json" },
		},
	),
	...state("an offer whose terms have no outcome", {
		offer: { terms_json: "{}" },
	}),
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
	...sequence(
		"Resend refuses and a second try goes through",
		(make) => [make(ask), make(ask)],
		{
			fetches: withResend([
				json(422, { message: "bad" }),
				json(200, { id: "em_2" }),
			]),
		},
	),
	...sequence(
		"Resend refuses after allowances were used before",
		(make) => [
			make(ask),
			make(ask, { advanceMs: 31_000 }),
			make(ask, { advanceMs: 31_000 }),
		],
		{
			fetches: withResend([
				json(200, { id: "em_1" }),
				json(200, { id: "em_2" }),
				json(422, { message: "bad" }),
			]),
		},
	),
	...state(
		"Resend answers 500 and an older link exists",
		{
			extra: {
				software_agreement_links: [
					{
						id: "link-old",
						purpose: "agreement",
						offer_id: "o-r1",
						link_hash: "hash-of-the-offer-link",
						recipient_email: GRACE,
						token_hash: "token-hash-of-an-older-agreement-link",
						issued_at: "2026-11-13T11:50:00.000Z",
						expires_at: "2026-11-13T12:50:00.000Z",
						used_at: null,
					},
				],
			},
		},
		{ fetches: withResend(json(500, {})) },
	),
	// outages of each statement
	...outage(
		"the signing switch lookup fails",
		/FROM software_signing_settings/,
	),
	...outage(
		"the offer lookup fails",
		/FROM software_offers o JOIN software_offer_links l/,
	),
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
	...outage("the link batch fails", LINK_INSERT),
	...outage(
		"the name lookup fails after the link is stored",
		/SELECT name FROM owner_requests/,
	),
	...outage(
		"the used_at update after a sent email fails",
		/UPDATE software_agreement_links SET used_at=\? WHERE purpose/,
	),
	...outage(
		"the clean-up batch after a refused email fails",
		/DELETE FROM software_agreement_sessions WHERE link_id/,
		{
			fetches: withResend(json(422, { message: "bad" })),
		},
	),
	...state(
		"the session lookup for the message fails",
		{ session: {} },
		{
			failures: [
				{
					on: /FROM software_agreement_sessions WHERE token_hash/,
					message: "session lookup fails",
				},
			],
		},
	).map(withCookie),
	// races
	...race(
		"the request is withdrawn between the lookup and the batch",
		LINK_INSERT,
		"UPDATE owner_requests SET status='withdrawn'",
	),
	...race(
		"the request is resolved between the lookup and the batch",
		LINK_INSERT,
		"UPDATE owner_requests SET status='resolved'",
	),
	...race(
		"the offer link is revoked between the lookup and the batch",
		LINK_INSERT,
		"UPDATE software_offer_links SET revoked_at='2026-11-13T11:59:59.000Z'",
	),
	...race(
		"signing is switched off between the lookup and the batch",
		LINK_INSERT,
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	...race(
		"the owner starts the project between the lookup and the batch",
		LINK_INSERT,
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')",
	),
	...race(
		"the offer is superseded between the lookup and the batch",
		LINK_INSERT,
		"UPDATE software_offers SET status='superseded'",
	),
	...race(
		"another request issues a link between the lookup and the batch",
		LINK_INSERT,
		"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('link-race','agreement','o-r1','h','grace@example.test','race-hash','2026-11-13T11:59:59.000Z','2026-11-13T12:59:59.000Z')",
	),
	...race(
		"the offer is withdrawn while the email is being sent",
		/SELECT name FROM owner_requests/,
		"UPDATE software_offers SET status='withdrawn'",
	),
	...race(
		"a refused email after another request used the allowance in between",
		/DELETE FROM software_agreement_sessions WHERE link_id/,
		"UPDATE audio_client_allowances SET uses=uses+1",
		{
			fetches: withResend(json(422, { message: "bad" })),
		},
	),
	// the emailed link, followed
	...sequence(
		"the emailed link is previewed and then consumed, which sets the session cookie",
		(make) => [make(ask), follow("GET"), follow("POST")],
	),
	...sequence("the emailed link works once", (make) => [
		make(ask),
		follow("POST"),
		follow("POST"),
		follow("GET"),
	]),
	...sequence("the emailed link expires after an hour", (make) => [
		make(ask),
		follow("GET", {}, { advanceMs: 3_600_001 }),
	]),
	...sequence("the emailed link still works at 59 minutes", (make) => [
		make(ask),
		follow("POST", {}, { advanceMs: 3_540_000 }),
	]),
	...sequence("a newer link makes the older one useless", (make) => [
		make(ask),
		make(ask, { advanceMs: 31_000 }),
		follow("POST", { mail: 0 }),
		follow("POST", { mail: 1 }),
	]),
	...sequence(
		"the emailed key used with another offer's token",
		(make) => [
			make(ask),
			follow("GET", { token: OTHER_TOKEN }),
			follow("POST", { token: OTHER_TOKEN }),
		],
		{ ...world({ extra: secondOffer() }) },
	),
	...sequence("the emailed link after the offer link was revoked", (make) => [
		make(ask),
		follow(
			"GET",
			{},
			{
				before: {
					label: "the owner revoked the offer link",
					run: (w) =>
						w.music.exec(
							"UPDATE software_offer_links SET revoked_at='2026-11-13T12:00:00.000Z'",
						),
				},
			},
		),
		follow("POST"),
	]),
	...sequence("the emailed link after the request was withdrawn", (make) => [
		make(ask),
		follow(
			"GET",
			{},
			{
				before: {
					label: "the request was withdrawn",
					run: (w) =>
						w.music.exec("UPDATE owner_requests SET status='withdrawn'"),
				},
			},
		),
		follow("POST"),
	]),
	...sequence("the emailed link after the project started", (make) => [
		make(ask),
		follow(
			"GET",
			{},
			{
				before: {
					label: "the project started",
					run: (w) =>
						w.music.exec(
							"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')",
						),
				},
			},
		),
		follow("POST"),
	]),
	...sequence("the emailed link after signing was switched off", (make) => [
		make(ask),
		follow(
			"POST",
			{},
			{
				before: {
					label: "signing was switched off",
					run: (w) =>
						w.music.exec(
							"UPDATE software_signing_settings SET software_signing_enabled=0",
						),
				},
			},
		),
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
				{},
				{
					origin: "http://localhost:4321",
					headers: { origin: "http://localhost:4321" },
				},
			),
		],
		{ env: { SITE_ORIGIN: "http://localhost:4321" } },
	),
	...sequence(
		"the consume batch loses a race for the link",
		(make) => [make(ask), follow("POST")],
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
		(make) => [make(ask), follow("POST")],
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
		...world(),
		fetches: mail,
		steps: [{ ...base, json: ask }],
	},
	{
		name: "JSON from another site",
		...world(),
		fetches: mail,
		steps: [
			{ ...base, json: ask, headers: { origin: "https://evil.example" } },
		],
	},
	{
		name: "text/plain body",
		...world(),
		fetches: mail,
		steps: [{ ...base, body: JSON.stringify(ask), headers: SAME_ORIGIN }],
	},
	{
		name: "JSON content type and no body",
		...world(),
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
		...world(),
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
		...world(),
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
		...world(),
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
		...world(),
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
		...world(),
		fetches: mail,
		steps: [{ ...base, json: null, headers: SAME_ORIGIN }],
	},
	{
		name: "an array body",
		...world(),
		fetches: mail,
		steps: [{ ...base, json: ["tok"], headers: SAME_ORIGIN }],
	},
	{
		name: "form without an Origin header",
		...world(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ "cf-turnstile-response": "tok" }),
				headers: { "content-type": FORM_TYPE },
			},
		],
	},
	{
		name: "form from another site",
		...world(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ "cf-turnstile-response": "tok" }),
				headers: { origin: "https://evil.example", "content-type": FORM_TYPE },
			},
		],
	},
	{
		name: "form with the content type in a charset form",
		...world(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ "cf-turnstile-response": "tok" }),
				headers: {
					origin: ORIGIN,
					"content-type": `${FORM_TYPE}; charset=UTF-8`,
				},
			},
		],
	},
	{
		name: "form with the security token under its own name",
		...world(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ turnstileToken: "tok" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with a documents field that is not JSON",
		...world(),
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
		name: "form with a manifest field that is JSON",
		...world(),
		fetches: mail,
		steps: [
			{
				...base,
				body: formBody({ ...ask, manifest: "[1]" }),
				headers: formHeaders(),
			},
		],
	},
	{
		name: "form with a legal_name field takes the draft shape",
		...world(),
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
		...world(),
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
		...world(),
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
		...world(),
		fetches: mail,
		steps: [{ ...base, headers: formHeaders() }],
	},
	{
		name: "a session cookie of the wrong shape is ignored",
		...world({ session: {} }),
		fetches: mail,
		steps: [
			{ ...base, json: ask, headers: { ...SAME_ORIGIN, ...cookie("short") } },
		],
	},
	{
		name: "a session cookie of another purpose is ignored",
		...world({ session: { purpose: "archive", offer_id: null } }),
		fetches: mail,
		steps: [{ ...base, json: ask, headers: { ...SAME_ORIGIN, ...cookie() } }],
	},
	{
		name: "a session cookie that matches no session",
		...world({ session: {} }),
		fetches: mail,
		steps: [
			{
				...base,
				json: ask,
				headers: { ...SAME_ORIGIN, ...cookie(OTHER_SESSION) },
			},
		],
	},
	{
		name: "the owner asking is treated as a visitor",
		...world(),
		fetches: mail,
		steps: [{ ...base, as: asOwner(), json: ask, headers: SAME_ORIGIN }],
	},
];

function withCookie(c: Case): Case {
	const isForm = c.name.endsWith("(form)");

	return {
		...c,
		steps: c.steps.map((step) => ({
			...step,
			headers: isForm
				? { ...formHeaders(), ...cookie() }
				: { ...SAME_ORIGIN, ...cookie() },
		})),
	};
}

defineCorpus("offer-link", POST, cases);
