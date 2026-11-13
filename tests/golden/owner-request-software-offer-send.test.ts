import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	BASE,
	deposit,
	EARLIER,
	inserting,
	linkAgo,
	liveLink,
	mail,
	mailOutcomes,
	milestone,
	NOW,
	offer,
	offerTables,
	project,
	projectTables,
	refused,
	revokedLink,
	running,
	secondsFromNow,
	sent,
	template,
	terms,
	unreachable,
	withOffers,
} from "./areas/software-offers";
import {
	asClientCookie,
	asVisitor,
	byHost,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonObject, JsonValue } from "../helpers/json";

// The golden corpus for the send action of POST /api/owner/requests/[id]/software with signing off: the owner sends the
// saved draft (or reissues the link of the sent offer). One batch guards the request, the sending window, signed
// agreements, deposits, projects and the offer, supersedes the sent offer, marks the draft sent, writes a new hashed link
// (replacing any old one), retires signing and writes "offer-sent"; then the route emails the link to the client (and a
// copy to the owner) and checks that the link is still live. Signing on is in owner-request-software-offer-signing. The
// guards shared by every action are recorded in owner-request-software-fit.
//
// Every response branch of the send action, and the cases that reach it:
//
//   guards   403 a visitor, a forged cookie; 503 no database; 400 schema (version missing, 0, negative, fractional, text, null;
//            expectedUpdatedAt missing or not text); 404 unknown id, another kind; 409 closed (withdrawn, empty email);
//            409 resolved; 409 project started
//   409 "An offer is still being sent..."  a live link under 20 seconds old (checked first), or a link that became fresh
//            during the batch
//   409 "Save a valid draft before sending."  no offer, only superseded or withdrawn offers, a version that is not the draft's
//            (or the sent offer's when no draft exists), an updated_at that is not the offer's
//   400 {ok:false,errors}   the stored terms are not valid terms: {}, null, an array, a text, a missing field, a repeated
//            deliverable (shown with the error text of each field)
//   409 deposit block text  a draft is being sent over a sent offer whose first-milestone deposit invoice is creating, open,
//            payment_failed or uncollectible ("Void the open deposit invoice in Stripe first...") or paid ("A deposit is
//            already paid...")
//   500 "The offer link couldn't be built. Check SITE_ORIGIN."  SITE_ORIGIN that is not a URL (nothing written)
//   200 {ok:true,version,link,linkCreatedAt,sentAt,updatedAt,emailSent,uncertain,copySent}  a draft sent (the sent offer
//            superseded), a sent offer reissued after its link was revoked (sentAt and updatedAt kept), each Resend outcome
//            (a refused or lost client email still answers 200 with emailSent false and the link: the offer is sent and the
//            link is live)
//   409 "The email went out, but the link was closed while it was sending..."  the email was accepted and the link was
//            revoked, the offer superseded or the request withdrawn before the check
//   409 generic "...changed or could not be saved..."  a guard of the batch fails (updated_at, status or email moved; the
//            link is live when a reissue needs a revoked one; there is no link; a signed agreement exists; a deposit
//            invoice opened; the draft changed), the batch throws, stored terms that are not JSON, a read throws inside the
//            try, the check after the email throws (the email has already gone out)
//   409 project started     the project appears between the checks and the batch
//   rejected                the first read or the project pre-check throws
//   effects: reads (offers, sending window, deposits, signing setting), the batch, Resend POST for the client and one for
//   the owner's copy, the live-link read. No R2.

const sendBody = (
	version: JsonValue = 1,
	expectedUpdatedAt: JsonValue = EARLIER,
): JsonObject => ({ action: "send", version, expectedUpdatedAt });

const SEND_TABLES = [...offerTables, ...projectTables];

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, { dump: { music: SEND_TABLES }, ...extra });

const draftSeed = (
	over: SeedRow = {},
	extra: Seed = {},
	request: SeedRow = {},
) => withOffers([offer("draft", 1, over)], extra, request);

const sendCase = (
	name: string,
	seed: Seed = draftSeed(),
	extra: Partial<Case> = {},
	body: JsonValue | undefined = sendBody(),
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	fetches: mail(),
	steps: [step(body, over)],
	...extra,
});

/** A sent offer v1 that is being replaced by the draft v2, the state that deposits and signing guard. */
const replacing = (
	extra: Seed = {},
	request: SeedRow = {},
	link: SeedRow = liveLink(),
) =>
	withOffers(
		[offer("sent"), offer("draft", 2)],
		{ software_offer_links: [link], ...extra },
		request,
	);

const draft2 = sendBody(2);

const sentReissue = (link: SeedRow | null = revokedLink()) =>
	withOffers([offer("sent")], link ? { software_offer_links: [link] } : {});

const termsRow = (value: JsonValue) =>
	draftSeed({ terms_json: JSON.stringify(value) });

/** A draft whose stored terms are this text, whatever it is. */
const rawTermsRow = (text: string) => draftSeed({ terms_json: text });

const onBatch = /INSERT INTO software_offer_links/;

const liveCheck =
	/SELECT 1 FROM software_offer_links WHERE request_id=\? AND token_hash=\?/;

const cases: Case[] = [
	// who and what
	sendCase("a visitor", draftSeed(), {}, sendBody(), { as: asVisitor() }),
	sendCase("a forged studio cookie", draftSeed(), {}, sendBody(), {
		as: asClientCookie("forged"),
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [step(sendBody())],
	},
	sendCase(
		"no version",
		draftSeed(),
		{},
		{ action: "send", expectedUpdatedAt: EARLIER },
	),
	sendCase("a version of 0", draftSeed(), {}, sendBody(0)),
	sendCase("a negative version", draftSeed(), {}, sendBody(-1)),
	sendCase("a fractional version", draftSeed(), {}, sendBody(1.5)),
	sendCase("a version as text", draftSeed(), {}, sendBody("1")),
	sendCase("a version of null", draftSeed(), {}, sendBody(null)),
	sendCase(
		"no expectedUpdatedAt",
		draftSeed(),
		{},
		{ action: "send", version: 1 },
	),
	sendCase(
		"an expectedUpdatedAt that is a number",
		draftSeed(),
		{},
		sendBody(1, 5),
	),
	sendCase("an unknown request id", draftSeed(), {}, sendBody(), {
		path: `${BASE}/nope`,
		params: { id: "nope" },
	}),
	sendCase("a request of another kind", {
		owner_requests: [rows.ownerRequest("r1")],
	}),
	// the request
	sendCase("a reviewed request", draftSeed()),
	sendCase("a new request", draftSeed({}, {}, { status: "new" })),
	sendCase("a withdrawn request", draftSeed({}, {}, { status: "withdrawn" })),
	sendCase("a request with an empty email", draftSeed({}, {}, { email: "" })),
	sendCase("a resolved request", draftSeed({}, {}, { status: "resolved" })),
	sendCase(
		"a request with a started project",
		withOffers([offer("sent")], { software_projects: [project()] }),
	),
	// the offer
	sendCase("no offer at all", withOffers([])),
	sendCase("the draft", draftSeed()),
	sendCase("a draft with the wrong version", draftSeed(), {}, sendBody(2)),
	sendCase(
		"a draft with the wrong updated_at",
		draftSeed(),
		{},
		sendBody(1, "2026-11-13T10:00:00.000Z"),
	),
	sendCase(
		"a draft with an empty expected updated_at",
		draftSeed(),
		{},
		sendBody(1, ""),
	),
	sendCase(
		"a draft whose updated_at is ahead of the clock",
		draftSeed({ updated_at: secondsFromNow(3600) }),
		{},
		sendBody(1, secondsFromNow(3600)),
	),
	sendCase("only a superseded offer", withOffers([offer("superseded")])),
	sendCase("only a withdrawn offer", withOffers([offer("withdrawn")])),
	sendCase(
		"a draft and a sent offer: the draft is sent and the sent offer superseded",
		replacing(),
		{},
		draft2,
	),
	sendCase(
		"a draft and a sent offer: the sent offer's version is refused",
		replacing(),
		{},
		sendBody(1),
	),
	sendCase(
		"a draft of version 4 after earlier versions",
		withOffers(
			[
				offer("superseded", 1),
				offer("withdrawn", 2),
				offer("sent", 3),
				offer("draft", 4),
			],
			{ software_offer_links: [liveLink()] },
		),
		{},
		sendBody(4),
	),
	// reissue
	sendCase("a sent offer reissued after its link was revoked", sentReissue()),
	sendCase(
		"a sent offer whose link is live is not reissued",
		sentReissue(liveLink()),
	),
	sendCase("a sent offer with no link is not reissued", sentReissue(null)),
	sendCase("a reissue with the wrong version", sentReissue(), {}, sendBody(2)),
	sendCase(
		"a reissue with the wrong updated_at",
		sentReissue(),
		{},
		sendBody(1, "2026-11-13T10:00:00.000Z"),
	),
	sendCase(
		"a reissue of a sent offer whose link was revoked a second ago",
		withOffers([offer("sent")], {
			software_offer_links: [linkAgo(10, { revoked_at: secondsFromNow(-1) })],
		}),
	),
	// stored terms
	sendCase("stored terms of {}", rawTermsRow("{}")),
	sendCase("stored terms of null", rawTermsRow("null")),
	sendCase("stored terms that are an array", rawTermsRow("[]")),
	sendCase("stored terms that are a text", rawTermsRow('"terms"')),
	sendCase("stored terms that are not JSON", rawTermsRow("{not json")),
	sendCase("stored terms that are empty text", rawTermsRow("")),
	sendCase(
		"stored terms with a fee below $1",
		termsRow(terms({ milestones: [milestone({ feeCents: 5 })] })),
	),
	sendCase(
		"stored terms with repeated deliverables",
		termsRow(terms({ milestones: [milestone({ deliverables: ["A", "a"] })] })),
	),
	sendCase(
		"stored terms with an estimate below the total",
		termsRow(terms({ projectRange: { lowCents: 1, highCents: 2 } })),
	),
	sendCase(
		"stored terms in invoice mode with three milestones and checkpoints",
		termsRow(
			terms({
				paymentMode: "invoice",
				milestones: [
					milestone({ checkpoint: { label: "Mid", cancellationPercent: 60 } }),
					milestone({ name: "Two" }),
					milestone({ name: "Three" }),
				],
				projectRange: { lowCents: 720_000, highCents: 900_000 },
			}),
		),
	),
	sendCase(
		"stored terms with unicode and markup",
		termsRow(terms({ outcome: `<b>Café</b> & "co" 日本語 🙂`, summary: "s" })),
	),
	// deposits
	...[
		"creating",
		"open",
		"payment_failed",
		"uncollectible",
		"paid",
		"void",
	].map((status) =>
		sendCase(
			`a draft sent over an offer whose deposit invoice is ${status}`,
			replacing({ software_invoices: [deposit(status)] }),
			{},
			draft2,
		),
	),
	sendCase(
		"a deposit refunded after it was paid does not block",
		replacing({
			software_invoices: [deposit("paid", { refunded_at: EARLIER })],
		}),
		{},
		draft2,
	),
	sendCase(
		"an open deposit invoice of a later milestone does not block",
		replacing({ software_invoices: [deposit("open", { milestone_index: 1 })] }),
		{},
		draft2,
	),
	sendCase(
		"an open balance invoice does not block",
		replacing({ software_invoices: [deposit("open", { kind: "balance" })] }),
		{},
		draft2,
	),
	sendCase(
		"an open deposit of a superseded offer does not block",
		withOffers([offer("superseded"), offer("sent", 2), offer("draft", 3)], {
			software_offer_links: [liveLink()],
			software_invoices: [deposit("open")],
		}),
		{},
		sendBody(3),
	),
	sendCase(
		"an open deposit does not stop a reissue",
		withOffers([offer("sent")], {
			software_offer_links: [revokedLink()],
			software_invoices: [deposit("open")],
		}),
	),
	// the sending window
	sendCase(
		"a draft sent over a link made 10 seconds ago",
		replacing({}, {}, linkAgo(10)),
		{},
		draft2,
	),
	sendCase(
		"a draft sent over a link made exactly 20 seconds ago",
		replacing({}, {}, linkAgo(20)),
		{},
		draft2,
	),
	sendCase(
		"a draft sent over a link made 21 seconds ago",
		replacing({}, {}, linkAgo(21)),
		{},
		draft2,
	),
	sendCase(
		"a draft sent over a link revoked just after it was made",
		replacing({}, {}, linkAgo(10, { revoked_at: NOW })),
		{},
		draft2,
	),
	sendCase(
		"a first draft with an old revoked link",
		draftSeed({}, { software_offer_links: [revokedLink()] }),
	),
	// signing guards that apply without signing
	sendCase(
		"a signed agreement stops the send",
		{
			...replacing(),
			...rows.agreementBase(),
			software_agreements: [rows.agreement("a1", "r1", "o1")],
		},
		{},
		draft2,
	),
	sendCase(
		"an executed agreement stops the send",
		{
			...replacing(),
			...rows.agreementBase(),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", {
					status: "executed",
					executed_at: EARLIER,
				}),
			],
		},
		{},
		draft2,
	),
	sendCase("a client-signed agreement stops the reissue of the sent offer", {
		...rows.agreementBase(),
		...sentReissue(),
		software_agreements: [rows.agreement("a1", "r1", "o1")],
	}),
	sendCase(
		"an abandoned agreement does not stop the send",
		{
			...replacing(),
			...rows.agreementBase(),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", { status: "abandoned" }),
			],
		},
		{},
		draft2,
	),
	sendCase(
		"a review agreement is abandoned by the send",
		{
			...withOffers([offer("sent"), offer("draft", 2)], {
				software_offer_links: [liveLink()],
				...rows.agreementBase(),
				software_agreements: [
					rows.agreement("a1", "r1", "o1", { status: "review" }),
				],
			}),
		},
		{},
		draft2,
	),
	sendCase(
		"an offer with a pinned template is sent with signing off: the email says to sign outside the website",
		{
			software_agreement_templates: [template("msa"), template("sow")],
			...draftSeed({
				msa_template_id: "template-msa",
				sow_template_id: "template-sow",
			}),
		},
	),
	sendCase("a sent offer with pinned templates is reissued with signing off", {
		software_agreement_templates: [template("msa"), template("sow")],
		...withOffers(
			[
				offer("sent", 1, {
					msa_template_id: "template-msa",
					sow_template_id: "template-sow",
				}),
			],
			{ software_offer_links: [revokedLink()] },
		),
	}),
	// Resend and the environment
	...mailOutcomes.map(({ name, client, copy }) =>
		sendCase(`send: ${name}`, draftSeed(), { fetches: mail(client, copy) }),
	),
	sendCase("no Resend key", draftSeed(), { omit: ["RESEND_API_KEY"] }),
	sendCase("no sender address", draftSeed(), { omit: ["CONTACT_FROM_EMAIL"] }),
	sendCase("no owner address", draftSeed(), { omit: ["OWNER_EMAIL"] }),
	sendCase("Resend answers 500 to the client email", draftSeed(), {
		fetches: mail({ kind: "response", status: 500, text: "", headers: {} }),
	}),
	// the link
	sendCase("SITE_ORIGIN that is not a URL", draftSeed(), {
		env: { SITE_ORIGIN: "not a url" },
	}),
	sendCase("an empty SITE_ORIGIN", draftSeed(), { env: { SITE_ORIGIN: "" } }),
	sendCase("no SITE_ORIGIN", draftSeed(), { omit: ["SITE_ORIGIN"] }),
	sendCase("a SITE_ORIGIN with a path and a port", draftSeed(), {
		env: { SITE_ORIGIN: "http://localhost:4321/some/path?x=1" },
	}),
	// the greeting
	sendCase(
		"a client name with spaces around it and a second name",
		draftSeed({}, {}, { name: "  Ada   Lovelace " }),
	),
	sendCase("an empty client name", draftSeed({}, {}, { name: "" })),
	sendCase("a client name of only spaces", draftSeed({}, {}, { name: "   " })),
	sendCase(
		"a client name with markup",
		draftSeed({}, {}, { name: `<img src=x onerror=alert(1)> Mallory` }),
	),
	sendCase(
		"a client name with unicode",
		draftSeed({}, {}, { name: "Zoë 🙂 Müller" }),
	),
	sendCase(
		"a client email in capitals with spaces around it",
		draftSeed({}, {}, { email: " Grace@Example.TEST " }),
	),
	// races on the batch
	sendCase("the request's updated_at moves before the batch", draftSeed(), {
		interleave: [
			{
				on: onBatch,
				label: "another change moves updated_at",
				run: running(
					"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
				),
			},
		],
	}),
	sendCase("the request is withdrawn before the batch", draftSeed(), {
		interleave: [
			{
				on: onBatch,
				label: "the client withdraws",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	sendCase(
		"a link is made a moment ago by another send",
		replacing(),
		{
			interleave: [
				{
					on: onBatch,
					label: "another tab sends",
					run: running(`UPDATE software_offer_links SET created_at='${NOW}'`),
				},
			],
		},
		draft2,
	),
	sendCase(
		"a client signs before the batch",
		{ ...replacing(), ...rows.agreementBase() },
		{
			interleave: [
				{
					on: onBatch,
					label: "a client signs",
					run: inserting(
						"software_agreements",
						rows.agreement("a1", "r1", "o1"),
					),
				},
			],
		},
		draft2,
	),
	sendCase(
		"a deposit invoice opens before the batch",
		replacing(),
		{
			interleave: [
				{
					on: onBatch,
					label: "an invoice opens",
					run: inserting("software_invoices", deposit("open")),
				},
			],
		},
		draft2,
	),
	sendCase(
		"a project starts before the batch",
		replacing(),
		{
			interleave: [
				{
					on: onBatch,
					label: "a project starts",
					run: inserting("software_projects", project()),
				},
			],
		},
		draft2,
	),
	sendCase("the draft is saved again before the batch", draftSeed(), {
		interleave: [
			{
				on: onBatch,
				label: "another tab saves the draft",
				run: running(
					"UPDATE software_offers SET updated_at='2026-11-13T11:45:00.000Z'",
				),
			},
		],
	}),
	sendCase("the draft is withdrawn before the batch", draftSeed(), {
		interleave: [
			{
				on: onBatch,
				label: "the draft is withdrawn",
				run: running("UPDATE software_offers SET status='withdrawn'"),
			},
		],
	}),
	sendCase(
		"a reissue when another tab made a new live link first",
		sentReissue(),
		{
			interleave: [
				{
					on: onBatch,
					label: "another tab reissues",
					run: running(
						"UPDATE software_offer_links SET revoked_at=NULL,created_at='2026-11-13T11:40:00.000Z'",
					),
				},
			],
		},
	),
	sendCase("a reissue when the link is deleted first", sentReissue(), {
		interleave: [
			{
				on: onBatch,
				label: "the link is deleted",
				run: running("DELETE FROM software_offer_links"),
			},
		],
	}),
	// races after the email
	sendCase("the link is revoked while the email is sent", draftSeed(), {
		interleave: [
			{
				on: liveCheck,
				label: "another tab revokes the link",
				run: running(`UPDATE software_offer_links SET revoked_at='${NOW}'`),
			},
		],
	}),
	sendCase(
		"the link is revoked while an email that fails is sent",
		draftSeed(),
		{
			fetches: mail(refused),
			interleave: [
				{
					on: liveCheck,
					label: "another tab revokes the link",
					run: running(`UPDATE software_offer_links SET revoked_at='${NOW}'`),
				},
			],
		},
	),
	sendCase("the offer is withdrawn while the email is sent", draftSeed(), {
		interleave: [
			{
				on: liveCheck,
				label: "the offer is withdrawn",
				run: running("UPDATE software_offers SET status='withdrawn'"),
			},
		],
	}),
	sendCase("the request is withdrawn while the email is sent", draftSeed(), {
		interleave: [
			{
				on: liveCheck,
				label: "the client withdraws",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	sendCase(
		"the client's email is cleared while the email is sent",
		draftSeed(),
		{
			interleave: [
				{
					on: liveCheck,
					label: "personal data is deleted",
					run: running("UPDATE owner_requests SET email=''"),
				},
			],
		},
	),
	sendCase("the link is replaced while the email is sent", draftSeed(), {
		interleave: [
			{
				on: liveCheck,
				label: "another tab sends again",
				run: running("UPDATE software_offer_links SET token_hash='other'"),
			},
		],
	}),
	// outages
	sendCase("the first read fails", draftSeed(), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	sendCase("the project pre-check fails", draftSeed(), {
		failures: [
			{ on: /^SELECT 1 FROM software_projects/, message: "D1 is down" },
		],
	}),
	sendCase("the offers read fails", draftSeed(), {
		failures: [
			{
				on: /^SELECT \* FROM software_offers WHERE request_id/,
				message: "D1 is down",
			},
		],
	}),
	sendCase("the sending read fails", draftSeed(), {
		failures: [
			{ on: /^SELECT 1 FROM software_offer_links/, message: "D1 is down" },
		],
	}),
	sendCase(
		"the deposit read fails",
		replacing(),
		{
			failures: [
				{
					on: /SELECT i\.status FROM software_invoices/,
					message: "D1 is down",
				},
			],
		},
		draft2,
	),
	sendCase("the signing setting read fails", draftSeed(), {
		failures: [{ on: /FROM software_signing_settings/, message: "D1 is down" }],
	}),
	sendCase("the send batch fails", draftSeed(), {
		failures: [{ on: onBatch, message: "D1 is down" }],
	}),
	sendCase(
		"the send batch fails and the sending lookup after it fails",
		draftSeed(),
		{
			failures: [
				{ on: onBatch, message: "D1 is down" },
				{
					on: /^SELECT 1 FROM software_offer_links/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	sendCase("the check after the email fails", draftSeed(), {
		failures: [{ on: liveCheck, message: "D1 is down" }],
	}),
	sendCase(
		"the check after the email fails when the email failed too",
		draftSeed(),
		{
			fetches: mail(refused),
			failures: [{ on: liveCheck, message: "D1 is down" }],
		},
	),
	// sequences
	{
		name: "send, then send again inside the 20-second window",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [step(sendBody()), step(sendBody(1, NOW), { advanceMs: 5000 })],
	},
	{
		name: "send, then send again after the window",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [step(sendBody()), step(sendBody(1, NOW), { advanceMs: 21_000 })],
	},
	{
		name: "send, revoke after the window, then reissue",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [
			step(sendBody()),
			step(
				{ action: "revoke", expectedLinkCreatedAt: NOW },
				{ advanceMs: 21_000 },
			),
			step(sendBody(1, NOW), { advanceMs: 1000 }),
		],
	},
	{
		name: "send, save a new draft, send it, and the first link stops working",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [
			step(sendBody()),
			step(
				{
					action: "draft",
					terms: terms({ summary: "Second version." }),
					expectedUpdatedAt: null,
				},
				{ advanceMs: 21_000 },
			),
			step(sendBody(2, secondsFromNow(21)), { advanceMs: 21_000 }),
		],
	},
	{
		name: "send with the email refused, then send again after the window",
		music: { seed: draftSeed() },
		fetches: byHost({ resend: [refused, sent] }),
		steps: [step(sendBody()), step(sendBody(1, NOW), { advanceMs: 21_000 })],
	},
	{
		name: "send with the network down, revoke, then reissue with the network back",
		music: { seed: draftSeed() },
		fetches: byHost({ resend: [unreachable, sent] }),
		steps: [
			step(sendBody()),
			step(
				{ action: "revoke", expectedLinkCreatedAt: NOW },
				{ advanceMs: 21_000 },
			),
			step(sendBody(1, NOW), { advanceMs: 1000 }),
		],
	},
	{
		name: "send, then decline the sent offer",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [
			step(sendBody()),
			step(
				{ action: "decline", text: "Changed our mind." },
				{ advanceMs: 21_000 },
			),
		],
	},
	{
		name: "send, then send a wrong version",
		music: { seed: draftSeed() },
		fetches: mail(),
		steps: [step(sendBody()), step(sendBody(2, NOW), { advanceMs: 21_000 })],
	},
];

defineCorpus("owner-request-software-offer-send", POST, cases);
