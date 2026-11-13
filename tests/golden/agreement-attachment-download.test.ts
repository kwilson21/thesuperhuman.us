import { GET } from "~/pages/api/agreements/attachments/[id]";
import {
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type Step,
} from "./harness";
import {
	ARCHIVE,
	agreementSessionRow,
	archiveCookie,
	attachmentKey,
	attachmentRow,
	cookies,
	detailsJson,
	downloadSeed,
	EARLIER,
	GRACE,
	linkRow,
	merge,
	OTHER_TOKEN,
	PDF,
	PDF_SHA,
	signingCookie,
	sql,
	studioCookie,
} from "./areas/agreement-admin";

// The golden corpus for GET /api/agreements/attachments/[id]: a client downloads a PDF the owner attached to the offer
// they are signing. Only the signing session counts (not the archive or studio session), and the offer's details must
// pin the attachment's key and digest.
//
// Every response branch of the handler (src/pages/api/agreements/attachments/[id].ts), and its cases:
//
//   503 "Unavailable" (no agreement headers)         no database
//   401 "Verify email first." + agreement headers    no cookie, an archive cookie, a studio cookie, an expired, revoked or
//                                                    unknown signing session, an offer no longer sent, a revoked offer link, a
//                                                    withdrawn or resolved request, a snapshot email that differs, a malformed cookie
//   404 "Not found"                                  unknown attachment, an attachment of another request, details that do not pin
//                                                    it (null, other key, other digest, other attachments), another offer's session
//   503 "Unavailable" + agreement headers            object missing
//   503 the integrity sentence (curly apostrophes)   stored bytes differ from the row's digest
//   200 application/pdf, attachment agreement-attachment.pdf   the signing session, two attachments, an unusual stored filename
//                                                    (never used in the header), Range ignored, twice in a row
//   rejected                                         details that are not JSON (the SQL errors), a database outage, the bucket read
//                                                    throws, no bucket bound

const KEY = attachmentKey("att1");

const get = (cookie: string | undefined, extra: Partial<Step> = {}): Step => ({
	as: asVisitor(),
	method: "GET",
	path: "/api/agreements/attachments/att1",
	params: { id: "att1" },
	headers: cookie === undefined ? {} : { cookie },
	...extra,
});

const attached: Seed = {
	software_agreement_attachments: [
		attachmentRow("att1", "r1", { created_at: EARLIER }),
	],
};

const scene = (
	name: string,
	cookie: string | undefined,
	setup: string[] = [],
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: {
		seed: merge(
			downloadSeed({ offer: { agreement_details_json: detailsJson(KEY) } }),
			attached,
		),
	},
	r2: { seed: { [KEY]: { body: PDF } } },
	setup: setup.length ? sql(...setup) : undefined,
	steps: [get(cookie, step)],
	...extra,
});

const signing = signingCookie();

const PAST = "2026-11-13T11:30:00.000Z";

/** A second request, offer and signing session, so a session of another offer can ask for this attachment. */
const second: Seed = {
	owner_requests: [
		rows.softwareRequest("r2", { email: GRACE, status: "reviewed" }),
	],
	software_offers: [
		rows.softwareOffer("o2", "r2", {
			status: "sent",
			recipient_email_snapshot: GRACE,
		}),
	],
	software_offer_links: [rows.offerLink("r2")],
	software_agreement_links: [
		linkRow("l-signing2", "agreement", {
			offer_id: "o2",
			link_hash: "hash-r2",
		}),
	],
	software_agreement_sessions: [
		agreementSessionRow(OTHER_TOKEN, "agreement", {
			offer_id: "o2",
			link_hash: "hash-r2",
			link_id: "l-signing2",
		}),
	],
};

const cases: Case[] = [
	scene("the signing session downloads the attachment", signing),
	scene(
		"a Range header is ignored",
		signing,
		[],
		{},
		{ headers: { cookie: signing, range: "bytes=0-9" } },
	),
	scene("two downloads in a row", signing, [], {
		steps: [get(signing), get(signing, { advanceMs: 1000 })],
	}),
	scene("an unusual stored filename never reaches the header", signing, [
		`UPDATE software_agreement_attachments SET filename='a"b\\n"cé\u{1F600}.pdf' WHERE id='att1'`,
	]),
	scene(
		"the offer pins two attachments and the second is asked for",
		signing,
		[],
		{
			music: {
				seed: merge(
					downloadSeed({
						offer: {
							agreement_details_json: JSON.stringify({
								attachments: [
									{ key: KEY, sha256: PDF_SHA },
									{ key: attachmentKey("att2"), sha256: PDF_SHA },
								],
							}),
						},
					}),
					attached,
					{
						software_agreement_attachments: [
							attachmentRow("att2", "r1", { created_at: EARLIER }),
						],
					},
				),
			},
			r2: {
				seed: { [KEY]: { body: PDF }, [attachmentKey("att2")]: { body: PDF } },
			},
		},
		{ path: "/api/agreements/attachments/att2", params: { id: "att2" } },
	),
	scene("no database is bound", signing, [], { music: { missing: true } }),
	scene("no cookie", undefined),
	scene("an archive cookie is not a signing session", archiveCookie(ARCHIVE)),
	scene("a studio cookie is not a signing session", studioCookie()),
	scene(
		"an archive session in the signing cookie",
		`agreement_session=${ARCHIVE.value}`,
	),
	scene("an unknown signing token", `agreement_session=${"R".repeat(43)}`),
	scene(
		"a signing cookie of 42 characters",
		`agreement_session=${"Q".repeat(42)}`,
	),
	scene("an expired signing session", signing, [
		`UPDATE software_agreement_sessions SET expires_at='${PAST}' WHERE purpose='agreement'`,
	]),
	scene("a revoked signing session", signing, [
		`UPDATE software_agreement_sessions SET revoked_at='${PAST}' WHERE purpose='agreement'`,
	]),
	scene("an offer that is no longer sent", signing, [
		"UPDATE software_offers SET status='superseded' WHERE id='o-r1'",
	]),
	scene("an offer link that was revoked", signing, [
		`UPDATE software_offer_links SET revoked_at='${PAST}' WHERE request_id='r1'`,
	]),
	scene("a withdrawn request", signing, [
		"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
	]),
	scene("a resolved request", signing, [
		"UPDATE owner_requests SET status='resolved' WHERE id='r1'",
	]),
	scene("a snapshot email that differs", signing, [
		"UPDATE software_offers SET recipient_email_snapshot='ada@example.test' WHERE id='o-r1'",
	]),
	scene(
		"an unknown attachment id",
		signing,
		[],
		{},
		{ path: "/api/agreements/attachments/nope", params: { id: "nope" } },
	),
	scene("an empty attachment id", signing, [], {}, { params: { id: "" } }),
	scene(
		"an attachment id that looks like SQL",
		signing,
		[],
		{},
		{ params: { id: "att1' OR '1'='1" } },
	),
	scene(
		"an attachment of another request",
		signing,
		[
			"UPDATE software_agreement_attachments SET request_id='r2' WHERE id='att1'",
		],
		{
			music: {
				seed: merge(
					downloadSeed({ offer: { agreement_details_json: detailsJson(KEY) } }),
					second,
					attached,
				),
			},
		},
	),
	scene(
		"a session of another offer asks for this attachment",
		cookies(signingCookie(OTHER_TOKEN)).cookie,
		[],
		{
			music: {
				seed: merge(
					downloadSeed({ offer: { agreement_details_json: detailsJson(KEY) } }),
					second,
					attached,
				),
			},
		},
	),
	scene("the offer has no details", signing, [
		"UPDATE software_offers SET agreement_details_json=NULL WHERE id='o-r1'",
	]),
	scene("the offer details pin another key", signing, [
		`UPDATE software_offers SET agreement_details_json='${detailsJson(attachmentKey("other"))}' WHERE id='o-r1'`,
	]),
	scene("the offer details pin another digest", signing, [
		`UPDATE software_offers SET agreement_details_json='${JSON.stringify({ attachments: [{ key: KEY, sha256: "f".repeat(64) }] })}' WHERE id='o-r1'`,
	]),
	scene("the offer details have an empty attachment list", signing, [
		`UPDATE software_offers SET agreement_details_json='{"attachments":[]}' WHERE id='o-r1'`,
	]),
	scene("the offer details are not JSON", signing, [
		"UPDATE software_offers SET agreement_details_json='{nope' WHERE id='o-r1'",
	]),
	scene("the stored object is missing", signing, [], { r2: { seed: {} } }),
	scene("the stored bytes do not match the digest", signing, [], {
		r2: { seed: { [KEY]: { body: "tampered" } } },
	}),
	scene("the row digest differs from the pinned digest", signing, [
		"UPDATE software_agreement_attachments SET sha256='" +
			"e".repeat(64) +
			"' WHERE id='att1'",
	]),
	scene("no bucket is bound", signing, [], { r2: { missing: true } }),
	scene("the bucket read fails", signing, [], {
		r2: { seed: { [KEY]: { body: PDF } }, fails: ["get"] },
	}),
	scene("the session lookup fails", signing, [], {
		failures: [{ on: /FROM software_agreement_sessions/, message: "d1 down" }],
	}),
	scene("the attachment query fails", signing, [], {
		failures: [
			{
				on: /FROM software_agreement_attachments a JOIN software_offers o/,
				message: "d1 down",
			},
		],
	}),
	scene("the live check fails", signing, [], {
		failures: [
			{
				on: /FROM software_offers o JOIN software_offer_links/,
				message: "d1 down",
			},
		],
	}),
	scene("the session expires between two downloads", signing, [], {
		steps: [get(signing), get(signing, { advanceMs: 3_600_001 })],
	}),
];

void PDF_SHA;

defineCorpus("agreement-attachment-download", GET, cases);
