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
	offer,
	offerTables,
	project,
	projectTables,
	revokedLink,
	running,
	secondsFromNow,
	terms,
	withOffers,
} from "./areas/software-offers";
import {
	asClientCookie,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Seed,
	type SeedRow,
	type Step,
} from "./harness";
import type { JsonValue } from "../helpers/json";

// The golden corpus for the revoke action of POST /api/owner/requests/[id]/software: the owner closes the client's offer
// link. One batch checks the request, retires everything the client could still use to sign (unsigned reviews abandoned,
// saved drafts deleted, sessions revoked, sign-in links used), checks the offer is not still sending, checks the link is the
// one the page showed (by its created_at), revokes it and writes "offer-link-revoked". No email, no R2. The guards shared by
// every action are recorded in owner-request-software-fit. Revoke is the one action a withdrawn request and a request with a
// started project still accept (only a closed request with no email, an unknown id and the schema stop it).
//
// Every response branch of the revoke action, and the cases that reach it:
//
//   guards   403 a visitor, a forged cookie; 503 no database; 400 expectedLinkCreatedAt missing, empty, not text, null;
//            404 unknown id, another kind; 409 closed: an empty email only (a withdrawn request is allowed through)
//   200 {ok:true}    a live link whose created_at matches, on a new, reviewed, resolved, withdrawn request, with a started
//                    project, with each offer status, with a signed agreement and an open deposit (neither blocks it), with
//                    a link 20 seconds old or older, retiring review agreements, drafts, sessions and sign-in links
//   409 "The client link changed since this page loaded..."  the link's created_at differs, the link is already revoked, there
//                    is no link, or another writer replaced or revoked it during the batch
//   409 "An offer is still being sent..."  the matching link is under 20 seconds old
//   409 generic "...changed or could not be saved..."  updated_at, status or email moved during the batch; the batch throws
//   rejected         the batch throws and the lookup in the catch block throws too
//   effects: one batch (request guard, four signing-retirement statements, sending guard, link guard, revoke, audit), then,
//   when it rolls back, one or two lookups to decide which 409 to answer.

const revoke = (at: JsonValue = EARLIER): JsonValue => ({
	action: "revoke",
	expectedLinkCreatedAt: at,
});

const step = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act(body, {
		dump: { music: [...offerTables, ...projectTables] },
		...extra,
	});

const seedWith = (
	extra: Seed = {},
	over: SeedRow = {},
	offers: readonly SeedRow[] = [offer("sent")],
	link: SeedRow | null = liveLink(),
) =>
	withOffers(
		offers,
		{ software_offer_links: link ? [link] : [], ...extra },
		over,
	);

const revokeCase = (
	name: string,
	seed: Seed = seedWith(),
	extra: Partial<Case> = {},
	body: JsonValue | undefined = revoke(),
	over: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	steps: [step(body, over)],
	...extra,
});

const signing = (status: string, over: SeedRow = {}, id = "a1") => ({
	...rows.agreementBase(),
	software_agreements: [rows.agreement(id, "r1", "o1", { status, ...over })],
});

const signingRows = () => ({
	software_agreement_drafts: [
		{
			offer_id: "o1",
			recipient_email: "grace@example.test",
			values_json: "{}",
			updated_at: EARLIER,
		},
	],
	software_agreement_links: [
		{
			id: "link1",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: "grace@example.test",
			token_hash: "th1",
			issued_at: EARLIER,
			expires_at: "2026-11-14T11:00:00.000Z",
			used_at: null,
		},
		{
			id: "link2",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: "grace@example.test",
			token_hash: "th2",
			issued_at: EARLIER,
			expires_at: "2026-11-14T11:00:00.000Z",
			used_at: "2026-11-13T11:10:00.000Z",
		},
	],
	software_agreement_sessions: [
		{
			token_hash: "sess1",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: "grace@example.test",
			link_id: "link1",
			verified_at: EARLIER,
			expires_at: "2026-11-14T11:00:00.000Z",
			revoked_at: null,
			csrf_nonce: "n",
		},
		{
			token_hash: "sess2",
			purpose: "agreement",
			offer_id: "o1",
			recipient_email: "grace@example.test",
			link_id: "link1",
			verified_at: EARLIER,
			expires_at: "2026-11-14T11:00:00.000Z",
			revoked_at: "2026-11-13T11:20:00.000Z",
			csrf_nonce: "n2",
		},
	],
});

const moved = running(
	"UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'",
);

const onBatch = /UPDATE software_offer_links SET revoked_at/;

const cases: Case[] = [
	// who and what
	revokeCase("a visitor", seedWith(), {}, revoke(), { as: asVisitor() }),
	revokeCase("a forged studio cookie", seedWith(), {}, revoke(), {
		as: asClientCookie("forged"),
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [step(revoke())],
	},
	revokeCase("no expectedLinkCreatedAt", seedWith(), {}, { action: "revoke" }),
	revokeCase("an empty expectedLinkCreatedAt", seedWith(), {}, revoke("")),
	revokeCase(
		"an expectedLinkCreatedAt that is not text",
		seedWith(),
		{},
		revoke(5),
	),
	revokeCase("an expectedLinkCreatedAt of null", seedWith(), {}, revoke(null)),
	revokeCase("an unknown request id", seedWith(), {}, revoke(), {
		path: `${BASE}/nope`,
		params: { id: "nope" },
	}),
	revokeCase("a request of another kind", {
		owner_requests: [rows.ownerRequest("r1")],
	}),
	// the request
	revokeCase("a reviewed request", seedWith()),
	revokeCase("a new request", seedWith({}, { status: "new" })),
	revokeCase("a resolved request", seedWith({}, { status: "resolved" })),
	revokeCase("a withdrawn request", seedWith({}, { status: "withdrawn" })),
	revokeCase("a request with an empty email", seedWith({}, { email: "" })),
	revokeCase(
		"a withdrawn request with an empty email",
		seedWith({}, { status: "withdrawn", email: "" }),
	),
	revokeCase(
		"a request with a started project",
		seedWith({ software_projects: [project()] }),
	),
	revokeCase(
		"a request whose updated_at is ahead of the clock",
		seedWith({}, { updated_at: secondsFromNow(3600) }),
	),
	// the link
	revokeCase(
		"a link made 21 seconds ago",
		seedWith({}, {}, [offer("sent")], linkAgo(21)),
		{},
		revoke(secondsFromNow(-21)),
	),
	revokeCase(
		"a link made exactly 20 seconds ago",
		seedWith({}, {}, [offer("sent")], linkAgo(20)),
		{},
		revoke(secondsFromNow(-20)),
	),
	revokeCase(
		"a link made 19 seconds ago",
		seedWith({}, {}, [offer("sent")], linkAgo(19)),
		{},
		revoke(secondsFromNow(-19)),
	),
	revokeCase(
		"a link made 1 second ago",
		seedWith({}, {}, [offer("sent")], linkAgo(1)),
		{},
		revoke(secondsFromNow(-1)),
	),
	revokeCase(
		"a link whose created_at is not the one the page showed",
		seedWith(),
		{},
		revoke("2026-11-13T10:00:00.000Z"),
	),
	revokeCase(
		"an expectedLinkCreatedAt in another time format",
		seedWith(),
		{},
		revoke("2026-11-13T11:00:00Z"),
	),
	revokeCase(
		"an expectedLinkCreatedAt of one space",
		seedWith(),
		{},
		revoke(" "),
	),
	revokeCase(
		"a link that is already revoked",
		seedWith({}, {}, [offer("sent")], revokedLink()),
	),
	revokeCase("a request with no link", seedWith({}, {}, [offer("sent")], null)),
	revokeCase("a request with no offer and no link", seedWith({}, {}, [], null)),
	revokeCase("a link with no offer", seedWith({}, {}, [])),
	// the offers
	revokeCase(
		"a draft and a sent offer",
		seedWith({}, {}, [offer("sent"), offer("draft", 2)]),
	),
	revokeCase("a draft offer only", seedWith({}, {}, [offer("draft")])),
	revokeCase("a superseded offer", seedWith({}, {}, [offer("superseded")])),
	revokeCase("a withdrawn offer", seedWith({}, {}, [offer("withdrawn")])),
	// signing
	revokeCase(
		"a review MSA is abandoned, a client-signed SOW and an abandoned MSA are not",
		{
			...seedWith({ ...rows.agreementBase() }),
			software_agreements: [
				rows.agreement("a1", "r1", "o1", { status: "review" }),
				rows.agreement("a2", "r1", "o1", {
					kind: "sow",
					status: "client_signed",
				}),
				rows.agreement("a3", "r1", "o1", { status: "abandoned" }),
			],
		},
	),
	revokeCase(
		"signing rows are retired: a draft, two links, two sessions",
		seedWith(signingRows()),
	),
	revokeCase(
		"a signed agreement does not stop the revoke",
		seedWith(signing("client_signed")),
	),
	revokeCase(
		"an executed agreement does not stop the revoke",
		seedWith(signing("executed", { executed_at: EARLIER })),
	),
	revokeCase(
		"an open deposit invoice does not stop the revoke",
		seedWith({ software_invoices: [deposit("open")] }),
	),
	// races
	revokeCase("the request's updated_at moves before the batch", seedWith(), {
		interleave: [
			{ on: onBatch, label: "another change moves updated_at", run: moved },
		],
	}),
	revokeCase("the request is withdrawn before the batch", seedWith(), {
		interleave: [
			{
				on: onBatch,
				label: "the client withdraws",
				run: running("UPDATE owner_requests SET status='withdrawn'"),
			},
		],
	}),
	revokeCase("the client's email is cleared before the batch", seedWith(), {
		interleave: [
			{
				on: onBatch,
				label: "personal data is deleted",
				run: running("UPDATE owner_requests SET email=''"),
			},
		],
	}),
	revokeCase("another writer replaces the link before the batch", seedWith(), {
		interleave: [
			{
				on: onBatch,
				label: "an offer is sent again",
				run: running(
					"UPDATE software_offer_links SET token_hash='other',created_at='2026-11-13T11:45:00.000Z'",
				),
			},
		],
	}),
	revokeCase("another writer revokes the link before the batch", seedWith(), {
		interleave: [
			{
				on: onBatch,
				label: "another tab revokes",
				run: running(
					"UPDATE software_offer_links SET revoked_at='2026-11-13T11:50:00.000Z'",
				),
			},
		],
	}),
	revokeCase("a project starts before the batch", seedWith(), {
		interleave: [
			{
				on: onBatch,
				label: "a project starts",
				run: inserting("software_projects", project()),
			},
		],
	}),
	// outages
	revokeCase("the first read fails", seedWith(), {
		failures: [
			{ on: /FROM owner_requests WHERE id=\?/, message: "D1 is down" },
		],
	}),
	revokeCase("the batch fails", seedWith(), {
		failures: [{ on: onBatch, message: "D1 is down" }],
	}),
	revokeCase(
		"the batch fails and the link lookup after it also fails",
		seedWith(),
		{
			failures: [
				{ on: onBatch, message: "D1 is down" },
				{
					on: /^SELECT 1 FROM software_offer_links/,
					message: "D1 is down again",
				},
			],
		},
	),
	revokeCase(
		"a link made 10 seconds ago and the lookups after the batch fail",
		seedWith({}, {}, [offer("sent")], linkAgo(10)),
		{
			failures: [
				{
					on: /^SELECT 1 FROM software_offer_links/,
					nth: 2,
					message: "D1 is down",
				},
			],
		},
		revoke(secondsFromNow(-10)),
	),
	// sequences
	{
		name: "revoke, then revoke the same link again",
		music: { seed: seedWith() },
		steps: [step(revoke()), step(revoke(), { advanceMs: 1000 })],
	},
	{
		name: "revoke, then a fit note",
		music: { seed: seedWith() },
		steps: [
			step(revoke()),
			step(
				{ action: "fit", label: "potential-fit", note: "x" },
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "revoke, then a new draft",
		music: { seed: seedWith() },
		steps: [
			step(revoke()),
			step(
				{
					action: "draft",
					terms: terms(),
					expectedUpdatedAt: null,
				},
				{ advanceMs: 1000 },
			),
		],
	},
	{
		name: "a link made 10 seconds ago: revoke refuses, then works 11 seconds later",
		music: { seed: seedWith({}, {}, [offer("sent")], linkAgo(10)) },
		steps: [
			step(revoke(secondsFromNow(-10))),
			step(revoke(secondsFromNow(-10)), { advanceMs: 11_000 }),
		],
	},
	{
		name: "revoke after the request is withdrawn in between, then revoke again",
		music: { seed: seedWith({}, {}, [offer("sent")], liveLink()) },
		fetches: mail(),
		steps: [
			step(revoke(), {
				before: {
					label: "the client withdraws",
					run: (world) =>
						world.music.exec("UPDATE owner_requests SET status='withdrawn'"),
				},
			}),
			step(revoke(), { advanceMs: 1000 }),
		],
	},
];

defineCorpus("owner-request-software-revoke", POST, cases);
