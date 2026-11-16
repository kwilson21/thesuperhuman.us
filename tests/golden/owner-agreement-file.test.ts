import { GET } from "~/pages/api/owner/agreements/[id]/file";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Step,
} from "./harness";
import {
	ARCHIVE,
	archiveCookie,
	downloadSeed,
	PDF,
	signedBucket,
	SIGNED_KEY,
	sql,
	STUDIO,
	studioCookie,
} from "./areas/agreement-admin";

// The golden corpus for GET /api/owner/agreements/[id]/file: the owner downloads an executed agreement PDF. The owner
// needs no client session (agreementDownload is called with owner = true), but the same agreement, artifact and bucket
// checks apply.
//
// Every response branch of the handler and agreementDownload (src/lib/agreement-download.ts), and its cases:
//
//   403 "Owner access required." (no agreement headers)   a visitor, a visitor holding a valid archive cookie, a signing cookie,
//                                                          a signed-in studio cookie
//   503 "Unavailable" + agreement headers                  no database, no bucket, neither
//   404 "Not found"                                        unknown id, empty id, SQL-looking, long and unicode ids; review,
//                                                          client_signed, abandoned; archive_closed_at set (retention-closed)
//   409 "Signed by both parties..."                        no artifact, pending, rendering, failed, no pdf_key
//   503 "Signed copy unavailable..."                       object missing
//   503 "Signed copy failed its integrity check..."        bytes differ, digest null or empty
//   200 application/pdf, attachment signed-agreement.pdf   the owner with no cookie, with wrong cookies, a terminated agreement,
//                                                          Range ignored, twice in a row, an agreement of an unknown client email
//   rejected                                               the agreement query, the artifact query, or the bucket read throws

const get = (extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	method: "GET",
	path: "/api/owner/agreements/a1/file",
	params: { id: "a1" },
	...extra,
});

const scene = (
	name: string,
	setup: string[] = [],
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: { seed: downloadSeed() },
	r2: { seed: signedBucket() },
	setup: setup.length ? sql(...setup) : undefined,
	steps: [get(step)],
	...extra,
});

const cases: Case[] = [
	scene("the owner downloads the signed copy"),
	scene(
		"the owner with a wrong cookie still downloads it",
		[],
		{},
		{ headers: { cookie: "agreement_archive=nope" } },
	),
	scene("a visitor is refused", [], {}, { as: asVisitor() }),
	scene(
		"a visitor with a valid archive cookie is refused",
		[],
		{},
		{ as: asVisitor(), headers: { cookie: archiveCookie(ARCHIVE) } },
	),
	scene(
		"a signed-in studio cookie is refused",
		[],
		{},
		{ as: asClientCookie(STUDIO) },
	),
	scene(
		"a visitor with a studio cookie header is refused",
		[],
		{},
		{ as: asVisitor(), headers: { cookie: studioCookie() } },
	),
	scene("no database is bound", [], { music: { missing: true } }),
	scene("no bucket is bound", [], { r2: { missing: true } }),
	scene("neither database nor bucket", [], {
		music: { missing: true },
		r2: { missing: true },
	}),
	scene(
		"an unknown id",
		[],
		{},
		{ path: "/api/owner/agreements/zzz/file", params: { id: "zzz" } },
	),
	scene("an empty id", [], {}, { params: { id: "" } }),
	scene(
		"an id that looks like SQL",
		[],
		{},
		{ params: { id: "a1' OR '1'='1" } },
	),
	scene("a very long id", [], {}, { params: { id: "a".repeat(2000) } }),
	scene("a unicode id", [], {}, { params: { id: "ä😀" } }),
	scene("an agreement in review", [
		"UPDATE software_agreements SET status='review' WHERE id='a1'",
	]),
	scene("a client-signed agreement", [
		"UPDATE software_agreements SET status='client_signed' WHERE id='a1'",
	]),
	scene("an abandoned agreement", [
		"UPDATE software_agreements SET status='abandoned' WHERE id='a1'",
	]),
	scene("a retention-closed agreement", [
		"UPDATE software_agreements SET archive_closed_at='2026-11-12T00:00:00.000Z' WHERE id='a1'",
	]),
	scene("a terminated agreement is still downloadable", [
		"UPDATE software_agreements SET terminated_at='2026-11-01T00:00:00.000Z' WHERE id='a1'",
	]),
	{
		name: "no artifact row",
		music: { seed: downloadSeed({ artifact: null }) },
		r2: { seed: signedBucket() },
		steps: [get()],
	},
	scene("an artifact still pending", [
		"UPDATE software_agreement_artifacts SET status='pending'",
	]),
	scene("an artifact rendering", [
		"UPDATE software_agreement_artifacts SET status='rendering'",
	]),
	scene("an artifact that failed", [
		"UPDATE software_agreement_artifacts SET status='failed', error_code='storage'",
	]),
	scene("an artifact with no pdf_key", [
		"UPDATE software_agreement_artifacts SET pdf_key=NULL",
	]),
	scene("an artifact with an empty pdf_key", [
		"UPDATE software_agreement_artifacts SET pdf_key=''",
	]),
	scene("the stored object is missing", [], { r2: { seed: {} } }),
	scene("the stored bytes do not match the digest", [], {
		r2: {
			seed: { [SIGNED_KEY]: { body: `${new TextDecoder().decode(PDF)}x` } },
		},
	}),
	scene("an artifact with no digest", [
		"UPDATE software_agreement_artifacts SET pdf_sha256=NULL",
	]),
	scene("an artifact with an empty digest", [
		"UPDATE software_agreement_artifacts SET pdf_sha256=''",
	]),
	scene(
		"a Range header is ignored",
		[],
		{},
		{ headers: { range: "bytes=0-9" } },
	),
	scene("the agreement query fails", [], {
		failures: [
			{
				on: /FROM software_agreements a JOIN software_agreement_clients/,
				message: "d1 down",
			},
		],
	}),
	scene("the artifact query fails", [], {
		failures: [{ on: /FROM software_agreement_artifacts/, message: "d1 down" }],
	}),
	scene("the bucket read fails", [], {
		r2: { seed: signedBucket(), fails: ["get"] },
	}),
	{
		name: "two downloads in a row",
		music: { seed: downloadSeed() },
		r2: { seed: signedBucket() },
		steps: [get(), get({ advanceMs: 1000 })],
	},
	{
		name: "the artifact is ready after a first refusal",
		music: { seed: downloadSeed({ artifact: { status: "rendering" } }) },
		r2: { seed: signedBucket() },
		steps: [
			get(),
			get({
				advanceMs: 1000,
				before: {
					label: "the artifact became ready",
					run: sql("UPDATE software_agreement_artifacts SET status='ready'"),
				},
			}),
		],
	},
	{
		name: "the pdf_key points at another agreement's object",
		music: {
			seed: downloadSeed({
				artifact: { pdf_key: "agreements/other/signed.pdf" },
			}),
		},
		r2: { seed: { "agreements/other/signed.pdf": { body: PDF } } },
		steps: [get()],
	},
];

defineCorpus("owner-agreement-file", GET, cases);
