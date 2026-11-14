import { POST } from "~/pages/api/owner/requests/[id]/agreement";
import {
	BOTH,
	LATER,
	MSA_HASH,
	MSA_ID,
	OTHER_ID,
	PAST,
	SOW_HASH,
	SOW_ONLY,
	abandonBody,
	clientSigned,
	countersignBody,
	deposit,
	doc,
	notificationRows,
	openLink,
	own,
	ownBoth,
	ownForm,
	ownerJson,
	reusedReady,
	scene,
	type Scene,
} from "./areas/signing";
import { asOwner, asVisitor, defineCorpus, type Case } from "./harness";

// The golden corpus for POST /api/owner/requests/[id]/agreement, action "abandon": the owner abandons the signing action
// the client already signed. One batch abandons the documents, supersedes the offer, revokes the client's link and
// sessions and deletes the saved draft. A deposit invoice that still counts blocks it. Names starting "form:" send the
// same request as an urlencoded form; the others send JSON.
//
//   200 {ok:true}        the batch committed (a form gets a 303 to /owner/requests/r1)
//   400                  documents, reason or confirmed missing or wrong (owner-request-agreement-wire holds the shared ones)
//   409 {ok:false}       no sent offer for the request
//   409 "Review the complete pending signing action."   nothing client_signed, or the named documents differ in id,
//                        hash or number from the client_signed ones
//   409 "Void or refund the deposit invoice first."     a deposit invoice for milestone 0 that is creating, open,
//                        payment_failed, uncollectible, or paid and not refunded: before the batch, and after a failed
//                        batch when one appeared meanwhile
//   409 "The agreement changed or the operation failed. Reload before retrying."   a guard lost to a race, or the batch
//                        threw with no deposit to blame
//   rejected             an outage on the offer lookup, or on the deposit recheck after a failed batch

const BATCH = /UPDATE software_agreements SET status='abandoned'/;

const pending: Scene = clientSigned({
	extra: { software_agreement_links: [openLink] },
});

const signs = (over: Scene = {}): Scene => ({ ...pending, ...over });

const reasoned = (name: string, reason: JsonValueLoose) =>
	own(name, pending, abandonBody({ reason }));

type JsonValueLoose = string | number | boolean | null;

const sentOffer = (
	name: string,
	sc: Scene,
	body = abandonBody(),
	extra: Partial<Case> = {},
): Case => own(name, sc, body, extra);

const hashed = (hash: string) => ({ row: { text_sha256: hash } });

const success: Case[] = [
	...ownBoth("abandon both documents", pending, abandonBody()),
	sentOffer(
		"abandon with the documents in the other order",
		pending,
		abandonBody({ documents: [...BOTH].reverse() }),
	),
	sentOffer(
		"abandon closes a notice that was still sending",
		signs({
			notifications: notificationRows("sending", {
				attempted_at: PAST,
				attempt_id: "a",
			}),
		}),
	),
	sentOffer(
		"abandon leaves sent and failed notices alone",
		signs({ notifications: notificationRows("sent", { sent_at: PAST }) }),
	),
	sentOffer("abandon deletes the saved draft", signs({ draft: {} })),
	sentOffer(
		"abandon with no draft and no notices",
		signs({ notifications: false }),
	),
	sentOffer(
		"abandon revokes every session of the offer",
		signs({ extra: { software_agreement_links: [openLink] } }),
	),
	sentOffer(
		"abandon with a session that is already revoked",
		signs({ session: { revoked_at: PAST } }),
	),
	sentOffer("abandon with no client session at all", signs({ session: false })),
	sentOffer("abandon revokes the offer link", pending),
	sentOffer(
		"abandon when the offer link was revoked already",
		signs({ link: { revoked_at: PAST } }),
	),
	sentOffer(
		"abandon a request that is resolved",
		signs({ request: { status: "resolved" } }),
	),
	sentOffer(
		"abandon a request that is withdrawn",
		signs({ request: { status: "withdrawn" } }),
	),
	sentOffer(
		"abandon with a project already started",
		signs({
			extra: {
				software_projects: [
					{
						request_id: "r1",
						offer_id: "o1",
						terms_json: "{}",
						payment_mode: "standard",
						signatures_recorded_at: PAST,
						first_payment_recorded_at: PAST,
						started_at: PAST,
						started_by: "o",
						created_at: PAST,
						updated_at: PAST,
					},
				],
			},
		}),
	),
	own(
		"abandon by an owner email in capitals",
		pending,
		abandonBody(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	own(
		"abandon by an owner email with markup",
		pending,
		abandonBody(),
		{},
		{ as: asOwner("o<b>@example.test") },
	),
];

const reasons: Case[] = [
	reasoned(
		"a reason with accents and a symbol",
		"Le client a demandé un changement d'étendue ✓",
	),
	reasoned("a reason written decomposed is stored composed", "Café"),
	reasoned("a reason padded with spaces", "   scope changed   "),
	reasoned(
		"a reason with markup and quotes",
		`<script>alert("x")</script> & 'y'`,
	),
	reasoned("a reason in Chinese", "客户要求更改范围"),
	reasoned("a reason with an emoji", "Client left 🙂"),
	reasoned("a reason with a line break", "line one\nline two"),
	reasoned("a reason of 1000 characters", "r".repeat(1000)),
	reasoned("a reason of 1001 characters", "r".repeat(1001)),
	reasoned("an empty reason", ""),
	reasoned("a reason of only spaces", "   "),
	reasoned("a reason with a control character", "a\u0007b"),
	reasoned("a reason that is not text", 5),
	reasoned("a reason that is null", null),
	own("no reason", pending, {
		action: "abandon",
		documents: BOTH,
		confirmed: true,
	}),
	own("confirmed false", pending, abandonBody({ confirmed: false })),
	own("confirmed as text", pending, abandonBody({ confirmed: "true" })),
	own("no confirmation", pending, {
		action: "abandon",
		documents: BOTH,
		reason: "x",
	}),
	own("no documents", pending, {
		action: "abandon",
		reason: "x",
		confirmed: true,
	}),
	own("an empty documents list", pending, abandonBody({ documents: [] })),
	own(
		"three documents",
		pending,
		abandonBody({ documents: [...BOTH, { id: OTHER_ID, hash: MSA_HASH }] }),
	),
	own(
		"a document id that is not a uuid",
		pending,
		abandonBody({ documents: [{ id: "x", hash: SOW_HASH }] }),
	),
	own(
		"a document hash in capitals",
		pending,
		abandonBody({ documents: [{ id: MSA_ID, hash: MSA_HASH.toUpperCase() }] }),
	),
	...ownBoth("an empty reason (twin)", pending, abandonBody({ reason: "" })),
];

const states: Case[] = [
	sentOffer(
		"no sent offer: superseded",
		signs({ offer: { status: "superseded" } }),
	),
	sentOffer(
		"no sent offer: withdrawn",
		signs({ offer: { status: "withdrawn" } }),
	),
	sentOffer("no sent offer: draft", signs({ offer: { status: "draft" } })),
	...ownBoth(
		"documents still in review: nothing to abandon",
		{ msa: doc("review"), sow: doc("review") },
		abandonBody(),
	),
	sentOffer("documents already executed", {
		msa: doc("executed"),
		sow: doc("executed"),
	}),
	sentOffer("documents already abandoned", {
		msa: doc("abandoned"),
		sow: doc("abandoned"),
	}),
	sentOffer("no documents at all", { msa: false, sow: false }),
	sentOffer(
		"a hash that differs",
		pending,
		abandonBody({ documents: [{ id: MSA_ID, hash: SOW_HASH }, BOTH[1]] }),
	),
	sentOffer(
		"an id that does not exist",
		pending,
		abandonBody({ documents: [BOTH[0], { id: OTHER_ID, hash: SOW_HASH }] }),
	),
	sentOffer(
		"only the SOW named while both are pending",
		pending,
		abandonBody({ documents: SOW_ONLY }),
	),
	sentOffer(
		"only the MSA named while both are pending",
		pending,
		abandonBody({ documents: [BOTH[0]] }),
	),
	sentOffer(
		"a stored hash that no longer matches",
		signs({ sow: doc("client_signed", hashed("f".repeat(64))) }),
	),
	sentOffer(
		"only the SOW is client_signed and the MSA is in review: the SOW alone is named",
		{
			msa: doc("review"),
			sow: doc("client_signed"),
			extra: { software_agreement_links: [openLink] },
		},
		abandonBody({ documents: SOW_ONLY }),
	),
	sentOffer("only the SOW is client_signed and both are named", {
		msa: doc("review"),
		sow: doc("client_signed"),
	}),
	sentOffer(
		"one document executed and the other client_signed",
		{ msa: doc("executed"), sow: doc("client_signed") },
		abandonBody({ documents: SOW_ONLY }),
	),
	sentOffer(
		"a reused MSA: the SOW alone is abandoned and the MSA stays executed",
		{
			reused: reusedReady,
			msa: false,
			sow: doc("client_signed"),
			extra: { software_agreement_links: [openLink] },
		},
		abandonBody({ documents: SOW_ONLY }),
	),
	sentOffer("a reused MSA but both documents named", {
		reused: reusedReady,
		msa: false,
		sow: doc("client_signed"),
	}),
];

states.push(
	own(
		"abandon for a request that has no offer",
		pending,
		abandonBody(),
		{},
		{
			path: "/api/owner/requests/r9/agreement",
			params: { id: "r9" },
		},
	),
);

const deposits: Case[] = [
	...(["creating", "open", "payment_failed", "uncollectible"] as const).map(
		(status) =>
			sentOffer(
				`a deposit invoice that is ${status}`,
				signs({ extra: { software_invoices: [deposit(status)] } }),
			),
	),
	sentOffer(
		"a deposit invoice that is paid and not refunded",
		signs({ extra: { software_invoices: [deposit("paid")] } }),
	),
	...ownBoth(
		"a deposit invoice that is paid (twin)",
		signs({ extra: { software_invoices: [deposit("paid")] } }),
		abandonBody(),
	),
	sentOffer(
		"a deposit invoice that was refunded",
		signs({
			extra: { software_invoices: [deposit("paid", { refunded_at: PAST })] },
		}),
	),
	sentOffer(
		"a deposit invoice that is void",
		signs({ extra: { software_invoices: [deposit("void")] } }),
	),
	sentOffer(
		"a balance invoice that is open",
		signs({
			extra: { software_invoices: [deposit("open", { kind: "balance" })] },
		}),
	),
	sentOffer(
		"a deposit invoice of the second milestone",
		signs({
			extra: {
				software_invoices: [
					deposit("open", { milestone_index: 1, kind: "milestone" }),
				],
			},
		}),
	),
	sentOffer(
		"a deposit invoice of another offer",
		signs({
			extra: {
				software_offers: [rowsOffer()],
				software_invoices: [deposit("open", { offer_id: "o2", id: "si2" })],
			},
		}),
	),
	sentOffer(
		"a void deposit and an open one",
		signs({
			extra: {
				software_invoices: [
					deposit("void"),
					deposit("open", { id: "si2", stripe_invoice_id: "in_2" }),
				],
			},
		}),
	),
];

function rowsOffer() {
	return {
		id: "o2",
		request_id: "r1",
		version: 2,
		status: "superseded",
		terms_json: "{}",
		created_at: PAST,
		updated_at: PAST,
		sent_at: PAST,
		sent_by: "o",
	};
}

const race = (
	name: string,
	sql: string,
	sc: Scene = pending,
	extra: Partial<Case> = {},
): Case =>
	own(name, sc, abandonBody(), {
		interleave: [{ on: BATCH, label: name, run: (sqlite) => sqlite.exec(sql) }],
		...extra,
	});

const races: Case[] = [
	race(
		"a deposit invoice is created before the batch",
		"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'creating','o','t','t')",
	),
	race(
		"a deposit invoice is paid before the batch",
		"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'paid','o','t','t')",
	),
	race(
		"the SOW is countersigned before the batch",
		"UPDATE software_agreements SET status='executed' WHERE kind='sow'",
	),
	race(
		"both documents are executed before the batch",
		"UPDATE software_agreements SET status='executed'",
	),
	race(
		"the MSA is abandoned by another request first",
		"UPDATE software_agreements SET status='abandoned' WHERE kind='msa'",
	),
	race(
		"a stored hash changes before the batch",
		`UPDATE software_agreements SET text_sha256='${"e".repeat(64)}' WHERE kind='sow'`,
	),
	race(
		"the agreements are deleted before the batch",
		"DELETE FROM software_agreements",
	),
	race(
		"the offer is superseded before the batch (no error: zero rows)",
		"UPDATE software_offers SET status='superseded'",
	),
	race(
		"the offer link is revoked before the batch",
		`UPDATE software_offer_links SET revoked_at='${LATER}'`,
	),
	race(
		"the request is resolved before the batch",
		"UPDATE owner_requests SET status='resolved'",
	),
	race(
		"the client session is revoked before the batch",
		`UPDATE software_agreement_sessions SET revoked_at='${PAST}'`,
	),
	race(
		"the draft is deleted before the batch",
		"DELETE FROM software_agreement_drafts",
		signs({ draft: {} }),
	),
];

const fail = (
	name: string,
	on: RegExp,
	extra: Partial<Case> = {},
	sc: Scene = pending,
	nth?: number,
): Case =>
	own(name, sc, abandonBody(), {
		failures: [{ on, message: "d1 unavailable", nth }],
		...extra,
	});

const outages: Case[] = [
	fail(
		"outage: the offer lookup",
		/SELECT \* FROM software_offers WHERE request_id=\? AND status='sent'/,
	),
	fail(
		"outage: the read of the agreements",
		/FROM software_agreements WHERE offer_id=\?/,
	),
	fail(
		"outage: the first deposit check",
		/SELECT 1 FROM software_invoices WHERE offer_id=\?/,
	),
	fail(
		"outage: the first deposit check and the recheck after it",
		/^SELECT 1 FROM software_invoices WHERE offer_id=\?/,
		{
			failures: [
				{
					on: /^SELECT 1 FROM software_invoices WHERE offer_id=\?/,
					message: "d1 unavailable",
				},
				{
					on: /^SELECT 1 FROM software_invoices WHERE offer_id=\?/,
					nth: 2,
					message: "d1 unavailable",
				},
			],
		},
	),
	fail("outage: the abandon batch", BATCH),
	fail("outage: the abandon batch while a deposit appeared", BATCH, {
		failures: [{ on: BATCH, message: "d1 unavailable" }],
		interleave: [
			{
				on: BATCH,
				label: "a deposit appears",
				run: (sqlite) =>
					sqlite.exec(
						"INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('si9','r1','o1',0,'deposit',50000,7,'open','o','t','t')",
					),
			},
		],
	}),
	fail("outage: the abandon batch, then the same request again", BATCH, {
		steps: [ownerJson(abandonBody()), ownerJson(abandonBody())],
	}),
	ownForm("outage: the abandon batch", pending, abandonBody(), {
		failures: [{ on: BATCH, message: "d1 unavailable" }],
	}),
];

outages[2] = fail(
	"outage: the first deposit check only",
	/SELECT 1 FROM software_invoices WHERE offer_id=\?/,
);

const sequences: Case[] = [
	{
		name: "abandon, then abandon again (a double click)",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(abandonBody()), ownerJson(abandonBody())],
	},
	{
		name: "abandon, then countersign",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(abandonBody()), ownerJson(countersignBody())],
	},
	{
		name: "abandon three times",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(abandonBody()),
			ownerJson(abandonBody()),
			ownerJson(abandonBody()),
		],
	},
	{
		name: "a refused abandon for a deposit, then the invoice is voided, then abandon",
		...scene(
			signs({
				extra: {
					software_invoices: [deposit("open")],
					software_agreement_links: [openLink],
				},
			}),
		),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(abandonBody()),
			ownerJson(abandonBody(), {
				before: {
					label: "the deposit invoice is voided",
					run: (world) =>
						world.music.exec("UPDATE software_invoices SET status='void'"),
				},
			}),
		],
	},
	{
		name: "an invalid abandon, then a valid one",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [
			ownerJson(abandonBody({ confirmed: false })),
			ownerJson(abandonBody()),
		],
	},
	{
		name: "abandon a day after the client signed",
		...scene(pending),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(abandonBody(), { advanceMs: 86_400_000 })],
	},
	{
		name: "abandon and the client's notices were already closed",
		...scene(
			signs({ notifications: notificationRows("failed", { attempt_id: "a" }) }),
		),
		omit: ["RESEND_API_KEY"],
		steps: [ownerJson(abandonBody())],
	},
	own(
		"a visitor cannot abandon",
		pending,
		abandonBody(),
		{},
		{ as: asVisitor() },
	),
];

const cases: Case[] = [
	...success,
	...reasons,
	...states,
	...deposits,
	...races,
	...outages,
	...sequences,
];

defineCorpus("owner-request-agreement-abandon", POST, cases);
