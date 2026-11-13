import { GET, POST } from "~/pages/api/offer/[token]/review";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	uuidFor,
	type Case,
	type Step,
} from "./harness";
import {
	agreementWorld,
	clientRow,
	contractor,
	cookie,
	CSRF,
	details,
	formBody,
	formHeaders,
	GRACE,
	IP,
	OTHER_SESSION,
	OTHER_TOKEN,
	REVIEW_TABLES,
	SAME_ORIGIN,
	secondOffer,
	startedProject,
	terms,
	TOKEN,
	values,
	wireKit,
	type Opts,
} from "./areas/agreement-access";

// The golden corpus for GET and POST /api/offer/[token]/review: a client with a verified session turns the details they
// typed into the agreement documents for review (POST), and downloads one document as text (GET).
//
// POST reads three wire formats; every case that can be sent each way is recorded each way (see wireKit in
// areas/agreement-access.ts): (json), (form values) and (form fields). The route is wrapped by nativeAgreementRoute, so
// a native form post gets a 303 to /offer/<token>/sign?review=1 on success (keeping the JSON content-type header of the
// answer) and an HTML page that keeps the status code on every failure; a JSON request gets JSON.
//
// Branches (the handler, agreementRequest and nativeAgreementRoute/nativeAgreementResponse in src/lib/agreement-request.ts,
// agreementSession and signingEnabled in agreement-access.ts, resolveClientDetails and saveAgreementDraft in
// agreement-draft.ts, reviewAgreements in software-agreements.ts, validateAgreementDetails in agreement-fields.ts,
// renderAgreement and validateAgreementCharacters in agreement-templates.ts):
//
//   POST
//   503 {ok:false}                       no MUSIC_DB (before the body is read; a form post gets it as an HTML page)
//   request                              403 Forbidden, 415, 400 Missing request / Invalid JSON, 413 over 16384, 400 Invalid fields
//   401 "Open a fresh email link ..."    signing off, no session, a session of another offer, expired, revoked, a link or recipient that no longer
//                                        matches, an offer that is not sent, a request withdrawn or resolved, a bad token (the body is read first)
//   403 "Reload and try again."          csrf_nonce missing, empty, not text or wrong (checked after the session, before the details)
//   400 "Check the highlighted details." the draft schema (unknown field, a field not text, over its limit, a control character) and the client
//                                        schema: each required field empty, an entity type or state outside the lists, Outside the US with no
//                                        country, an invalid reviewer, approver or notice email, no portfolio choice
//   200 documents                        MSA and SOW created (reviewAgreements), the MSA reused from an executed agreement, an earlier review
//                                        replaced, invoice and standard payment, two milestones, a checkpoint, attachments, every portfolio choice
//   409 with the error text              the text of any thrown error that does not start with "[" (this includes database and JavaScript error
//                                        messages: see the bugs in the report), "The agreement could not be reviewed." otherwise (a Zod error)
//                                        A signature is already saved; the MSA does not match; another offer has a pending MSA; templates
//                                        unavailable; unresolved blanks; unsupported character; missing milestone details; a guard failing
//   303 /offer/<token>/sign?review=1     form success
//   rejected                             a statement outside the try throwing (the signing lookup, the offer lookup, the session lookup)
//   GET (download)
//   401 {ok:false}                       no database, no session, signing off, a bad token
//   404 {ok:false}                       no document query, an unknown id, another review session's document, an abandoned or another offer's
//   200 text/plain attachment            msa and sow documents in each agreement state, with markup and unicode in the text

const PATH = `/api/offer/${TOKEN}/review`;

const { scenario, withValues, ALL, TWO } = wireKit(PATH, REVIEW_TABLES);

const one = (name: string, spec: Parameters<typeof scenario>[1] = {}) =>
	scenario(name, { wires: ALL, ...spec });

const two = (name: string, spec: Parameters<typeof scenario>[1] = {}) =>
	scenario(name, { wires: TWO, ...spec });

const outage = (
	name: string,
	on: RegExp,
	nth = 1,
	spec: Parameters<typeof scenario>[1] = {},
) =>
	one(name, {
		...spec,
		over: { failures: [{ on, nth, message: `${name} fails` }], ...spec.over },
	});

const race = (
	name: string,
	on: RegExp,
	sql: string,
	opts: Opts = {},
	spec: Parameters<typeof scenario>[1] = {},
) =>
	one(name, {
		opts,
		...spec,
		over: {
			interleave: [{ on, label: name, run: (sqlite) => sqlite.exec(sql) }],
			...spec.over,
		},
	});

const CLIENTS_INSERT = /INSERT OR IGNORE INTO software_agreement_clients/;
const DRAFT_INSERT = /INSERT INTO software_agreement_drafts/;

const offerWith = (over: {
	terms?: unknown;
	details?: unknown;
	contractor?: unknown;
}) => {
	const offer: { [column: string]: string } = {};

	if (over.terms !== undefined) offer.terms_json = JSON.stringify(over.terms);

	if (over.details !== undefined)
		offer.agreement_details_json = JSON.stringify(over.details);

	if (over.contractor !== undefined)
		offer.contractor_snapshot_json = JSON.stringify(over.contractor);

	return { offer };
};

const raw = (
	column: "terms_json" | "agreement_details_json" | "contractor_snapshot_json",
	value: string | null,
): Opts => ({
	offer: { [column]: value },
});

const twoMilestones = {
	terms: {
		...terms,
		milestones: [
			{ ...terms.milestones[0] },
			{
				name: "Reports",
				deliverables: ["A reports page"],
				acceptance: ["Open the reports page"],
				feeCents: 150_000,
			},
		],
	},
	details: {
		...details,
		milestones: [
			{
				start: "2026-12-01",
				target: "2026-12-10",
				handoff: "Source and notices",
			},
			{ start: "2026-12-10", target: "2026-12-20", handoff: "Reports handoff" },
		],
	},
};

const checkpointTerms = {
	...terms,
	milestones: [
		{
			...terms.milestones[0],
			checkpoint: { label: "Midpoint review", cancellationPercent: 60 },
		},
	],
};

const checkpointDetails = {
	...details,
	milestones: [
		{
			...details.milestones[0],
			checkpoint_criteria: "Booking page deployed",
			checkpoint_evidence: "A recorded walkthrough",
		},
	],
};

// An executed MSA of an earlier offer for the same legal party, kept by an artifact that is ready.
const reuse = (
	over: {
		msa?: { [column: string]: string | number | null };
		artifact?: string | null;
	} = {},
) => ({
	opts: {
		extra: {
			owner_requests: [
				{
					id: "r0",
					kind: "software",
					name: "Grace Hopper",
					email: GRACE,
					summary: "Earlier project",
					status: "resolved",
					created_at: "2026-10-01T10:00:00.000Z",
					updated_at: "2026-10-01T10:00:00.000Z",
				},
			],
			software_offers: [
				{
					id: "o-old",
					request_id: "r0",
					version: 1,
					status: "superseded",
					terms_json: "{}",
					created_at: "2026-10-01T10:00:00.000Z",
					updated_at: "2026-10-01T10:00:00.000Z",
				},
			],
			software_agreement_clients: [clientRow()],
			software_agreements: [
				{
					id: "ag-old-msa",
					kind: "msa",
					offer_id: "o-old",
					request_id: "r0",
					client_id: "client-1",
					template_id: "tpl-msa",
					status: "executed",
					canonical_text: "Executed MSA text\n",
					text_sha256: "1".repeat(64),
					values_json: "{}",
					created_at: "2026-10-01T10:00:00.000Z",
					effective_on: "2026-10-01",
					review_session_hash: "old-review-hash",
					executed_at: "2026-10-02T10:00:00.000Z",
					...over.msa,
				},
			],
			software_agreement_artifacts:
				over.artifact === null
					? []
					: [{ agreement_id: "ag-old-msa", status: over.artifact ?? "ready" }],
		},
		sql: [
			"UPDATE software_offers SET reused_msa_id='ag-old-msa' WHERE id='o-r1'",
		],
	} satisfies Opts,
});

// Another offer of the same party whose MSA is still under review.
const pendingElsewhere = (withMsa = true): Opts => ({
	extra: {
		owner_requests: [
			{
				id: "r3",
				kind: "software",
				name: "Grace Hopper",
				email: GRACE,
				summary: "Another project",
				status: "reviewed",
				created_at: "2026-10-01T10:00:00.000Z",
				updated_at: "2026-10-01T10:00:00.000Z",
			},
		],
		software_offers: [
			{
				id: "o-r3",
				request_id: "r3",
				version: 1,
				status: "sent",
				terms_json: "{}",
				created_at: "2026-10-01T10:00:00.000Z",
				updated_at: "2026-10-01T10:00:00.000Z",
			},
		],
		software_agreement_clients: [clientRow()],
		software_agreements: withMsa ? [pendingMsa] : [],
	},
});

const pendingMsa = {
	id: "ag-other-msa",
	kind: "msa",
	offer_id: "o-r3",
	request_id: "r3",
	client_id: "client-1",
	template_id: "tpl-msa",
	status: "review",
	canonical_text: "Pending MSA text\n",
	text_sha256: "2".repeat(64),
	values_json: "{}",
	created_at: "2026-10-01T10:00:00.000Z",
	effective_on: "2026-10-01",
	review_session_hash: "other-review-hash",
};

const posts: Case[] = [
	// the review is made
	...one("a full review creates the MSA and the SOW"),
	...one("a review for the private portfolio choice", {
		input: withValues({ portfolio_choice: "private" }),
	}),
	...one("a review for the anonymous portfolio choice", {
		input: withValues({ portfolio_choice: "anonymous" }),
	}),
	...one(
		"explicit reviewer, approver and notice details are used and the emails lower-cased",
		{
			input: withValues({
				reviewer_name: "Rita Reviewer",
				reviewer_email: "RITA@Example.TEST",
				approver_name: "Alan Approver",
				approver_email: "Alan@Example.Test",
				notice_email: "Notices@Example.Test",
			}),
		},
	),
	...one("a state outside the US uses the country", {
		input: withValues({ state: "Outside the US", country: "Canada" }),
	}),
	...one("surrounding spaces are trimmed before the documents are made", {
		input: withValues({
			legal_name: "  Hopper Systems LLC  ",
			signer_name: "\tGrace Hopper ",
		}),
	}),
	...one("an invoice-terms offer", {
		opts: offerWith({
			terms: { ...terms, paymentMode: "invoice" },
			details: { ...details, invoice_first_duration: 10 },
		}),
	}),
	...one("an offer with two milestones", {
		opts: offerWith({
			terms: twoMilestones.terms,
			details: twoMilestones.details,
		}),
	}),
	...one("an offer with a checkpoint", {
		opts: offerWith({ terms: checkpointTerms, details: checkpointDetails }),
	}),
	...one("an offer with attachments", {
		opts: offerWith({
			details: {
				...details,
				attachments: [
					{
						filename: "Scope.pdf",
						version: "1",
						date: "2026-11-01",
						sha256: "a".repeat(64),
						key: "agreements/attachments/00000000-0000-4000-8000-0000000000aa.pdf",
						bytes: 1234,
					},
				],
			},
		}),
	}),
	...one("a late evening review uses the New York date", {
		opts: { session: { expires_at: "2026-11-15T00:00:00.000Z" } },
		over: {},
		input: undefined,
		steps: (send) => [send(undefined, { advanceMs: 15 * 3_600_000 })],
	}),
	...one(
		"markup, ampersands and quotes in the details appear in the documents as typed",
		{
			input: withValues({
				legal_name: `<b>Hopper</b> & "Sons" 'LLC'`,
				business_address: `1 <Main> St &amp; "Suite" 'B'`,
				signer_title: "Owner & <CEO>",
			}),
		},
	),
	...one("accented and Greek letters are accepted", {
		input: withValues({
			legal_name: "Zoë Ångström Ελλάδα Ltd",
			signer_name: "Zoë Ångström",
		}),
	}),
	...one("CJK text is not supported by the document font", {
		input: withValues({ legal_name: "株式会社テスト" }),
	}),
	...one("an emoji is not supported by the document font", {
		input: withValues({ signer_title: "Owner 😀" }),
	}),
	...one("square brackets in a detail leave an unresolved blank", {
		input: withValues({ business_address: "1 Main St [Suite 2]" }),
	}),
	...one("three underscores in a detail leave an unresolved blank", {
		input: withValues({ signer_title: "Owner ___" }),
	}),
	...one("a template field in a detail is refused", {
		input: withValues({ legal_name: "{{client.legal_name}}" }),
	}),
	...one("a decomposed accent is normalised before it is rendered", {
		input: withValues({ signer_name: "Renée" }),
	}),
	// an earlier review, signed documents and other offers
	...one("an earlier review is replaced by the new documents", {
		opts: { agreements: "review" },
	}),
	...one("an earlier review for another legal name replaces its client too", {
		opts: { agreements: "review" },
		input: withValues({ legal_name: "Hopper Industries Inc" }),
	}),
	...one("a client-signed agreement cannot be reviewed again", {
		opts: { agreements: "client_signed" },
	}),
	...one("an executed agreement cannot be reviewed again", {
		opts: { agreements: "executed" },
	}),
	...one("an abandoned agreement is ignored", {
		opts: { agreements: "abandoned" },
	}),
	...one("the MSA of an earlier offer is reused", reuse()),
	...one("a reused MSA for another legal name does not match", {
		...reuse(),
		input: withValues({ legal_name: "Another Company LLC" }),
	}),
	...one(
		"a reused MSA that was terminated does not match",
		reuse({ msa: { terminated_at: "2026-10-20T10:00:00.000Z" } }),
	),
	...one(
		"a reused MSA whose archive is closed does not match",
		reuse({ msa: { archive_closed_at: "2026-10-20T10:00:00.000Z" } }),
	),
	...one(
		"a reused MSA with a failed artifact does not match",
		reuse({ artifact: "failed" }),
	),
	...one(
		"a reused MSA with no artifact does not match",
		reuse({ artifact: null }),
	),
	...one(
		"a reused MSA that is not executed does not match",
		reuse({ msa: { status: "client_signed", executed_at: null } }),
	),
	...one("another offer has a pending MSA for the party", {
		opts: pendingElsewhere(),
	}),
	// the pinned templates and the stored offer
	...one("the SOW template is not pinned", {
		opts: { offer: { sow_template_id: null } },
	}),
	...one("the MSA template is not pinned", {
		opts: { offer: { msa_template_id: null } },
	}),
	...one("the offer terms are not JSON (the parser message is returned)", {
		opts: raw("terms_json", "not json"),
	}),
	...one("the offer terms fail their schema", {
		opts: raw("terms_json", "{}"),
	}),
	...one("the agreement details are missing", {
		opts: raw("agreement_details_json", null),
	}),
	...one("the agreement details are not JSON", {
		opts: raw("agreement_details_json", "{oops"),
	}),
	...one("the agreement details fail their schema", {
		opts: raw("agreement_details_json", "{}"),
	}),
	...one("the details cover fewer milestones than the offer", {
		opts: offerWith({ terms: twoMilestones.terms }),
	}),
	...one("an invoice offer without a first-milestone duration", {
		opts: offerWith({ terms: { ...terms, paymentMode: "invoice" } }),
	}),
	...one("a checkpoint offer without criteria and evidence", {
		opts: offerWith({ terms: checkpointTerms }),
	}),
	...one(
		"the contractor snapshot is missing (a JavaScript error message is returned)",
		{ opts: raw("contractor_snapshot_json", null) },
	),
	...one("the contractor snapshot fails its schema", {
		opts: offerWith({
			contractor: { ...contractor, registered_agent_confirmed: false },
		}),
	}),
	// who is asking
	...scenario("no database binding", {
		wires: ALL,
		over: { music: { missing: true } },
	}),
	...two("no session cookie", { headers: { cookie: "" } }),
	...two("a cookie of the wrong shape", { headers: cookie("short") }),
	...two("a cookie that matches no session", {
		headers: cookie(OTHER_SESSION),
	}),
	...two("an archive session", {
		opts: { session: { purpose: "archive", offer_id: null, link_hash: null } },
	}),
	...two("an expired session", {
		opts: { session: { expires_at: "2026-11-13T11:59:59.999Z" } },
	}),
	...two("a revoked session", {
		opts: { session: { revoked_at: "2026-11-13T11:45:00.000Z" } },
	}),
	...two("a session of another offer", {
		opts: { session: { offer_id: "o-r2" }, extra: secondOffer() },
	}),
	...two("a session whose link is no longer the offer link", {
		opts: { session: { link_hash: "older-link-hash" } },
	}),
	...two("a session for another recipient than the offer", {
		opts: { session: { recipient_email: "other@example.test" } },
	}),
	...two("signing is off", { opts: { signing: false } }),
	...two(
		"signing is off and the csrf nonce is wrong: the session check comes first",
		{
			opts: { signing: false },
			input: { csrf_nonce: "wrong", values: values() },
		},
	),
	...two("the offer link was revoked", {
		opts: { offerLink: { revoked_at: "2026-11-13T11:30:00.000Z" } },
	}),
	...two("the offer was superseded", {
		opts: { offer: { status: "superseded" } },
	}),
	...two("the request was withdrawn", {
		opts: { request: { status: "withdrawn" } },
	}),
	...two("the request was resolved", {
		opts: { request: { status: "resolved" } },
	}),
	...two("a token of the wrong shape", { params: { token: "short" } }),
	...two("a token that matches no offer", { params: { token: OTHER_TOKEN } }),
	...two(
		"a token with markup characters shows only its escaped form in the page",
		{
			params: { token: `"><script>alert(1)</script>&'` },
		},
	),
	...two("the owner asking has no agreement session", {
		headers: { cookie: "" },
	}).map((c) => ({
		...c,
		steps: c.steps.map((step) => ({ ...step, as: asOwner() })),
	})),
	// the csrf nonce
	...two("no csrf nonce", { input: { values: values() } }),
	...two("a wrong csrf nonce", {
		input: { csrf_nonce: "wrong", values: values() },
	}),
	...two("an empty csrf nonce", {
		input: { csrf_nonce: "", values: values() },
	}),
	...two("a csrf nonce in capitals", {
		input: { csrf_nonce: CSRF.toUpperCase(), values: values() },
	}),
	...two("a csrf nonce that is a number", {
		input: { csrf_nonce: 5, values: values() },
	}),
	...two("a csrf nonce that is null", {
		input: { csrf_nonce: null, values: values() },
	}),
	...two("a csrf nonce that is a list", {
		input: { csrf_nonce: [CSRF], values: values() },
	}),
	// the details
	...two("no values", { input: { csrf_nonce: CSRF } }),
	...two("values that are null", { input: { csrf_nonce: CSRF, values: null } }),
	...two("values that are a list", { input: { csrf_nonce: CSRF, values: [] } }),
	...two("values that are text", {
		input: { csrf_nonce: CSRF, values: "legal_name" },
	}),
	...two("values that are an empty object", {
		input: { csrf_nonce: CSRF, values: {} },
	}),
	...one("an unknown field", { input: withValues({ nickname: "x" }) }),
	...two("a field that is a number", {
		input: { csrf_nonce: CSRF, values: { ...values(), legal_name: 5 } },
	}),
	...two("a field that is null", {
		input: { csrf_nonce: CSRF, values: { ...values(), signer_name: null } },
	}),
	...one("a field over its limit", {
		input: withValues({ legal_name: "x".repeat(201) }),
	}),
	...one("a control character", {
		input: withValues({ business_address: "A\u0007B" }),
	}),
	...one("each required field empty at once", {
		input: withValues({
			legal_name: "",
			entity_type: "",
			state: "",
			business_address: "",
			signer_name: "",
			signer_title: "",
			portfolio_choice: "",
		}),
	}),
	...one("an empty legal name", { input: withValues({ legal_name: "" }) }),
	...one("a legal name of spaces", {
		input: withValues({ legal_name: "    " }),
	}),
	...one("an empty business type", { input: withValues({ entity_type: "" }) }),
	...one("a business type outside the list", {
		input: withValues({ entity_type: "Wizard guild" }),
	}),
	...one("a business type in lower case", {
		input: withValues({ entity_type: "llc" }),
	}),
	...one("an empty state", { input: withValues({ state: "" }) }),
	...one("a state outside the list", {
		input: withValues({ state: "Narnia" }),
	}),
	...one("a state in lower case", { input: withValues({ state: "virginia" }) }),
	...one("Outside the US with no country", {
		input: withValues({ state: "Outside the US", country: "" }),
	}),
	...one("a country with a state that is not Outside the US is ignored", {
		input: withValues({ state: "Virginia", country: "Mars" }),
	}),
	...one("an empty business address", {
		input: withValues({ business_address: "" }),
	}),
	...one("an empty signer name", { input: withValues({ signer_name: "" }) }),
	...one("an empty signer title", { input: withValues({ signer_title: "" }) }),
	...one("no portfolio choice", {
		input: withValues({ portfolio_choice: "" }),
	}),
	...one("a portfolio choice outside the list", {
		input: withValues({ portfolio_choice: "everyone" }),
	}),
	...one("an invalid reviewer email", {
		input: withValues({ reviewer_email: "not an email" }),
	}),
	...one("an invalid approver email", {
		input: withValues({ approver_email: "not an email" }),
	}),
	...one("an invalid notice email", {
		input: withValues({ notice_email: "not an email" }),
	}),
	...one("a reviewer email with markup", {
		input: withValues({ reviewer_email: "<b>x</b>@example.test" }),
	}),
	...one("a started project ends the review", {
		opts: { extra: startedProject() },
	}),
	// outages
	...scenario("the signing switch lookup fails", {
		wires: ALL,
		over: {
			failures: [
				{
					on: /FROM software_signing_settings/,
					message: "signing lookup fails",
				},
			],
		},
	}),
	...outage(
		"the offer lookup fails",
		/SELECT o\.\* FROM software_offers o JOIN software_offer_links l/,
	),
	...outage(
		"the session lookup fails",
		/SELECT \* FROM software_agreement_sessions WHERE token_hash/,
	),
	...outage(
		"the draft save batch fails (its message is returned)",
		DRAFT_INSERT,
	),
	...outage(
		"the agreements lookup fails",
		/SELECT \* FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
	),
	...outage(
		"the client lookup fails",
		/SELECT id FROM software_agreement_clients WHERE recipient_email/,
	),
	...outage(
		"the reused MSA lookup fails",
		/SELECT \* FROM software_agreements WHERE id=\? AND kind='msa'/,
		1,
		reuse(),
	),
	...outage(
		"the MSA template lookup fails",
		/SELECT \* FROM software_agreement_templates WHERE id=\?/,
	),
	...outage(
		"the SOW template lookup fails",
		/SELECT \* FROM software_agreement_templates WHERE id=\?/,
		2,
	),
	...outage(
		"the pending MSA lookup fails",
		/SELECT \* FROM software_agreements WHERE client_id=\? AND template_id=\?/,
	),
	...outage("the review batch fails (its message is returned)", CLIENTS_INSERT),
	// races between the reads and the review batch
	...race(
		"the session is revoked before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
	),
	...race(
		"the session expires before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_agreement_sessions SET expires_at='2026-11-13T11:59:00.000Z'",
	),
	...race(
		"the offer link is revoked before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_offer_links SET revoked_at='2026-11-13T11:59:59.000Z'",
	),
	...race(
		"the request is withdrawn before the review batch",
		CLIENTS_INSERT,
		"UPDATE owner_requests SET status='withdrawn'",
	),
	...race(
		"signing is switched off before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_signing_settings SET software_signing_enabled=0",
	),
	...race(
		"the offer is superseded before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_offers SET status='superseded'",
	),
	...race(
		"the owner starts the project before the review batch",
		CLIENTS_INSERT,
		"INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r1','o-r1','{}','standard','t','t','t','o','t','t')",
	),
	...race(
		"another tab signs the agreement before the review batch",
		CLIENTS_INSERT,
		"UPDATE software_agreements SET status='client_signed'",
		{ agreements: "review" },
	),
	...race(
		"another tab saves a draft between the draft save and the review",
		CLIENTS_INSERT,
		`INSERT OR REPLACE INTO software_agreement_drafts VALUES('o-r1','${GRACE}','{"legal_name":"Other tab"}','2026-11-13T11:59:59.000Z')`,
	),
	...race(
		"the same legal party is created by another tab before the review batch",
		CLIENTS_INSERT,
		"INSERT INTO software_agreement_clients VALUES('client-race','grace@example.test','Hopper Systems LLC','hopper systems llc','LLC','Virginia','1 Main Street, Roanoke, VA 24011','grace@example.test','2026-11-13T11:59:59.000Z')",
	),
	...race(
		"another offer's MSA for the party appears before the review batch",
		CLIENTS_INSERT,
		"INSERT INTO software_agreement_clients VALUES('client-1','grace@example.test','Hopper Systems LLC','hopper systems llc','LLC','Virginia','1 Main Street, Roanoke, VA 24011','grace@example.test','2026-11-13T11:59:59.000Z'); INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r3','software','Grace','grace@example.test','x','reviewed','t','t'); INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('o-r3','r3',1,'sent','{}','t','t'); INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o-r3','r3','client-1','tpl-msa','review','x','" +
			"3".repeat(64) +
			"','{}','t','2026-11-13','h')",
	),
	...race(
		"a signature is saved between the draft save and the agreements lookup",
		/SELECT \* FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
		"UPDATE software_agreements SET status='client_signed'",
		{ agreements: "review" },
	),
	...race(
		"another offer's MSA for the same party is inserted after the pending check",
		CLIENTS_INSERT,
		"INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o-r3','r3','client-1','tpl-msa','review','x','" +
			"3".repeat(64) +
			"','{}','t','2026-11-13','h')",
		pendingElsewhere(false),
	),
	// sequences
	...one("a review is made twice and the second replaces the first", {
		steps: (send) => [send(), send()],
	}),
	...one("a review is made again with changed details", {
		steps: (send) => [
			send(),
			send(withValues({ legal_name: "Hopper Industries Inc" }), {
				advanceMs: 60_000,
			}),
		],
	}),
	...one("a refused review does not change the documents of an earlier one", {
		steps: (send) => [
			send(),
			send(withValues({ entity_type: "Wizard guild" })),
		],
	}),
	...one("a review after the agreement was signed on another tab", {
		steps: (send) => [
			send(),
			send(undefined, {
				before: {
					label: "the client signs",
					run: (world) =>
						world.music.exec(
							"UPDATE software_agreements SET status='client_signed'",
						),
				},
			}),
		],
	}),
	...one("a review after the session was revoked", {
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
	...one("a review and then the document download", {
		steps: (send) => [
			send(),
			{
				handler: GET,
				method: "GET",
				as: asVisitor({ ip: IP }),
				path: `${PATH}?document=${uuidFor(3)}`,
				params: { token: TOKEN },
				headers: cookie(),
			},
		],
	}),
];

// A native form post with a draft-shaped body that has another action or turns fields into booleans.
const forms: Case[] = [
	{
		name: "a form with an action field is not wrapped as values",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, action: "review", ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: REVIEW_TABLES },
			},
		],
	},
	{
		name: "a form with a consent field turns it into a boolean and fails the strict schema",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, consent: "on", ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: REVIEW_TABLES },
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
		name: "a form with a documents field that is JSON is ignored",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				body: formBody({ csrf_nonce: CSRF, documents: "[]", ...values() }),
				headers: { ...formHeaders(), ...cookie() },
				dump: { music: REVIEW_TABLES },
			},
		],
	},
	{
		name: "a JSON null body (the handler throws)",
		...agreementWorld(),
		steps: [
			{
				as: asVisitor({ ip: IP }),
				path: PATH,
				params: { token: TOKEN },
				json: null,
				headers: { ...SAME_ORIGIN, ...cookie() },
				dump: { music: REVIEW_TABLES },
			},
		],
	},
	...[
		["a JSON list body", []],
		["a JSON text body", "csrf"],
		["a JSON number body", 5],
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
			} satisfies Step,
		],
	})),
	...(["json", "form"] as const).flatMap((wire) => {
		const headers = (extra: { [name: string]: string }) => ({
			"content-type":
				wire === "json"
					? "application/json"
					: "application/x-www-form-urlencoded",
			...cookie(),
			...extra,
		});

		const body = (pad: number) =>
			wire === "json"
				? JSON.stringify({
						csrf_nonce: CSRF,
						values: values({ business_address: "x".repeat(pad) }),
					})
				: formBody({
						csrf_nonce: CSRF,
						...values({ business_address: "x".repeat(pad) }),
					});

		const sized = (target: number) => body(target - body(0).length);

		const step = (extra: Partial<Step>): Step => ({
			as: asVisitor({ ip: IP }),
			path: PATH,
			params: { token: TOKEN },
			...extra,
		});

		return [
			{
				name: `no Origin header (${wire})`,
				...agreementWorld(),
				steps: [step({ body: body(0), headers: headers({}) })],
			},
			{
				name: `an Origin from another site (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: body(0),
						headers: headers({ origin: "https://evil.example" }),
					}),
				],
			},
			{
				name: `an Origin with the http scheme (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: body(0),
						headers: headers({ origin: "http://thesuperhuman.us" }),
					}),
				],
			},
			{
				name: `a body of exactly 16384 bytes (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: sized(16384),
						headers: headers({ origin: "https://thesuperhuman.us" }),
					}),
				],
			},
			{
				name: `a body of 16385 bytes (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: sized(16385),
						headers: headers({ origin: "https://thesuperhuman.us" }),
					}),
				],
			},
			{
				name: `an empty body (${wire})`,
				...agreementWorld(),
				steps: [
					step({
						body: "",
						headers: headers({ origin: "https://thesuperhuman.us" }),
					}),
				],
			},
			{
				name: `no body at all (${wire})`,
				...agreementWorld(),
				steps: [
					step({ headers: headers({ origin: "https://thesuperhuman.us" }) }),
				],
			},
			{
				name: `no database binding is answered before the body is read (${wire})`,
				...agreementWorld(),
				music: { missing: true },
				steps: [step({ body: "{", headers: headers({}) })],
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
				dump: { music: REVIEW_TABLES },
			},
		],
	},
];

// The download. Each case is one GET.
const download = (
	name: string,
	opts: Opts = {},
	over: Partial<Step> = {},
	caseOver: Partial<Case> = {},
): Case => ({
	name,
	...agreementWorld({ agreements: "review", ...opts }),
	steps: [
		{
			handler: GET,
			method: "GET",
			as: asVisitor({ ip: IP }),
			path: `${PATH}?document=ag-sow`,
			params: { token: TOKEN },
			headers: cookie(),
			...over,
		},
	],
	...caseOver,
});

const gets: Case[] = [
	download("the SOW in review is downloaded as text"),
	download(
		"the MSA in review is downloaded as text",
		{},
		{ path: `${PATH}?document=ag-msa` },
	),
	download("a client-signed document is downloaded", {
		agreements: "client_signed",
	}),
	download("an executed document is downloaded", { agreements: "executed" }),
	download("an abandoned document is not found", { agreements: "abandoned" }),
	download(
		"a document of another review session is not found",
		{},
		{},
		{
			...agreementWorld({
				agreements: "review",
				sql: [
					"UPDATE software_agreements SET review_session_hash='another-session-hash'",
				],
			}),
		},
	),
	download("a document of another offer is not found", {
		extra: secondOffer(),
		sql: ["UPDATE software_agreements SET offer_id='o-r2', request_id='r2'"],
	}),
	download("an unknown document id", {}, { path: `${PATH}?document=nope` }),
	download("no document in the query", {}, { path: PATH }),
	download("an empty document in the query", {}, { path: `${PATH}?document=` }),
	download(
		"the first of two document queries is used",
		{},
		{ path: `${PATH}?document=ag-msa&document=ag-sow` },
	),
	download(
		"a document id with markup is not echoed",
		{},
		{ path: `${PATH}?document=%3Cscript%3Ealert(1)%3C%2Fscript%3E` },
	),
	download(
		"a document id in capitals is not found",
		{},
		{ path: `${PATH}?document=AG-SOW` },
	),
	download("the text with markup and unicode is returned as it is stored", {
		sql: [
			"UPDATE software_agreements SET canonical_text='<script>alert(1)</script> & \"q\" Zoë 株式会社 😀\n' WHERE id='ag-sow'",
		],
	}),
	download("an empty document text", {
		sql: ["UPDATE software_agreements SET canonical_text='' WHERE id='ag-sow'"],
	}),
	download("no session cookie", {}, { headers: {} }),
	download("a cookie of the wrong shape", {}, { headers: cookie("short") }),
	download(
		"a cookie that matches no session",
		{},
		{ headers: cookie(OTHER_SESSION) },
	),
	download("an expired session", {
		session: { expires_at: "2026-11-13T11:59:59.999Z" },
	}),
	download("a revoked session", {
		session: { revoked_at: "2026-11-13T11:45:00.000Z" },
	}),
	download("a session of another offer", {
		session: { offer_id: "o-r2" },
		extra: secondOffer(),
	}),
	download("signing is off", { signing: false }),
	download("the offer link was revoked", {
		offerLink: { revoked_at: "2026-11-13T11:30:00.000Z" },
	}),
	download("the offer was superseded", { offer: { status: "superseded" } }),
	download("the request was withdrawn", { request: { status: "withdrawn" } }),
	download("a token of the wrong shape", {}, { params: { token: "short" } }),
	download(
		"a token that matches no offer",
		{},
		{ params: { token: OTHER_TOKEN } },
	),
	download("no database binding", {}, {}, { music: { missing: true } }),
	download(
		"the owner asking has no agreement session",
		{},
		{ as: asOwner(), headers: {} },
	),
	download(
		"a POST body is not needed and a form content type changes nothing",
		{},
		{
			headers: {
				...cookie(),
				"content-type": "application/x-www-form-urlencoded",
			},
		},
	),
	download(
		"the agreements lookup fails",
		{},
		{},
		{
			failures: [
				{
					on: /SELECT \* FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
					message: "the lookup fails",
				},
			],
		},
	),
	download(
		"the session lookup fails",
		{},
		{},
		{
			failures: [
				{
					on: /SELECT \* FROM software_agreement_sessions WHERE token_hash/,
					message: "the lookup fails",
				},
			],
		},
	),
	download(
		"the signing lookup fails",
		{},
		{},
		{
			failures: [
				{ on: /FROM software_signing_settings/, message: "the lookup fails" },
			],
		},
	),
	download(
		"the session is revoked after it was checked and the document is still returned",
		{},
		{},
		{
			interleave: [
				{
					on: /SELECT \* FROM software_agreements WHERE offer_id=\? AND status<>'abandoned'/,
					label: "the session is revoked after the check",
					run: (sqlite) =>
						sqlite.exec(
							"UPDATE software_agreement_sessions SET revoked_at='2026-11-13T11:59:59.000Z'",
						),
				},
			],
		},
	),
];

defineCorpus("offer-review", POST, [...posts, ...forms, ...gets]);
