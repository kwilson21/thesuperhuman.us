import { vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	MSA_ID,
	OTHER_ID,
	ORIGINAL_PDF,
	ORIGINAL_PDF_HASH,
	SOW_ID,
	SOW_PDF_KEY,
	MSA_PDF_KEY,
	deliveryRows,
	doc,
	executed,
	forAgreement,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	resend,
	resendOk,
	sha,
	storedPackets,
	CLIENT,
	type Scene,
} from "./areas/signing";
import {
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	text,
	type Case,
} from "./harness";

vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "retry-artifact": the owner asks the site to
// prepare the signed packet of an executed agreement again (and, once it is ready, to send the copies). The packet is
// rendered with pdf-lib, stored in R2 with its certificate, manifest and texts, read back, and marked ready.
//
//   200 {ok:true}   the request ended without an error, whatever the packet did: ready, failed, still rendering or not
//                   claimed at all (a form gets a 303 to /owner/requests/r1)
//   400             agreement_id missing or not a uuid; expectedAttempt not a uuid; confirmedStale or confirmedNotSent
//                   not a boolean
//   404 {ok:false}  no agreement with this id for this request
//   409 "Check the stale preparation attempt before recovery."   expectedAttempt given and the recovery refused
//                   (not confirmed, not rendering, another attempt, attempted less than a minute ago)
//   409 "The agreement changed or the operation failed. Reload before retrying."   any error outside the packet's own
//                   try: no R2 bucket, an outage on the lookups, the claim or the failure mark
//   rejected        the offer lookup (outside the try)
//   artifact outcomes (error_code in the dump): ready; failed render (not executed, no MSA, no signature, a stored
//   packet with a wrong hash, a character the fonts cannot print, an attachment missing, changed or not a PDF, a bad
//   manifest, an R2 get that fails, a values record that lacks the contractor); failed storage (R2 put fails);
//   failed readback (the ready batch fails). Not claimed: ready, rendering, no artifact row, archived agreement.
//   Then the copies: deliverAgreementCopies sends each pending copy (cases with Resend).
// The retry-copy cases are in owner-request-agreement-retry-copy.

const stored = { r2: { seed: storedPackets } };

const A = "11111111-2222-4333-8444-555555555555";

const artifactWith = (
	artifact: { [column: string]: string | number | null } | null,
	sc: Scene = {},
): Scene => ({
	msa: doc("executed", {
		artifact: {
			status: "ready",
			pdf_key: MSA_PDF_KEY,
			pdf_sha256: ORIGINAL_PDF_HASH,
		},
	}),
	sow: doc("executed", { artifact }),
	...sc,
});

const at = (offsetMs: number) =>
	new Date(Date.parse("2026-11-13T12:00:00.000Z") - offsetMs).toISOString();

const rendering = (offsetMs: number) =>
	artifactWith({
		status: "rendering",
		attempt_id: A,
		attempted_at: at(offsetMs),
	});

const body = (over: { [name: string]: string | boolean } = {}) =>
	forAgreement("retry-artifact", over);

const wire: Case[] = [
	...ownBoth("retry the packet of both documents", executed(), body()),
	...ownBoth(
		"an agreement id that does not exist",
		executed(),
		body({ agreement_id: OTHER_ID }),
	),
	own("no agreement id", executed(), { action: "retry-artifact" }),
	own(
		"an agreement id that is not a uuid",
		executed(),
		body({ agreement_id: "x" }),
	),
	own(
		"an agreement id in capitals",
		executed(),
		body({ agreement_id: SOW_ID.toUpperCase() }),
	),
	own(
		"expectedAttempt that is not a uuid",
		executed(),
		body({ expectedAttempt: "x" }),
	),
	own(
		"confirmedStale given as text",
		executed(),
		body({ confirmedStale: "yes" }),
	),
	own(
		"confirmedNotSent given as text",
		executed(),
		body({ confirmedNotSent: "yes" }),
	),
	own(
		"an agreement of another request",
		{
			...executed(),
			extra: {
				software_agreements: [
					rows.agreement(OTHER_ID, "r9", "o1", {
						status: "executed",
						offer_id: null,
					}),
				],
			},
		},
		body({ agreement_id: OTHER_ID }),
	),
	own(
		"the MSA id instead of the SOW id",
		executed(),
		body({ agreement_id: MSA_ID }),
	),
	own("a visitor cannot retry", executed(), body(), {}, { as: asVisitor() }),
];

const recovery: Case[] = [
	own(
		"a stale attempt is named without confirmation",
		rendering(120_000),
		body({ expectedAttempt: A }),
	),
	own(
		"a stale attempt is named and confirmed",
		rendering(120_000),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	ownForm(
		"a stale attempt is named and confirmed",
		rendering(120_000),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"an attempt exactly one minute old is recovered",
		rendering(60_000),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"an attempt 59.999 seconds old is refused",
		rendering(59_999),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"an attempt that is running now is refused",
		rendering(0),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"another attempt id is named",
		rendering(120_000),
		body({
			expectedAttempt: "99999999-2222-4333-8444-555555555555",
			confirmedStale: true,
		}),
	),
	own(
		"the artifact is not rendering",
		artifactWith({ status: "failed", error_code: "render" }),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"the artifact is ready",
		artifactWith({
			status: "ready",
			pdf_key: SOW_PDF_KEY,
			pdf_sha256: ORIGINAL_PDF_HASH,
		}),
		body({ expectedAttempt: A, confirmedStale: true }),
	),
	own(
		"confirmed stale without an attempt id is ignored",
		rendering(120_000),
		body({ confirmedStale: true }),
	),
	own(
		"a rendering packet is left alone without recovery",
		rendering(120_000),
		body(),
	),
	own(
		"a rendering packet that just started is left alone",
		rendering(0),
		body(),
	),
];

const states: Case[] = [
	own("the packet is pending", executed(), body()),
	own(
		"the packet failed before (render)",
		artifactWith({
			status: "failed",
			error_code: "render",
			attempt_id: A,
			attempted_at: at(5000),
		}),
		body(),
	),
	own(
		"the packet failed before (storage)",
		artifactWith({
			status: "failed",
			error_code: "storage",
			attempt_id: A,
			attempted_at: at(5000),
		}),
		body(),
	),
	own(
		"the packet failed before (readback)",
		artifactWith({
			status: "failed",
			error_code: "readback",
			attempt_id: A,
			attempted_at: at(5000),
		}),
		body(),
	),
	own(
		"the packet is ready already",
		artifactWith({
			status: "ready",
			pdf_key: SOW_PDF_KEY,
			pdf_sha256: ORIGINAL_PDF_HASH,
		}),
		body(),
		stored,
	),
	own("there is no artifact row", artifactWith(null), body()),
	own(
		"the agreement was archived",
		{
			...executed(),
			sow: doc("executed", { row: { archive_closed_at: at(1000) } }),
		},
		body(),
	),
	own(
		"the MSA was archived",
		{
			...executed(),
			msa: doc("executed", { row: { archive_closed_at: at(1000) } }),
		},
		body(),
	),
	own(
		"the agreement is only client_signed",
		{
			msa: doc("client_signed"),
			sow: doc("client_signed", { artifact: { status: "pending" } }),
		},
		body(),
	),
	own(
		"the agreement was abandoned",
		{
			msa: doc("abandoned"),
			sow: doc("abandoned", { artifact: { status: "pending" } }),
		},
		body(),
	),
	own(
		"the MSA is not executed",
		{ msa: doc("client_signed"), sow: doc("executed") },
		body(),
	),
	own(
		"the MSA was abandoned",
		{ msa: doc("abandoned"), sow: doc("executed") },
		body(),
	),
	own(
		"the agreement is the MSA itself",
		executed(),
		body({ agreement_id: MSA_ID }),
	),
	own("there is no MSA row", { msa: false, sow: doc("executed") }, body()),
	own(
		"only one signature was recorded",
		{ msa: doc("executed"), sow: doc("executed", { contractor: false }) },
		body(),
	),
	own(
		"no signature was recorded",
		{
			msa: doc("executed"),
			sow: doc("executed", { client: false, contractor: false }),
		},
		body(),
	),
	own(
		"the MSA has no contractor signature",
		{ msa: doc("executed", { contractor: false }), sow: doc("executed") },
		body(),
	),
	own(
		"the record lacks the contractor",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: { values_json: JSON.stringify({ client: CLIENT }) },
			}),
		},
		body(),
	),
	own(
		"a typed name the fonts cannot print",
		{
			msa: doc("executed"),
			sow: doc("executed", { client: { typed_name: "威尔逊" } }),
		},
		body(),
	),
	own(
		"a title with markup is printed as text",
		{
			msa: doc("executed"),
			sow: doc("executed", { contractor: { title: "<b>Founder</b> & Co" } }),
		},
		body(),
	),
	own(
		"a manifest that is not JSON",
		{
			msa: doc("executed"),
			sow: doc("executed", { row: { attachment_manifest_json: "{bad" } }),
		},
		body(),
	),
];

const attachment = (key: string) =>
	JSON.stringify([
		{
			filename: "a.pdf",
			version: "1",
			date: "2026-11-01",
			sha256: ORIGINAL_PDF_HASH,
			key,
			bytes: ORIGINAL_PDF.length,
		},
	]);

const ATT = "agreements/attachments/abc-123.pdf";

const attachments: Case[] = [
	own(
		"an attachment that is stored and matches",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: { attachment_manifest_json: attachment(ATT) },
			}),
		},
		body(),
		{
			r2: { seed: { [ATT]: { body: ORIGINAL_PDF } } },
		},
	),
	own(
		"an attachment that is missing from R2",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: { attachment_manifest_json: attachment(ATT) },
			}),
		},
		body(),
	),
	own(
		"an attachment whose bytes changed",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: { attachment_manifest_json: attachment(ATT) },
			}),
		},
		body(),
		{
			r2: { seed: { [ATT]: { body: "other bytes" } } },
		},
	),
	own(
		"an attachment that is not a PDF",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: {
					attachment_manifest_json: JSON.stringify([
						{ key: ATT, sha256: sha("not a pdf") },
					]),
				},
			}),
		},
		body(),
		{
			r2: { seed: { [ATT]: { body: "not a pdf" } } },
		},
	),
	own(
		"five attachments",
		{
			msa: doc("executed"),
			sow: doc("executed", {
				row: {
					attachment_manifest_json: JSON.stringify(
						["a", "b", "c", "d", "e"].map((n) => ({
							key: `agreements/attachments/${n}.pdf`,
							sha256: ORIGINAL_PDF_HASH,
						})),
					),
				},
			}),
		},
		body(),
		{
			r2: {
				seed: Object.fromEntries(
					["a", "b", "c", "d", "e"].map((n) => [
						`agreements/attachments/${n}.pdf`,
						{ body: ORIGINAL_PDF },
					]),
				),
			},
		},
	),
];

const storage: Case[] = [
	own(
		"a stored packet with its hash is used as is",
		executed(),
		body(),
		stored,
	),
	own("a stored packet whose recorded hash is wrong", executed(), body(), {
		r2: {
			seed: {
				[MSA_PDF_KEY]: {
					body: ORIGINAL_PDF,
					customMetadata: { sha256: sha("other") },
				},
			},
		},
	}),
	own("a stored packet with no recorded hash", executed(), body(), {
		r2: { seed: { [MSA_PDF_KEY]: { body: ORIGINAL_PDF } } },
	}),
	own("no storage bucket", executed(), body(), { r2: { missing: true } }),
	own("R2 get fails", executed(), body(), { r2: { fails: ["get"] } }),
	own("R2 put fails", executed(), body(), { r2: { fails: ["put"] } }),
	ownForm("R2 put fails", executed(), body(), { r2: { fails: ["put"] } }),
];

const fail = (
	name: string,
	on: RegExp,
	extra: Partial<Case> = {},
	sc: Scene = executed(),
	nth?: number,
): Case =>
	own(name, sc, body(), {
		failures: [{ on, message: "d1 unavailable", nth }],
		...extra,
	});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail("outage: the agreement lookup", /SELECT status,kind,effective_on/),
	fail("outage: the MSA id lookup", /SELECT msa_id FROM software_agreements/),
	fail(
		"outage: the claim of the MSA packet",
		/UPDATE software_agreement_artifacts SET status='rendering'/,
	),
	fail(
		"outage: the claim of the SOW packet",
		/UPDATE software_agreement_artifacts SET status='rendering'/,
		{},
		executed(),
		2,
	),
	fail(
		"outage: the read of the agreement for the packet",
		/SELECT \* FROM software_agreements WHERE id=\? AND status='executed'/,
	),
	fail(
		"outage: the signature read",
		/SELECT party,typed_name,title,consent_text/,
	),
	fail(
		"outage: the ready batch leaves the packet failed (readback)",
		/UPDATE software_agreement_artifacts SET status='ready'/,
	),
	fail(
		"outage: the ready batch, then the same request again",
		/UPDATE software_agreement_artifacts SET status='ready'/,
		{
			steps: [ownerJson(body()), ownerJson(body())],
		},
	),
	fail(
		"outage: the ready batch and the failed mark",
		/UPDATE software_agreement_artifacts SET status=/,
		{
			failures: [
				{
					on: /UPDATE software_agreement_artifacts SET status='ready'/,
					message: "d1 unavailable",
				},
				{
					on: /UPDATE software_agreement_artifacts SET status='failed'/,
					message: "d1 unavailable",
				},
			],
		},
	),
	fail(
		"outage: the recovery update",
		/UPDATE software_agreement_artifacts SET status='failed',error_code='render'/,
		{
			steps: [
				ownerJson(
					forAgreement("retry-artifact", {
						expectedAttempt: A,
						confirmedStale: true,
					}),
				),
			],
		},
		rendering(120_000),
	),
	fail(
		"outage: the read of the artifact for the copies",
		/SELECT \* FROM software_agreement_artifacts WHERE agreement_id=\? AND status='ready'/,
		{ ...stored, fetches: resendOk, omit: [] },
	),
	fail(
		"outage: the claim of a copy",
		/UPDATE software_agreement_deliveries SET status='sending'/,
		{ ...stored, fetches: resendOk, omit: [] },
	),
	fail(
		"outage: recording a sent copy",
		/UPDATE software_agreement_deliveries SET status=\?/,
		{ ...stored, fetches: resendOk, omit: [] },
	),
	ownForm("outage: the claim of the MSA packet", executed(), body(), {
		failures: [
			{
				on: /UPDATE software_agreement_artifacts SET status='rendering'/,
				message: "d1 unavailable",
			},
		],
	}),
];

const mail = (
	name: string,
	fetches: Case["fetches"],
	extra: Partial<Case> = {},
	sc: Scene = executed(),
): Case => own(name, sc, body(), { ...stored, fetches, omit: [], ...extra });

const copies: Case[] = [
	mail("the packet is prepared and both copies are sent", resendOk),
	mail(
		"the client copy hits a 5xx and the contractor copy is sent",
		resend(json(503, {}), json(200, { id: "x" })),
	),
	mail(
		"both copies are refused with a 4xx",
		resend(json(422, { message: "bad" })),
	),
	mail(
		"the network is down for the copies",
		byHost({ resend: networkDown("socket hang up") }),
	),
	mail("a non-JSON 200 answer", resend(text(200, "ok"))),
	mail("no Resend key: the packet is prepared and nothing is sent", resendOk, {
		omit: ["RESEND_API_KEY"],
	}),
	mail("no sender address", resendOk, { omit: ["CONTACT_FROM_EMAIL"] }),
	mail(
		"the copies were sent before",
		resendOk,
		{},
		{ ...executed(), deliveries: deliveryRows("sent", { sent_at: at(1000) }) },
	),
	mail(
		"one copy is still sending",
		resendOk,
		{},
		{
			...executed(),
			deliveries: [
				...deliveryRows("sent", { sent_at: at(1000) }).slice(0, 1),
				...deliveryRows("sending", {
					attempted_at: at(5000),
					attempt_id: A,
				}).slice(1),
			],
		},
	),
	mail(
		"the copies failed before",
		resendOk,
		{},
		{ ...executed(), deliveries: deliveryRows("failed", { attempt_id: A }) },
	),
	{
		...mail("the same request twice (a double click)", resendOk),
		steps: [ownerJson(body()), ownerJson(body())],
	},
	{
		...mail(
			"the same request twice after an uncertain send",
			resend(json(503, {})),
		),
		steps: [ownerJson(body()), ownerJson(body())],
	},
	{
		...mail(
			"a retry that fails, then succeeds on the second request",
			resendOk,
			{
				failures: [
					{
						on: /UPDATE software_agreement_artifacts SET status='ready'/,
						message: "d1 unavailable",
					},
				],
			},
		),
		steps: [ownerJson(body()), ownerJson(body())],
	},
	ownForm(
		"the packet is prepared and the copies are sent",
		executed(),
		body(),
		{ ...stored, fetches: resendOk, omit: [] },
	),
];

const cases: Case[] = [
	...wire,
	...recovery,
	...states,
	...attachments,
	...storage,
	...outages,
	...copies,
];

defineCorpus("owner-request-agreement-retry-artifact", POST, cases);
