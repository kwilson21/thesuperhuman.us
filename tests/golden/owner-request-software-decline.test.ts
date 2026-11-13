import { POST } from "~/pages/api/owner/requests/[id]/software";
import {
	act,
	BASE,
	deposit,
	inserting,
	linkAgo,
	liveLink,
	mail,
	mailOutcomes,
	NOW,
	offer,
	offerTables,
	project,
	projectTables,
	refused,
	request,
	revokedLink,
	running,
	sent,
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
import type { JsonValue } from "../helpers/json";

// The golden corpus for the decline action of POST /api/owner/requests/[id]/software: the owner declines a software
// request. The first batch withdraws the draft and the sent offer, retires everything the client could still use to sign,
// closes the offer link and moves updated_at; then the route emails the client (and a copy to the owner); a second batch
// resolves the request and records "declined". The guards shared by every action are recorded in
// owner-request-software-fit.
//
// Every response branch of the decline action, and the cases that reach it:
//
//   guards   403 a visitor, a forged cookie; 503 no database; 400 text missing, empty, spaces only, not text, over 2000;
//            404 unknown id, another kind; 409 closed (withdrawn, empty email); 409 project started
//   409 "Void the open deposit invoice in Stripe before declining..."  a first-milestone deposit invoice that is creating,
//            open, payment_failed or uncollectible and not refunded; this check comes before the resolved check
//            (paid, refunded, void, a later milestone, a balance invoice do not block)
//   409 "This request is already resolved."  a resolved request with no open deposit
//   409 "An offer is still being sent..."    a live offer link created in the last 20 seconds (20 seconds exactly and a
//            revoked link do not count); also from the first batch's guard or the second batch's guard in a race
//   409 generic "...changed or could not be saved..."  the first batch fails a guard (updated_at, status or email moved; a
//            signed or executed agreement exists; a deposit invoice opened; an audio project exists) or throws
//   409 project started     the project appears before the first batch or the second batch
//   502 {ok:false,uncertain,message}  the client's email refused (not uncertain), answered 5xx or lost (uncertain), or not
//            configured (no key, sender or owner address). The first batch has already run: offers withdrawn, link
//            revoked, signing retired, updated_at moved; the request is not resolved and no audit row says "declined"
//   409 "The client email was sent, but..."  the second batch fails a guard or throws after the email
//   200 {ok:true,copySent}  both emails sent; the copy refused, answered 5xx or lost (copySent false)
//   effects: reads (the project pre-check, the open deposit invoices, the sending window), the first batch (signed-agreement
//   guard, request guard, sending guard, deposit guard, audio guard, no-project guard, withdraw offers, four
//   signing-retirement statements, revoke links, update updated_at, audit "offer-link-revoked"), Resend POST for the
//   client and one for the owner's copy, the second batch (request guard at the new time, no-project guard, sending guard,
//   audio guard, resolve, audit "declined"), and after a rolled-back batch the lookups that choose the 409.

const decline = (text: JsonValue = "Not a fit right now."): JsonValue => ({
	action: "decline",
	text,
});

const DECLINE_TABLES = [...offerTables, ...projectTables, "audio_projects"];

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, { dump: { music: DECLINE_TABLES }, ...extra });

/** A request with a sent offer and an old live link: the state a decline normally meets. */
const sentSeed = (
	extra: Seed = {},
	over: SeedRow = {},
	offers: readonly SeedRow[] = [offer("sent")],
	link: SeedRow = liveLink(),
) => withOffers(offers, { software_offer_links: [link], ...extra }, over);

const declineCase = (
	name: string,
	seed: Seed = sentSeed(),
	extra: Partial<Case> = {},
	body: JsonValue | undefined = decline(),
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	fetches: mail(),
	steps: [step(body, over)],
	...extra,
});

const signing = (status: string, over: SeedRow = {}) => ({
	...rows.agreementBase(),
	software_agreements: [rows.agreement("a1", "r1", "o1", { status, ...over })],
});

const movedUpdatedAt = running(
	"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
);

const cases: Case[] = [
	// who and what
	declineCase("a visitor", sentSeed(), {}, decline(), { as: asVisitor() }),
	declineCase("a forged studio cookie", sentSeed(), {}, decline(), {
		as: asClientCookie("forged"),
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [step(decline())],
	},
	declineCase("no text", sentSeed(), {}, { action: "decline" }),
	declineCase("an empty text", sentSeed(), {}, decline("")),
	declineCase("a text of only spaces", sentSeed(), {}, decline("  \n ")),
	declineCase("a text that is not text", sentSeed(), {}, decline(7)),
	declineCase(
		"a text over 2000 characters",
		sentSeed(),
		{},
		decline("d".repeat(2001)),
	),
	declineCase(
		"a text of exactly 2000 characters",
		sentSeed(),
		{},
		decline("d".repeat(2000)),
	),
	declineCase(
		"a text with unicode and markup",
		sentSeed(),
		{},
		decline(`Thanks 🙂 <b>&</b> "quoted" café`),
	),
	declineCase("an unknown request id", sentSeed(), {}, decline(), {
		path: `${BASE}/nope`,
		params: { id: "nope" },
	}),
	declineCase("a request of another kind", {
		owner_requests: [rows.ownerRequest("r1")],
	}),
	// the request
	declineCase("a new request with no offer at all", {
		owner_requests: [request({ status: "new" })],
	}),
	declineCase("a reviewed request with no offer", {
		owner_requests: [request()],
	}),
	declineCase("a withdrawn request", sentSeed({}, { status: "withdrawn" })),
	declineCase("a request with an empty email", sentSeed({}, { email: "" })),
	declineCase("a resolved request", sentSeed({}, { status: "resolved" })),
	declineCase(
		"a resolved request with an open deposit invoice is blocked by the deposit first",
		sentSeed({ software_invoices: [deposit("open")] }, { status: "resolved" }),
	),
	declineCase(
		"a request with a started project",
		sentSeed({ software_projects: [project()] }),
	),
	// the offers
	declineCase("a draft offer only", withOffers([offer("draft")])),
	declineCase(
		"a draft offer and a sent offer",
		sentSeed({}, {}, [offer("sent"), offer("draft", 2)]),
	),
	declineCase(
		"a superseded offer and a withdrawn offer are left as they are",
		sentSeed({}, {}, [offer("superseded"), offer("withdrawn", 2)]),
	),
	declineCase("a sent offer with no link", withOffers([offer("sent")])),
	declineCase(
		"a sent offer with a link that is already revoked",
		sentSeed({}, {}, [offer("sent")], revokedLink()),
	),
	// deposits
	...["creating", "open", "payment_failed", "uncollectible"].map((status) =>
		declineCase(
			`a deposit invoice that is ${status} blocks the decline`,
			sentSeed({ software_invoices: [deposit(status)] }),
		),
	),
	...["paid", "void"].map((status) =>
		declineCase(
			`a deposit invoice that is ${status} does not block the decline`,
			sentSeed({ software_invoices: [deposit(status)] }),
		),
	),
	declineCase(
		"a refunded open deposit invoice does not block the decline",
		sentSeed({
			software_invoices: [
				deposit("open", { refunded_at: "2026-11-13T11:30:00.000Z" }),
			],
		}),
	),
	declineCase(
		"an open deposit invoice of a later milestone does not block the decline",
		sentSeed({ software_invoices: [deposit("open", { milestone_index: 1 })] }),
	),
	declineCase(
		"an open balance invoice does not block the decline",
		sentSeed({ software_invoices: [deposit("open", { kind: "balance" })] }),
	),
	declineCase(
		"an open deposit invoice of a superseded offer blocks the decline",
		sentSeed({ software_invoices: [deposit("open")] }, {}, [
			offer("superseded"),
			offer("sent", 2),
		]),
	),
	// the sending window
	declineCase(
		"an offer sent 10 seconds ago",
		sentSeed({}, {}, [offer("sent")], linkAgo(10)),
	),
	declineCase(
		"an offer sent 19 seconds ago",
		sentSeed({}, {}, [offer("sent")], linkAgo(19)),
	),
	declineCase(
		"an offer sent exactly 20 seconds ago",
		sentSeed({}, {}, [offer("sent")], linkAgo(20)),
	),
	declineCase(
		"an offer sent 21 seconds ago",
		sentSeed({}, {}, [offer("sent")], linkAgo(21)),
	),
	declineCase(
		"a link revoked 10 seconds after it was made",
		sentSeed({}, {}, [offer("sent")], linkAgo(10, { revoked_at: NOW })),
	),
	// signing
	declineCase(
		"a review agreement is abandoned",
		sentSeed(signing("review")),
		{},
		decline(),
		{ dump: { music: [...DECLINE_TABLES, "software_agreement_events"] } },
	),
	declineCase(
		"a client-signed agreement blocks the decline",
		sentSeed(signing("client_signed")),
	),
	declineCase(
		"an executed agreement blocks the decline",
		sentSeed(signing("executed", { executed_at: NOW })),
	),
	declineCase(
		"an abandoned agreement does not block the decline",
		sentSeed(signing("abandoned")),
	),
	declineCase(
		"unsigned signing rows are retired: a saved draft, a link and a session",
		sentSeed({
			software_agreement_drafts: [
				{
					offer_id: "o1",
					recipient_email: "grace@example.test",
					values_json: "{}",
					updated_at: "2026-11-13T11:00:00.000Z",
				},
			],
			software_agreement_links: [
				{
					id: "link1",
					purpose: "agreement",
					offer_id: "o1",
					recipient_email: "grace@example.test",
					token_hash: "th1",
					issued_at: "2026-11-13T11:00:00.000Z",
					expires_at: "2026-11-14T11:00:00.000Z",
				},
			],
			software_agreement_sessions: [
				{
					token_hash: "sess1",
					purpose: "agreement",
					offer_id: "o1",
					recipient_email: "grace@example.test",
					link_id: "link1",
					verified_at: "2026-11-13T11:00:00.000Z",
					expires_at: "2026-11-14T11:00:00.000Z",
					csrf_nonce: "n",
				},
			],
		}),
	),
	declineCase(
		"an audio project for the request blocks the decline",
		sentSeed({
			audio_projects: [
				{
					request_id: "r1",
					created_at: "2026-11-13T11:00:00.000Z",
					updated_at: "2026-11-13T11:00:00.000Z",
				},
			],
		}),
	),
	// Resend and the environment
	...mailOutcomes.map(({ name, client, copy }) =>
		declineCase(`decline: ${name}`, sentSeed(), {
			fetches: mail(client, copy),
		}),
	),
	declineCase("no Resend key", sentSeed(), { omit: ["RESEND_API_KEY"] }),
	declineCase("no sender address", sentSeed(), {
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	declineCase("no owner address", sentSeed(), { omit: ["OWNER_EMAIL"] }),
	declineCase("Resend answers 500 to the client email", sentSeed(), {
		fetches: mail({ kind: "response", status: 500, text: "", headers: {} }),
	}),
	declineCase(
		"a text with a header-looking line",
		sentSeed(),
		{},
		decline("Hi\nBcc: x@example.test"),
	),
	declineCase(
		"a request email seeded in capitals with spaces by hand (cannot arise through the app)",
		sentSeed({}, { email: " Grace@Example.TEST " }),
	),
	declineCase(
		"a request whose updated_at is ahead of the clock",
		sentSeed({}, { updated_at: "2026-11-13T13:00:00.000Z" }),
	),
	// races on the first batch
	declineCase(
		"the request's updated_at moves before the first batch",
		sentSeed(),
		{
			interleave: [
				{
					on: /UPDATE software_offers SET status='withdrawn'/,
					label: "another change moves updated_at",
					run: movedUpdatedAt,
				},
			],
		},
	),
	declineCase("the request is withdrawn before the first batch", sentSeed(), {
		interleave: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				label: "the client withdraws",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	declineCase(
		"a signed agreement appears before the first batch",
		sentSeed(rows.agreementBase()),
		{
			interleave: [
				{
					on: /UPDATE software_offers SET status='withdrawn'/,
					label: "a client signs",
					run: inserting(
						"software_agreements",
						rows.agreement("a1", "r1", "o1"),
					),
				},
			],
		},
	),
	declineCase("a fresh offer link appears before the first batch", sentSeed(), {
		interleave: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				label: "an offer is sent a moment ago",
				run: running(`UPDATE software_offer_links SET created_at='${NOW}'`),
			},
		],
	}),
	declineCase("a deposit invoice opens before the first batch", sentSeed(), {
		interleave: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				label: "an invoice opens",
				run: inserting("software_invoices", deposit("open")),
			},
		],
	}),
	declineCase("a project starts before the first batch", sentSeed(), {
		interleave: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				label: "a project starts",
				run: inserting("software_projects", project()),
			},
		],
	}),
	declineCase("an audio project appears before the first batch", sentSeed(), {
		interleave: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				label: "an audio project appears",
				run: running(
					"INSERT INTO audio_projects(request_id,created_at,updated_at) VALUES ('r1','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')",
				),
			},
		],
	}),
	// races on the second batch
	declineCase("the request changes while the email is sent", sentSeed(), {
		interleave: [
			{
				on: /UPDATE owner_requests SET status='resolved'/,
				label: "another change moves updated_at",
				run: movedUpdatedAt,
			},
		],
	}),
	declineCase(
		"a fresh offer link appears while the email is sent",
		sentSeed(),
		{
			interleave: [
				{
					on: /UPDATE owner_requests SET status='resolved'/,
					label: "an offer is sent",
					run: running(
						`UPDATE software_offer_links SET created_at='${NOW}',revoked_at=NULL`,
					),
				},
			],
		},
	),
	declineCase("a project starts while the email is sent", sentSeed(), {
		interleave: [
			{
				on: /UPDATE owner_requests SET status='resolved'/,
				label: "a project starts",
				run: inserting("software_projects", project()),
			},
		],
	}),
	declineCase("an audio project appears while the email is sent", sentSeed(), {
		interleave: [
			{
				on: /UPDATE owner_requests SET status='resolved'/,
				label: "an audio project appears",
				run: running(
					"INSERT INTO audio_projects(request_id,created_at,updated_at) VALUES ('r1','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')",
				),
			},
		],
	}),
	// outages
	declineCase("the first read fails", sentSeed(), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	declineCase("the project pre-check fails", sentSeed(), {
		failures: [
			{ on: /^SELECT 1 FROM software_projects/, message: "D1 is down" },
		],
	}),
	declineCase("the deposit read fails", sentSeed(), {
		failures: [
			{ on: /SELECT i\.status FROM software_invoices/, message: "D1 is down" },
		],
	}),
	declineCase("the sending read fails", sentSeed(), {
		failures: [
			{ on: /^SELECT 1 FROM software_offer_links/, message: "D1 is down" },
		],
	}),
	declineCase("the first batch fails", sentSeed(), {
		failures: [
			{
				on: /UPDATE software_offers SET status='withdrawn'/,
				message: "D1 is down",
			},
		],
	}),
	declineCase("the second batch fails", sentSeed(), {
		failures: [
			{
				on: /UPDATE owner_requests SET status='resolved'/,
				message: "D1 is down",
			},
		],
	}),
	declineCase(
		"the second batch fails and so does the project lookup after it",
		sentSeed(),
		{
			failures: [
				{
					on: /UPDATE owner_requests SET status='resolved'/,
					message: "D1 is down",
				},
				{
					on: /^SELECT 1 FROM software_projects/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	declineCase(
		"the first batch fails and the lookups after it also fail",
		sentSeed(),
		{
			failures: [
				{
					on: /UPDATE software_offers SET status='withdrawn'/,
					message: "D1 is down",
				},
				{
					on: /^SELECT 1 FROM software_offer_links/,
					nth: 2,
					message: "D1 is down again",
				},
			],
		},
	),
	// sequences
	{
		name: "decline, then decline again",
		music: { seed: sentSeed() },
		fetches: mail(),
		steps: [step(decline()), step(decline("Again."), { advanceMs: 1000 })],
	},
	{
		name: "a decline whose email is refused, then the same decline",
		music: { seed: sentSeed() },
		fetches: byHost({ resend: [refused, sent] }),
		steps: [step(decline()), step(decline(), { advanceMs: 1000 })],
	},
	{
		name: "a decline whose email is lost, then the same decline",
		music: { seed: sentSeed() },
		fetches: byHost({ resend: [unreachable, sent] }),
		steps: [step(decline()), step(decline(), { advanceMs: 1000 })],
	},
	{
		name: "decline, then a fit note",
		music: { seed: sentSeed() },
		fetches: mail(),
		steps: [
			step(decline()),
			step(
				{ action: "fit", label: "stated-mismatch", note: "x" },
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "decline, then revoke the link that the decline already closed",
		music: { seed: sentSeed() },
		fetches: mail(),
		steps: [
			step(decline()),
			step(
				{ action: "revoke", expectedLinkCreatedAt: "2026-11-13T11:00:00.000Z" },
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "decline, then send the withdrawn offer",
		music: { seed: sentSeed() },
		fetches: mail(),
		steps: [
			step(decline()),
			step(
				{
					action: "send",
					version: 1,
					expectedUpdatedAt: "2026-11-13T11:00:00.000Z",
				},
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "decline, then a question",
		music: { seed: sentSeed() },
		fetches: mail(),
		steps: [
			step(decline()),
			step({ action: "question", text: "Still there?" }, { advanceMs: 1000 }),
		],
	},
];

defineCorpus("owner-request-software-decline", POST, cases);
