import { afterAll } from "vitest";
import { POST as archiveLinkRoute } from "~/pages/api/agreements/link";
import { POST as signingLinkRoute } from "~/pages/api/offer/[token]/link";
import {
	asVisitor,
	defineCorpus,
	rows,
	seed,
	type Case,
	type Step,
	type World,
} from "./harness";
import { astroPages } from "./harness/page";
import {
	agreementWorld,
	contractor,
	details,
	formHeaders,
	GRACE,
	IP,
	LINK_TABLES,
	mail,
	NOW,
	openPage,
	ORIGIN,
	OTHER_TOKEN,
	pageKey,
	pagePath,
	postPage,
	SAME_ORIGIN,
	secondOffer,
	startedProject,
	terms,
	TOKEN,
	type Opts,
} from "./areas/agreement-access";

// The golden corpus for the signing link's page, src/pages/offer/[token]/verify.astro: the page the emailed link opens.
// A GET shows "Your agreement is ready." with the offer's outcome and a Continue form; the form's POST consumes the
// link, makes a two-hour signing session and redirects to /offer/<token>/sign with the agreement_session cookie. The
// page is rendered by Astro's container (tests/golden/harness/page.ts), so each step records the page's own status,
// headers, cookies and HTML. A case issues the link through POST /api/offer/[token]/link first, as a client does, then
// follows it through the page. Recorded on today's code, before the behaviour fixes and the conversion that
// docs/plans/2026-11-signing-conversion.md plans (B1, B2 and B5 change some of these cases; that PR lists them).
//
// Every response branch of the page and of what it calls (completeAgreementLink and liveSigningGuard in
// src/lib/agreement-access.ts, canonicalAgreementRequest in src/lib/agreement-host.ts, getLinkedOffer in
// src/lib/software-offers.ts), and the cases that reach it:
//
//   the key (verify.astro:7-10)
//   a GET reads ?key=, a POST reads the form's `key`
//                                     every case; "a POST with the key only in the query string" and "a GET with no
//                                     key" send none (""), "a multipart form with a good key" posts multipart, "a PUT
//                                     ..." and "a HEAD ..." read the query as a GET does
//   the page throws: rejected         formData() fails on a body that is not a form: "a POST whose body is JSON, not a
//                                     form: the page throws", "a POST of plain text: the page throws"
//
//   completeAgreementLink, then the page (verify.astro:12-27)
//   404, the expired page             the request's origin or Host is not SITE_ORIGIN, or SITE_ORIGIN is not a URL: "a
//                                     GET from another host", "a POST from another host", "a Host header that differs
//                                     from the site", "a SITE_ORIGIN that is not a URL"
//   401, the expired page             no MUSIC_DB: "no D1: a GET", "no D1: a POST"; a key that is not 43 URL-safe
//                                     characters: "a GET with a key that is too short", "a POST with a key that is too
//                                     short", "a key of 44 characters", "a key with characters outside the alphabet",
//                                     "a GET with no key", "a POST with no key in the form", "a POST with an empty
//                                     key", "a POST with the key only in the query string"
//   401, the expired page             no unused, unexpired signing link for the key's hash: "a GET with an unknown
//                                     key", "a POST with an unknown key", "an archive key on the signing page", "a GET
//                                     after an hour: the key has expired", "a POST after an hour ...", "a GET at
//                                     exactly the hour ...", the second POST and the GET of "a POST twice ...", the
//                                     first POST of "a newer link makes the older one useless", and the owner's moves
//                                     that retire the request's links: "a POST after the owner resends the offer", "a
//                                     POST after the owner revokes the offer link", "a POST after the owner withdraws
//                                     the offer"
//   401, the expired page             the link's offer token differs from the URL's: "another offer's token with the
//                                     key", "a token of the wrong shape with a good key"
//   the page throws: rejected         the link read fails: "outage: the link read on a GET: the page throws", "outage:
//                                     the link read on a POST: the page throws"
//   401, the expired page             GET: liveSigningGuard refuses (A1) or fails: the GET of each "... the emailed
//                                     link left unused" case (the offer superseded or withdrawn, its link revoked, the
//                                     request withdrawn or resolved, the recipient changed), "signing switched off: a
//                                     GET and a POST", "a project started: a GET and a POST", "outage: the GET's live
//                                     check: the expired page"
//   200, "Your agreement is ready."   "a GET with a good key shows the agreement is ready, with the offer's outcome",
//                                     "a GET, then the page's Continue form posts the key", "a GET leaves the link
//                                     unused, so a second GET still shows it ready", "the outcome's markup is escaped",
//                                     "terms with no outcome show an empty kicker", the GET after each of the two batch
//                                     outages (the link left unused)
//     the offer read (getLinkedOffer) finds nothing: an empty kicker
//                                     "the request's email is emptied after the link is sent: the page shows no
//                                     outcome"
//     the page throws: rejected       the offer read fails or the terms are not JSON: "outage: the offer read on a GET:
//                                     the page throws", "terms that are not JSON: the page throws"
//   401, the expired page             a method other than GET or POST, after the link read: "a PUT with a good key in
//                                     the query", "a HEAD with a good key"
//   401, the expired page             POST: the batch refuses (A1, A5) or fails: the POST of each "... the emailed link
//                                     left unused" case, "signing switched off ...", "a project started ...", "another
//                                     tab consumes the link between the POST's read and its batch", "the offer is
//                                     superseded between the POST's read and its batch", "signing is switched off
//                                     between ...", "a project starts between ...", "outage: the POST's batch (the
//                                     session insert): the expired page, the link left unused", "outage: the POST's
//                                     batch (the event insert) ..."
//   303 to /offer/<token>/sign        POST: the link used, the `verified` event, the session, the agreement_session
//                                     cookie (Secure over https): "a POST with a good key consumes the link and
//                                     redirects to the signing page with the session cookie", the POST of "a GET, then
//                                     the page's Continue form posts the key", the first POST of "a POST twice ...", "a
//                                     link consumed over http sets the cookie without Secure", "a POST at 59 minutes
//                                     still works", "a multipart form with a good key", "a POST with another site's
//                                     Origin header still consumes the link" (the page checks no Origin), the second
//                                     POST of "a newer link makes the older one useless"
//
// The ready and expired pages keep completeAgreementLink's status and add `Referrer-Policy: no-referrer` and
// `Cache-Control: no-store`; the expired page's "Send a new link" goes to /offer/<token>/sign with the URL's token, as
// written ("a token of the wrong shape with a good key"). The 303 is completeAgreementLink's own Response, answered as
// it is.

const pages = await astroPages({
	verify: "src/pages/offer/[token]/verify.astro",
});

afterAll(pages.remove);

/** The client asks for the signing link of the offer: the email holds the key the page is opened with. */
const issue = (extra: Partial<Step> = {}): Step => ({
	handler: signingLinkRoute,
	as: asVisitor({ ip: IP }),
	path: `/api/offer/${TOKEN}/link`,
	params: { token: TOKEN },
	json: { turnstileToken: "tok" },
	headers: SAME_ORIGIN,
	dump: { music: LINK_TABLES },
	...extra,
});

/** A sent offer with its link and signing on, and no session yet. */
const world = (opts: Opts = {}) => agreementWorld({ session: null, ...opts });

const scene = (
	name: string,
	steps: readonly Step[],
	over: Partial<Case> = {},
): Case => ({ name, ...world(), fetches: mail, steps, ...over });

/** A key of the right shape that no link was issued for. */
const UNKNOWN_KEY = "x".repeat(43);

/** What `before` runs: SQL on the music database, off the record. */
const sql =
	(...statements: readonly string[]) =>
	(w: World) => {
		for (const statement of statements) w.music.exec(statement);
	};

const before = (label: string, run: (w: World) => void) => ({
	before: { label, run },
});

// The owner's moves on the offer, as their batches leave the rows these cases hold (src/server/offers-store.ts): each
// retires the request's signing (`retireSigning`: sessions revoked and the emailed links used; there are no reviews or
// drafts to abandon or delete here), so the link is refused as used before the page asks whether the offer is live.
const retire = [
	`UPDATE software_agreement_sessions SET revoked_at='${NOW}' WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id='r1') AND revoked_at IS NULL`,
	`UPDATE software_agreement_links SET used_at='${NOW}' WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id='r1') AND used_at IS NULL`,
];

/**
 * `saveSend` for the open draft: the sent version superseded, version 2 sent, the link's token replaced, signing
 * retired.
 */
const resend = (w: World) => {
	w.music.exec(
		"UPDATE software_offers SET status='superseded' WHERE request_id='r1' AND status='sent'",
	);
	seed(w.music, {
		software_offers: [
			rows.softwareOffer("o-r1-v2", "r1", {
				version: 2,
				terms_json: JSON.stringify(terms),
				agreement_details_json: JSON.stringify(details),
				msa_template_id: "tpl-msa",
				sow_template_id: "tpl-sow",
				contractor_snapshot_json: JSON.stringify(contractor),
				recipient_email_snapshot: GRACE,
				created_at: NOW,
				updated_at: NOW,
				sent_at: NOW,
			}),
		],
	});
	sql(
		`UPDATE software_offer_links SET token_hash='hash-of-the-resent-offer-link',created_at='${NOW}',revoked_at=NULL WHERE request_id='r1'`,
		...retire,
	)(w);
};

/** `revokeOfferLink`: signing retired and the offer link revoked. */
const revoke = sql(
	...retire,
	`UPDATE software_offer_links SET revoked_at='${NOW}' WHERE request_id='r1' AND revoked_at IS NULL`,
);

/** `withdrawForDecline`: the offers withdrawn, signing retired and the offer link revoked. */
const withdraw = sql(
	`UPDATE software_offers SET status='withdrawn',updated_at='${NOW}' WHERE request_id='r1' AND status IN ('draft','sent')`,
	...retire,
	`UPDATE software_offer_links SET revoked_at='${NOW}' WHERE request_id='r1' AND revoked_at IS NULL`,
);

/** A state in which liveSigningGuard (A1) refuses, set with the emailed link left unused; then a GET and a POST. */
const unsignable = (name: string, label: string, run: (w: World) => void) =>
	scene(name, [issue(), openPage({}, before(label, run)), postPage()]);

/** A change made between the POST's link read and its batch (only that batch holds `used_at=? WHERE token_hash=?`). */
const betweenReadAndBatch = (name: string, label: string, statement: string) =>
	scene(name, [issue(), postPage()], {
		interleave: [
			{
				on: /UPDATE software_agreement_links SET used_at=\? WHERE token_hash=\?/,
				label,
				run: (sqlite) => sqlite.exec(statement),
			},
		],
	});

const BOUNDARY = "golden-form-boundary";

const cases: Case[] = [
	// the page with a good key
	scene(
		"a GET with a good key shows the agreement is ready, with the offer's outcome",
		[issue(), openPage()],
	),
	scene(
		"a POST with a good key consumes the link and redirects to the signing page with the session cookie",
		[issue(), postPage()],
	),
	scene("a GET, then the page's Continue form posts the key", [
		issue(),
		openPage(),
		postPage(),
	]),
	scene("a GET leaves the link unused, so a second GET still shows it ready", [
		issue(),
		openPage(),
		openPage(),
	]),
	scene("a POST twice: the second finds the link used, and so does a GET", [
		issue(),
		postPage(),
		postPage(),
		openPage(),
	]),
	scene(
		"a link consumed over http sets the cookie without Secure",
		[
			issue({
				origin: "http://localhost:4321",
				headers: { origin: "http://localhost:4321" },
			}),
			postPage(
				{},
				{
					origin: "http://localhost:4321",
					headers: formHeaders({ origin: "http://localhost:4321" }),
				},
			),
		],
		{ env: { SITE_ORIGIN: "http://localhost:4321" } },
	),
	scene("a newer link makes the older one useless", [
		issue(),
		issue({ advanceMs: 31_000 }),
		postPage({ mail: 0 }),
		postPage({ mail: 1 }),
	]),
	scene("a POST with another site's Origin header still consumes the link", [
		issue(),
		postPage({}, { headers: formHeaders({ origin: "https://evil.example" }) }),
	]),
	scene("a multipart form with a good key", [
		issue(),
		postPage(
			{},
			{
				body: (prior) =>
					`--${BOUNDARY}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${pageKey({})(prior)}\r\n--${BOUNDARY}--\r\n`,
				headers: {
					origin: ORIGIN,
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
			},
		),
	]),
	// what the page shows of the offer
	scene("the outcome's markup is escaped", [issue(), openPage()], {
		...world({
			offer: {
				terms_json: JSON.stringify({
					...terms,
					outcome: `Fish & <b>"chips"</b> <script>x</script>`,
				}),
			},
		}),
	}),
	scene("terms with no outcome show an empty kicker", [
		issue(),
		openPage(
			{},
			before(
				"the offer's terms lose their outcome",
				sql(
					`UPDATE software_offers SET terms_json='${JSON.stringify({ ...terms, outcome: undefined })}' WHERE id='o-r1'`,
				),
			),
		),
	]),
	scene(
		"the request's email is emptied after the link is sent: the page shows no outcome",
		[
			issue(),
			openPage(
				{},
				before(
					"the request's email is emptied",
					sql("UPDATE owner_requests SET email='' WHERE id='r1'"),
				),
			),
		],
	),
	scene("terms that are not JSON: the page throws", [
		issue(),
		openPage(
			{},
			before(
				"the offer's terms are not JSON",
				sql("UPDATE software_offers SET terms_json='not json' WHERE id='o-r1'"),
			),
		),
	]),
	// the key's shape
	scene("a GET with a key that is too short", [
		issue(),
		openPage({ key: "short" }),
	]),
	scene("a POST with a key that is too short", [
		issue(),
		postPage({ key: "short" }),
	]),
	scene("a key of 44 characters", [
		issue(),
		openPage({ key: `${UNKNOWN_KEY}A` }),
	]),
	scene("a key with characters outside the alphabet", [
		issue(),
		openPage({ key: `${"x".repeat(40)}%2B%2F%3D` }),
	]),
	scene("a GET with no key", [issue(), openPage({}, { path: pagePath({}) })]),
	scene("a POST with no key in the form", [
		issue(),
		postPage({}, { body: "other=1" }),
	]),
	scene("a POST with an empty key", [issue(), postPage({ key: "" })]),
	scene("a POST with the key only in the query string", [
		issue(),
		postPage(
			{},
			{
				path: (prior) => `${pagePath({})}?key=${pageKey({})(prior)}`,
				body: "",
			},
		),
	]),
	// the link the key names
	scene("a GET with an unknown key", [issue(), openPage({ key: UNKNOWN_KEY })]),
	scene("a POST with an unknown key", [
		issue(),
		postPage({ key: UNKNOWN_KEY }),
	]),
	scene("a GET after an hour: the key has expired", [
		issue(),
		openPage({}, { advanceMs: 3_600_001 }),
	]),
	scene("a POST after an hour: the key has expired", [
		issue(),
		postPage({}, { advanceMs: 3_600_001 }),
	]),
	scene("a GET at exactly the hour: the key has expired", [
		issue(),
		openPage({}, { advanceMs: 3_600_000 }),
	]),
	scene("a POST at 59 minutes still works", [
		issue(),
		postPage({}, { advanceMs: 3_540_000 }),
	]),
	scene(
		"an archive key on the signing page",
		[
			{
				handler: archiveLinkRoute,
				as: asVisitor({ ip: IP }),
				path: "/api/agreements/link",
				json: { email: GRACE, turnstileToken: "tok" },
				headers: SAME_ORIGIN,
				dump: { music: LINK_TABLES },
			},
			openPage(),
			postPage(),
		],
		{ ...world({ agreements: "executed" }) },
	),
	// the token in the URL
	scene(
		"another offer's token with the key",
		[
			issue(),
			openPage({ token: OTHER_TOKEN }),
			postPage({ token: OTHER_TOKEN }),
		],
		{ ...world({ extra: secondOffer() }) },
	),
	scene("a token of the wrong shape with a good key", [
		issue(),
		openPage({ token: "short" }),
		postPage({ token: "short" }),
	]),
	// the site origin
	scene("a GET from another host", [
		issue(),
		openPage({}, { origin: "https://www.thesuperhuman.us" }),
	]),
	scene("a POST from another host", [
		issue(),
		postPage(
			{},
			{
				origin: "https://www.thesuperhuman.us",
				headers: formHeaders({ origin: "https://www.thesuperhuman.us" }),
			},
		),
	]),
	scene("a Host header that differs from the site", [
		issue(),
		openPage({}, { headers: { host: "evil.example" } }),
	]),
	scene("a SITE_ORIGIN that is not a URL", [openPage({ key: UNKNOWN_KEY })], {
		env: { SITE_ORIGIN: "not a url" },
	}),
	// bindings
	scene("no D1: a GET", [openPage({ key: UNKNOWN_KEY })], {
		music: { missing: true },
	}),
	scene("no D1: a POST", [postPage({ key: UNKNOWN_KEY })], {
		music: { missing: true },
	}),
	// methods and bodies
	scene("a PUT with a good key in the query", [
		issue(),
		openPage({}, { method: "PUT" }),
	]),
	scene("a HEAD with a good key", [issue(), openPage({}, { method: "HEAD" })]),
	scene("a POST whose body is JSON, not a form: the page throws", [
		issue(),
		postPage(
			{},
			{
				body: undefined,
				json: (prior) => ({ key: pageKey({})(prior) }),
				headers: SAME_ORIGIN,
			},
		),
	]),
	scene("a POST of plain text: the page throws", [
		issue(),
		postPage(
			{},
			{
				body: (prior) => `key=${pageKey({})(prior)}`,
				headers: SAME_ORIGIN,
			},
		),
	]),
	// the owner's moves, which retire the emailed links
	scene("a POST after the owner resends the offer", [
		issue(),
		postPage({}, before("the owner resends the offer", resend)),
	]),
	scene("a POST after the owner revokes the offer link", [
		issue(),
		postPage({}, before("the owner revokes the offer link", revoke)),
	]),
	scene("a POST after the owner withdraws the offer", [
		issue(),
		postPage({}, before("the owner withdraws the offer", withdraw)),
	]),
	// the offer no longer open for signing, with the emailed link left unused (liveSigningGuard, A1)
	unsignable(
		"signing switched off: a GET and a POST",
		"signing is switched off",
		sql("UPDATE software_signing_settings SET software_signing_enabled=0"),
	),
	unsignable("a project started: a GET and a POST", "the project starts", (w) =>
		seed(w.music, startedProject()),
	),
	unsignable(
		"the offer is superseded, the emailed link left unused: a GET and a POST",
		"the offer is superseded",
		sql("UPDATE software_offers SET status='superseded' WHERE id='o-r1'"),
	),
	unsignable(
		"the offer is withdrawn, the emailed link left unused: a GET and a POST",
		"the offer is withdrawn",
		sql("UPDATE software_offers SET status='withdrawn' WHERE id='o-r1'"),
	),
	unsignable(
		"the offer link is revoked, the emailed link left unused: a GET and a POST",
		"the offer link is revoked",
		sql(`UPDATE software_offer_links SET revoked_at='${NOW}'`),
	),
	unsignable(
		"the request is withdrawn, the emailed link left unused: a GET and a POST",
		"the request is withdrawn",
		sql("UPDATE owner_requests SET status='withdrawn' WHERE id='r1'"),
	),
	unsignable(
		"the request is resolved, the emailed link left unused: a GET and a POST",
		"the request is resolved",
		sql("UPDATE owner_requests SET status='resolved' WHERE id='r1'"),
	),
	unsignable(
		"the offer's recipient changes, the emailed link left unused: a GET and a POST",
		"the offer's recipient changes",
		sql(
			"UPDATE software_offers SET recipient_email_snapshot='someone.else@example.test' WHERE id='o-r1'",
		),
	),
	// races between the POST's link read and its batch
	betweenReadAndBatch(
		"another tab consumes the link between the POST's read and its batch",
		"another tab consumed the link",
		`UPDATE software_agreement_links SET used_at='${NOW}'`,
	),
	betweenReadAndBatch(
		"the offer is superseded between the POST's read and its batch",
		"the offer is superseded",
		"UPDATE software_offers SET status='superseded' WHERE id='o-r1'",
	),
	betweenReadAndBatch(
		"signing is switched off between the POST's read and its batch",
		"signing is switched off",
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	betweenReadAndBatch(
		"a project starts between the POST's read and its batch",
		"the project starts",
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')",
	),
	// outages
	scene(
		"outage: the link read on a GET: the page throws",
		[issue(), openPage()],
		{
			failures: [
				{
					on: /SELECT \* FROM software_agreement_links WHERE token_hash=\?/,
					message: "the link read fails",
				},
			],
		},
	),
	scene(
		"outage: the link read on a POST: the page throws",
		[issue(), postPage()],
		{
			failures: [
				{
					on: /SELECT \* FROM software_agreement_links WHERE token_hash=\?/,
					message: "the link read fails",
				},
			],
		},
	),
	// The first match is liveSigningGuard inside the link route's batch; the second is the page's GET.
	scene(
		"outage: the GET's live check: the expired page",
		[issue(), openPage()],
		{
			failures: [
				{
					on: /SELECT CASE WHEN EXISTS\(SELECT 1 FROM software_offers o JOIN software_offer_links/,
					nth: 2,
					message: "the live check fails",
				},
			],
		},
	),
	// The first match is getLinkedOffer in the link route; the second is the page's own read of the offer.
	scene(
		"outage: the offer read on a GET: the page throws",
		[issue(), openPage()],
		{
			failures: [
				{
					on: /SELECT o\.\* FROM software_offers o JOIN software_offer_links/,
					nth: 2,
					message: "the offer read fails",
				},
			],
		},
	),
	scene(
		"outage: the POST's batch (the session insert): the expired page, the link left unused",
		[issue(), postPage(), openPage()],
		{
			failures: [
				{
					on: /INSERT INTO software_agreement_sessions/,
					message: "the session insert fails",
				},
			],
		},
	),
	// The first match is the link route's `link-issued` event; the second is the page's `verified` event.
	scene(
		"outage: the POST's batch (the event insert): the expired page, the link left unused",
		[issue(), postPage(), openPage()],
		{
			failures: [
				{
					on: /INSERT INTO software_agreement_events/,
					nth: 2,
					message: "the event insert fails",
				},
			],
		},
	),
];

defineCorpus("offer-verify-page", pages.page("verify"), cases);
