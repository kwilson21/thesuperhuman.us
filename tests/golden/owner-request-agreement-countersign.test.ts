import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	BOTH,
	CONTRACTOR,
	MSA_HASH,
	OLD_PDF_KEY,
	MSA_ID,
	OTHER_ID,
	PAST,
	SOW_HASH,
	SOW_ID,
	SOW_ONLY,
	abandonBody,
	clientSigned,
	countersignBody,
	doc,
	notificationRows,
	originalPacket,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	reusedReady,
	resendOk,
	scene,
	sha,
	type Scene,
} from "./areas/signing";
import { asOwner, asVisitor, defineCorpus, type Case } from "./harness";

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "countersign": the owner signs the MSA and SOW
// the client already signed. The signatures commit in one batch; the signed packet and its emailed copies are then
// prepared and, whatever happens there, the answer is the same.
//
// Every response branch and effect path of the action, of countersignAgreements, signatureInsert, reusedMsaGuard and
// closeObsoleteAgreementNotifications (software-agreements.ts), prepareAgreementArtifact and deliverAgreementCopies
// (agreement-artifacts.ts), renderAgreementPacket (agreement-pdf.ts), and the cases that reach them. Names starting
// "form:" send the same request as an urlencoded form; the others send JSON. Most cases leave out the Resend key, so no
// 400 KB mail body is recorded; the cases that send the signed copy name it.
//
//   200 {ok:true,message:"Signed by both parties. Copy preparation needs attention."}
//       the signatures committed, whatever the packet and the copies did (a form gets a 303 to /owner/requests/r1)
//       success with the packet rendered, stored and read back, and both copies sent; with no AUDIO bucket, a failing
//       get or put, a stored packet, no Resend key
//   409 "Signing is off or the offer changed."   no sent offer for the request, signing off
//   409 "The agreement changed or the operation failed. Reload before retrying."
//       no pending documents, documents that differ in id, hash or number, a name or a stored value that cannot be signed,
//       a batch guard lost to a race, a batch outage
//   rejected (an outage on the offer lookup or the signing setting, outside the try)
//   400 / 403 / 503 and the form and JSON wire errors are in owner-request-agreement-wire

const reuseOriginal: Partial<Case> = {
	r2: { seed: originalPacket },
};

const BATCH = /INSERT INTO software_agreement_signatures/;

const pending: Scene = clientSigned();

const signs = (over: Scene = {}): Scene => ({ ...pending, ...over });

// ---------------------------------------------------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------------------------------------------------

const success: Case[] = [
	own(
		"countersign both documents and send the signed copies",
		pending,
		countersignBody(),
		{ fetches: resendOk, omit: [] },
	),
	ownForm("countersign both documents", pending, countersignBody()),
	own("countersign both documents (no mail)", pending, countersignBody()),
	own(
		"countersign with the documents in the other order",
		pending,
		countersignBody({ documents: [...BOTH].reverse() }),
	),
	own(
		"countersign twelve hours later",
		pending,
		countersignBody(),
		{},
		{ advanceMs: 12 * 3_600_000 },
	),
	...ownBoth("countersign (twin, no mail)", pending, countersignBody()),
	own(
		"countersign leaves the offer sent and the client session alone",
		signs({ draft: {} }),
		countersignBody(),
	),
	own(
		"countersign closes a signature notice that was still sending",
		signs({
			notifications: notificationRows("sending", {
				attempted_at: PAST,
				attempt_id: "a",
			}),
		}),
		countersignBody(),
	),
	own(
		"countersign with the notices already sent",
		signs({
			notifications: notificationRows("sent", { sent_at: PAST }),
		}),
		countersignBody(),
	),
	own(
		"countersign with failed notices",
		signs({
			notifications: notificationRows("failed", { attempt_id: "a" }),
		}),
		countersignBody(),
	),
	own(
		"countersign with no notification rows",
		signs({ notifications: false }),
		countersignBody(),
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// The typed name
// ---------------------------------------------------------------------------------------------------------------------

const typed = (name: string, typed_name: string): Case =>
	own(name, pending, countersignBody({ typed_name }));

const names: Case[] = [
	typed("a typed name in lower case", "kazon wilson"),
	typed("a typed name in capitals", "KAZON WILSON"),
	typed("a typed name that is not the contractor signer's", "Someone Else"),
	typed("a typed name with accents", "Kazön Wílson"),
	typed("a typed name written decomposed is stored composed", "Kazön Wílson"),
	typed("a typed name padded with spaces", "   Kazon Wilson   "),
	typed("a typed name in Cyrillic", "Казон Вилсон"),
	typed("a typed name in Chinese cannot be printed", "威尔逊"),
	typed("a typed name with an emoji cannot be printed", "Kazon 🙂 Wilson"),
	typed("a typed name with markup and quotes", `Kazon <b>"Wilson" & 'Co'</b>`),
	typed("a typed name of 200 characters", "K".repeat(200)),
	typed("a typed name of 201 characters", "K".repeat(201)),
	typed("an empty typed name", ""),
	typed("a typed name of only spaces", "    "),
	typed("a typed name with a control character", "Kazon\u0007Wilson"),
	typed("a typed name with a line break", "Kazon\nWilson"),
	typed("a typed name with a tab", "Kazon\tWilson"),
	typed("a typed name with a zero-width joiner", "Kazon‍Wilson"),
	typed("a typed name with a right-to-left mark", "Kazon‏Wilson"),
	typed("a typed name with a lone surrogate", "Kazon\ud800Wilson"),
	typed("a typed name that is a single letter", "K"),
	own(
		"a typed name that is not text",
		pending,
		countersignBody({ typed_name: 7 }),
	),
	own(
		"a typed name that is null",
		pending,
		countersignBody({ typed_name: null }),
	),
	own("no typed name", pending, {
		action: "countersign",
		documents: BOTH,
		consent: true,
	}),
	...ownBoth(
		"a typed name in capitals (twin)",
		pending,
		countersignBody({ typed_name: "KAZON WILSON" }),
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// The offer, the setting and the state of the documents
// ---------------------------------------------------------------------------------------------------------------------

const hashed = (hash: string) => ({ row: { text_sha256: hash } });

const states: Case[] = [
	...ownBoth(
		"signing switched off",
		signs({ signing: false }),
		countersignBody(),
	),
	own(
		"an offer that was superseded",
		signs({ offer: { status: "superseded" } }),
		countersignBody(),
	),
	own(
		"an offer that was withdrawn",
		signs({ offer: { status: "withdrawn" } }),
		countersignBody(),
	),
	own(
		"an offer that is still a draft",
		signs({ offer: { status: "draft" } }),
		countersignBody(),
	),
	own(
		"a request that was withdrawn",
		signs({ request: { status: "withdrawn" } }),
		countersignBody(),
	),
	own(
		"a request that was resolved",
		signs({ request: { status: "resolved" } }),
		countersignBody(),
	),
	own(
		"a request that is only reviewed",
		signs({ request: { status: "reviewed" } }),
		countersignBody(),
	),
	own(
		"a request that is still new",
		signs({ request: { status: "new" } }),
		countersignBody(),
	),
	own(
		"an agreement of another request is not countersigned",
		pending,
		countersignBody(),
		{},
		{
			path: "/api/owner/requests/r9/agreement",
			params: { id: "r9" },
		},
	),
	own(
		"documents still in review (no client signature)",
		{ msa: doc("review"), sow: doc("review") },
		countersignBody(),
	),
	...ownBoth(
		"documents already executed",
		{ msa: doc("executed"), sow: doc("executed") },
		countersignBody(),
	),
	own(
		"documents abandoned",
		{ msa: doc("abandoned"), sow: doc("abandoned") },
		countersignBody(),
	),
	own("no documents at all", { msa: false, sow: false }, countersignBody()),
	own(
		"the SOW only, named with the MSA",
		signs({ msa: false }),
		countersignBody(),
	),
	own(
		"the SOW only, named alone",
		signs({ msa: false }),
		countersignBody({ documents: SOW_ONLY }),
	),
	own(
		"the MSA only",
		signs({ sow: false }),
		countersignBody({ documents: [BOTH[0]] }),
	),
	own(
		"one document is client_signed and the other still in review",
		{ msa: doc("client_signed"), sow: doc("review") },
		countersignBody(),
	),
	own(
		"one document is client_signed and the other executed",
		{ msa: doc("executed"), sow: doc("client_signed") },
		countersignBody({ documents: SOW_ONLY }),
	),
	own(
		"the documents that are named include a wrong hash",
		pending,
		countersignBody({ documents: [{ id: MSA_ID, hash: SOW_HASH }, BOTH[1]] }),
	),
	own(
		"a document id that does not exist",
		pending,
		countersignBody({ documents: [BOTH[0], { id: OTHER_ID, hash: SOW_HASH }] }),
	),
	own(
		"only the SOW named while both are pending",
		pending,
		countersignBody({ documents: SOW_ONLY }),
	),
	own(
		"only the MSA named while both are pending",
		pending,
		countersignBody({ documents: [BOTH[0]] }),
	),
	own(
		"a stored hash that no longer matches the text named",
		signs({ sow: doc("client_signed", hashed("f".repeat(64))) }),
		countersignBody(),
	),
	own(
		"a third document named",
		pending,
		countersignBody({ documents: [...BOTH, { id: OTHER_ID, hash: MSA_HASH }] }),
	),
	own(
		"the same document named twice",
		pending,
		countersignBody({ documents: [BOTH[1], BOTH[1]] }),
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// The contractor snapshot
// ---------------------------------------------------------------------------------------------------------------------

const snapshot = (value: string | null, name: string, signing = signs()) =>
	own(
		name,
		{ ...signing, offer: { contractor_snapshot_json: value } },
		countersignBody(),
	);

const snapshots: Case[] = [
	snapshot(null, "an offer with no contractor snapshot"),
	snapshot("{bad", "an offer whose contractor snapshot is not JSON"),
	snapshot("{}", "an offer whose contractor snapshot is empty"),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, config_version: 2, extra: "x" }),
		"a contractor snapshot with an extra field",
	),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, registered_agent_confirmed: false }),
		"a contractor snapshot that did not confirm the registered agent",
	),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, notice_email: "NOTICE@EXAMPLE.TEST" }),
		"a contractor snapshot notice email seeded in capitals by hand is lower-cased (the app stores it lower-cased)",
	),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, signer_title: "总裁" }),
		"a contractor title the fonts cannot print",
	),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, legal_name: "Café <Group> & Co" }),
		"a contractor legal name with markup and accents",
	),
	snapshot(
		JSON.stringify({ ...CONTRACTOR, config_version: 7 }),
		"a contractor snapshot with another config version",
	),
	own(
		"an offer with no client email snapshot",
		signs({ offer: { recipient_email_snapshot: null } }),
		countersignBody(),
	),
];

// ---------------------------------------------------------------------------------------------------------------------
// A reused MSA
// ---------------------------------------------------------------------------------------------------------------------

const reused: Case[] = [
	{
		...own(
			"a reused MSA: the SOW alone is countersigned",
			{ reused: reusedReady, msa: false, sow: doc("client_signed") },
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	{
		...ownForm(
			"a reused MSA: the SOW alone is countersigned",
			{ reused: reusedReady, msa: false, sow: doc("client_signed") },
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	{
		...own(
			"a reused MSA: both documents named",
			{ reused: reusedReady, msa: false, sow: doc("client_signed") },
			countersignBody(),
		),
		...reuseOriginal,
	},
	{
		...own(
			"a reused MSA that was terminated",
			{
				reused: doc("executed", {
					row: { terminated_at: "2026-11-01" },
					artifact: reusedReady.artifact,
				}),
				msa: false,
				sow: doc("client_signed"),
			},
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	{
		...own(
			"a reused MSA that is not executed",
			{ reused: doc("client_signed"), msa: false, sow: doc("client_signed") },
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	own(
		"a reused MSA whose stored packet is missing from R2",
		{ reused: reusedReady, msa: false, sow: doc("client_signed") },
		countersignBody({ documents: SOW_ONLY }),
	),
	{
		...own(
			"a reused MSA whose stored packet changed",
			{
				reused: doc("executed", {
					artifact: { ...reusedReady.artifact, pdf_sha256: sha("other") },
				}),
				msa: false,
				sow: doc("client_signed"),
			},
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	{
		...own(
			"a reused MSA whose artifact is not ready",
			{
				reused: doc("executed", { artifact: { status: "pending" } }),
				msa: false,
				sow: doc("client_signed"),
			},
			countersignBody({ documents: SOW_ONLY }),
		),
		...reuseOriginal,
	},
	{
		...own(
			"a reused MSA whose stored packet is not a PDF",
			{
				reused: doc("executed", {
					artifact: { ...reusedReady.artifact, pdf_sha256: sha("not a pdf") },
				}),
				msa: false,
				sow: doc("client_signed"),
			},
			countersignBody({ documents: SOW_ONLY }),
		),
		r2: {
			seed: {
				[OLD_PDF_KEY]: {
					body: "not a pdf",
					customMetadata: { sha256: sha("not a pdf") },
				},
			},
		},
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Races: another writer changes the row between the reads and the batch
// ---------------------------------------------------------------------------------------------------------------------

const race = (
	name: string,
	sql: string,
	sc: Scene = pending,
	extra: Partial<Case> = {},
): Case => ({
	...own(name, sc, countersignBody(), {
		interleave: [{ on: BATCH, label: name, run: (sqlite) => sqlite.exec(sql) }],
		...extra,
	}),
});

const races: Case[] = [
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
		"signing is switched off before the batch",
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	race(
		"the SOW is countersigned by a second request first",
		"UPDATE software_agreements SET status='executed' WHERE kind='sow'",
	),
	race(
		"both documents are executed first",
		"UPDATE software_agreements SET status='executed'",
	),
	race(
		"the MSA is abandoned first",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='msa'",
	),
	race(
		"the owner abandons both first",
		"UPDATE software_agreements SET status='abandoned'",
	),
	race(
		"the text of the SOW changes first",
		`UPDATE software_agreements SET text_sha256='${"e".repeat(64)}' WHERE kind='sow'`,
	),
	race("the agreements are deleted first", "DELETE FROM software_agreements"),
	race(
		"an artifact row appears first",
		`INSERT INTO software_agreement_artifacts(agreement_id) VALUES('${SOW_ID}')`,
	),
	race(
		"a delivery row appears first",
		`INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email) VALUES('${SOW_ID}','client','x@example.test')`,
	),
	race(
		"a contractor signature appears first",
		`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES('s-x','${SOW_ID}','contractor','x','x','x','v','t','t','h','e','t','m','i','[]','r','','')`,
	),
	race(
		"a project starts first",
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o1','{}','standard','x','x','x','x','x','x')",
	),
	{
		...race(
			"the reused MSA is terminated first",
			"UPDATE software_agreements SET terminated_at='2026-11-13' WHERE kind='msa'",
			{ reused: reusedReady, msa: false, sow: doc("client_signed") },
		),
		steps: [ownerJson(countersignBody({ documents: SOW_ONLY }))],
		...reuseOriginal,
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Outages
// ---------------------------------------------------------------------------------------------------------------------

const fail = (
	name: string,
	on: RegExp,
	extra: Partial<Case> = {},
	sc: Scene = pending,
	nth?: number,
): Case =>
	own(name, sc, countersignBody(), {
		failures: [{ on, message: "d1 unavailable", nth }],
		...extra,
	});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail("outage: the signing setting", /SELECT software_signing_enabled/),
	fail(
		"outage: the read of the agreements",
		/FROM software_agreements WHERE offer_id=\?/,
	),
	fail("outage: the signing batch", BATCH),
	fail("outage: the batch, then the same request again", BATCH, {
		steps: [ownerJson(countersignBody()), ownerJson(countersignBody())],
	}),
	fail(
		"outage: the lookup of the MSA id after the batch",
		/SELECT msa_id FROM software_agreements/,
	),
	fail(
		"outage: the claim of the MSA packet",
		/UPDATE software_agreement_artifacts SET status='rendering'/,
	),
	fail(
		"outage: the claim of the SOW packet",
		/UPDATE software_agreement_artifacts SET status='rendering'/,
		{},
		pending,
		2,
	),
	fail(
		"outage: reading the SOW for the packet",
		/SELECT \* FROM software_agreements WHERE id=\? AND status='executed'/,
		{},
		pending,
		2,
	),
	fail(
		"outage: the signature read of the packet",
		/SELECT party,typed_name,title,consent_text/,
	),
	fail(
		"outage: marking the packet ready",
		/UPDATE software_agreement_artifacts SET status='ready'/,
	),
	fail(
		"outage: marking the packet ready, then marking it failed",
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
		"outage: the read of the artifact for the copies",
		/SELECT \* FROM software_agreement_artifacts WHERE agreement_id=\? AND status='ready'/,
		{ fetches: resendOk, omit: [] },
	),
	fail(
		"outage: the claim of the client copy",
		/UPDATE software_agreement_deliveries SET status='sending'/,
		{ fetches: resendOk, omit: [] },
	),
	fail(
		"outage: recording the client copy",
		/UPDATE software_agreement_deliveries SET status=\?/,
		{ fetches: resendOk, omit: [] },
	),
	{
		...fail("form: outage: the signing batch", BATCH),
		steps: [
			{
				...ownerJson(undefined),
				body: new URLSearchParams({
					action: "countersign",
					documents: JSON.stringify(BOTH),
					typed_name: "Kazon Wilson",
					consent: "true",
				}).toString(),
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/x-www-form-urlencoded",
				},
			},
		],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// R2 and Resend around the packet
// ---------------------------------------------------------------------------------------------------------------------

const storage: Case[] = [
	own(
		"no storage bucket: the packet is never made",
		pending,
		countersignBody(),
		{ r2: { missing: true } },
	),
	own(
		"R2 get fails: the packet is marked failed (render)",
		pending,
		countersignBody(),
		{ r2: { fails: ["get"] } },
	),
	own(
		"R2 put fails: the packet is marked failed (storage)",
		pending,
		countersignBody(),
		{ r2: { fails: ["put"] } },
	),
	own(
		"the Resend key is missing: the packet is made, nothing is sent",
		pending,
		countersignBody(),
	),
	own(
		"the sender address is missing: the packet is made, nothing is sent",
		pending,
		countersignBody(),
		{ omit: ["CONTACT_FROM_EMAIL"] },
	),
	{
		name: "countersign twice (a double click)",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(countersignBody()), ownerJson(countersignBody())],
	},
	{
		name: "countersign three times",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(countersignBody()),
			ownerJson(countersignBody()),
			ownerJson(countersignBody()),
		],
	},
	{
		name: "countersign, then abandon",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(countersignBody()), ownerJson(abandonBody())],
	},
	{
		name: "countersign, then the client tries to sign again",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(countersignBody()),
			ownerJson(countersignBody({ typed_name: "Another Name" })),
		],
	},
	{
		name: "countersign after the clock passes the client session",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(countersignBody(), { advanceMs: 3 * 86_400_000 })],
	},
	{
		name: "an invalid request, then a valid one",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(countersignBody({ consent: false })),
			ownerJson(countersignBody()),
		],
	},
	{
		name: "a refused hash, then the right documents",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(
				countersignBody({
					documents: [{ id: MSA_ID, hash: SOW_HASH }, BOTH[1]],
				}),
			),
			ownerJson(countersignBody()),
		],
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------------------------------------------------

const who: Case[] = [
	own(
		"the owner email in capitals is lower-cased for the verified email only",
		pending,
		countersignBody(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	own(
		"an owner email with surrounding spaces",
		pending,
		countersignBody(),
		{},
		{ as: asOwner("  owner@example.test ") },
	),
	own(
		"an owner email with markup",
		pending,
		countersignBody(),
		{},
		{ as: asOwner("o<b>wner</b>@example.test") },
	),
	own(
		"a countersign from an address of 101 characters",
		pending,
		countersignBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"cf-connecting-ip": "1".repeat(101),
			},
		},
	),
	own(
		"a countersign from an address of 100 characters",
		pending,
		countersignBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"cf-connecting-ip": "1".repeat(100),
			},
		},
	),
	own(
		"a countersign with a user agent of 2001 characters",
		pending,
		countersignBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"user-agent": "u".repeat(2001),
			},
		},
	),
	own(
		"a countersign with a user agent that has a control character",
		pending,
		countersignBody(),
		{},
		{
			headers: { origin: "https://thesuperhuman.us", "user-agent": "a\u0001b" },
		},
	),
	own(
		"a countersign with a browser and an address recorded",
		pending,
		countersignBody(),
		{},
		{
			headers: {
				origin: "https://thesuperhuman.us",
				"user-agent": "golden-owner-browser",
				"cf-connecting-ip": "198.51.100.7",
			},
		},
	),
	own(
		"a visitor cannot countersign",
		pending,
		countersignBody(),
		{},
		{ as: asVisitor() },
	),
	own(
		"a client who is signed in cannot countersign",
		pending,
		countersignBody(),
		{},
		{
			as: asVisitor({
				headers: { cookie: "agreement_session=" + "s".repeat(43) },
			}),
		},
	),
];

const cases: Case[] = [
	...success,
	...names,
	...states,
	...snapshots,
	...reused,
	...races,
	...outages,
	...storage,
	...who,
];

defineCorpus("owner-request-agreement-countersign", POST, cases);
