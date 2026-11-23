import { afterAll } from "vitest";
import { POST as archiveLinkRoute } from "~/pages/api/agreements/link";
import { POST as signingLinkRoute } from "~/pages/api/offer/[token]/link";
import {
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
	type World,
} from "./harness";
import { astroPages } from "./harness/page";
import {
	agreementWorld,
	formHeaders,
	GRACE,
	IP,
	LINK_TABLES,
	mail,
	NOW,
	openPage,
	ORIGIN,
	pageKey,
	pagePath,
	postPage,
	SAME_ORIGIN,
	TOKEN,
	type Opts,
	type PageVisit,
} from "./areas/agreement-access";

// The golden corpus for the archive link's page, src/pages/agreements/verify.astro: the page the emailed link to a
// client's signed agreements opens. A GET shows "Your documents are ready." with a Continue form; the form's POST
// consumes the link, makes a two-hour archive session and redirects to /agreements with the agreement_archive cookie.
// The page is rendered by Astro's container (tests/golden/harness/page.ts), so each step records the page's own status,
// headers, cookies and HTML. A case issues the link through POST /api/agreements/link first, as a client does (the seed
// holds an executed agreement for the email, so the link is mailed), then follows it through the page. Recorded on
// today's code, before the behaviour fixes and the conversion that docs/plans/2026-11-signing-conversion.md plans (B1,
// B2 and B5 change some of these cases; that PR lists them).
//
// Every response branch of the page and of what it calls (completeAgreementLink in src/lib/agreement-access.ts, with no
// token, so purpose "archive", and canonicalAgreementRequest in src/lib/agreement-host.ts), and the cases that reach
// it. The archive link has no live check: a GET reads the link and answers 200, and the POST's batch holds no A1 (only
// the signing page reads the offer).
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
//   401, the expired page             no unused, unexpired archive link for the key's hash: "a GET with an unknown
//                                     key", "a POST with an unknown key", "a signing key on the archive page", "a GET
//                                     after an hour: the key has expired", "a POST after an hour ...", "a GET at
//                                     exactly the hour ...", the second POST and the GET of "a POST twice ...", the
//                                     first POST of "a newer link makes the older one useless"
//   the page throws: rejected         the link read fails: "outage: the link read on a GET: the page throws", "outage:
//                                     the link read on a POST: the page throws"
//   200, "Your documents are ready."  "a GET with a good key shows the documents are ready", "a GET, then the page's
// Continue form posts the key", "a GET leaves the link unused, so a second GET still shows it ready", the GET after
// each of the two batch outages (the link left unused)
//   401, the expired page             a method other than GET or POST, after the link read: "a PUT with a good key in
//                                     the query", "a HEAD with a good key"
//   401, the expired page             POST: the batch refuses (A5) or fails: "another tab consumes the link between the
//                                     POST's read and its batch", "outage: the POST's batch (the session insert): the
//                                     expired page, the link left unused", "outage: the POST's batch (the event insert)
//                                     ..."
//   303 to /agreements                POST: the link used, the `verified` event, the session, the agreement_archive
//                                     cookie (Secure over https): "a POST with a good key consumes the link and
//                                     redirects to the archive with its cookie", the POST of "a GET, then the page's
//                                     Continue form posts the key", the first POST of "a POST twice ...", "a link
//                                     consumed over http sets the cookie without Secure", "a POST at 59 minutes still
//                                     works", "a multipart form with a good key", "a POST with another site's Origin
//                                     header still consumes the link" (the page checks no Origin), "the archive key
//                                     still opens after the agreements end" (the redeem reads no agreement), the second
//                                     POST of "a newer link makes the older one useless"
//
// The ready and expired pages keep completeAgreementLink's status and add `Referrer-Policy: no-referrer` and
// `Cache-Control: no-store`; the expired page's "Send a new link" goes to /agreements. The 303 is
// completeAgreementLink's own Response, answered as it is.

const pages = await astroPages({
	verify: "src/pages/agreements/verify.astro",
});

afterAll(pages.remove);

/** The client asks for the archive link for their email: the email holds the key the page is opened with. */
const issue = (extra: Partial<Step> = {}): Step => ({
	handler: archiveLinkRoute,
	as: asVisitor({ ip: IP }),
	path: "/api/agreements/link",
	json: { email: GRACE, turnstileToken: "tok" },
	headers: SAME_ORIGIN,
	dump: { music: LINK_TABLES },
	...extra,
});

/** The executed agreements of a sent offer for the client's email, signing on, no session yet. */
const world = (opts: Opts = {}) =>
	agreementWorld({ agreements: "executed", session: null, ...opts });

const scene = (
	name: string,
	steps: readonly Step[],
	over: Partial<Case> = {},
): Case => ({ name, ...world(), fetches: mail, steps, ...over });

/** The archive page; every step of this corpus opens or posts it. */
const ARCHIVE: PageVisit = { archive: true };

const open = (
	visit: Omit<PageVisit, "archive"> = {},
	extra: Partial<Step> = {},
) => openPage({ ...ARCHIVE, ...visit }, extra);

const post = (
	visit: Omit<PageVisit, "archive"> = {},
	extra: Partial<Step> = {},
) => postPage({ ...ARCHIVE, ...visit }, extra);

/** A key of the right shape that no link was issued for. */
const UNKNOWN_KEY = "x".repeat(43);

const before = (label: string, run: (w: World) => void) => ({
	before: { label, run },
});

const BOUNDARY = "golden-form-boundary";

const cases: Case[] = [
	// the page with a good key
	scene("a GET with a good key shows the documents are ready", [
		issue(),
		open(),
	]),
	scene(
		"a POST with a good key consumes the link and redirects to the archive with its cookie",
		[issue(), post()],
	),
	scene("a GET, then the page's Continue form posts the key", [
		issue(),
		open(),
		post(),
	]),
	scene("a GET leaves the link unused, so a second GET still shows it ready", [
		issue(),
		open(),
		open(),
	]),
	scene("a POST twice: the second finds the link used, and so does a GET", [
		issue(),
		post(),
		post(),
		open(),
	]),
	scene(
		"a link consumed over http sets the cookie without Secure",
		[
			issue({
				origin: "http://localhost:4321",
				headers: { origin: "http://localhost:4321" },
			}),
			post(
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
		post({ mail: 0 }),
		post({ mail: 1 }),
	]),
	scene("a POST with another site's Origin header still consumes the link", [
		issue(),
		post({}, { headers: formHeaders({ origin: "https://evil.example" }) }),
	]),
	scene("a multipart form with a good key", [
		issue(),
		post(
			{},
			{
				body: (prior) =>
					`--${BOUNDARY}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${pageKey(ARCHIVE)(prior)}\r\n--${BOUNDARY}--\r\n`,
				headers: {
					origin: ORIGIN,
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
			},
		),
	]),
	scene("the archive key still opens after the agreements end", [
		issue(),
		post(
			{},
			before("the owner ends the agreements", (w) =>
				w.music.exec(
					`UPDATE software_agreements SET ended_at='${NOW}' WHERE request_id='r1'`,
				),
			),
		),
	]),
	// the key's shape
	scene("a GET with a key that is too short", [
		issue(),
		open({ key: "short" }),
	]),
	scene("a POST with a key that is too short", [
		issue(),
		post({ key: "short" }),
	]),
	scene("a key of 44 characters", [issue(), open({ key: `${UNKNOWN_KEY}A` })]),
	scene("a key with characters outside the alphabet", [
		issue(),
		open({ key: `${"x".repeat(40)}%2B%2F%3D` }),
	]),
	scene("a GET with no key", [issue(), open({}, { path: pagePath(ARCHIVE) })]),
	scene("a POST with no key in the form", [
		issue(),
		post({}, { body: "other=1" }),
	]),
	scene("a POST with an empty key", [issue(), post({ key: "" })]),
	scene("a POST with the key only in the query string", [
		issue(),
		post(
			{},
			{
				path: (prior) => `${pagePath(ARCHIVE)}?key=${pageKey(ARCHIVE)(prior)}`,
				body: "",
			},
		),
	]),
	// the link the key names
	scene("a GET with an unknown key", [issue(), open({ key: UNKNOWN_KEY })]),
	scene("a POST with an unknown key", [issue(), post({ key: UNKNOWN_KEY })]),
	scene("a GET after an hour: the key has expired", [
		issue(),
		open({}, { advanceMs: 3_600_001 }),
	]),
	scene("a POST after an hour: the key has expired", [
		issue(),
		post({}, { advanceMs: 3_600_001 }),
	]),
	scene("a GET at exactly the hour: the key has expired", [
		issue(),
		open({}, { advanceMs: 3_600_000 }),
	]),
	scene("a POST at 59 minutes still works", [
		issue(),
		post({}, { advanceMs: 3_540_000 }),
	]),
	scene(
		"a signing key on the archive page",
		[
			{
				handler: signingLinkRoute,
				as: asVisitor({ ip: IP }),
				path: `/api/offer/${TOKEN}/link`,
				params: { token: TOKEN },
				json: { turnstileToken: "tok" },
				headers: SAME_ORIGIN,
				dump: { music: LINK_TABLES },
			},
			open(),
			post(),
		],
		{ ...agreementWorld({ session: null }) },
	),
	// the site origin
	scene("a GET from another host", [
		issue(),
		open({}, { origin: "https://www.thesuperhuman.us" }),
	]),
	scene("a POST from another host", [
		issue(),
		post(
			{},
			{
				origin: "https://www.thesuperhuman.us",
				headers: formHeaders({ origin: "https://www.thesuperhuman.us" }),
			},
		),
	]),
	scene("a Host header that differs from the site", [
		issue(),
		open({}, { headers: { host: "evil.example" } }),
	]),
	scene("a SITE_ORIGIN that is not a URL", [open({ key: UNKNOWN_KEY })], {
		env: { SITE_ORIGIN: "not a url" },
	}),
	// bindings
	scene("no D1: a GET", [open({ key: UNKNOWN_KEY })], {
		music: { missing: true },
	}),
	scene("no D1: a POST", [post({ key: UNKNOWN_KEY })], {
		music: { missing: true },
	}),
	// methods and bodies
	scene("a PUT with a good key in the query", [
		issue(),
		open({}, { method: "PUT" }),
	]),
	scene("a HEAD with a good key", [issue(), open({}, { method: "HEAD" })]),
	scene("a POST whose body is JSON, not a form: the page throws", [
		issue(),
		post(
			{},
			{
				body: undefined,
				json: (prior) => ({ key: pageKey(ARCHIVE)(prior) }),
				headers: SAME_ORIGIN,
			},
		),
	]),
	scene("a POST of plain text: the page throws", [
		issue(),
		post(
			{},
			{
				body: (prior) => `key=${pageKey(ARCHIVE)(prior)}`,
				headers: SAME_ORIGIN,
			},
		),
	]),
	// a race between the POST's link read and its batch
	scene(
		"another tab consumes the link between the POST's read and its batch",
		[issue(), post()],
		{
			interleave: [
				{
					on: /UPDATE software_agreement_links SET used_at=\? WHERE token_hash=\?/,
					label: "another tab consumed the link",
					run: (sqlite) =>
						sqlite.exec(`UPDATE software_agreement_links SET used_at='${NOW}'`),
				},
			],
		},
	),
	// outages
	scene("outage: the link read on a GET: the page throws", [issue(), open()], {
		failures: [
			{
				on: /SELECT \* FROM software_agreement_links WHERE token_hash=\?/,
				message: "the link read fails",
			},
		],
	}),
	scene("outage: the link read on a POST: the page throws", [issue(), post()], {
		failures: [
			{
				on: /SELECT \* FROM software_agreement_links WHERE token_hash=\?/,
				message: "the link read fails",
			},
		],
	}),
	scene(
		"outage: the POST's batch (the session insert): the expired page, the link left unused",
		[issue(), post(), open()],
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
		[issue(), post(), open()],
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

defineCorpus("agreements-verify-page", pages.page("verify"), cases);
