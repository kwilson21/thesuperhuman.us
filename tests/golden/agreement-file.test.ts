import { GET } from "~/pages/api/agreements/[id]/file";
import {
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type Step,
} from "./harness";
import {
	agreementSessionRow,
	ARCHIVE,
	archiveCookie,
	cookies,
	downloadSeed,
	GRACE,
	linkRow,
	merge,
	OTHER_TOKEN,
	PDF,
	signedBucket,
	SIGNED_KEY,
	SIGNING,
	signingCookie,
	sql,
	STUDIO,
	studioCookie,
} from "./areas/agreement-admin";

// The golden corpus for GET /api/agreements/[id]/file: a client downloads the executed agreement PDF. Access is the
// archive session, the signing session of the same offer (or of an offer that reuses the MSA), or a studio session of
// the client whose software project holds the agreement (or an SOW linking to it).
//
// Every response branch of the handler and agreementDownload (src/lib/agreement-download.ts), and its cases:
//
//   503 "Unavailable" + agreement headers        no database, no bucket, neither
//   401 "Verify your agreement email first."     no cookie (the agreement is not looked up), an id that does not exist or is not
//                                                open to a visitor (unknown, empty, SQL-looking, very long or unicode id; status
//                                                review, client_signed or abandoned; archive_closed_at set), so ids cannot be told
//                                                apart, and each reason a session does not count, each alone:
//     archive session     expired (at the instant and before), revoked, a signing session in the archive cookie, another client's
//                         email, a recipient email seeded in another case by hand (the app stores it lower-cased), a malformed cookie (42 characters, trailing text), an unknown token
//     signing session     expired, revoked, offer not sent, offer link revoked, request withdrawn, request resolved, snapshot email
//                         differs, an offer that does not reuse this MSA
//     studio session      forged, expired, revoked, another client's, project revoked, content deleted, request withdrawn, the
//                         project holds another agreement, malformed cookie
//   409 "Signed by both parties. Copy preparation needs attention."   no artifact row, pending, rendering, failed, pdf_key empty
//   503 "Signed copy unavailable. Contact Kazon."                      object missing
//   503 "Signed copy failed its integrity check. Contact Kazon."       bytes differ from the digest, digest empty
//   200 application/pdf, attachment signed-agreement.pdf, nosniff       archive, signing, reused MSA, studio, studio through an SOW,
//                         several cookies, a wrong cookie beside a right one, Range ignored, a terminated agreement
//   rejected            the agreement query, the artifact query, a session query, or the bucket read throws (no catch in the route)

const dl = (cookie: string | undefined, extra: Partial<Step> = {}): Step => ({
	as: asVisitor(),
	method: "GET",
	path: "/api/agreements/a1/file",
	params: { id: "a1" },
	headers: cookie === undefined ? {} : { cookie },
	...extra,
});

const base = (seed: Seed = {}, extra: Partial<Case> = {}): Partial<Case> => ({
	music: { seed: merge(downloadSeed(), seed) },
	r2: { seed: signedBucket() },
	...extra,
});

const ok = (
	name: string,
	cookie: string | undefined,
	setup: string[] = [],
	extra: Partial<Case> = {},
): Case => ({
	name,
	...base({}, extra),
	setup: setup.length ? sql(...setup) : undefined,
	steps: [dl(cookie)],
});

const archive = archiveCookie();
const NOW = "2026-11-13T12:00:00.000Z";
const PAST = "2026-11-13T11:30:00.000Z";

/** A second request and offer with its own signing session, for the reused-MSA cases. */
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

const secondCookie = signingCookie(OTHER_TOKEN);

const cases: Case[] = [
	// allowed
	ok("an archive session downloads the signed copy", archive),
	ok("the signing session of the same offer downloads it", signingCookie()),
	ok("a studio session of the project's client downloads it", studioCookie()),
	ok(
		"a signing session of an offer that reuses the MSA downloads it",
		secondCookie,
		["UPDATE software_offers SET reused_msa_id='a1' WHERE id='o2'"],
		{ music: { seed: merge(downloadSeed(), second) } },
	),
	ok(
		"a signing session of an offer that does not reuse the MSA is refused",
		secondCookie,
		[],
		{ music: { seed: merge(downloadSeed(), second) } },
	),
	{
		name: "a studio session whose project holds an SOW that links to the MSA downloads it",
		music: {
			seed: merge(downloadSeed({ project: { agreement_id: "s1" } }), {
				software_agreements: [
					rows.agreement("s1", "r1", "o-r1", {
						kind: "sow",
						template_id: "template-sow",
						sow_number: "SOW-1",
						status: "executed",
						msa_id: "a1",
					}),
				],
			}),
		},
		r2: { seed: signedBucket() },
		steps: [dl(studioCookie())],
	},
	ok(
		"the studio session works with an archive cookie of another client",
		cookies(archiveCookie(), studioCookie()).cookie,
		[
			"UPDATE software_agreement_sessions SET recipient_email='ada@example.test' WHERE purpose='archive'",
		],
	),
	ok(
		"a wrong archive cookie beside a right signing cookie",
		cookies(
			archiveCookie({ value: "R".repeat(43), hash: ARCHIVE.hash }),
			signingCookie(),
		).cookie,
	),
	ok(
		"a right archive cookie beside an unknown signing cookie",
		cookies(
			archive,
			signingCookie({ value: "R".repeat(43), hash: SIGNING.hash }),
		).cookie,
	),
	ok(
		"all three sessions together",
		cookies(archive, signingCookie(), studioCookie()).cookie,
	),
	{
		name: "a Range header is ignored and the whole file is sent",
		...base(),
		steps: [dl(archive, { headers: { cookie: archive, range: "bytes=0-9" } })],
	},
	ok("a terminated agreement is still downloadable", archive, [
		"UPDATE software_agreements SET terminated_at='2026-11-01T00:00:00.000Z' WHERE id='a1'",
	]),

	// the agreement itself
	{
		name: "no database is bound",
		...base(),
		music: { missing: true },
		steps: [dl(archive)],
	},
	{
		name: "no bucket is bound",
		...base(),
		r2: { missing: true },
		steps: [dl(archive)],
	},
	{
		name: "neither database nor bucket",
		...base(),
		music: { missing: true },
		r2: { missing: true },
		steps: [dl(archive)],
	},
	{
		name: "an unknown id with no cookie is 401, as for a known id",
		...base(),
		steps: [
			dl(undefined, {
				path: "/api/agreements/zzz/file",
				params: { id: "zzz" },
			}),
		],
	},
	{
		name: "an unknown id with a valid session is 401, as for an id that is not theirs",
		...base(),
		steps: [
			dl(archive, { path: "/api/agreements/zzz/file", params: { id: "zzz" } }),
		],
	},
	{
		name: "a known id with no cookie is 401, the same as an unknown id",
		...base(),
		steps: [dl(undefined)],
	},
	{
		name: "an empty id",
		...base(),
		steps: [dl(archive, { params: { id: "" } })],
	},
	{
		name: "an id that looks like SQL",
		...base(),
		steps: [dl(archive, { params: { id: "a1' OR '1'='1" } })],
	},
	{
		name: "a very long id",
		...base(),
		steps: [dl(archive, { params: { id: "a".repeat(2000) } })],
	},
	{
		name: "a unicode id",
		...base(),
		steps: [dl(archive, { params: { id: "ä😀" } })],
	},
	{
		name: "an upper-case id",
		...base(),
		steps: [dl(archive, { params: { id: "A1" } })],
	},
	ok("an agreement in review is refused as an unknown id", archive, [
		"UPDATE software_agreements SET status='review' WHERE id='a1'",
	]),
	ok("a client-signed agreement is refused as an unknown id", archive, [
		"UPDATE software_agreements SET status='client_signed' WHERE id='a1'",
	]),
	ok("an abandoned agreement is refused as an unknown id", archive, [
		"UPDATE software_agreements SET status='abandoned' WHERE id='a1'",
	]),
	ok("a retention-closed agreement is refused as an unknown id", archive, [
		"UPDATE software_agreements SET archive_closed_at='2026-11-12T00:00:00.000Z' WHERE id='a1'",
	]),

	// archive session faults
	ok("an archive session that expires at this instant", archive, [
		`UPDATE software_agreement_sessions SET expires_at='${NOW}' WHERE purpose='archive'`,
	]),
	ok("an expired archive session", archive, [
		`UPDATE software_agreement_sessions SET expires_at='${PAST}' WHERE purpose='archive'`,
	]),
	ok("a revoked archive session", archive, [
		`UPDATE software_agreement_sessions SET revoked_at='${PAST}' WHERE purpose='archive'`,
	]),
	ok(
		"a signing session presented as the archive cookie",
		`agreement_archive=${SIGNING.value}`,
	),
	ok("another client's archive session", archive, [
		"UPDATE software_agreement_sessions SET recipient_email='ada@example.test' WHERE purpose='archive'",
	]),
	ok(
		"an archive session whose recipient email is seeded in another case by hand (cannot arise through the app)",
		archive,
		[
			"UPDATE software_agreement_sessions SET recipient_email='Grace@Example.test' WHERE purpose='archive'",
		],
	),
	ok(
		"an archive cookie of 42 characters",
		`agreement_archive=${ARCHIVE.value.slice(1)}`,
	),
	ok(
		"an archive cookie with trailing text",
		`agreement_archive=${ARCHIVE.value}x`,
	),
	ok("an unknown archive token", `agreement_archive=${"R".repeat(43)}`),
	ok("the cookie name in upper case", `AGREEMENT_ARCHIVE=${ARCHIVE.value}`),

	// signing session faults
	ok("an expired signing session", signingCookie(), [
		`UPDATE software_agreement_sessions SET expires_at='${PAST}' WHERE purpose='agreement'`,
	]),
	ok("a revoked signing session", signingCookie(), [
		`UPDATE software_agreement_sessions SET revoked_at='${PAST}' WHERE purpose='agreement'`,
	]),
	ok("a signing session of an offer that is no longer sent", signingCookie(), [
		"UPDATE software_offers SET status='superseded' WHERE id='o-r1'",
	]),
	ok("a signing session whose offer link was revoked", signingCookie(), [
		`UPDATE software_offer_links SET revoked_at='${PAST}' WHERE request_id='r1'`,
	]),
	ok("a signing session of a withdrawn request", signingCookie(), [
		"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
	]),
	ok("a signing session of a resolved request", signingCookie(), [
		"UPDATE owner_requests SET status='resolved' WHERE id='r1'",
	]),
	ok("a signing session whose offer snapshot email differs", signingCookie(), [
		"UPDATE software_offers SET recipient_email_snapshot='ada@example.test' WHERE id='o-r1'",
	]),
	ok("a signing session of another recipient", signingCookie(), [
		"UPDATE software_agreement_sessions SET recipient_email='ada@example.test' WHERE purpose='agreement'",
	]),

	// studio session faults
	ok("a forged studio cookie", studioCookie("f".repeat(72))),
	ok("an expired studio session", studioCookie(), [
		`UPDATE audio_client_sessions SET expires_at='${PAST}'`,
	]),
	ok("a revoked studio session", studioCookie(), [
		`UPDATE audio_client_sessions SET revoked_at='${PAST}'`,
	]),
	ok("another client's studio session", studioCookie(), [
		"UPDATE audio_client_sessions SET email='ada@example.test'",
	]),
	ok("a studio session of a client whose project was revoked", studioCookie(), [
		`UPDATE software_projects SET revoked_at='${PAST}' WHERE request_id='r1'`,
	]),
	ok(
		"a studio session of a client whose project content was deleted",
		studioCookie(),
		[
			`UPDATE software_projects SET content_deleted_at='${PAST}' WHERE request_id='r1'`,
		],
	),
	ok("a studio session of a withdrawn request", studioCookie(), [
		"UPDATE owner_requests SET status='withdrawn' WHERE id='r1'",
	]),
	ok("a studio session whose project holds no agreement", studioCookie(), [
		"UPDATE software_projects SET agreement_id=NULL WHERE request_id='r1'",
	]),
	ok("a studio cookie of 71 characters", studioCookie(STUDIO.slice(1))),

	// artifact
	{
		name: "no artifact row",
		music: { seed: downloadSeed({ artifact: null }) },
		r2: { seed: signedBucket() },
		steps: [dl(archive)],
	},
	ok("an artifact still pending", archive, [
		"UPDATE software_agreement_artifacts SET status='pending'",
	]),
	ok("an artifact rendering", archive, [
		"UPDATE software_agreement_artifacts SET status='rendering'",
	]),
	ok("an artifact that failed", archive, [
		"UPDATE software_agreement_artifacts SET status='failed', error_code='render'",
	]),
	ok("an artifact with no pdf_key", archive, [
		"UPDATE software_agreement_artifacts SET pdf_key=NULL",
	]),
	{
		name: "the stored object is missing",
		...base(),
		r2: { seed: {} },
		steps: [dl(archive)],
	},
	{
		name: "the stored bytes do not match the digest",
		...base(),
		r2: {
			seed: { [SIGNED_KEY]: { body: `${new TextDecoder().decode(PDF)}x` } },
		},
		steps: [dl(archive)],
	},
	ok("an artifact with no digest", archive, [
		"UPDATE software_agreement_artifacts SET pdf_sha256=NULL",
	]),
	ok("an artifact with an empty digest", archive, [
		"UPDATE software_agreement_artifacts SET pdf_sha256=''",
	]),

	// outages
	{
		name: "the agreement query fails",
		...base(),
		failures: [
			{
				on: /FROM software_agreements a JOIN software_agreement_clients/,
				message: "d1 down",
			},
		],
		steps: [dl(archive)],
	},
	{
		name: "the session lookup fails",
		...base(),
		failures: [{ on: /FROM software_agreement_sessions/, message: "d1 down" }],
		steps: [dl(archive)],
	},
	{
		name: "the artifact query fails",
		...base(),
		failures: [{ on: /FROM software_agreement_artifacts/, message: "d1 down" }],
		steps: [dl(archive)],
	},
	{
		name: "the bucket read fails",
		...base(),
		r2: { seed: signedBucket(), fails: ["get"] },
		steps: [dl(archive)],
	},
	{
		name: "the studio session lookup fails",
		...base(),
		failures: [{ on: /FROM audio_client_sessions/, message: "d1 down" }],
		steps: [dl(studioCookie())],
	},
	{
		name: "the signing live check fails",
		...base(),
		failures: [
			{
				on: /FROM software_offers o JOIN software_offer_links/,
				message: "d1 down",
			},
		],
		steps: [dl(signingCookie())],
	},
	{
		name: "two downloads in a row read the bucket twice",
		...base(),
		steps: [dl(archive), dl(archive, { advanceMs: 1000 })],
	},
	{
		name: "a session that expires between two downloads",
		...base(),
		steps: [dl(archive), dl(archive, { advanceMs: 3_600_001 })],
	},
];

defineCorpus("agreement-file", GET, cases);
